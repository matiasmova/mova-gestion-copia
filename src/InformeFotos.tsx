import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { pedirAsistente } from './asistenteIA'
import VistaPreviaPdf from './VistaPreviaPdf'
import { generarPdfInforme, nombreArchivoInforme } from './pdfInformeFotos'

// Generar informe de avance para el cliente: fotos (nuevas o de la obra), un
// texto por foto, "Ordenar con IA" que redacta todo prolijo, y el PDF con las
// fotos para descargar o compartir. Las fotos nuevas se guardan en la obra
// (Fotos y notas) al generar el PDF, con su texto.

type Foto = { id: string; url: string; texto: string; archivo?: File; ruta?: string; guardada?: boolean }
type Borrador = { titulo: string; intro: string; fotos: Foto[]; cierre: string; antesIA?: Omit<Borrador, 'antesIA'> | null }
type FotoObra = { id: number; storage_path: string; descripcion: string | null; url: string }

// El borrador queda en memoria mientras la app está abierta (aunque cierres la sección).
const borradores = new Map<number, Borrador>()
const hoyTexto = () => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
let contador = 0
const nuevoId = () => `f${Date.now()}-${contador++}`

export default function InformeFotos({ obraId, obra, cliente, avance }: { obraId: number; obra: string; cliente: string; avance: number | null }) {
  const [b, setB] = useState<Borrador>(() => borradores.get(obraId) ?? { titulo: `Informe de avance · ${obra}`, intro: '', fotos: [], cierre: '' })
  const [pensando, setPensando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [verPdf, setVerPdf] = useState(false)
  const [guardarEnObra, setGuardarEnObra] = useState(true)
  const [deObra, setDeObra] = useState<FotoObra[] | null>(null)
  const [eligiendo, setEligiendo] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)

  useEffect(() => { borradores.set(obraId, b) }, [obraId, b])
  const cambiar = (c: Partial<Borrador>) => setB((x) => ({ ...x, ...c }))
  const cambiarFoto = (id: string, c: Partial<Foto>) => setB((x) => ({ ...x, fotos: x.fotos.map((f) => (f.id === id ? { ...f, ...c } : f)) }))
  const mover = (i: number, d: number) => setB((x) => { const f = [...x.fotos]; const j = i + d; if (j < 0 || j >= f.length) return x; [f[i], f[j]] = [f[j], f[i]]; return { ...x, fotos: f } })

  function agregarArchivos(lista: FileList | null) {
    const nuevas = Array.from(lista ?? []).filter((a) => a.type.startsWith('image/')).map((a): Foto => ({ id: nuevoId(), url: URL.createObjectURL(a), texto: '', archivo: a }))
    if (nuevas.length) setB((x) => ({ ...x, fotos: [...x.fotos, ...nuevas] }))
  }

  async function abrirFotosObra() {
    setEligiendo(true)
    if (deObra) return
    const { data } = await supabase.from('obra_imagenes').select('id, storage_path, descripcion').eq('obra_id', obraId).order('created_at', { ascending: false }).limit(60)
    const filas = (data ?? []) as { id: number; storage_path: string; descripcion: string | null }[]
    const firmadas = await Promise.all(filas.map(async (f) => {
      const { data: u } = await supabase.storage.from('obras').createSignedUrl(f.storage_path, 3600)
      return u?.signedUrl ? { ...f, url: u.signedUrl } : null
    }))
    setDeObra(firmadas.filter((x): x is FotoObra => !!x))
  }
  function usarDeObra(f: FotoObra) {
    if (b.fotos.some((x) => x.ruta === f.storage_path)) return
    setB((x) => ({ ...x, fotos: [...x.fotos, { id: nuevoId(), url: f.url, texto: f.descripcion ?? '', ruta: f.storage_path, guardada: true }] }))
  }

  async function ordenarConIA() {
    setError(''); setAviso(''); setPensando(true)
    try {
      const r = await pedirAsistente<{ titulo: string; introduccion: string; cierre: string; fotos: { n: number; texto: string }[] }>({
        accion: 'informe_fotos', obra, cliente, fecha: hoyTexto(), avance: avance != null ? Math.round(avance) : '',
        titulo: b.titulo, introduccion: b.intro, cierre: b.cierre, fotos: b.fotos.map((f) => ({ texto: f.texto })),
      })
      const { antesIA: _x, ...antes } = b // eslint-disable-line @typescript-eslint/no-unused-vars
      setB({
        titulo: r.titulo || b.titulo, intro: r.introduccion || b.intro, cierre: r.cierre || b.cierre,
        fotos: b.fotos.map((f, i) => ({ ...f, texto: r.fotos.find((x) => x.n === i + 1)?.texto ?? f.texto })),
        antesIA: antes,
      })
      setAviso('Listo: la IA ordenó y redactó el informe. Revisalo y corregí lo que quieras.')
    } catch (e) { setError((e as Error).message) } finally { setPensando(false) }
  }

  // Al generar el PDF, las fotos nuevas se guardan en la obra (una sola vez).
  async function guardarFotosNuevas(): Promise<void> {
    if (!guardarEnObra) return
    for (const f of b.fotos) {
      if (f.guardada || !f.archivo) continue
      const ruta = `${obraId}/${Date.now()}-${f.archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const subida = await supabase.storage.from('obras').upload(ruta, f.archivo)
      if (subida.error) { console.error(subida.error); continue }
      const { error: e } = await supabase.from('obra_imagenes').insert({ obra_id: obraId, avance_id: null, storage_path: ruta, tipo: 'informe', descripcion: f.texto.trim() || null })
      if (e) console.error(e)
      cambiarFoto(f.id, { ruta, guardada: true })
    }
  }
  async function armarPdf() {
    await guardarFotosNuevas()
    const fotos = await Promise.all(b.fotos.map(async (f) => {
      const blob: Blob = f.archivo ? f.archivo : await (await fetch(f.url)).blob()
      return { blob, texto: f.texto }
    }))
    const datos = { titulo: b.titulo.trim() || `Informe de avance · ${obra}`, obra, cliente, fecha: hoyTexto(), avance, introduccion: b.intro, fotos, cierre: b.cierre }
    return { blob: await generarPdfInforme(datos), nombre: nombreArchivoInforme(datos) }
  }

  function empezarDeNuevo() {
    if (!window.confirm('¿Borrar este borrador del informe? Las fotos que ya se guardaron en la obra no se borran.')) return
    setB({ titulo: `Informe de avance · ${obra}`, intro: '', fotos: [], cierre: '' })
    setAviso(''); setError('')
  }

  const vacio = !b.fotos.length && !b.intro.trim()
  return <div className="ifWrap">
    <p className="gestionAyuda" style={{ marginTop: 0 }}>Cargá fotos, escribí en cada una qué se ve o qué se hizo (como te salga) y tocá <b>✨ Ordenar con IA</b> para que quede prolijo. Después generás el PDF para mandárselo al cliente.</p>
    <label className="ifCampo">Título<input value={b.titulo} onChange={(e) => cambiar({ titulo: e.target.value })} /></label>
    <label className="ifCampo">Introducción (opcional)<textarea rows={4} value={b.intro} onChange={(e) => cambiar({ intro: e.target.value })} placeholder="Ej.: esta semana terminamos el cableado de planta baja y arrancamos con el tablero" /></label>

    <div className="ifFotos">
      {b.fotos.map((f, i) => <div key={f.id} className="ifFoto">
        <img src={f.url} alt={`Foto ${i + 1}`} />
        <div className="ifFotoTx">
          <span className="ifNum">Foto {i + 1}{f.guardada ? <em> · en la obra</em> : null}</span>
          <textarea rows={4} value={f.texto} onChange={(e) => cambiarFoto(f.id, { texto: e.target.value })} placeholder="¿Qué se ve o qué se hizo? Ej.: caños en la losa del living" aria-label={`Texto de la foto ${i + 1}`} />
          <div className="ifFotoAcc">
            <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
            <button type="button" aria-label="Bajar" disabled={i === b.fotos.length - 1} onClick={() => mover(i, 1)}>↓</button>
            <button type="button" className="quitar" aria-label="Quitar del informe" onClick={() => setB((x) => ({ ...x, fotos: x.fotos.filter((y) => y.id !== f.id) }))}>✕ Quitar</button>
          </div>
        </div>
      </div>)}
      <input ref={entrada} type="file" accept="image/*" multiple hidden onChange={(e) => { agregarArchivos(e.target.files); e.target.value = '' }} />
      <div className="ifAgregar">
        <button type="button" onClick={() => entrada.current?.click()}>📷 Agregar fotos</button>
        <button type="button" onClick={() => void abrirFotosObra()}>🖼️ Usar fotos de la obra</button>
      </div>
      {eligiendo && <div className="ifElegir">
        <div className="ifElegirCab"><b>Fotos de la obra</b><button type="button" onClick={() => setEligiendo(false)}>Listo</button></div>
        {deObra == null ? <p className="gestionAyuda">Cargando fotos…</p>
          : deObra.length === 0 ? <p className="gestionAyuda">Esta obra todavía no tiene fotos.</p>
          : <div className="ifElegirGrid">{deObra.map((f) => { const usada = b.fotos.some((x) => x.ruta === f.storage_path); return <button key={f.id} type="button" className={usada ? 'usada' : ''} onClick={() => usarDeObra(f)} aria-pressed={usada}><img src={f.url} alt={f.descripcion ?? 'Foto de la obra'} />{usada && <i>✓</i>}</button> })}</div>}
      </div>}
    </div>

    <label className="ifCampo">Próximos pasos / cierre (opcional)<textarea rows={3} value={b.cierre} onChange={(e) => cambiar({ cierre: e.target.value })} placeholder="Ej.: la semana que viene colocamos las teclas y probamos todo" /></label>

    {error && <p className="loginError" role="alert">{error}</p>}
    {aviso && <p className="ifAviso" role="status">✓ {aviso}{b.antesIA && <button type="button" onClick={() => { if (b.antesIA) setB({ ...b.antesIA, fotos: b.fotos.map((f) => ({ ...f, texto: b.antesIA!.fotos.find((x) => x.id === f.id)?.texto ?? f.texto })), antesIA: null }); setAviso('') }}>↩ Deshacer</button>}</p>}

    <label className="ifCheck"><input type="checkbox" checked={guardarEnObra} onChange={(e) => setGuardarEnObra(e.target.checked)} /> Guardar las fotos nuevas en la obra (Fotos y notas)</label>
    <div className="ifAcc">
      <button type="button" className="ifIA" disabled={pensando || vacio} onClick={() => void ordenarConIA()}>{pensando ? '✨ Redactando…' : '✨ Ordenar con IA'}</button>
      <button type="button" className="newButton" disabled={vacio} onClick={() => setVerPdf(true)}>📄 Ver PDF</button>
      {!vacio && <button type="button" className="cancelButton" onClick={empezarDeNuevo}>Empezar de nuevo</button>}
    </div>
    {verPdf && <VistaPreviaPdf titulo={b.titulo || 'Informe de avance'} generar={armarPdf} onCerrar={() => setVerPdf(false)} />}
  </div>
}
