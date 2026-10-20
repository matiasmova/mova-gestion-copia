import GananciaTrabajo from './GananciaTrabajo'
import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { avisoGuardado } from './Animados'
import CampoNumero from './CampoNumero'
import BuscadorCatalogo from './BuscadorCatalogo'
import { Texto } from './PresupuestoEnVivo'
import ComoLoVeCliente from './ComoLoVeCliente'
import CompararMercado, { type ProductoAComparar } from './CompararMercado'
import { hoy } from './gestionFormat'
import { PCT_ANTICIPO as PCT_SENA } from './estadoObra'
import type { CambioTipo } from './presupuestoModificaciones'
import { ETIQUETA_ADICIONAL, etiquetaModificacion } from './presupuestoModificaciones'

// La obra en vivo: la línea de avances que se toca para cargar o corregir, y el
// presupuesto aceptado que se edita directo. El presupuesto nunca se pisa: cada
// cambio queda guardado como modificación (aprobada o esperando al cliente) y
// el total, el cobro de hoy y lo que falta se recalculan con eso.

const plata = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0))
const conSigno = (n: number) => `${n > 0 ? '+ ' : n < 0 ? '− ' : ''}${plata(Math.abs(n))}`
const redondear = (n: number) => Math.round(n * 100) / 100
const fechaChica = (f: string) => new Date(`${f.slice(0, 10)}T00:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '')

// ---------------------------------------------------------------------------
// Línea de avances tocable
// ---------------------------------------------------------------------------

// Avance por ítem: cada ítem pesa según lo que vale hoy (los quitados no cuentan).
export type AvanceItems = { porcentaje: number; tramos: { desc: string; peso: number; av: number }[] }
const textoAvance = (av: number, cantidad: number) => {
  if (cantidad > 1 && Number.isInteger(cantidad) && cantidad <= 50) return `${Math.round(cantidad * av / 100)} de ${cantidad}`
  return av >= 100 ? 'terminado' : av <= 0 ? 'sin empezar' : 'en curso'
}
const COLORES_AVANCE = ['#e47b00', '#2f6fd6', '#7c5cff', '#12a06a', '#d9483f', '#0e8fb5', '#d4880f', '#8b5cf6']

type AvanceLinea = { id: number; fecha: string; titulo: string; porcentaje: number; estado: string }

// Solo para obras sin presupuesto aceptado (las que tienen presupuesto usan AvanceObra).
export function LineaAvances({ avances, cargando, terminada, onTocar, onNuevo, onInforme, onVerTodo }: {
  avances: AvanceLinea[] // más reciente primero
  cargando: boolean
  terminada: boolean
  onTocar: (id: number) => void
  onNuevo: (porcentaje?: number) => void
  onInforme?: () => void
  onVerTodo: () => void
}) {
  const tira = useRef<HTMLDivElement>(null)
  const orden = [...avances].sort((x, y) => x.fecha.slice(0, 10).localeCompare(y.fecha.slice(0, 10)) || x.id - y.id)
  // Se ve siempre el final de la línea (lo último cargado).
  useEffect(() => { const el = tira.current; if (el) el.scrollLeft = el.scrollWidth }, [avances.length])

  return <section className="oeLinea" aria-label="Avances de la obra">
    <div className="oeTit">
      <span>AVANCES</span>
      <span className="oeTitBtns">
        {onInforme && avances.length > 0 && <button type="button" className="oeIA" onClick={onInforme}>✨ Informe IA</button>}
        <button type="button" className="oeLink" onClick={onVerTodo}>Ver todo ›</button>
      </span>
    </div>
    {cargando ? <p className="oeCargando">Cargando avances…</p> : (
      <div className="oeTiempo" ref={tira}>
        <div className="oeNodo ok fijo"><i aria-hidden>✓</i><b>Aceptado</b><small>inicio</small></div>
        {orden.map((a, i) => {
          const ultimo = i === orden.length - 1
          const fin = Number(a.porcentaje) >= 100
          return <button key={a.id} type="button" className={`oeNodo ok${ultimo && !terminada ? ' hoy' : ''}`} title={a.titulo} onClick={() => onTocar(a.id)}>
            <i aria-hidden>{fin ? '🏁' : Number(a.porcentaje)}</i>
            <b>{fin ? 'Terminada' : `${Number(a.porcentaje)}%`}</b>
            <small>{fechaChica(a.fecha)}</small>
            <em>{a.titulo}</em>
          </button>
        })}
        {!terminada && <>
          <button type="button" className="oeNodo mas" onClick={() => onNuevo()}><i aria-hidden>＋</i><b>Cargar</b><small>avance de hoy</small></button>
          <button type="button" className="oeNodo fin" onClick={() => onNuevo(100)}><i aria-hidden>🏁</i><b>Terminada</b><small>marcar 100%</small></button>
        </>}
      </div>
    )}
    <small className="oeAyuda">Tocá un punto para corregirlo o ＋ para cargar el de hoy.</small>
  </section>
}

// ---------------------------------------------------------------------------
// Avance de la obra (un solo avance): sale de lo que avanzó cada ítem del
// presupuesto, pesado por lo que vale. Cobro: seña + el resto de cada ítem
// según su avance (estadoObra / cuentaObra).
// ---------------------------------------------------------------------------

export function PanelAvance({ porItems, avanceObra, cuenta, onBitacora, onInforme }: {
  porItems: AvanceItems | null | undefined // undefined = cargando; null = el presupuesto no tiene ítems
  avanceObra: number
  cuenta: { anticipo: number; corresponde: number; totalActualizado: number } | null
  onBitacora: () => void
  onInforme?: () => void
}) {
  const marcados = porItems ? porItems.tramos.some((x) => x.av > 0) : false
  const pct = porItems && marcados ? porItems.porcentaje : avanceObra
  return <section className="oeLinea" aria-label="Avance de la obra">
    <div className="oeTit">
      <span>AVANCE DE LA OBRA</span>
      <span className="oeTitBtns">
        {onInforme && <button type="button" className="oeIA" onClick={onInforme}>✨ Informe IA</button>}
        <button type="button" className="oeLink" onClick={onBitacora}>Fotos y notas ›</button>
      </span>
    </div>
    {porItems === undefined ? <div className="oeAvRes cargando" aria-busy="true"><span className="oeAvEsq" /><span className="oeAvEsq corto" /></div>
      : porItems === null ? <p className="oeAyuda">Marcá el avance tocando cada ítem del presupuesto de abajo.</p>
        : <div className="oeAvRes">
          <div className="oeAvResCab">
            <b className="oeAvNum">{Math.round(pct)}<small>%</small></b>
            <span><b>{porItems.tramos.filter((x) => x.av >= 100).length} de {porItems.tramos.length} ítems terminados</b><small>Cada ítem pesa según lo que vale. Se marca tocando el ítem en el presupuesto.</small></span>
          </div>
          <div className="oeAvBarra" role="img" aria-label={`Avance de la obra: ${Math.round(pct)}%`}>
            {porItems.tramos.map((x, i) => <span key={i} style={{ flexGrow: x.peso, ['--c' as string]: COLORES_AVANCE[i % COLORES_AVANCE.length] }} title={`${x.desc} · ${Math.round(x.av)}%`}><i style={{ width: `${x.av}%` }} /></span>)}
          </div>
          <ul className="oeAvLista">
            {porItems.tramos.map((x, i) => <li key={i} style={{ ['--c' as string]: COLORES_AVANCE[i % COLORES_AVANCE.length] }}>
              <i aria-hidden /><span>{x.desc}</span><b className={x.av >= 100 ? 'fin' : ''}>{x.av >= 100 ? '✓ 100%' : `${Math.round(x.av)}%`}</b><em>hecho {plata(x.peso * x.av / 100)} <small>de {plata(x.peso)}</small> · suma hoy <strong>{plata(x.peso * (100 - PCT_SENA) / 100 * x.av / 100)}</strong></em>
            </li>)}
          </ul>
          {!marcados && avanceObra > 0 && <p className="oeAyuda">La obra figura en {Math.round(avanceObra)}% (cargado antes). Marcá cada ítem en el presupuesto de abajo, o usá "Arrancar con todos en {Math.round(avanceObra)}%".</p>}
          {cuenta && cuenta.totalActualizado > 0 && <p className="oeAvCuenta">
            Con este avance corresponde <b>{plata(cuenta.corresponde)}</b>: seña {PCT_SENA}% {plata(cuenta.anticipo)} + el {100 - PCT_SENA}% de lo hecho {plata(Math.max(0, cuenta.corresponde - cuenta.anticipo))}.
          </p>}
        </div>}
  </section>
}

// ---------------------------------------------------------------------------
// Presupuesto en vivo de la obra (cada cambio = modificación)
// ---------------------------------------------------------------------------

type Item = { id: number; presupuesto_id: number; catalogo_id?: number | null; descripcion: string; cantidad: number; precio_unitario: number; descuento_pct: number; tipo?: string | null; costo_unitario?: number | null }
type Adicional = {
  id: number; tipo: string; descripcion: string; motivo: string | null; importe: number; estado: string; fecha: string
  presupuesto_id: number | null; item_id: number | null; cambio_tipo: CambioTipo | null
  cantidad_anterior: number | null; precio_anterior: number | null; cantidad_nueva: number | null; precio_nuevo: number | null
}
type Presu = { id: number; titulo: string; total: number }
type EstadoItem = { descripcion: string; cantidad: number; precio: number; quitado: boolean; modificado: boolean; pendiente: boolean; cambio: Adicional | null }
type Producto = { id: number; nombre: string; nombre_presupuesto?: string | null; unidad: string; precio_venta: number; tipo: string; categoria?: string | null; foto_url?: string | null }

// Lo que se está editando: un ítem del presupuesto o un ítem nuevo (extra).
type Edicion = { clave: string; itemId: number | null; presupuestoId: number; descripcion: string; cantidad: number; precio: string; motivo: string; catalogoId: number | null }
// Paso de confirmación: "¿el cliente ya aprobó?"
type Pregunta = { quitar: boolean; diferencia: number }

const num = (x: unknown) => (x == null || x === '' ? null : Number(x))
const precioNeto = (it: Item) => it.precio_unitario * (1 - (Number(it.descuento_pct) || 0) / 100)

function estadoDe(item: Item, adicionales: Adicional[]): EstadoItem {
  const cambios = adicionales
    .filter((a) => a.tipo === 'cambio' && a.item_id === item.id && a.estado !== 'rechazado')
    .sort((x, y) => (x.fecha ?? '').localeCompare(y.fecha ?? '') || x.id - y.id)
  const ultimo = cambios[cambios.length - 1] ?? null
  const base: EstadoItem = { descripcion: item.descripcion, cantidad: item.cantidad, precio: precioNeto(item), quitado: false, modificado: false, pendiente: false, cambio: null }
  if (!ultimo) return base
  const pendiente = ultimo.estado === 'pendiente'
  if (ultimo.cambio_tipo === 'quitado') return { ...base, quitado: true, modificado: true, pendiente, cambio: ultimo }
  return { descripcion: ultimo.descripcion, cantidad: ultimo.cantidad_nueva ?? base.cantidad, precio: ultimo.precio_nuevo ?? base.precio, quitado: false, modificado: true, pendiente, cambio: ultimo }
}

// onAvanceItems: el avance calculado (para la línea). onAvanceCambiado: se marcó el avance de un ítem (la obra se actualiza sola).
export function PresupuestoVivoObra({ obraId, onCambio, onVerHistorial, onGanancia, avanceObra, onAvanceItems, onAvanceCambiado }: { obraId: number; onCambio: () => void; onVerHistorial: () => void; onGanancia?: (g: number) => void; avanceObra?: number; onAvanceItems?: (a: AvanceItems | null | undefined) => void; onAvanceCambiado?: (a: AvanceItems) => void }) {
  const [presus, setPresus] = useState<Presu[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [adicionales, setAdicionales] = useState<Adicional[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [pregunta, setPregunta] = useState<Pregunta | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorEd, setErrorEd] = useState('')
  const [catalogo, setCatalogo] = useState<Producto[] | null>(null)
  const [verCambios, setVerCambios] = useState(false)
  // Comparar con el mercado: todo el presupuesto (solo para ver) o el ítem que se está editando.
  const [mercado, setMercado] = useState<{ productos: ProductoAComparar[]; deItem: boolean } | null>(null)
  // Avance de cada ítem (columna "avance", fase 40). null = falta el SQL.
  const [avances, setAvances] = useState<Record<number, number> | null>({})
  const [errorAv, setErrorAv] = useState('')

  useEffect(() => {
    let vigente = true
    void (async () => {
      setError('')
      const [rPres, rAdic] = await Promise.all([
        supabase.from('presupuestos').select('id, titulo, total, estado, activo').eq('obra_id', obraId),
        supabase.from('adicionales').select('*').eq('obra_id', obraId).order('fecha').order('id'),
      ])
      if (!vigente) return
      if (rPres.error || rAdic.error) { console.error(rPres.error || rAdic.error); setError('No se pudo cargar el presupuesto de la obra.'); setCargando(false); return }
      const aceptados = (rPres.data ?? []).filter((p) => p.activo !== false && p.estado === 'aceptado').map((p) => ({ id: p.id, titulo: p.titulo, total: Number(p.total || 0) }))
      let filas: Item[] = []
      if (aceptados.length) {
        const rItems = await supabase.from('presupuesto_items').select('id, presupuesto_id, catalogo_id, descripcion, cantidad, precio_unitario, descuento_pct, tipo, costo_unitario').in('presupuesto_id', aceptados.map((p) => p.id)).order('orden', { ascending: true })
        if (!vigente) return
        if (rItems.error) console.error(rItems.error)
        filas = (rItems.data ?? []).map((it) => ({ ...it, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), descuento_pct: Number(it.descuento_pct ?? 0) })) as Item[]
        const rAv = await supabase.from('presupuesto_items').select('id, avance').in('presupuesto_id', aceptados.map((p) => p.id))
        if (!vigente) return
        setAvances(rAv.error ? null : Object.fromEntries(((rAv.data ?? []) as { id: number; avance: number | null }[]).map((x) => [x.id, Number(x.avance) || 0])))
      }
      setPresus(aceptados)
      setItems(filas)
      setAdicionales((rAdic.data ?? []).map((a) => ({
        ...a, importe: Number(a.importe), presupuesto_id: num(a.presupuesto_id), item_id: num(a.item_id), cambio_tipo: a.cambio_tipo ?? null,
        cantidad_anterior: num(a.cantidad_anterior), precio_anterior: num(a.precio_anterior), cantidad_nueva: num(a.cantidad_nueva), precio_nuevo: num(a.precio_nuevo),
      })) as Adicional[])
      setCargando(false)
    })()
    return () => { vigente = false }
  }, [obraId, revision])

  // El catálogo se pide recién al agregar un extra.
  useEffect(() => {
    if (!edicion || edicion.itemId != null || catalogo) return
    void (async () => {
      const columnas = 'id, tipo, nombre, unidad, precio_venta, categoria, foto_url'
      let r = await supabase.from('productos_servicios').select(`${columnas}, nombre_presupuesto`).eq('activo', true).order('nombre')
      if (r.error) r = await supabase.from('productos_servicios').select(columnas).eq('activo', true).order('nombre') as typeof r
      setCatalogo(((r.data ?? []) as Producto[]).map((p) => ({ ...p, precio_venta: Number(p.precio_venta) || 0 })))
    })()
  }, [edicion, catalogo])

  // Peso de cada ítem: lo que vale hoy con los cambios aprobados.
  const pesos = items.map((it) => {
    const v = estadoDe(it, adicionales.filter((a) => a.estado !== 'pendiente'))
    return { it, peso: v.quitado ? 0 : Math.max(0, v.cantidad * v.precio), av: avances?.[it.id] ?? 0, desc: v.descripcion.split('\n')[0], cantidad: v.cantidad }
  })
  const pesoTotal = pesos.reduce((s, x) => s + x.peso, 0)
  const avanceTotal = pesoTotal > 0 ? pesos.reduce((s, x) => s + x.peso * x.av, 0) / pesoTotal : 0
  const conAvance = pesos.filter((x) => x.av > 0)
  const resumenAvance: AvanceItems | null = avances && pesoTotal > 0 ? {
    porcentaje: Math.round(avanceTotal * 1e6) / 1e6,
    tramos: pesos.filter((x) => x.peso > 0).map((x) => ({ desc: x.desc, peso: x.peso, av: x.av })),
  } : null
  const claveResumen = resumenAvance ? resumenAvance.tramos.map((x) => `${x.peso}:${x.av}`).join('|') : ''
  // Solo cuando se cambia un ítem (no al abrir) se actualiza la línea de avances y la obra.
  const cambioPropio = useRef(false)
  useEffect(() => {
    if (cargando) return
    onAvanceItems?.(resumenAvance)
    if (cambioPropio.current && resumenAvance) onAvanceCambiado?.(resumenAvance)
    cambioPropio.current = false
  }, [claveResumen, cargando]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onAvanceItems?.(undefined), []) // eslint-disable-line react-hooks/exhaustive-deps

  async function cambiarAvance(itemId: number, valor: number) {
    if (!avances) return
    const antes = avances[itemId] ?? 0
    const nuevo = Math.max(0, Math.min(100, Math.round(valor)))
    if (nuevo === antes) return
    setErrorAv('')
    const { error: fallo } = await supabase.from('presupuesto_items').update({ avance: nuevo }).eq('id', itemId)
    if (fallo) { console.error(fallo); setErrorAv('No se pudo guardar el avance del ítem. Volvé a intentar.'); return }
    cambioPropio.current = true
    setAvances((m) => ({ ...m, [itemId]: nuevo }))
  }
  // Para arrancar: todos los ítems con el avance que ya tenía la obra.
  async function arrancarCon(pct: number) {
    const ids = items.map((it) => it.id)
    const { error: fallo } = await supabase.from('presupuesto_items').update({ avance: pct }).in('id', ids)
    if (fallo) { console.error(fallo); setErrorAv('No se pudo guardar. Volvé a intentar.'); return }
    cambioPropio.current = true
    setAvances(Object.fromEntries(ids.map((id) => [id, pct])))
  }

  // Control del avance de un ítem (se guarda al tocar, no es una modificación del presupuesto).
  function controlAvance(it: Item) {
    if (!avances) return <div className="oeAvCtrl"><small className="oeAyuda">Para cargar el avance de cada ítem falta correr en Supabase el SQL <b>supabase-avance-items-fase-40.sql</b>.</small></div>
    const av = avances[it.id] ?? 0
    const cant = Number(estadoDe(it, adicionales).cantidad) || 0
    const porUnidad = cant > 1 && Number.isInteger(cant) && cant <= 20
    return <div className="oeAvCtrl">
      <div className="oeAvCab"><b>Avance de este ítem</b><span>{Math.round(av)}% · {textoAvance(av, cant)}</span></div>
      <div className="oeAvChips">
        {porUnidad
          ? Array.from({ length: cant + 1 }, (_, k) => { const p = Math.round(k / cant * 100); return <button key={k} type="button" className={`${Math.round(av) === p ? 'on' : ''}${k === cant ? ' fin' : ''}`} onClick={() => void cambiarAvance(it.id, p)}>{k}</button> })
          : [0, 25, 50, 75, 100].map((p) => <button key={p} type="button" className={`${Math.round(av) === p ? 'on' : ''}${p === 100 ? ' fin' : ''}`} onClick={() => void cambiarAvance(it.id, p)}>{p === 100 ? 'Terminado' : `${p}%`}</button>)}
        {porUnidad && <small>colocados de {cant}</small>}
      </div>
      <input type="range" min={0} max={100} step={5} defaultValue={av} key={av} aria-label="Avance del ítem" onPointerUp={(e) => void cambiarAvance(it.id, Number(e.currentTarget.value))} onKeyUp={(e) => void cambiarAvance(it.id, Number(e.currentTarget.value))}
        onChange={(e) => { const sp = e.currentTarget.parentElement?.querySelector('.oeAvCab span'); if (sp) sp.textContent = `${e.currentTarget.value}% · arrastrá y soltá` }} />
      {errorAv && <p role="alert" className="oeError">{errorAv}</p>}
    </div>
  }

  if (cargando) return <section className="oeDoc"><p className="oeCargando">Cargando presupuesto…</p></section>
  if (error) return <section className="oeDoc"><p role="alert" className="oeError">{error}</p></section>
  if (!presus.length) return null

  // Valor de la obra: original + cambios aprobados (el gasto extra es un reintegro aparte).
  const cuentan = adicionales.filter((a) => a.tipo !== 'gasto_extra')
  const original = presus.reduce((s, p) => s + p.total, 0)
  const aprobados = cuentan.filter((a) => a.estado === 'aprobado' || a.estado === 'pagado').reduce((s, a) => s + a.importe, 0)
  const pendientes = cuentan.filter((a) => a.estado === 'pendiente')
  const totalPend = pendientes.reduce((s, a) => s + a.importe, 0)
  const agregados = adicionales.filter((a) => a.tipo === 'cambio' && a.cambio_tipo === 'agregado' && a.estado !== 'rechazado')
  // Todo lo que suma o resta al total (para ver de dónde sale "Cambios").
  const idsItems = new Set(items.map((it) => it.id))
  const huerfano = (a: Adicional) => a.tipo === 'cambio' && a.cambio_tipo !== 'agregado' && a.item_id != null && !idsItems.has(a.item_id)
  const detalleCambios = cuentan.filter((a) => a.estado !== 'rechazado').sort((x, y) => (y.fecha ?? '').localeCompare(x.fecha ?? '') || y.id - x.id)
  const huerfanos = detalleCambios.filter(huerfano)
  const extras = adicionales.filter((a) => a.tipo !== 'cambio' && a.estado !== 'rechazado')

  function terminar(texto: string) {
    setEdicion(null)
    setPregunta(null)
    setRevision((v) => v + 1)
    onCambio()
    avisoGuardado(texto)
  }

  function abrirItem(it: Item) {
    if (edicion?.clave === `i${it.id}`) { setEdicion(null); setPregunta(null); return }
    const e = estadoDe(it, adicionales)
    setErrorEd('')
    setPregunta(null)
    setEdicion({ clave: `i${it.id}`, itemId: it.id, presupuestoId: it.presupuesto_id, descripcion: e.descripcion, cantidad: e.cantidad, precio: String(redondear(e.precio)), motivo: '', catalogoId: null })
  }

  function abrirExtra() {
    setErrorEd('')
    setPregunta(null)
    setEdicion({ clave: 'nuevo', itemId: null, presupuestoId: presus[0].id, descripcion: '', cantidad: 1, precio: '', motivo: '', catalogoId: null })
    setTimeout(() => document.querySelector('[data-oe-nuevo]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  const itemEd = edicion?.itemId != null ? items.find((x) => x.id === edicion.itemId) ?? null : null
  const estEd = itemEd ? estadoDe(itemEd, adicionales) : null

  // Paso 1: "Listo" o "Quitar" → se pregunta si el cliente ya lo aprobó.
  function preguntar(quitar: boolean) {
    if (!edicion) return
    setErrorEd('')
    const cant = Number(edicion.cantidad) || 0
    const precio = Number(edicion.precio)
    if (!quitar) {
      if (!edicion.descripcion.trim()) { setErrorEd('Escribí la descripción.'); return }
      if (!(cant > 0)) { setErrorEd('La cantidad tiene que ser mayor que cero.'); return }
      if (edicion.precio === '' || !(precio >= 0)) { setErrorEd('Poné el precio unitario.'); return }
    }
    const antes = estEd ? estEd.cantidad * estEd.precio : 0
    const ahora = quitar ? 0 : cant * precio
    if (estEd && itemEd && estEd.modificado && !quitar) {
      const comoOriginal = edicion.descripcion.trim() === itemEd.descripcion.trim() && Math.abs(precio - precioNeto(itemEd)) < 0.005 && Math.abs(cant - itemEd.cantidad) < 0.0005
      if (comoOriginal) { void volverAlOriginal(itemEd.id); return }
    }
    if (estEd && !quitar) {
      const igual = edicion.descripcion.trim() === estEd.descripcion.trim() && Math.abs(precio - estEd.precio) < 0.005 && Math.abs(cant - estEd.cantidad) < 0.0005
      if (igual) { setEdicion(null); return }
    }
    setPregunta({ quitar, diferencia: redondear(ahora - antes) })
  }

  // Paso 2: se guarda la modificación (aprobada o pendiente).
  async function guardar(aprobado: boolean) {
    if (!edicion || !pregunta) return
    const cant = Number(edicion.cantidad) || 0
    const precio = redondear(Number(edicion.precio) || 0)
    let cambioTipo: CambioTipo = 'agregado'
    if (pregunta.quitar) cambioTipo = 'quitado'
    else if (estEd) cambioTipo = edicion.descripcion.trim() !== estEd.descripcion.trim() || Math.abs(precio - estEd.precio) > 0.005 ? 'reemplazo' : 'cantidad'
    setGuardando(true)
    const { error: fallo } = await supabase.from('adicionales').insert({
      obra_id: obraId,
      tipo: 'cambio',
      descripcion: pregunta.quitar && estEd ? estEd.descripcion : edicion.descripcion.trim(),
      motivo: edicion.motivo.trim() || null,
      importe: pregunta.diferencia,
      fecha: hoy(),
      observaciones: null,
      estado: aprobado ? 'aprobado' : 'pendiente',
      presupuesto_id: edicion.presupuestoId,
      item_id: estEd ? edicion.itemId : null,
      cambio_tipo: cambioTipo,
      descripcion_anterior: estEd ? estEd.descripcion : null,
      cantidad_anterior: estEd ? estEd.cantidad : null,
      precio_anterior: estEd ? redondear(estEd.precio) : null,
      cantidad_nueva: pregunta.quitar ? null : cant,
      precio_nuevo: pregunta.quitar ? null : precio,
    })
    setGuardando(false)
    if (fallo) { console.error(fallo); setErrorEd(`No se pudo guardar: ${fallo.message || 'volvé a intentar.'}`); return }
    terminar(aprobado ? 'Cambio aprobado: el total se actualizó' : 'Cambio guardado, espera aprobación')
  }

  // Deshacer: se borran los cambios del ítem y vuelve a como estaba en el
  // presupuesto aceptado. Sirve para corregir un cambio cargado de más.
  async function volverAlOriginal(itemId: number) {
    const it = items.find((x) => x.id === itemId)
    if (!it) return
    if (!window.confirm(`¿Volver "${it.descripcion}" al original (${Number(it.cantidad).toLocaleString('es-AR')} × ${plata(precioNeto(it))})?\n\nSe borran los cambios cargados en este ítem y el total se recalcula.`)) return
    setGuardando(true)
    const { error: fallo } = await supabase.from('adicionales').delete().eq('obra_id', obraId).eq('tipo', 'cambio').eq('item_id', itemId)
    setGuardando(false)
    if (fallo) { console.error(fallo); setErrorEd('No se pudo volver al original. Volvé a intentar.'); return }
    terminar('Volvió al original: el total se actualizó')
  }

  // Borrar un cambio del detalle (con confirmación). Los reintegros y lo cobrado no se tocan acá.
  async function borrarCambio(a: Adicional) {
    if (!window.confirm(`¿Borrar "${a.descripcion}" (${conSigno(a.importe)})?\n\nDeja de sumar o restar y el total se recalcula.`)) return
    setGuardando(true)
    const { error: fallo } = await supabase.from('adicionales').delete().eq('id', a.id)
    setGuardando(false)
    if (fallo) { console.error(fallo); setErrorEd('No se pudo borrar. Volvé a intentar.'); return }
    terminar('Cambio borrado: el total se actualizó')
  }

  // Un extra agregado por error: se borra.
  async function borrarAgregado(a: Adicional) {
    if (!window.confirm(`¿Borrar el extra "${a.descripcion}" (${conSigno(a.importe)})? El total se recalcula.`)) return
    setGuardando(true)
    const { error: fallo } = await supabase.from('adicionales').delete().eq('id', a.id)
    setGuardando(false)
    if (fallo) { console.error(fallo); setErrorEd('No se pudo borrar. Volvé a intentar.'); return }
    terminar('Extra borrado: el total se actualizó')
  }

  // Un cambio pendiente: el cliente lo aprobó o no.
  async function decidir(a: Adicional, estado: 'aprobado' | 'rechazado') {
    setGuardando(true)
    const { error: fallo } = await supabase.from('adicionales').update({ estado }).eq('id', a.id)
    setGuardando(false)
    if (fallo) { console.error(fallo); setErrorEd('No se pudo actualizar. Volvé a intentar.'); return }
    terminar(estado === 'aprobado' ? 'Aprobado: el total se actualizó' : 'Marcado como no aprobado')
  }

  function elegirProducto(id: string) {
    const p = catalogo?.find((x) => x.id === Number(id))
    if (!p || !edicion) return
    setEdicion({ ...edicion, catalogoId: p.id, descripcion: p.nombre_presupuesto || p.nombre, precio: String(p.precio_venta || '') })
  }

  // Panel de edición (mismo para un ítem y para un extra nuevo).
  function panel() {
    if (!edicion) return null
    const pendiente = estEd?.pendiente && estEd.cambio
    if (pendiente) {
      return <div className="oePanel">
        <p className="oeAviso pend">⏳ Este cambio ({conSigno(estEd!.cambio!.importe)}) está esperando que el cliente lo apruebe. Todavía no suma al total.</p>
        <div className="oeDecidir">
          <button type="button" className="si" disabled={guardando} onClick={() => void decidir(estEd!.cambio!, 'aprobado')}>✅ El cliente aprobó</button>
          <button type="button" className="no" disabled={guardando} onClick={() => void decidir(estEd!.cambio!, 'rechazado')}>❌ No lo aprobó</button>
        </div>
        <button type="button" className="oeOriginal" disabled={guardando} onClick={() => void volverAlOriginal(itemEd!.id)}>↩️ Volver al original (borrar los cambios de este ítem)</button>
        {errorEd && <p role="alert" className="oeError">{errorEd}</p>}
      </div>
    }
    if (pregunta) {
      return <div className="oePanel">
        <div className="oePregunta">
          <b>¿El cliente ya aprobó este cambio?</b>
          <span>{pregunta.quitar ? 'Se quita el ítem' : edicion.itemId == null ? 'Se agrega un extra' : 'Se modifica el ítem'}: <strong className={pregunta.diferencia < 0 ? 'resta' : 'suma'}>{conSigno(pregunta.diferencia)}</strong></span>
          <div className="oeDecidir">
            <button type="button" className="si" disabled={guardando} onClick={() => void guardar(true)}>✅ Sí, ya aprobó<small>suma al total y al cobro</small></button>
            <button type="button" className="pe" disabled={guardando} onClick={() => void guardar(false)}>⏳ Todavía no<small>queda pendiente</small></button>
          </div>
          <button type="button" className="oeVolver" disabled={guardando} onClick={() => setPregunta(null)}>‹ Volver a editar</button>
        </div>
        {errorEd && <p role="alert" className="oeError">{errorEd}</p>}
      </div>
    }
    const cant = Number(edicion.cantidad) || 0
    const precio = Number(edicion.precio) || 0
    const antes = estEd ? estEd.cantidad * estEd.precio : 0
    const dif = redondear(cant * precio - antes)
    return <div className="oePanel">
      {estEd?.modificado && itemEd && <div className="oeEraOriginal">
        <span>{estEd.quitado ? 'Este ítem está quitado.' : 'Este ítem tiene cambios.'} Original: <b>{Number(itemEd.cantidad).toLocaleString('es-AR')} × {plata(precioNeto(itemEd))} = {plata(itemEd.cantidad * precioNeto(itemEd))}</b></span>
        <button type="button" disabled={guardando} onClick={() => void volverAlOriginal(itemEd.id)}>↩️ Volver al original</button>
      </div>}
      {edicion.itemId == null && <BuscadorCatalogo catalogo={catalogo ?? []} valor={edicion.catalogoId} cargando={!catalogo} onElegir={elegirProducto}
        onCreado={(p) => { setCatalogo((c) => [...(c ?? []), p]); setEdicion((e) => (e ? { ...e, catalogoId: p.id, descripcion: p.nombre_presupuesto || p.nombre, precio: String(p.precio_venta || '') } : e)) }} />}
      <Texto className="pvDesc" value={edicion.descripcion} onChange={(v) => setEdicion({ ...edicion, descripcion: v })} placeholder="Descripción" />
      <div className="pvCtrl">
        <label>Cantidad</label>
        <div className="pvPaso">
          <button type="button" aria-label="Menos" onClick={() => setEdicion({ ...edicion, cantidad: Math.max(1, cant - 1) })}>−</button>
          <CampoNumero value={edicion.cantidad} onChange={(e) => setEdicion({ ...edicion, cantidad: Number(e.target.value) || 0 })} aria-label="Cantidad" />
          <button type="button" aria-label="Más" onClick={() => setEdicion({ ...edicion, cantidad: cant + 1 })}>+</button>
        </div>
      </div>
      <div className="pvCtrl">
        <label>Precio</label>
        <CampoNumero className="pvPrecio" value={edicion.precio} onChange={(e) => setEdicion({ ...edicion, precio: e.target.value })} aria-label="Precio unitario" />
      </div>
      {edicion.descripcion.trim() && <button type="button" className="pvMercadoItem" onClick={() => setMercado({ deItem: true, productos: [{ nombre: edicion.descripcion.split('\n')[0].trim(), precio: Number(edicion.precio) || 0, cantidad: Number(edicion.cantidad) || 1, tipo: itemEd?.tipo === 'servicio' ? 'servicio' : 'producto', costo: Number(itemEd?.costo_unitario) || 0 }] })}>
        📈 ¿Cómo estoy en el mercado?<small>la IA busca este ítem</small>
      </button>}
      <input className="oeMotivo" value={edicion.motivo} onChange={(e) => setEdicion({ ...edicion, motivo: e.target.value })} placeholder="Motivo (opcional): ej. lo pidió el cliente" />
      <p className="oeAviso">🔁 No se pisa el presupuesto aceptado: queda como modificación{edicion.itemId != null && Math.abs(dif) > 0.5 ? <> · <b>{conSigno(dif)}</b></> : ''}.</p>
      {errorEd && <p role="alert" className="oeError">{errorEd}</p>}
      <div className="pvAcc">
        {estEd && !estEd.quitado && <button type="button" className="rojo" onClick={() => preguntar(true)}>🗑 Quitar</button>}
        <button type="button" onClick={() => { setEdicion(null); setPregunta(null) }}>Cancelar</button>
        <button type="button" className="listo" onClick={() => preguntar(false)}>✓ Listo</button>
      </div>
    </div>
  }

  const marca = (e: { pendiente: boolean; quitado: boolean; modificado: boolean }) =>
    e.pendiente ? <span className="oeMod pe">⏳ por aprobar</span> : e.quitado ? <span className="oeMod no">quitado</span> : e.modificado ? <span className="oeMod ap">modificado</span> : null

  return <section className="oeDoc" aria-label="Presupuesto de la obra">
    <div className="oeTit"><span>PRESUPUESTO</span><span className="oeTitBtns">
      <button type="button" className="oeIA" disabled={!items.length} onClick={() => setMercado({ deItem: false, productos: items.map((it) => { const e = estadoDe(it, adicionales.filter((a) => a.estado !== 'pendiente')); return { nombre: e.descripcion.split('\n')[0], precio: Math.round(e.precio * 100) / 100, cantidad: e.cantidad, tipo: it.tipo === 'servicio' ? 'servicio' : 'producto', costo: Number(it.costo_unitario) || 0 } }).filter((x) => x.cantidad > 0) })}>📈 Comparar precios</button>
      <button type="button" className="oeLink" onClick={onVerHistorial}>Historial ›</button>
    </span></div>
    <div className="oeTotales">
      <div><small>ORIGINAL</small><b>{plata(original)}</b></div>
      <button type="button" className={`cambio${verCambios ? ' on' : ''}`} aria-expanded={verCambios} onClick={() => setVerCambios((v) => !v)}><small>CAMBIOS {verCambios ? '▴' : '▾'}</small><b>{conSigno(aprobados)}</b></button>
      <div className="total"><small>TOTAL HOY</small><b>{plata(original + aprobados)}</b></div>
    </div>
    <GananciaTrabajo presupuestoIds={presus.map((p) => p.id)} obraId={obraId} total={original} adicionales={aprobados}
      items={items.map((it) => ({ tipo: it.tipo ?? '', catalogo_id: it.catalogo_id ?? null, cantidad: it.cantidad, precio_unitario: it.precio_unitario, costo_unitario: Number(it.costo_unitario) || 0, descuento_pct: it.descuento_pct }))}
      reintegros={adicionales.filter((a) => a.tipo === 'gasto_extra' && a.estado !== 'rechazado').reduce((s, a) => s + a.importe, 0)} onGanancia={onGanancia} />
    {huerfanos.length > 0 && !verCambios && <button type="button" className="oeAviso pend oeAvisoBtn" onClick={() => setVerCambios(true)}>⚠ {huerfanos.length === 1 ? 'Hay 1 cambio' : `Hay ${huerfanos.length} cambios`} de ítems que ya no están en el presupuesto (se editó después). Tocá para verlos ›</button>}
    {verCambios && <div className="oeCambios">
      <div className="oeCambiosCab"><b>De dónde salen los cambios</b><button type="button" className="oeLink" onClick={() => setVerCambios(false)}>Cerrar</button></div>
      {detalleCambios.length === 0 ? <small className="oeAyuda">No hay cambios: el total es el del presupuesto aceptado.</small> : detalleCambios.map((a) => (
        <div key={a.id} className="oeCambio">
          <span className="oeTx">
            <b>{a.descripcion}</b>
            <small>{etiquetaModificacion(a)} · {new Date(`${(a.fecha ?? '').slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR')}{a.estado === 'pendiente' ? ' · ⏳ por aprobar (no suma)' : ''}{a.motivo ? ` · ${a.motivo}` : ''}</small>
            {huerfano(a) && <small className="oePropuesto">Este ítem ya no está en el presupuesto: si fue un error, borralo.</small>}
          </span>
          <span className="pvImp">{conSigno(a.importe)}</span>
          {a.estado !== 'pagado' && <button type="button" className="oeCambioBorrar" aria-label="Borrar este cambio" disabled={guardando} onClick={() => void borrarCambio(a)}>🗑</button>}
        </div>
      ))}
    </div>}
    {avances && pesoTotal > 0 && !conAvance.length && <div className="oeAvEmpezar">
      <span><b>Avance por ítem</b><small>Tocá cada ítem y marcá cuánto lleva: el avance de la obra y lo que falta cobrar salen solos de ahí.</small></span>
      {(avanceObra ?? 0) > 0 && (avanceObra ?? 0) < 100 && <button type="button" onClick={() => void arrancarCon(Math.round(avanceObra ?? 0))}>Arrancar con todos en {Math.round(avanceObra ?? 0)}%<small>y después ajustás cada uno</small></button>}
      {errorAv && <p role="alert" className="oeError">{errorAv}</p>}
    </div>}
    <small className="oeAyuda">Tocá un ítem para marcar su avance o cambiarlo (el cambio queda como modificación y el total se recalcula).</small>
    {pendientes.length > 0 && <p className="oeAviso pend">⏳ {pendientes.length === 1 ? '1 cambio espera' : `${pendientes.length} cambios esperan`} aprobación del cliente ({conSigno(totalPend)}). Todavía no suman.</p>}

    {presus.map((p) => {
      const delPresu = items.filter((it) => it.presupuesto_id === p.id)
      return <div key={p.id} className="oeLista">
        {presus.length > 1 && <div className="oeSubTit">{p.titulo}</div>}
        {/* Cómo lo ve el cliente: detallado o resumido, con textos escritos por la IA */}
        <ComoLoVeCliente presupuestoId={p.id} titulo={p.titulo} onGuardado={onCambio}
          items={delPresu.map((it) => ({ tipo: it.tipo === 'servicio' ? 'servicio' : 'producto', descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, costo_unitario: Number(it.costo_unitario) || 0, descuento_pct: it.descuento_pct }))} />
        {delPresu.map((it, i) => {
          const e = estadoDe(it, adicionales)
          // Lo que vale hoy: solo con los cambios aprobados (lo pendiente se muestra aparte).
          const vigente = e.pendiente ? estadoDe(it, adicionales.filter((a) => a.estado !== 'pendiente')) : e
          const abierto = edicion?.clave === `i${it.id}`
          const original = it.cantidad * precioNeto(it)
          const ahora = vigente.quitado ? 0 : vigente.cantidad * vigente.precio
          return <div key={it.id} className={`oeItem${abierto ? ' abierto' : ''}${e.quitado ? ' quitado' : ''}`}>
            <button type="button" className="oeFila" aria-expanded={abierto} onClick={() => abrirItem(it)}>
              <span className="pvN">{String(i + 1).padStart(2, '0')}</span>
              <span className="oeTx"><b>{e.descripcion}{marca(e)}</b><small>{vigente.quitado ? 'Se quita' : !vigente.modificado && Number(it.descuento_pct) > 0
                  ? <>{Number(it.cantidad).toLocaleString('es-AR')} × {plata(it.precio_unitario)}<span className="pvPct">{Number(it.descuento_pct)}% dto.</span><span className="pvCU">= {plata(precioNeto(it))} c/u</span></>
                  : `${Number(vigente.cantidad).toLocaleString('es-AR')} × ${plata(vigente.precio)}`}</small>
                {e.pendiente && <small className="oePropuesto">Propuesto: {e.quitado ? 'quitarlo' : `${Number(e.cantidad).toLocaleString('es-AR')} × ${plata(e.precio)} = ${plata(e.cantidad * e.precio)}`}</small>}
                {avances && !vigente.quitado && (() => { const av = avances[it.id] ?? 0; return <span className={`oeAvFila${av >= 100 ? ' fin' : ''}`}><span className="oeAvMini"><i style={{ width: `${av}%` }} /></span><small>{av >= 100 ? '✓ ' : ''}{Math.round(av)}% · {textoAvance(av, Number(vigente.cantidad) || 0)}</small></span> })()}</span>
              <span className="pvImp">{plata(ahora)}{vigente.modificado && Math.abs(ahora - original) > 0.5 && <s>{plata(original)}</s>}</span>
            </button>
            {abierto && !pregunta && controlAvance(it)}
            {abierto && panel()}
          </div>
        })}
      </div>
    })}

    {(agregados.length > 0 || extras.length > 0) && <div className="oeLista">
      <div className="oeSubTit">Agregado en la obra</div>
      {[...agregados, ...extras].map((a) => {
        const pend = a.estado === 'pendiente'
        const reintegro = a.tipo === 'gasto_extra'
        return <div key={a.id} className="oeItem">
          <div className="oeFila fija">
            <span className="pvN">＋</span>
            <span className="oeTx"><b>{a.descripcion}{pend ? <span className="oeMod pe">⏳ por aprobar</span> : <span className="oeMod ap">{reintegro ? 'reintegro' : 'aprobado'}</span>}</b>
              <small>{a.tipo === 'cambio' ? `${Number(a.cantidad_nueva ?? 1).toLocaleString('es-AR')} × ${plata(a.precio_nuevo ?? a.importe)}` : ETIQUETA_ADICIONAL[a.tipo] ?? a.tipo}</small></span>
            <span className="pvImp">{conSigno(a.importe)}</span>
          </div>
          {!pend && a.tipo === 'cambio' && <div className="oePanel"><button type="button" className="oeOriginal" disabled={guardando} onClick={() => void borrarAgregado(a)}>↩️ Deshacer: borrar este extra</button></div>}
          {pend && (reintegro
            ? <div className="oePanel"><button type="button" className="oeLink" onClick={onVerHistorial}>Revisar el gasto en Cambios y extras ›</button></div>
            : <div className="oePanel"><div className="oeDecidir">
                <button type="button" className="si" disabled={guardando} onClick={() => void decidir(a, 'aprobado')}>✅ Aprobó</button>
                <button type="button" className="no" disabled={guardando} onClick={() => void decidir(a, 'rechazado')}>❌ No aprobó</button>
              </div>{a.tipo === 'cambio' && <button type="button" className="oeOriginal" disabled={guardando} onClick={() => void borrarAgregado(a)}>↩️ Lo cargué por error: borrarlo</button>}</div>)}
        </div>
      })}
    </div>}

    {edicion?.clave === 'nuevo'
      ? <div className="oeItem abierto" data-oe-nuevo><div className="oeFila fija"><span className="pvN">＋</span><span className="oeTx"><b>Extra nuevo</b><small>Elegilo del catálogo o escribilo</small></span></div>{panel()}</div>
      : <button type="button" className="pvAgregarSec" onClick={abrirExtra}>＋ Agregar un extra</button>}

    {mercado && <CompararMercado titulo={presus[0]?.titulo ?? 'Presupuesto de la obra'} productos={mercado.productos} onCerrar={() => setMercado(null)}
      onUsarPrecio={mercado.deItem ? (_i, precio) => setEdicion((e) => (e ? { ...e, precio: String(precio) } : e)) : undefined} />}
  </section>
}
