import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { archivoParaIA, pedirAsistente } from './asistenteIA'
import CampoNumero from './CampoNumero'

// Leer planos: se sube un plano (foto o PDF) y se cuentan, por ambiente, las
// bocas de luz, tomacorrientes, llaves y registros. Dos formas:
//  · Con IA (función "asistente-ia", acción "plano"): lee la simbología y arma la tabla.
//  · A mano: tocando el plano se marca cada elemento y se cuenta solo.
// La tabla se puede corregir. Lo último trabajado queda guardado en este dispositivo.

type Tipo = 'bocas' | 'tomas' | 'llaves' | 'registros'
type Fila = { nombre: string } & Record<Tipo, number>
type Marca = { x: number; y: number; tipo: Tipo }
type Lectura = { estimado: boolean; confianza: 'alta' | 'media' | 'baja'; notas: string; ambientes: Fila[] }

const TIPOS: { id: Tipo; nombre: string; corto: string; color: string }[] = [
  { id: 'bocas', nombre: 'Bocas de luz', corto: 'Bocas', color: '#e47b00' },
  { id: 'tomas', nombre: 'Tomacorrientes', corto: 'Tomas', color: '#2f6fd6' },
  { id: 'llaves', nombre: 'Llaves de luz', corto: 'Llaves', color: '#12a06a' },
  { id: 'registros', nombre: 'Registros', corto: 'Registros', color: '#7c5cff' },
]
const CLAVE = 'mova_plano_ultimo'
const vacia = (nombre: string): Fila => ({ nombre, bocas: 0, tomas: 0, llaves: 0, registros: 0 })

