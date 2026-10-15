import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import BuscadorCatalogo from './BuscadorCatalogo'
import CampoNumero from './CampoNumero'
import CompararMercado, { posicionPrecio, type ProductoAComparar } from './CompararMercado'
import { descuentoItems, importeBruto, importeNeto, partirDescripcion, pctItem, redondear } from './presupuestoCalculos'
import { MEDIOS_PAGO, cargarFormasPago, guardarFormasPago, type FormasPago } from './formasPago'
import { PARTE_UNICA, cargarResumenDoc, incluyeDe, partesConItems, resumenVacio, type ResumenDoc } from './resumenDocumento'
import { pedirAsistente } from './asistenteIA'
import { codigoPresupuesto } from './codigoPresupuesto'
import logo from './assets/mova-logo.jpg'

// Presupuesto "en vivo": se arma sobre el mismo documento que recibe el cliente.
// Se toca un ítem y se cambia ahí (cantidad, precio, descuento); el total se
// recalcula al instante y todo se guarda solo. Arriba: Detallado/Resumido (con
// texto de la IA) y Comparar precios con el mercado.

type Producto = { id: number; tipo: string; nombre: string; nombre_presupuesto?: string | null; unidad: string; precio_venta: number; costo_unitario: number; categoria?: string | null; foto_url?: string | null }
type Item = ItemPresupuesto & { _k: number }

export type PresupuestoVivo = {
  id: number; titulo: string; estado: string; fecha: string; validez_dias: number | null
  descuento: number; items: ItemPresupuesto[]
}

type Props = {
  presupuesto: PresupuestoVivo; cliente: string; obra: string | null; onCerrar: () => void; onEditorCompleto: () => void; modoInicial?: 'edit' | 'ver'
  // Cuando es la pantalla principal del presupuesto: estado arriba, acciones abajo y menú ⋯.
  estado?: ReactNode
  acciones?: ReactNode
  menu?: (cerrar: () => void) => ReactNode
  extra?: ReactNode
  onGuardado?: () => void
}

const SECCIONES: { tipo: 'producto' | 'servicio'; titulo: string }[] = [
  { tipo: 'producto', titulo: 'Productos y equipos' },
  { tipo: 'servicio', titulo: 'Servicios' },
]
const DESCUENTOS = [0, 5, 10, 15, 25]
let claves = 0
const conClave = (it: ItemPresupuesto): Item => ({ ...it, _k: ++claves })

