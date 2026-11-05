import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'
import CampoNumero from './CampoNumero'
import { useDictado } from './dictadoVoz'
import { cargarEtiquetasObras, type ObraEtiqueta } from './etiquetasObras'
import { DESTINOS, cambiarEstado, cargarDefinitivo, datosVacios, guardarParaRevisar, interpretar, type DatosDictado, type Destino, type Dictado } from './dictados'

// Dictado rápido: 1) te escucha (o escribís), 2) la IA propone a dónde va y
// saca los datos, 3) lo guardás "para revisar" o lo cargás ya.

type Persona = { id: number; nombre: string }
let cacheObras: ObraEtiqueta[] | null = null
let cachePersonas: Persona[] | null = null
async function cargarListas() {
  if (!cacheObras) cacheObras = (await cargarEtiquetasObras()).filter((o) => o.activo)
  if (!cachePersonas) {
    const { data } = await supabase.from('personal').select('id,nombre,apellido,activo').order('nombre')
    cachePersonas = ((data ?? []) as { id: number; nombre: string; apellido: string | null; activo: boolean }[]).filter((p) => p.activo !== false).map((p) => ({ id: p.id, nombre: `${p.nombre} ${p.apellido ?? ''}`.trim() }))
  }
  return { obras: cacheObras, personas: cachePersonas }
}

