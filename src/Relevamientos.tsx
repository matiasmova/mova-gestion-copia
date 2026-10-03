import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'
import NuevoCliente, { type ClienteParaObra } from './NuevoCliente'
import NuevoPresupuesto, { type ClienteOpcion, type ObraOpcion, type ItemPresupuesto } from './NuevoPresupuesto'
import type { Pedido } from './BuscadorGlobal'
import { avisoGuardado } from './Animados'
import { AMBIENTES_COMUNES, TIPOS_RELEV, ordenarTexto, descripcionPresupuesto, nombreTipo, type ItemRelev, type TipoRelev } from './relevamientoTexto'
import './relevamientos.css'

// Relevamientos: lo que se anota en la visita al cliente (por ambiente), con fotos
// y dictado por voz, para después pasarlo a un presupuesto con un toque.

type Relevamiento = {
  id: number; cliente_id: number | null; titulo: string; direccion: string | null; fecha: string
  notas: string | null; estado: string; presupuesto_id: number | null; creado_at: string
}
type Foto = { id: number; ambiente: string; archivo: string; url?: string }
type Cliente = ClienteParaObra

const BUCKET = 'relevamientos'
const FALTA_SQL = 'Falta correr en Supabase el SQL "supabase-relevamientos-fase-26.sql".'
const hoy = () => new Date().toISOString().slice(0, 10)
const nombreCliente = (c?: Cliente | null) => (c ? `${c.nombre} ${c.apellido ?? ''}`.trim() : 'Sin cliente')
const fechaCorta = (f: string) => new Date(`${f.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

type Props = {
  pedido?: Pedido | null
  onPedidoAtendido?: () => void
  puedePresupuestar: boolean
  onAbrirPresupuesto?: (id: number) => void
}

export default function Relevamientos({ pedido, onPedidoAtendido, puedePresupuestar, onAbrirPresupuesto }: Props) {
  const [lista, setLista] = useState<Relevamiento[]>([])
  const [conteos, setConteos] = useState<Record<number, { items: number; ver: number }>>({})
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<number | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    let vigente = true
    void (async () => {
      setCargando(true)
      const [rR, rC, rI] = await Promise.all([
        supabase.from('relevamientos').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }),
        supabase.from('Clientes').select('id, nombre, apellido, direccion, localidad').order('nombre', { ascending: true }),
        supabase.from('relevamiento_items').select('relevamiento_id, revisar'),
      ])
      if (!vigente) return
      setCargando(false)
      if (rR.error) { setError(FALTA_SQL); return }
      setError('')
      setLista((rR.data ?? []) as Relevamiento[])
      setClientes((rC.data ?? []) as Cliente[])
      const c: Record<number, { items: number; ver: number }> = {}
      for (const it of (rI.data ?? []) as { relevamiento_id: number; revisar: boolean }[]) {
        c[it.relevamiento_id] ??= { items: 0, ver: 0 }
        c[it.relevamiento_id].items++
        if (it.revisar) c[it.relevamiento_id].ver++
      }
      setConteos(c)
    })()
    return () => { vigente = false }
  }, [rev])

  useEffect(() => {
    if (pedido?.accion === 'nuevo') { setNuevo(true); onPedidoAtendido?.() }
  }, [pedido]) // eslint-disable-line react-hooks/exhaustive-deps

  const clientePorId = (id: number | null) => clientes.find((c) => c.id === id) ?? null
  const q = busqueda.trim().toLowerCase()
  const filtrados = lista.filter((r) => !q || `${r.titulo} ${nombreCliente(clientePorId(r.cliente_id))} ${r.direccion ?? ''}`.toLowerCase().includes(q))

  if (abierto != null) {
    const r = lista.find((x) => x.id === abierto)
    if (r) return <FichaRelevamiento rel={r} cliente={clientePorId(r.cliente_id)} clientes={clientes} puedePresupuestar={puedePresupuestar}
      onAbrirPresupuesto={onAbrirPresupuesto} onVolver={() => { setAbierto(null); setRev((v) => v + 1) }}
      onCambio={(cambio) => setLista((l) => l.map((x) => (x.id === r.id ? { ...x, ...cambio } : x)))}
      onEliminado={() => { setAbierto(null); setRev((v) => v + 1) }} />
  }

  return (
    <div className="relevPage">
      <div className="pageHeader">
        <div>
          <p className="subtitle">VISITAS A CLIENTES</p>
          <h2>Relevamientos</h2>
          <p className="welcome">Anotá lo que ves en la obra, por ambiente, y pasalo a presupuesto</p>
        </div>
        <button className="newButton" onClick={() => setNuevo(true)}>+ Nuevo relevamiento</button>
      </div>

      {error && <p className="loginError" role="alert">{error}</p>}
      {!error && lista.length > 0 && <input className="relevBuscar" placeholder="Buscar por cliente, título o dirección…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />}
      {cargando && <p role="status">Cargando…</p>}
      {!cargando && !error && lista.length === 0 && (
        <div className="relevVacio">
          <span>📋</span>
          <b>Todavía no hay relevamientos</b>
          <p>Cuando vayas a ver un trabajo, creá uno: anotá o dictá lo que hace falta en cada ambiente, sacá fotos y después lo pasás a presupuesto.</p>
          <button className="newButton" onClick={() => setNuevo(true)}>+ Nuevo relevamiento</button>
        </div>
      )}
      <div className="relevLista">
        {filtrados.map((r) => {
          const c = conteos[r.id]
          return (
            <button key={r.id} type="button" className="relevCard" onClick={() => setAbierto(r.id)}>
              <div className="relevCardTop">
                <span>{fechaCorta(r.fecha)}</span>
                <span className={`relevEstado ${r.estado}`}>{r.estado === 'presupuestado' ? '📄 Presupuestado' : '📝 Abierto'}</span>
              </div>
              <b>{r.titulo}</b>
              <small>{nombreCliente(clientePorId(r.cliente_id))}{r.direccion ? ` · ${r.direccion}` : ''}</small>
              <div className="relevCardPie">
                <span>{c?.items ?? 0} ítem{(c?.items ?? 0) === 1 ? '' : 's'}</span>
                {c?.ver ? <span className="ver">👀 {c.ver} para ver</span> : null}
              </div>
            </button>
          )
        })}
      </div>

      {nuevo && <NuevoRelevamiento clientes={clientes} onCancelar={() => setNuevo(false)}
        onClienteCreado={(c) => setClientes((l) => [...l, c].sort((a, b) => a.nombre.localeCompare(b.nombre)))}
        onCreado={(r) => { setNuevo(false); setLista((l) => [r, ...l]); setAbierto(r.id) }} />}
    </div>
  )
}

// ---------- Nuevo relevamiento ----------
function NuevoRelevamiento({ clientes, onCancelar, onCreado, onClienteCreado }: { clientes: Cliente[]; onCancelar: () => void; onCreado: (r: Relevamiento) => void; onClienteCreado: (c: Cliente) => void }) {
  const [clienteId, setClienteId] = useState('')
  const [titulo, setTitulo] = useState('')
  const [direccion, setDireccion] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [creandoCliente, setCreandoCliente] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  function elegirCliente(id: string, lista = clientes) {
    setClienteId(id)
    const c = lista.find((x) => x.id === Number(id))
    if (c && !direccion.trim()) setDireccion([c.direccion, c.localidad].filter(Boolean).join(', '))
  }

  async function crear() {
    setGuardando(true); setError('')
    const { data, error: e } = await supabase.from('relevamientos').insert({
      cliente_id: clienteId ? Number(clienteId) : null, titulo: titulo.trim() || 'Relevamiento', direccion: direccion.trim() || null, fecha,
    }).select('*').single()
    setGuardando(false)
    if (e || !data) { setError(FALTA_SQL); return }
    onCreado(data as Relevamiento)
  }

  return createPortal(
    <div className="modalOverlay"><div className="modalCard relevModal">
      <div className="modalHeader"><div><p className="subtitle">NUEVO</p><h2>Relevamiento</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
      <div className="clienteForm">
        <label>Cliente
          <div className="relevClienteFila">
            <select value={clienteId} onChange={(e) => elegirCliente(e.target.value)}>
              <option value="">Elegí un cliente…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{nombreCliente(c)}</option>)}
            </select>
            <button type="button" className="editButton" onClick={() => setCreandoCliente(true)}>+ Nuevo</button>
          </div>
        </label>
        <label>Título<input placeholder="Ej.: Domótica casa completa" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
        <label>Dirección<input placeholder="Calle, número, localidad" value={direccion} onChange={(e) => setDireccion(e.target.value)} /></label>
        <label>Fecha<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        {error && <p className="loginError">{error}</p>}
        <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button type="button" className="newButton" disabled={guardando} onClick={() => void crear()}>{guardando ? 'Creando…' : 'Empezar relevamiento'}</button></div>
      </div>
      {creandoCliente && createPortal(
        <NuevoCliente onCancelar={() => setCreandoCliente(false)} onGuardado={() => setCreandoCliente(false)}
          onCreado={(c) => { onClienteCreado(c); setCreandoCliente(false); setClienteId(String(c.id)); if (!direccion.trim()) setDireccion([c.direccion, c.localidad].filter(Boolean).join(', ')) }} />,
        document.body,
      )}
    </div></div>,
    document.body,
  )
}

// ---------- Dictado por voz (si el navegador lo permite) ----------
type Reconocedor = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
function crearReconocedor(): Reconocedor | null {
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor }
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return C ? new C() : null
}

// Achica la foto antes de subirla (máx. 1600 px, JPG).
async function comprimir(archivo: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(archivo)
    const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * escala); canvas.height = Math.round(bmp.height * escala)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b ?? archivo), 'image/jpeg', 0.82))
  } catch { return archivo }
}

// ---------- Ficha del relevamiento ----------
function FichaRelevamiento({ rel, cliente, clientes, puedePresupuestar, onAbrirPresupuesto, onVolver, onCambio, onEliminado }: {
  rel: Relevamiento; cliente: Cliente | null; clientes: Cliente[]; puedePresupuestar: boolean; onAbrirPresupuesto?: (id: number) => void
  onVolver: () => void; onCambio: (c: Partial<Relevamiento>) => void; onEliminado: () => void
}) {
  const [items, setItems] = useState<ItemRelev[]>([])
  const [fotos, setFotos] = useState<Foto[]>([])
  const [ambientesExtra, setAmbientesExtra] = useState<string[]>([])
  const [texto, setTexto] = useState('')
  const [escuchando, setEscuchando] = useState(false)
  const [avisoVoz, setAvisoVoz] = useState('')
  const [notas, setNotas] = useState(rel.notas ?? '')
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [presupuestando, setPresupuestando] = useState<{ clientes: ClienteOpcion[]; obras: ObraOpcion[] } | null>(null)
  const [verFoto, setVerFoto] = useState<Foto | null>(null)
  const timers = useRef<Record<string, number>>({})
  const reconocedor = useRef<Reconocedor | null>(null)
  const textoBase = useRef('')

  useEffect(() => {
    let vigente = true
    void (async () => {
      const [rI, rF] = await Promise.all([
        supabase.from('relevamiento_items').select('*').eq('relevamiento_id', rel.id).order('orden', { ascending: true }).order('id', { ascending: true }),
        supabase.from('relevamiento_fotos').select('id, ambiente, archivo').eq('relevamiento_id', rel.id).order('id', { ascending: true }),
      ])
      if (!vigente) return
      setItems(((rI.data ?? []) as (ItemRelev & { canales: number | null; cantidad: number | string })[]).map((x) => ({ ...x, cantidad: Number(x.cantidad) || 1, detalle: x.detalle ?? '' })))
      const fs = (rF.data ?? []) as Foto[]
      if (fs.length) {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrls(fs.map((f) => f.archivo), 3600)
        if (!vigente) return
        setFotos(fs.map((f, i) => ({ ...f, url: data?.[i]?.signedUrl ?? undefined })))
      }
    })()
    return () => { vigente = false; reconocedor.current?.stop() }
  }, [rel.id])

  const ambientes = [...new Set([...items.map((i) => i.ambiente), ...fotos.map((f) => f.ambiente), ...ambientesExtra])]
  const sugeridos = AMBIENTES_COMUNES.filter((a) => !ambientes.includes(a))
  const totalVer = items.filter((i) => i.revisar).length

  // ----- guardado -----
  function guardarRel(cambio: Partial<Relevamiento>, demora = 0) {
    onCambio(cambio)
    window.clearTimeout(timers.current.rel)
    timers.current.rel = window.setTimeout(() => { void supabase.from('relevamientos').update(cambio).eq('id', rel.id) }, demora)
  }
  function cambiarItem(idx: number, cambio: Partial<ItemRelev>, demora = 500) {
    setItems((l) => l.map((x, i) => (i === idx ? { ...x, ...cambio } : x)))
    const it = items[idx]
    if (!it?.id) return
    const clave = `i${it.id}`
    window.clearTimeout(timers.current[clave])
    timers.current[clave] = window.setTimeout(() => { void supabase.from('relevamiento_items').update(cambio).eq('id', it.id!) }, demora)
  }
  async function agregarItems(nuevos: ItemRelev[]) {
    if (!nuevos.length) return
    const base = items.length
    const filas = nuevos.map((n, k) => ({ relevamiento_id: rel.id, ambiente: n.ambiente, cantidad: n.cantidad, tipo: n.tipo, canales: n.canales, detalle: n.detalle || null, revisar: n.revisar, smart: n.smart, orden: base + k }))
    const { data, error } = await supabase.from('relevamiento_items').insert(filas).select('*')
    if (error) { window.alert(FALTA_SQL); return }
    setItems((l) => [...l, ...((data ?? []) as ItemRelev[]).map((x) => ({ ...x, cantidad: Number(x.cantidad) || 1, detalle: x.detalle ?? '' }))])
  }
  async function quitarItem(idx: number) {
    const it = items[idx]
    setItems((l) => l.filter((_, i) => i !== idx))
    if (it?.id) await supabase.from('relevamiento_items').delete().eq('id', it.id)
  }

  // ----- texto / voz -----
  async function ordenar() {
    const nuevos = ordenarTexto(texto, ambientes.length === 1 ? ambientes[0] : 'General')
    if (!nuevos.length) return
    await agregarItems(nuevos)
    setTexto('')
    avisoGuardado(`${nuevos.length} ítem${nuevos.length === 1 ? '' : 's'} agregado${nuevos.length === 1 ? '' : 's'}`)
  }
  function dictar() {
    if (escuchando) { reconocedor.current?.stop(); return }
    const r = crearReconocedor()
    if (!r) { setAvisoVoz('Este navegador no permite dictar desde la app. Tocá el cuadro de texto y usá el 🎤 del teclado del celular: funciona igual.'); return }
    setAvisoVoz('')
    r.lang = 'es-AR'; r.continuous = true; r.interimResults = true
    textoBase.current = texto ? `${texto.trim()}\n` : ''
    r.onresult = (e) => {
      let final = '', parcial = ''
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) final += `${res[0].transcript.trim()}\n`
        else parcial += res[0].transcript
      }
      setTexto(textoBase.current + final + parcial)
    }
    r.onerror = (e) => { if (e.error === 'not-allowed') setAvisoVoz('Permití el micrófono para dictar (o usá el 🎤 del teclado).') }
    r.onend = () => setEscuchando(false)
    reconocedor.current = r
    try { r.start(); setEscuchando(true) } catch { setEscuchando(false) }
  }

  // ----- fotos -----
  async function subirFoto(ambiente: string, archivo: File | undefined) {
    if (!archivo) return
    setSubiendo(ambiente)
    const blob = await comprimir(archivo)
    const ruta = `${rel.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`
    const { error } = await supabase.storage.from(BUCKET).upload(ruta, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) { setSubiendo(null); window.alert(`No se pudo subir la foto. ${FALTA_SQL}`); return }
    const { data } = await supabase.from('relevamiento_fotos').insert({ relevamiento_id: rel.id, ambiente, archivo: ruta }).select('id, ambiente, archivo').single()
    const { data: firma } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 3600)
    setSubiendo(null)
    if (data) setFotos((l) => [...l, { ...(data as Foto), url: firma?.signedUrl }])
  }
  async function quitarFoto(f: Foto) {
    if (!window.confirm('¿Eliminar esta foto?')) return
    setVerFoto(null)
    setFotos((l) => l.filter((x) => x.id !== f.id))
    await supabase.storage.from(BUCKET).remove([f.archivo])
    await supabase.from('relevamiento_fotos').delete().eq('id', f.id)
  }

  function nuevoAmbiente(nombre?: string) {
    const n = (nombre ?? window.prompt('Nombre del ambiente (ej.: Cocina, Quincho, Dormitorio 2)') ?? '').trim()
    if (!n) return
    if (!ambientes.includes(n)) setAmbientesExtra((l) => [...l, n])
    setTimeout(() => document.getElementById(`amb-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }
  function renombrarAmbiente(viejo: string) {
    const n = (window.prompt('Nuevo nombre del ambiente', viejo) ?? '').trim()
    if (!n || n === viejo) return
    setAmbientesExtra((l) => l.map((a) => (a === viejo ? n : a)))
    setItems((l) => l.map((x) => (x.ambiente === viejo ? { ...x, ambiente: n } : x)))
    setFotos((l) => l.map((x) => (x.ambiente === viejo ? { ...x, ambiente: n } : x)))
    void supabase.from('relevamiento_items').update({ ambiente: n }).eq('relevamiento_id', rel.id).eq('ambiente', viejo)
    void supabase.from('relevamiento_fotos').update({ ambiente: n }).eq('relevamiento_id', rel.id).eq('ambiente', viejo)
  }

  // ----- pasar a presupuesto -----
  async function abrirPresupuesto() {
    const [rC, rO] = await Promise.all([
      supabase.from('Clientes').select('id, nombre, apellido, direccion, localidad').order('nombre', { ascending: true }),
      supabase.from('obras').select('id, cliente_id, nombre_obra').order('nombre_obra', { ascending: true }),
    ])
    setPresupuestando({ clientes: (rC.data ?? []) as ClienteOpcion[], obras: (rO.data ?? []) as ObraOpcion[] })
  }
  const itemsPresupuesto: ItemPresupuesto[] = [
    ...items.map((it) => ({ catalogo_id: null, tipo: 'producto' as const, descripcion: descripcionPresupuesto(it), cantidad: it.cantidad, precio_unitario: 0, costo_unitario: 0, descuento_pct: 0 })),
    ...(items.length ? [{ catalogo_id: null, tipo: 'servicio' as const, descripcion: `Mano de obra: instalación y configuración\n${items.reduce((t, i) => t + i.cantidad, 0)} equipos en ${ambientes.filter((a) => items.some((i) => i.ambiente === a)).length} ambientes`, cantidad: 1, precio_unitario: 0, costo_unitario: 0, descuento_pct: 0 }] : []),
  ]
  const pendientesVer = items.filter((i) => i.revisar)
  const notasPresupuesto = [notas.trim(), pendientesVer.length ? `A confirmar en obra: ${pendientesVer.map((i) => `${nombreTipo(i.tipo)} ${i.ambiente}`).join(', ')}.` : ''].filter(Boolean).join('\n')

  async function eliminar() {
    if (!window.confirm('¿Eliminar este relevamiento con sus ítems y fotos? No se puede deshacer.')) return
    if (fotos.length) await supabase.storage.from(BUCKET).remove(fotos.map((f) => f.archivo))
    await supabase.from('relevamientos').delete().eq('id', rel.id)
    onEliminado()
  }

  return (
    <div className="relevPage relevFicha">
      <div className="relevFichaTop">
        <button type="button" className="editButton" onClick={onVolver}>‹ Relevamientos</button>
        <button type="button" className="relevBorrar" onClick={() => void eliminar()} aria-label="Eliminar relevamiento">🗑</button>
      </div>
      <input className="relevTitulo" value={rel.titulo} onChange={(e) => guardarRel({ titulo: e.target.value }, 600)} aria-label="Título" />
      <div className="relevDatos">
        <select value={rel.cliente_id ?? ''} onChange={(e) => guardarRel({ cliente_id: e.target.value ? Number(e.target.value) : null })} aria-label="Cliente">
          <option value="">Sin cliente</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{nombreCliente(c)}</option>)}
        </select>
        <input value={rel.direccion ?? ''} placeholder="Dirección" onChange={(e) => guardarRel({ direccion: e.target.value || null }, 600)} aria-label="Dirección" />
        <input type="date" value={rel.fecha} onChange={(e) => guardarRel({ fecha: e.target.value })} aria-label="Fecha" />
      </div>
      {cliente && <small className="relevClienteTxt">👤 {nombreCliente(cliente)}</small>}

      {/* Anotar o dictar */}
      <div className="relevAnotar">
        <div className="relevAnotarCab"><b>✍️ Anotá o dictá</b><small>Como en WhatsApp: “1 tecla 2 puntos cocina (ver) + dimmer”. Se ordena solo por ambiente.</small></div>
        <textarea rows={4} placeholder={'1 dimmer 2 canales terraza\n1 tecla 3 puntos galería + dimmer\n1 lámpara smart jacuzzi'} value={texto} onChange={(e) => setTexto(e.target.value)} />
        <div className="relevAnotarBtns">
          <button type="button" className={`relevMic ${escuchando ? 'activo' : ''}`} onClick={dictar}>{escuchando ? '⏹ Terminar' : '🎤 Dictar'}</button>
          <button type="button" className="newButton" disabled={!texto.trim()} onClick={() => void ordenar()}>✨ Ordenar y agregar</button>
        </div>
        {escuchando && <small className="relevEscuchando">● Escuchando… hablá tranquilo; tocá Terminar cuando acabes.</small>}
        {avisoVoz && <small className="relevAvisoVoz">{avisoVoz}</small>}
      </div>

      {/* Resumen */}
      {items.length > 0 && (
        <div className="relevResumen">
          <span><b>{items.reduce((t, i) => t + i.cantidad, 0)}</b> equipos</span>
          <span><b>{ambientes.length}</b> ambientes</span>
          {TIPOS_RELEV.filter((t) => items.some((i) => i.tipo === t.id)).map((t) => <span key={t.id}>{t.icono} {items.filter((i) => i.tipo === t.id).reduce((s, i) => s + i.cantidad, 0)} {t.texto}</span>)}
          {totalVer > 0 && <span className="ver">👀 {totalVer} para ver</span>}
        </div>
      )}

      {/* Ambientes */}
      {ambientes.map((amb) => {
        const delAmb = items.map((it, idx) => ({ it, idx })).filter((x) => x.it.ambiente === amb)
        const fotosAmb = fotos.filter((f) => f.ambiente === amb)
        return (
          <section key={amb} id={`amb-${amb}`} className="relevAmb">
            <div className="relevAmbCab">
              <button type="button" className="relevAmbNombre" onClick={() => renombrarAmbiente(amb)} title="Cambiar nombre">{amb} <small>✏️</small></button>
              <span>{delAmb.length} ítem{delAmb.length === 1 ? '' : 's'}</span>
            </div>
            {delAmb.map(({ it, idx }) => (
              <div key={it.id ?? `n${idx}`} className={`relevItem ${it.revisar ? 'ver' : ''}`}>
                <div className="relevItemFila">
                  <div className="relevCant">
                    <button type="button" aria-label="Menos" onClick={() => cambiarItem(idx, { cantidad: Math.max(1, it.cantidad - 1) }, 300)}>−</button>
                    <b>{it.cantidad}</b>
                    <button type="button" aria-label="Más" onClick={() => cambiarItem(idx, { cantidad: it.cantidad + 1 }, 300)}>+</button>
                  </div>
                  <select value={it.tipo} onChange={(e) => cambiarItem(idx, { tipo: e.target.value as TipoRelev }, 0)} aria-label="Tipo">
                    {TIPOS_RELEV.map((t) => <option key={t.id} value={t.id}>{t.icono} {t.texto}</option>)}
                  </select>
                  <label className="relevCanales"><input inputMode="numeric" value={it.canales ?? ''} placeholder="–" onChange={(e) => { const n = parseInt(e.target.value, 10); cambiarItem(idx, { canales: Number.isFinite(n) && n > 0 ? n : null }) }} /><span>{it.tipo === 'tecla' ? 'ptos' : 'can.'}</span></label>
                  <button type="button" className="relevQuitar" aria-label="Quitar ítem" onClick={() => void quitarItem(idx)}>✕</button>
                </div>
                <input className="relevDetalle" value={it.detalle} placeholder="Detalle (ej.: + dimmer, para led 220v)" onChange={(e) => cambiarItem(idx, { detalle: e.target.value })} />
                <div className="relevMarcas">
                  <button type="button" className={it.revisar ? 'on ver' : ''} onClick={() => cambiarItem(idx, { revisar: !it.revisar }, 0)}>👀 Ver</button>
                  <button type="button" className={it.smart ? 'on smart' : ''} onClick={() => cambiarItem(idx, { smart: !it.smart }, 0)}>📶 Smart</button>
                  <select className="relevMover" value={amb} onChange={(e) => cambiarItem(idx, { ambiente: e.target.value }, 0)} aria-label="Mover a otro ambiente">
                    {ambientes.map((a) => <option key={a} value={a}>{a === amb ? 'Mover a…' : a}</option>)}
                  </select>
                </div>
              </div>
            ))}
            <div className="relevAgregar">
              {TIPOS_RELEV.map((t) => <button key={t.id} type="button" onClick={() => void agregarItems([{ ambiente: amb, cantidad: 1, tipo: t.id, canales: null, detalle: '', revisar: false, smart: t.id === 'lampara' }])}>+ {t.icono} {t.texto}</button>)}
            </div>
            <div className="relevFotos">
              {fotosAmb.map((f) => <button key={f.id} type="button" className="relevFoto" onClick={() => setVerFoto(f)}>{f.url ? <img src={f.url} alt={`Foto ${amb}`} /> : '📷'}</button>)}
              <label className="relevFotoAdd">
                <input type="file" accept="image/*" capture="environment" onChange={(e) => { void subirFoto(amb, e.target.files?.[0]); e.target.value = '' }} />
                {subiendo === amb ? '⏳' : '📷'}<small>{subiendo === amb ? 'Subiendo' : 'Foto'}</small>
              </label>
            </div>
          </section>
        )
      })}

      <div className="relevNuevoAmb">
        <b>+ Ambiente</b>
        <div>
          {sugeridos.slice(0, 10).map((a) => <button key={a} type="button" onClick={() => nuevoAmbiente(a)}>{a}</button>)}
          <button type="button" className="otro" onClick={() => nuevoAmbiente()}>Otro…</button>
        </div>
      </div>

      <label className="relevNotas">📝 Notas generales
        <textarea rows={3} placeholder="Tablero, tipo de cañería, horarios, lo que pidió el cliente…" value={notas} onChange={(e) => { setNotas(e.target.value); guardarRel({ notas: e.target.value || null }, 700) }} />
      </label>

      {puedePresupuestar && (
        <div className="relevPasar">
          {rel.presupuesto_id && onAbrirPresupuesto && <button type="button" className="editButton" onClick={() => onAbrirPresupuesto(rel.presupuesto_id!)}>📄 Ver el presupuesto creado</button>}
          <button type="button" className="obraRegistrarBtn" disabled={!items.length} onClick={() => void abrirPresupuesto()}>
            <span>📄 {rel.presupuesto_id ? 'Armar otro presupuesto' : 'Pasar a presupuesto'}</span>
            <small>{items.length ? `${items.length} ítems + mano de obra · solo te falta poner los precios` : 'Agregá ítems para armar el presupuesto'}</small>
          </button>
        </div>
      )}

      {presupuestando && (
        <NuevoPresupuesto clientes={presupuestando.clientes} obras={presupuestando.obras}
          inicial={{ cliente_id: rel.cliente_id, titulo: rel.titulo === 'Relevamiento' ? '' : rel.titulo, descripcion: rel.direccion ? `Según relevamiento del ${fechaCorta(rel.fecha)} en ${rel.direccion}` : `Según relevamiento del ${fechaCorta(rel.fecha)}`, notas: notasPresupuesto, items: itemsPresupuesto }}
          onCancelar={() => setPresupuestando(null)}
          onGuardado={(id) => {
            setPresupuestando(null)
            guardarRel({ estado: 'presupuestado', ...(id ? { presupuesto_id: Number(id) } : {}) })
            avisoGuardado('Presupuesto creado')
          }} />
      )}

      {verFoto && createPortal(
        <div className="relevVisor" onClick={() => setVerFoto(null)}>
          {verFoto.url && <img src={verFoto.url} alt="Foto" />}
          <div className="relevVisorBtns" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="cancelButton" onClick={() => setVerFoto(null)}>Cerrar</button>
            <button type="button" className="adicNo" onClick={() => void quitarFoto(verFoto)}>🗑 Eliminar</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