export default function Planos() {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [imagen, setImagen] = useState<string | null>(null)
  const [filas, setFilas] = useState<Fila[]>(() => { try { return (JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as { filas?: Fila[] } | null)?.filas ?? [] } catch { return [] } })
  const [info, setInfo] = useState<Omit<Lectura, 'ambientes'> | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState('')
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [tipoMarca, setTipoMarca] = useState<Tipo>('bocas')
  const [aviso, setAviso] = useState('')
  const entrada = useRef<HTMLInputElement>(null)

  useEffect(() => { try { localStorage.setItem(CLAVE, JSON.stringify({ filas })) } catch { /* sin almacenamiento */ } }, [filas])
  useEffect(() => () => { if (imagen) URL.revokeObjectURL(imagen) }, [imagen])
  function mostrar(t: string) { setAviso(t); window.setTimeout(() => setAviso((a) => (a === t ? '' : a)), 3000) }

  function elegir(f: File | undefined) {
    if (!f) return
    if (!/^image\/|^application\/pdf$/.test(f.type)) { setError('Subí una foto (JPG o PNG) o un PDF del plano.'); return }
    setError(''); setInfo(null); setMarcas([])
    setArchivo(f)
    setImagen(f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  }

  async function leerConIA() {
    if (!archivo) return
    if (archivo.type === 'application/pdf' && archivo.size > 6_000_000) { setError('El PDF pesa más de 6 MB. Sacale una foto o exportá solo la hoja del plano.'); return }
    setError(''); setLeyendo(true)
    try {
      const { data, mime } = await archivoParaIA(archivo, 2400)
      const r = await pedirAsistente<Lectura>({ accion: 'plano', imagen: data, mime })
      if (!r.ambientes.length) { setError('No pude leer ambientes en el plano. Probá con una imagen más nítida o contalo a mano tocando el plano.'); return }
      setFilas(r.ambientes)
      setInfo({ estimado: r.estimado, confianza: r.confianza, notas: r.notas })
    } catch (e) {
      setError((e as Error).message || 'No se pudo leer el plano.')
    } finally { setLeyendo(false) }
  }

  // Conteo a mano: cada toque sobre el plano agrega una marca del tipo elegido.
  // (con clic y no al apoyar el dedo: así deslizar para mover la pantalla no marca nada)
  function marcar(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    setMarcas((m) => [...m, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, tipo: tipoMarca }])
  }
  const cuentaMarcas = (t: Tipo) => marcas.filter((m) => m.tipo === t).length
  function pasarMarcas() {
    if (!marcas.length) return
    const fila: Fila = { nombre: `Conteo a mano ${filas.filter((f) => f.nombre.startsWith('Conteo a mano')).length + 1}`, bocas: cuentaMarcas('bocas'), tomas: cuentaMarcas('tomas'), llaves: cuentaMarcas('llaves'), registros: cuentaMarcas('registros') }
    setFilas((f) => [...f, fila])
    setMarcas([])
    mostrar('El conteo pasó a la tabla')
  }

  const cambiar = (i: number, campo: keyof Fila, valor: string | number) => setFilas((f) => f.map((x, k) => (k === i ? { ...x, [campo]: campo === 'nombre' ? String(valor) : Math.max(0, Math.round(Number(valor) || 0)) } : x)))
  const total = (t: Tipo) => filas.reduce((s, f) => s + (Number(f[t]) || 0), 0)

  async function copiar() {
    const texto = [
      'Conteo del plano',
      ...filas.map((f) => `${f.nombre}: ${TIPOS.map((t) => `${f[t.id]} ${t.corto.toLowerCase()}`).join(', ')}`),
      `TOTAL: ${TIPOS.map((t) => `${total(t.id)} ${t.corto.toLowerCase()}`).join(', ')}`,
    ].join('\n')
    try { await navigator.clipboard.writeText(texto); mostrar('Copiado') } catch { mostrar('No se pudo copiar') }
  }

  return (
    <div className="gestionPage planos">
      <div className="pageHeader">
        <div>
          <p className="subtitle">COMERCIAL</p>
          <h2>Leer planos</h2>
          <p className="gestionAyuda">Subí el plano y contá bocas de luz, tomacorrientes, llaves y registros por ambiente: con IA o tocando el plano.</p>
        </div>
      </div>

      <div className="plCols">
        <section className="plPlano" aria-label="Plano">
          <input ref={entrada} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = '' }} />
          {!archivo ? (
            <button type="button" className="plSubir" onClick={() => entrada.current?.click()}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); elegir(e.dataTransfer.files?.[0]) }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3h18v18H3z" /><path d="M3 9h7v12" /><path d="M10 14h11" /><path d="M14 3v6" /></svg>
              <b>Subí el plano</b>
              <small>Foto (JPG, PNG) o PDF · también podés arrastrarlo acá</small>
            </button>
          ) : <>
            <div className="plArchivo">
              <span><b>{archivo.name}</b><small>{archivo.type === 'application/pdf' ? 'PDF' : 'Imagen'} · {(archivo.size / 1024 / 1024).toFixed(1)} MB</small></span>
              <button type="button" className="cancelButton" onClick={() => entrada.current?.click()}>Cambiar</button>
            </div>
            <button type="button" className="newButton plIA" disabled={leyendo} onClick={() => void leerConIA()}>{leyendo ? 'Leyendo el plano…' : '✨ Contar con IA'}</button>
            {imagen ? <>
              <div className="plTipos" role="radiogroup" aria-label="Qué marcás al tocar">
                {TIPOS.map((t) => <button key={t.id} type="button" role="radio" aria-checked={tipoMarca === t.id} className={tipoMarca === t.id ? 'on' : ''} style={{ ['--c' as string]: t.color }} onClick={() => setTipoMarca(t.id)}>
                  <i aria-hidden />{t.corto}<b>{cuentaMarcas(t.id)}</b>
                </button>)}
              </div>
              <div className="plLienzo" onClick={marcar} role="img" aria-label="Plano: tocá para marcar">
                <img src={imagen} alt="Plano subido" draggable={false} />
                {marcas.map((m, i) => <span key={i} className="plMarca" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, ['--c' as string]: TIPOS.find((t) => t.id === m.tipo)!.color }} />)}
              </div>
              <div className="plAccMarcas">
                <small>Tocá el plano para marcar {TIPOS.find((t) => t.id === tipoMarca)!.nombre.toLowerCase()}.</small>
                <button type="button" className="cancelButton" disabled={!marcas.length} onClick={() => setMarcas((m) => m.slice(0, -1))}>Deshacer</button>
                <button type="button" className="cancelButton" disabled={!marcas.length} onClick={() => setMarcas([])}>Borrar marcas</button>
                <button type="button" className="newButton" disabled={!marcas.length} onClick={pasarMarcas}>Pasar a la tabla ({marcas.length})</button>
              </div>
            </> : <p className="gestionAyuda">Con un PDF se cuenta con IA. Para contar tocando, subí una foto o captura del plano.</p>}
          </>}
          {error && <p className="loginError" role="alert">{error}</p>}
        </section>

        <section className="plResultado" aria-label="Conteo">
          <div className="plTotales">
            {TIPOS.map((t) => <div key={t.id} style={{ ['--c' as string]: t.color }}><small>{t.nombre}</small><b>{total(t.id)}</b></div>)}
          </div>
          {info && <div className={`plInfo c-${info.confianza}`}>
            <b>{info.estimado ? 'Estimado: el plano no tiene la instalación dibujada' : 'Contado del plano'} · confianza {info.confianza}</b>
            {info.notas && <p>{info.notas}</p>}
            <small>Revisá los números: la IA puede equivocarse con símbolos chicos o borrosos.</small>
          </div>}
          {filas.length === 0
            ? <p className="gestionAyuda">Todavía no hay conteo. Subí un plano y tocá "Contar con IA", o marcá a mano.</p>
            : <div className="plTablaWrap">
              <table className="plTabla">
                <thead><tr><th>Ambiente</th>{TIPOS.map((t) => <th key={t.id} className="n">{t.corto}</th>)}<th aria-label="Quitar" /></tr></thead>
                <tbody>
                  {filas.map((f, i) => <tr key={i}>
                    <td><input value={f.nombre} aria-label="Ambiente" onChange={(e) => cambiar(i, 'nombre', e.target.value)} /></td>
                    {TIPOS.map((t) => <td key={t.id} className="n"><CampoNumero value={f[t.id]} aria-label={`${t.nombre} en ${f.nombre}`} onChange={(e) => cambiar(i, t.id, e.target.value)} /></td>)}
                    <td><button type="button" className="plQuitar" aria-label={`Quitar ${f.nombre}`} onClick={() => setFilas((x) => x.filter((_, k) => k !== i))}>✕</button></td>
                  </tr>)}
                </tbody>
                <tfoot><tr><td>Total</td>{TIPOS.map((t) => <td key={t.id} className="n">{total(t.id)}</td>)}<td /></tr></tfoot>
              </table>
            </div>}
          <div className="plAcc">
            <button type="button" className="cancelButton" onClick={() => setFilas((f) => [...f, vacia(`Ambiente ${f.length + 1}`)])}>＋ Ambiente</button>
            <button type="button" className="cancelButton" disabled={!filas.length} onClick={() => void copiar()}>Copiar resumen</button>
            <button type="button" className="cancelButton" disabled={!filas.length} onClick={() => { setFilas([]); setInfo(null) }}>Empezar de nuevo</button>
          </div>
          {aviso && <p className="plAviso" role="status">{aviso}</p>}
        </section>
      </div>
    </div>
  )
}