export default function DictadoRapido({ inicial, onCerrar, onListo }: { inicial?: Dictado; onCerrar: () => void; onListo: (aviso: string) => void }) {
  const [paso, setPaso] = useState<'escucha' | 'pensando' | 'destino'>(inicial ? 'destino' : 'escucha')
  const [texto, setTexto] = useState(inicial?.texto ?? '')
  const [destino, setDestino] = useState<Destino>(inicial?.destino ?? 'nota')
  const [datos, setDatos] = useState<DatosDictado>(inicial?.datos ?? datosVacios())
  const [obras, setObras] = useState<ObraEtiqueta[]>(cacheObras ?? [])
  const [personas, setPersonas] = useState<Persona[]>(cachePersonas ?? [])
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const caja = useRef<HTMLTextAreaElement>(null)
  const dictado = useDictado((t) => setTexto(t))

  useEffect(() => { void cargarListas().then((l) => { setObras(l.obras); setPersonas(l.personas) }) }, [])
  // Al abrir, empieza a escuchar (si el navegador lo permite).
  useEffect(() => { if (!inicial) dictado.empezar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function entender() {
    if (dictado.escuchando) dictado.parar()
    const t = texto.trim()
    if (!t) { setError('Dictá o escribí algo.'); return }
    setError(''); setPaso('pensando')
    const l = await cargarListas()
    const r = await interpretar(t, l.obras.map((o) => ({ id: o.id, etiqueta: o.etiqueta })), l.personas)
    setDestino(r.destino); setDatos(r.datos)
    if (!r.conIA) setAviso('La IA no respondió: elegí vos a dónde va y completá los datos.')
    setPaso('destino')
  }

  const set = (c: Partial<DatosDictado>) => setDatos((d) => ({ ...d, ...c }))
  const setItem = (i: number, c: Partial<DatosDictado['items'][number]>) => setDatos((d) => ({ ...d, items: d.items.map((x, k) => (k === i ? { ...x, ...c } : x)) }))

  async function guardar(ahora: boolean) {
    setError(''); setGuardando(true)
    try {
      if (ahora) {
        const msg = await cargarDefinitivo(texto.trim(), destino, datos)
        if (inicial) await cambiarEstado(inicial.id, 'cargado')
        onListo(`✓ ${msg}`)
      } else {
        const fallo = await guardarParaRevisar({ id: inicial?.id, texto: texto.trim(), destino, datos })
        if (fallo) { setError(fallo); return }
        onListo('Guardado para revisar')
      }
    } catch (e) { setError((e as Error).message) } finally { setGuardando(false) }
  }

  const conObra = destino !== 'compra' && destino !== 'nota'
  const totalItems = datos.items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precio) || 0), 0)

  return <div className="modalOverlay drVelo" onClick={(e) => { if (e.target === e.currentTarget && !guardando) onCerrar() }}>
    <div className="drHoja" role="dialog" aria-modal="true" aria-label="Dictado rápido">
      <span className="drAsa" aria-hidden />
      {paso === 'escucha' && <>
        <h2 className="drTit">{dictado.escuchando ? '🎤 Te escucho…' : '🎤 Dictar rápido'}</h2>
        {dictado.escuchando && <div className="drOndas" aria-hidden>{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 6) * 0.09}s` }} />)}</div>}
        <textarea ref={caja} className="drTexto" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: “En la obra de Aldo agregar dos tomas dobles en el quincho”" aria-label="Lo que dictaste (lo podés corregir)" />
        {dictado.error && <p className="drAyuda">{dictado.error}</p>}
        <p className="drAyuda">Decilo como te salga: un recordatorio, algo que falta en una obra, un extra, un pago, una compra o una nota.</p>
        {error && <p className="loginError">{error}</p>}
        <div className="drAcc">
          <button type="button" className="cancelButton" onClick={onCerrar}>Cancelar</button>
          {!dictado.escuchando && <button type="button" className="editButton" onClick={() => dictado.empezar()}>🎤 {texto ? 'Seguir dictando' : 'Hablar'}</button>}
          <button type="button" className="newButton" onClick={() => void entender()}>Listo ›</button>
        </div>
      </>}
      {paso === 'pensando' && <div className="drPensando"><span className="drOndas chico" aria-hidden><i /><i /><i /><i /><i /></span><b>Entendiendo…</b><small>“{texto}”</small></div>}
      {paso === 'destino' && <>
        <textarea className="drTexto chico" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Lo que dictaste" />
        {aviso && <p className="drAyuda">{aviso}</p>}
        {datos.resumen && <p className="drResumen">✨ {datos.resumen}</p>}
        <span className="drLbl">¿A dónde va?</span>
        <div className="drDestinos">
          {(Object.keys(DESTINOS) as Destino[]).map((k) => <button key={k} type="button" aria-pressed={destino === k} onClick={() => setDestino(k)}>
            {datos.sugerido === k && <span className="drSug">✨ sugerido</span>}
            <b>{DESTINOS[k].icono} {DESTINOS[k].nombre}</b><small>{DESTINOS[k].ayuda}</small>
          </button>)}
        </div>

        <div className="drCampos">
          <label className="formFull">{destino === 'pago' ? 'Nota (opcional)' : destino === 'compra' ? 'Qué comprar' : 'Qué'}<input value={datos.titulo} onChange={(e) => set({ titulo: e.target.value })} /></label>
          {conObra && <label className="formFull">Obra{destino === 'pendObra' || destino === 'modObra' ? ' *' : ''}<select value={datos.obra_id ?? ''} onChange={(e) => set({ obra_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{destino === 'pago' ? '🏢 Gastos como empresa (sin obra)' : destino === 'recordatorio' ? 'Sin obra' : 'Elegí la obra'}</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
          </select></label>}
          {destino === 'pago' && <>
            <label>Empleado *<select value={datos.personal_id ?? ''} onChange={(e) => set({ personal_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Elegí a quién</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select></label>
            <label>Monto *<CampoNumero min="0" value={datos.monto || ''} onChange={(e) => set({ monto: Number(e.target.value) || 0 })} placeholder="$ 0" /></label>
          </>}
          {(destino === 'recordatorio' || destino === 'pendObra' || destino === 'pago') && <>
            <label>{destino === 'pendObra' ? 'Para cuándo (opcional)' : 'Día'}<input type="date" value={datos.fecha ?? ''} onChange={(e) => set({ fecha: e.target.value || null })} /></label>
            {destino === 'recordatorio' && <label>Hora<input type="time" value={datos.hora ?? ''} onChange={(e) => set({ hora: e.target.value || null })} /></label>}
          </>}
        </div>

        {(destino === 'modObra' || destino === 'compra') && <div className="drItems">
          <span className="drLbl">{destino === 'modObra' ? 'Ítems del cambio' : 'Materiales'}</span>
          {datos.items.map((it, i) => <div key={i} className={`drItem${destino === 'compra' ? ' sinPrecio' : ''}`}>
            <input value={it.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} aria-label="Descripción" placeholder="Descripción" />
            <CampoNumero value={it.cantidad} onChange={(e) => setItem(i, { cantidad: Number(e.target.value) || 0 })} aria-label="Cantidad" />
            {destino === 'modObra' && <CampoNumero min="0" value={it.precio || ''} placeholder="$ c/u" onChange={(e) => setItem(i, { precio: Number(e.target.value) || 0 })} aria-label="Precio por unidad" />}
            <button type="button" aria-label="Quitar" onClick={() => set({ items: datos.items.filter((_, k) => k !== i) })}>✕</button>
          </div>)}
          <button type="button" className="drMasItem" onClick={() => set({ items: [...datos.items, { descripcion: '', cantidad: 1, precio: 0 }] })}>＋ Ítem</button>
          {destino === 'modObra' && <>
            <p className="drTotal">Suma al total: <b>{moneda(totalItems)}</b></p>
            <div className="drAprobo" role="radiogroup" aria-label="¿El cliente ya aprobó?">
              <span>¿El cliente ya lo aprobó?</span>
              <button type="button" role="radio" aria-checked={!!datos.aprobado} onClick={() => set({ aprobado: true })}>✅ Sí</button>
              <button type="button" role="radio" aria-checked={!datos.aprobado} onClick={() => set({ aprobado: false })}>⏳ Todavía no</button>
            </div>
          </>}
        </div>}

        {error && <p className="loginError" role="alert">{error}</p>}
        <div className="drAcc col">
          <button type="button" className="newButton" disabled={guardando} onClick={() => void guardar(false)}>{inicial ? 'Guardar cambios' : 'Guardar para revisar'}</button>
          <button type="button" className="drYa" disabled={guardando} onClick={() => void guardar(true)}>{guardando ? 'Guardando…' : '✓ Cargar ahora'}</button>
          <button type="button" className="cancelButton" disabled={guardando} onClick={onCerrar}>Cancelar</button>
        </div>
        {!inicial && <p className="drAyuda centro">“Para revisar” queda arriba en Para hacer hasta que lo cargues.</p>}
      </>}
    </div>
  </div>
}

// Bandeja "Para revisar": lo dictado que todavía no se cargó.
export function RevisarDictados({ lista, onEditar, onCambio, onAviso }: { lista: Dictado[]; onEditar: (d: Dictado) => void; onCambio: () => void; onAviso: (t: string, deshacer?: () => void) => void }) {
  const [ocupado, setOcupado] = useState<number | null>(null)
  const [error, setError] = useState<{ id: number; t: string } | null>(null)
  const [obras, setObras] = useState<ObraEtiqueta[]>(cacheObras ?? [])
  const [personas, setPersonas] = useState<Persona[]>(cachePersonas ?? [])
  useEffect(() => { if (lista.length) void cargarListas().then((l) => { setObras(l.obras); setPersonas(l.personas) }) }, [lista.length])
  if (!lista.length) return null

  async function cargar(d: Dictado) {
    setOcupado(d.id); setError(null)
    try {
      const msg = await cargarDefinitivo(d.texto, d.destino, d.datos)
      await cambiarEstado(d.id, 'cargado')
      onAviso(`✓ ${msg}`); onCambio()
    } catch (e) { setError({ id: d.id, t: (e as Error).message }) } finally { setOcupado(null) }
  }
  async function descartar(d: Dictado) {
    setOcupado(d.id)
    const fallo = await cambiarEstado(d.id, 'descartado')
    setOcupado(null)
    if (fallo) { setError({ id: d.id, t: fallo }); return }
    onCambio()
    onAviso('Dictado descartado', () => void cambiarEstado(d.id, 'revisar').then(onCambio))
  }
  const hace = (f: string) => { const m = Math.round((Date.now() - new Date(f).getTime()) / 60000); return m < 2 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días` }
  const obra = (id: number | null) => obras.find((o) => o.id === id)?.etiqueta
  const persona = (id: number | null) => personas.find((p) => p.id === id)?.nombre

  return <section className="drRevisar" aria-label="Dictados para revisar">
    <h3>🎙️ Para revisar <span>{lista.length}</span></h3>
    {lista.map((d) => {
      const x = d.datos
      const filas: [string, string][] = [
        ...(x.titulo && x.titulo !== d.texto ? [['Qué', x.titulo] as [string, string]] : []),
        ...(x.fecha ? [['Cuándo', `${x.fecha.split('-').reverse().join('/')}${x.hora ? ` · ${x.hora}` : ''}`] as [string, string]] : []),
        ...(d.destino === 'pago' ? [['Empleado', persona(x.personal_id) ?? 'falta elegir'], ['Monto', x.monto ? moneda(x.monto) : 'falta'], ['Obra', obra(x.obra_id) ?? '🏢 Gastos como empresa']] as [string, string][] : []),
        ...x.items.map((it): [string, string] => [it.descripcion, d.destino === 'modObra' ? `${it.cantidad} × ${moneda(it.precio)}` : `${it.cantidad}`]),
        ...(d.destino === 'modObra' ? [['Suma al total', moneda(x.items.reduce((s, it) => s + it.cantidad * it.precio, 0))] as [string, string], ['El cliente', x.aprobado ? 'ya aprobó' : 'todavía no aprobó']] as [string, string][] : []),
      ]
      return <div key={d.id} className="drRev">
        <small>Dictado {hace(d.created_at)}</small>
        <q>{d.texto}</q>
        <div className="drChips"><span className="dest">{DESTINOS[d.destino].icono} {DESTINOS[d.destino].nombre}</span>{d.destino !== 'pago' && obra(x.obra_id) && <span>{obra(x.obra_id)}</span>}</div>
        {filas.length > 0 && <div className="drDet">{filas.map(([a, b], i) => <div key={i}><span>{a}</span><b>{b}</b></div>)}</div>}
        {error?.id === d.id && <p className="loginError">{error.t}</p>}
        <div className="drRevAcc">
          <button type="button" className="drYa" disabled={ocupado === d.id} onClick={() => void cargar(d)}>{ocupado === d.id ? 'Cargando…' : `✓ Cargar ${d.destino === 'modObra' ? 'el cambio' : d.destino === 'pago' ? 'el pago' : 'definitivo'}`}</button>
          <button type="button" className="editButton" disabled={ocupado === d.id} onClick={() => onEditar(d)}>Editar</button>
          <button type="button" className="cancelButton" disabled={ocupado === d.id} onClick={() => void descartar(d)}>Descartar</button>
        </div>
      </div>
    })}
  </section>
}