// Cuadro de texto que crece con lo escrito.
function Texto({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ajustar = () => { el.style.height = 'auto'; if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + 2}px` }
    ajustar()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(ajustar) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [value])
  return <textarea ref={ref} rows={1} className={className} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}

export default function PresupuestoEnVivo({ presupuesto, cliente, obra, onCerrar, onEditorCompleto, modoInicial = 'edit', estado, acciones, menu, extra, onGuardado }: Props) {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [modo, setModo] = useState<'edit' | 'ver'>(modoInicial)
  const [titulo, setTitulo] = useState(presupuesto.titulo)
  const [items, setItems] = useState<Item[]>(() => presupuesto.items.map(conClave))
  const [abierto, setAbierto] = useState<number | null>(null)
  const [catalogo, setCatalogo] = useState<Producto[]>([])
  const [cargandoCat, setCargandoCat] = useState(true)
  const [resumen, setResumen] = useState<ResumenDoc>(resumenVacio)
  const [formas, setFormas] = useState<FormasPago | null>(null)
  const [verItems, setVerItems] = useState<Record<string, boolean>>({})
  const [escribiendo, setEscribiendo] = useState<string | null>(null)
  const [estadoGuardado, setEstadoGuardado] = useState<'ok' | 'guardando' | 'error'>('ok')
  const [errorIA, setErrorIA] = useState('')
  const [mercado, setMercado] = useState<{ productos: ProductoAComparar[]; claves: number[] } | null>(null)
  const [medianas, setMedianas] = useState<Record<number, number>>({})

  // La bonificación general que ya tenía se respeta (los descuentos por ítem se recalculan).
  const bonificacion = useMemo(() => Math.max(0, redondear(Number(presupuesto.descuento || 0) - descuentoItems(presupuesto.items))), []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void (async () => {
      const columnas = 'id, tipo, nombre, unidad, precio_venta, costo_unitario, categoria, foto_url'
      let r = await supabase.from('productos_servicios').select(`${columnas}, nombre_presupuesto`).eq('activo', true).order('nombre')
      if (r.error) r = await supabase.from('productos_servicios').select(columnas).eq('activo', true).order('nombre') as typeof r
      setCatalogo(((r.data ?? []) as Producto[]).map((p) => ({ ...p, precio_venta: Number(p.precio_venta) || 0, costo_unitario: Number(p.costo_unitario) || 0 })))
      setCargandoCat(false)
    })()
    void cargarResumenDoc(presupuesto.id).then((r) => { if (r) setResumen(r) })
    void cargarFormasPago(presupuesto.id).then(setFormas)
  }, [presupuesto.id])

  // Con la ventana abierta, la página de atrás no se mueve.
  useEffect(() => {
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = antes }
  }, [])

  // ---------- Cuentas en vivo ----------
  const validos = items.filter((it) => it.descripcion.trim())
  const sumaNeta = validos.reduce((s, it) => s + importeNeto(it), 0)
  const total = Math.max(0, redondear(sumaNeta - Math.min(bonificacion, sumaNeta)))
  const sena = Math.round(total * 70) / 100

  // ---------- Guardado automático (de a uno por vez) ----------
  const ocupado = useRef(false)
  const pendiente = useRef(false)
  const primera = useRef(true)
  const ultimo = useRef({ titulo, items })
  ultimo.current = { titulo, items }

  async function guardarAhora() {
    if (ocupado.current) { pendiente.current = true; return }
    ocupado.current = true
    setEstadoGuardado('guardando')
    let ok = true
    do {
      pendiente.current = false
      const { titulo: t, items: its } = ultimo.current
      const buenos = its.filter((it) => it.descripcion.trim())
      const dItems = descuentoItems(buenos)
      const bruto = buenos.reduce((s, it) => s + importeBruto(it), 0)
      const descuento = redondear(dItems + Math.min(bonificacion, Math.max(0, bruto - dItems)))
      const r1 = await supabase.from('presupuestos').update({ ...(t.trim() ? { titulo: t.trim() } : {}), descuento }).eq('id', presupuesto.id)
      const r2 = await supabase.from('presupuesto_items').delete().eq('presupuesto_id', presupuesto.id)
      const r3 = buenos.length ? await supabase.from('presupuesto_items').insert(buenos.map((it, i) => ({
        presupuesto_id: presupuesto.id, catalogo_id: it.catalogo_id ?? null, tipo: it.tipo, descripcion: it.descripcion.trim(),
        cantidad: Number(it.cantidad) || 0, precio_unitario: Number(it.precio_unitario) || 0, costo_unitario: Number(it.costo_unitario) || 0,
        descuento_pct: pctItem(it), orden: i,
      }))) : { error: null }
      ok = !(r1.error || r2.error || r3.error)
      if (!ok) console.error(r1.error || r2.error || r3.error)
    } while (pendiente.current)
    ocupado.current = false
    setEstadoGuardado(ok ? 'ok' : 'error')
    if (ok) onGuardado?.()
  }

  useEffect(() => {
    if (primera.current) { primera.current = false; return }
    setEstadoGuardado('guardando')
    const t = setTimeout(() => void guardarAhora(), 900)
    return () => clearTimeout(t)
  }, [titulo, items]) // eslint-disable-line react-hooks/exhaustive-deps

  async function guardarResumen(r: ResumenDoc) {
    setResumen(r)
    setEstadoGuardado('guardando')
    const { error } = await supabase.from('presupuestos').update({ resumen_doc: r }).eq('id', presupuesto.id)
    if (error) { console.error(error); setErrorIA('Para el modo Resumido falta correr en Supabase el SQL "supabase-resumen-documento-fase-28.sql".') }
    setEstadoGuardado(error ? 'error' : 'ok')
    if (!error) onGuardado?.()
  }
  // Los textos se guardan cuando se deja de escribir.
  const tTexto = useRef<ReturnType<typeof setTimeout> | null>(null)
  function cambiarTexto(clave: string, id: string, texto: string) {
    const partes = resumen.grupos[clave]?.length ? resumen.grupos[clave] : [{ id, nombre: PARTE_UNICA, texto: '', incluye: [] }]
    const r = { ...resumen, grupos: { ...resumen.grupos, [clave]: partes.map((p) => (p.id === id ? { ...p, texto } : p)) } }
    setResumen(r)
    setEstadoGuardado('guardando')
    if (tTexto.current) clearTimeout(tTexto.current)
    tTexto.current = setTimeout(() => void guardarResumen(r), 900)
  }

  async function escribirConIA(clave: string, seccion: string, parte: { id: string; nombre: string; texto: string; items: ItemPresupuesto[] }, varias: boolean) {
    setErrorIA(''); setEscribiendo(parte.id)
    try {
      const res = await pedirAsistente<{ texto: string; incluye: string[] }>({
        accion: 'resumen_documento', titulo, seccion, parte: varias ? parte.nombre : '', cantidades: resumen.cantidades, marca: resumen.marca, actual: parte.texto,
        items: parte.items.map((it) => { const p = partirDescripcion(it.descripcion); return `${Number(it.cantidad).toLocaleString('es-AR')} × ${p.detalle ? `${p.titulo} (${p.detalle})` : p.titulo}` }),
      })
      if (!res.texto) throw new Error('La IA no devolvió el texto. Probá de nuevo.')
      const partes = resumen.grupos[clave]?.length ? resumen.grupos[clave] : [{ id: parte.id, nombre: PARTE_UNICA, texto: '', incluye: [] }]
      await guardarResumen({ ...resumen, grupos: { ...resumen.grupos, [clave]: partes.map((p) => (p.id === parte.id ? { ...p, texto: res.texto, incluye: res.incluye ?? [] } : p)) } })
    } catch (e) { setErrorIA((e as Error).message) } finally { setEscribiendo(null) }
  }

  async function cambiarFormas(f: FormasPago) {
    setFormas(f)
    setEstadoGuardado('guardando')
    const ok = await guardarFormasPago(presupuesto.id, f)
    setEstadoGuardado(ok ? 'ok' : 'error')
    if (ok) onGuardado?.()
  }

  // ---------- Ítems ----------
  const cambiarItem = (k: number, cambio: Partial<ItemPresupuesto>) => setItems((l) => l.map((it) => (it._k === k ? { ...it, ...cambio } : it)))
  function elegirProducto(k: number, id: string, nuevo?: Producto) {
    if (!id) { cambiarItem(k, { catalogo_id: null }); return }
    const p = nuevo ?? catalogo.find((x) => x.id === Number(id))
    if (!p) return
    cambiarItem(k, { catalogo_id: p.id, tipo: p.tipo === 'servicio' ? 'servicio' : 'producto', descripcion: p.nombre_presupuesto?.trim() || p.nombre, precio_unitario: p.precio_venta, costo_unitario: p.costo_unitario })
  }
  function agregar(tipo: 'producto' | 'servicio') {
    const nuevo = conClave({ catalogo_id: null, tipo, descripcion: '', cantidad: 1, precio_unitario: 0, costo_unitario: 0, descuento_pct: 0 })
    setItems((l) => [...l, nuevo])
    setAbierto(nuevo._k)
    if (resumen.modo === 'resumido') setVerItems((v) => ({ ...v, [tipo]: true }))
    setTimeout(() => document.querySelector(`[data-item="${nuevo._k}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  }

  function compararPrecios() {
    const lista = validos.filter((it) => Number(it.cantidad) > 0)
    const factor = sumaNeta > 0 ? total / sumaNeta : 1
    setMercado({
      claves: lista.map((it) => it._k),
      productos: lista.map((it) => ({
        id: it.catalogo_id ? Number(it.catalogo_id) : null, nombre: it.descripcion.split('\n')[0].trim(), tipo: it.tipo,
        cantidad: Number(it.cantidad), costo: Number(it.costo_unitario) || 0,
        precio: Math.round((importeNeto(it) / Number(it.cantidad)) * factor * 100) / 100,
      })),
    })
  }
  const marcaMercado = (it: Item) => {
    const m = medianas[it._k]
    if (!m) return null
    const pos = posicionPrecio(Number(it.precio_unitario) * (1 - pctItem(it) / 100), { mediana: m, ofertas: [{}] } as never)
    return pos.dif > 10 ? { c: 'caro', t: 'caro' } : pos.dif < -15 ? { c: 'barato', t: 'barato' } : { c: 'ok', t: 'en precio' }
  }

  const ed = modo === 'edit'
  const codigo = codigoPresupuesto(presupuesto.id)
  const validez = presupuesto.validez_dias ?? 15
  const vence = new Date(new Date(`${presupuesto.fecha.slice(0, 10)}T12:00:00`).getTime() + validez * 86400000).toLocaleDateString('es-AR')
  let numero = 0

  // Sube o baja un ítem dentro de su sección (intercambia el lugar con el vecino).
  function mover(k: number, con: number | null) {
    if (con == null) return
    setItems((l) => {
      const a = l.findIndex((x) => x._k === k), b = l.findIndex((x) => x._k === con)
      if (a < 0 || b < 0) return l
      const n = [...l];[n[a], n[b]] = [n[b], n[a]]
      return n
    })
  }

  // ---------- Mover manteniendo apretado ----------
  // Se mantiene apretado un ítem (o se arrastra desde ⠿) y se suelta donde va.
  // Mientras se arrastra, el ítem cambia de lugar en vivo dentro de su sección.
  const [arrastre, setArrastre] = useState<{ k: number; tipo: string } | null>(null)
  const espera = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const recienArrastrado = useRef(false)
  function empezarPresion(e: React.PointerEvent, it: Item, inmediato = false) {
    if (!ed || e.button > 0) return
    const tipo = it.tipo === 'servicio' ? 'servicio' : 'producto'
    const arrancar = () => { espera.current = null; setAbierto(null); setArrastre({ k: it._k, tipo }); try { navigator.vibrate?.(25) } catch { /* sin vibración */ } }
    if (inmediato) { e.preventDefault(); arrancar(); return }
    espera.current = { timer: setTimeout(arrancar, 380), x: e.clientX, y: e.clientY }
  }
  function cancelarEspera() { if (espera.current) { clearTimeout(espera.current.timer); espera.current = null } }
  useEffect(() => {
    // Antes de empezar: si el dedo se mueve, es scroll (no se arrastra).
    const mov = (e: PointerEvent) => { const w = espera.current; if (w && Math.hypot(e.clientX - w.x, e.clientY - w.y) > 8) cancelarEspera() }
    window.addEventListener('pointermove', mov)
    window.addEventListener('pointerup', cancelarEspera)
    window.addEventListener('pointercancel', cancelarEspera)
    return () => { window.removeEventListener('pointermove', mov); window.removeEventListener('pointerup', cancelarEspera); window.removeEventListener('pointercancel', cancelarEspera) }
  }, [])
  useEffect(() => {
    if (!arrastre) return
    const doc = document.querySelector('.pvDoc') as HTMLElement | null
    let ultimaY = 0
    let auto: ReturnType<typeof setInterval> | null = null
    const ubicar = (y: number) => {
      const filas = Array.from(document.querySelectorAll<HTMLElement>(`.pvItem[data-sec="${arrastre.tipo}"]`))
      const destino = filas.find((f) => { const r = f.getBoundingClientRect(); return y >= r.top && y <= r.bottom })
      const kDestino = destino ? Number(destino.dataset.item) : null
      if (kDestino == null || kDestino === arrastre.k) return
      setItems((l) => {
        const a = l.findIndex((x) => x._k === arrastre.k), b = l.findIndex((x) => x._k === kDestino)
        if (a < 0 || b < 0) return l
        const n = [...l]
        const [movido] = n.splice(a, 1)
        n.splice(b, 0, movido)
        return n
      })
    }
    const mover = (e: PointerEvent) => {
      ultimaY = e.clientY
      ubicar(e.clientY)
      // Cerca del borde, la pantalla se mueve sola.
      const r = doc?.getBoundingClientRect()
      if (auto) { clearInterval(auto); auto = null }
      if (doc && r) {
        const paso = e.clientY < r.top + 60 ? -12 : e.clientY > r.bottom - 90 ? 12 : 0
        if (paso) auto = setInterval(() => { doc.scrollBy(0, paso); ubicar(ultimaY) }, 30)
      }
    }
    const soltar = () => { if (auto) clearInterval(auto); recienArrastrado.current = true; setTimeout(() => { recienArrastrado.current = false }, 250); setArrastre(null) }
    // Mientras se arrastra, el dedo no hace scroll.
    const sinScroll = (e: TouchEvent) => e.preventDefault()
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar)
    window.addEventListener('touchmove', sinScroll, { passive: false })
    return () => {
      if (auto) clearInterval(auto)
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar)
      window.removeEventListener('touchmove', sinScroll)
    }
  }, [arrastre])

  function filaItem(it: Item, anterior: number | null, siguiente: number | null) {
    numero++
    const ab = ed && abierto === it._k
    const pct = pctItem(it)
    const marca = ed ? marcaMercado(it) : null
    const { titulo: t, detalle } = partirDescripcion(it.descripcion)
    return (
      <div key={it._k} data-item={it._k} data-sec={it.tipo === 'servicio' ? 'servicio' : 'producto'} className={`pvItem${ab ? ' abierto' : ''}${arrastre?.k === it._k ? ' arrastrando' : ''}`}>
        <div className="pvFila" role={ed ? 'button' : undefined} tabIndex={ed ? 0 : undefined}
          onPointerDown={(e) => empezarPresion(e, it)}
          onContextMenu={(e) => { if (ed) e.preventDefault() }}
          onClick={() => { if (ed && !recienArrastrado.current) setAbierto(ab ? null : it._k) }}
          onKeyDown={(e) => { if (ed && e.key === 'Enter') setAbierto(ab ? null : it._k) }}>
          {ed && (
            <button type="button" className="pvAgarre" aria-label="Mover (arrastrá, o usá las flechas del teclado)" title="Arrastrá para mover"
              onPointerDown={(e) => { e.stopPropagation(); empezarPresion(e, it, true) }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); mover(it._k, anterior) } if (e.key === 'ArrowDown') { e.preventDefault(); mover(it._k, siguiente) } }}>⠿</button>
          )}
          <span className="pvN">{String(numero).padStart(2, '0')}</span>
          <div className="pvTx">
            <b>{t || <i className="pvVacio">Sin descripción · tocá para completar</i>}</b>
            {detalle && <small className="pvDet">{detalle}</small>}
            <small>{Number(it.cantidad).toLocaleString('es-AR')} × {moneda(Number(it.precio_unitario))}{pct > 0 && <span className="pvPct">−{pct}%</span>}{marca && <span className={`pvMerc ${marca.c}`}>{marca.t}</span>}</small>
          </div>
          <div className="pvImp">{moneda(importeNeto(it))}{pct > 0 && <s>{moneda(importeBruto(it))}</s>}</div>
        </div>
        {ab && (
          <div className="pvPanel">
            <BuscadorCatalogo catalogo={catalogo} valor={it.catalogo_id} cargando={cargandoCat}
              onElegir={(id) => elegirProducto(it._k, id)}
              onCreado={(p) => { const prod = { ...p, costo_unitario: p.costo_unitario } as Producto; setCatalogo((c) => [...c, prod]); elegirProducto(it._k, String(p.id), prod) }} />
            <Texto className="pvDesc" value={it.descripcion} onChange={(v) => cambiarItem(it._k, { descripcion: v })} placeholder="Descripción que lee el cliente" />
            <div className="pvCtrl">
              <label>Cantidad</label>
              <div className="pvPaso">
                <button type="button" aria-label="Menos" onClick={() => cambiarItem(it._k, { cantidad: Math.max(1, Number(it.cantidad) - 1) })}>−</button>
                <CampoNumero value={it.cantidad} onChange={(e) => cambiarItem(it._k, { cantidad: Number(e.target.value) || 0 })} aria-label="Cantidad" />
                <button type="button" aria-label="Más" onClick={() => cambiarItem(it._k, { cantidad: Number(it.cantidad) + 1 })}>+</button>
              </div>
            </div>
            <div className="pvCtrl">
              <label>Precio</label>
              <CampoNumero className="pvPrecio" value={it.precio_unitario} onChange={(e) => cambiarItem(it._k, { precio_unitario: Number(e.target.value) || 0 })} aria-label="Precio unitario" />
              {medianas[it._k] ? <button type="button" className="pvMercadoUsar" onClick={() => cambiarItem(it._k, { precio_unitario: Math.round(medianas[it._k]) })}>Mercado {moneda(medianas[it._k])} · usar</button> : null}
            </div>
            <div className="pvCtrl">
              <label>Descuento</label>
              <div className="pvChips">
                {[...new Set([...DESCUENTOS, pct])].sort((a, b) => a - b).map((d) => (
                  <button type="button" key={d} className={pct === d ? 'on' : ''} onClick={() => cambiarItem(it._k, { descuento_pct: d })}>{d}%</button>
                ))}
              </div>
            </div>
            <div className="pvCtrl">
              <label>Tipo</label>
              <div className="pvChips">
                <button type="button" className={it.tipo === 'producto' ? 'on' : ''} onClick={() => cambiarItem(it._k, { tipo: 'producto' })}>📦 Producto</button>
                <button type="button" className={it.tipo === 'servicio' ? 'on' : ''} onClick={() => cambiarItem(it._k, { tipo: 'servicio' })}>🛠️ Servicio</button>
              </div>
            </div>
            <div className="pvCtrl">
              <label>Costo</label>
              <CampoNumero className="pvPrecio" value={it.costo_unitario} onChange={(e) => cambiarItem(it._k, { costo_unitario: Number(e.target.value) || 0 })} aria-label="Costo unitario" />
              <small className="pvAyuda">interno, no lo ve el cliente</small>
            </div>
            <div className="pvAcc">
              <button type="button" className="rojo" onClick={() => { setItems((l) => l.filter((x) => x._k !== it._k)); setAbierto(null) }}>🗑 Quitar</button>
              <button type="button" className="listo" onClick={() => setAbierto(null)}>✓ Listo</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return createPortal(
    <div className="pvFondo">
      <div className="pvVentana" role="dialog" aria-modal="true" aria-label="Presupuesto en vivo">
        <div className="pvBarra">
          <div className="pvModo" role="tablist">
            <button type="button" className={ed ? 'on' : ''} onClick={() => setModo('edit')}>✏️ Editando</button>
            <button type="button" className={!ed ? 'on' : ''} onClick={() => { setModo('ver'); setAbierto(null) }}>👁️ Como lo ve el cliente</button>
          </div>
          <span className={`pvGuardado ${estadoGuardado}`}>{estadoGuardado === 'ok' ? '✓ Guardado' : estadoGuardado === 'guardando' ? 'Guardando…' : '⚠ No se guardó'}</span>
          {menu && <button type="button" className="pvCerrar" onClick={() => setMenuAbierto((v) => !v)} aria-label="Más opciones" aria-expanded={menuAbierto}>⋯</button>}
          <button type="button" className="pvCerrar" onClick={() => { if (estadoGuardado === 'guardando') void guardarAhora(); onCerrar() }} aria-label="Cerrar">✕</button>
          {menu && menuAbierto && <div className="pfMas pvMenu" role="menu">{menu(() => setMenuAbierto(false))}</div>}
        </div>

        <div className={`pvDoc ${ed ? 'edit' : 'ver'}`}>
          <div className="pvCab">
            <img src={logo} alt="MOVA Tecnología Smart" />
            <div className="pvCod"><small>PRESUPUESTO</small><b>{codigo}</b><span>Válido hasta {vence}</span></div>
          </div>
          {ed
            ? <Texto className="pvTitulo" value={titulo} onChange={setTitulo} placeholder="Título del presupuesto" />
            : <h2 className="pvTitulo">{titulo}</h2>}
          <p className="pvCliente">Cliente: <b>{cliente}</b>{obra ? <> · Obra: <b>{obra}</b></> : null}</p>
          {estado}

          {ed && (
            <div className="pvHerr">
              <div className="pvVista" role="tablist" aria-label="Cómo lo ve el cliente">
                <button type="button" className={resumen.modo !== 'resumido' ? 'on' : ''} onClick={() => void guardarResumen({ ...resumen, modo: 'detallado' })}>📋 Detallado</button>
                <button type="button" className={resumen.modo === 'resumido' ? 'on' : ''} onClick={() => void guardarResumen({ ...resumen, modo: 'resumido' })}>✨ Resumido</button>
              </div>
              <button type="button" className="pvIA" disabled={validos.length === 0} onClick={compararPrecios}>📈 Comparar precios</button>
            </div>
          )}
          {errorIA && <p className="loginError" style={{ margin: 0 }}>{errorIA}</p>}

          <div className="pvTotal">
            <div><small>TOTAL DEL PRESUPUESTO</small><b>{moneda(total)}</b>{bonificacion > 0.5 && <span>Incluye bonificación de {moneda(Math.min(bonificacion, sumaNeta))}</span>}</div>
            <div className="der"><small>SEÑA 70%</small><b>{moneda(sena)}</b></div>
          </div>

          {SECCIONES.map(({ tipo, titulo: tSec }) => {
            const its = items.filter((it) => (it.tipo === 'servicio' ? 'servicio' : 'producto') === tipo)
            if (!its.length && !ed) { return null }
            const res = resumen.modo === 'resumido'
            const conTexto = its.filter((it) => it.descripcion.trim())
            const partes = res ? partesConItems(resumen, tipo, conTexto, validos).filter((p) => p.items.length) : []
            const mostrarItems = !res || (ed && verItems[tipo])
            return (
              <section className="pvSec" key={tipo}>
                <div className="pvSecCab"><b>{tSec.toUpperCase()}</b><span>{moneda(its.reduce((s, it) => s + importeNeto(it), 0))}</span></div>
                {res && partes.map((p) => (
                  <div className="pvParte" key={p.id}>
                    {partes.length > 1 && <b className="pvParteNombre">{p.nombre}</b>}
                    {ed
                      ? <Texto className="pvResTexto" value={escribiendo === p.id ? '✨ Escribiendo…' : p.texto} onChange={(v) => cambiarTexto(tipo, p.id, v)} placeholder="Tocá ✨ Escribir con IA o escribí acá lo que lee el cliente" />
                      : p.texto.trim() && <p className="pvResTexto">{p.texto}</p>}
                    {ed && <button type="button" className="pvIA chico" disabled={!!escribiendo} onClick={() => void escribirConIA(tipo, tSec, p, partes.length > 1)}>{escribiendo === p.id ? 'Escribiendo…' : p.texto.trim() ? '✨ Volver a escribir' : '✨ Escribir con IA'}</button>}
                    {incluyeDe(p, resumen).length > 0 && (
                      <div className="pvIncluye"><small>INCLUYE</small>{incluyeDe(p, resumen).map((x, i) => <span key={i}>{x}</span>)}</div>
                    )}
                  </div>
                ))}
                {res && ed && (
                  <button type="button" className="pvVerItems" onClick={() => setVerItems((v) => ({ ...v, [tipo]: !v[tipo] }))}>
                    {mostrarItems ? '▾ Ocultar ítems y precios' : `▸ Ítems y precios de esta sección (${its.length})`}
                  </button>
                )}
                {mostrarItems && its.map((it, i) => filaItem(it, i > 0 ? its[i - 1]._k : null, i < its.length - 1 ? its[i + 1]._k : null))}
                {ed && <button type="button" className="pvAgregarSec" onClick={() => agregar(tipo)}>＋ Agregar {tipo === 'servicio' ? 'servicio' : 'producto'}</button>}
              </section>
            )
          })}
          {items.length === 0 && !ed && <p className="pvVacioDoc">Todavía no hay ítems.</p>}

          {formas && (
            <div className="pvPagos">
              <small>FORMAS DE PAGO</small>
              <div className="pvChips">
                {MEDIOS_PAGO.filter((m) => ed || formas.medios.includes(m.id)).map((m) => (
                  <button type="button" key={m.id} className={formas.medios.includes(m.id) ? 'on' : ''} disabled={!ed}
                    onClick={() => void cambiarFormas({ ...formas, medios: formas.medios.includes(m.id) ? formas.medios.filter((x) => x !== m.id) : [...formas.medios, m.id] })}>
                    {m.icono} {m.texto}
                  </button>
                ))}
              </div>
            </div>
          )}

          {ed && extra}
          {ed && (
            <p className="pvMasOpc">¿Descripción, notas, bonificación general o soluciones? <button type="button" onClick={onEditorCompleto}>Abrir el editor completo</button></p>
          )}
        </div>

        <div className="pvPie">
          <div><small>Total · seña 70% {moneda(sena)}</small><b>{moneda(total)}</b></div>
          {acciones ?? <button type="button" onClick={() => { if (estadoGuardado === 'guardando') void guardarAhora(); onCerrar() }}>✓ Listo</button>}
        </div>
      </div>

      {mercado && (
        <CompararMercado titulo={titulo} productos={mercado.productos} total={total} onCerrar={() => setMercado(null)}
          onResultados={(m) => setMedianas((prev) => { const n = { ...prev }; m.forEach((v, i) => { if (v) n[mercado.claves[i]] = v }); return n })}
          onUsarPrecio={(i, precio) => cambiarItem(mercado.claves[i], { precio_unitario: precio })} />
      )}
    </div>,
    document.body,
  )
}
