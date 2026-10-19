import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import GraficoMeses from './GraficoMeses'
import { cuentaTrabajo, esExtraDeObra, totalEmpleados, type FilaEmpleado } from './gananciaTrabajo'

// Inicio en una sola pantalla, con la misma cuenta que el presupuesto:
//  · Ganancia en productos: venta − costo de cada producto vendido.
//  · Ganancia en servicios: servicios (100% tuyos) − empleados − extras de la obra.
//  · Menos los gastos de la empresa y los impuestos = ganancia final.
// Cada trabajo cuenta en el mes en que se aceptó su presupuesto. Los empleados
// son lo acordado con el personal de la obra (o el pago estimado del
// presupuesto si todavía no hay personal). Comprar stock NO resta: es plata
// invertida, que se ve en "Invertido en stock".

type Pres = { id: number; cliente_id: number; obra_id: number | null; titulo: string; estado: string; total: number; fecha: string | null; pago_empleados_estimado?: number | null }
type Costo = { monto: number; fecha: string; tipo?: string | null; personal_id: number | null; obra_id: number | null }
type Gasto = { id: number; fecha: string; categoria: string | null; descripcion: string | null; monto: number }
type Adicional = { obra_id: number; importe: number; estado: string; tipo: string }
type Item = { presupuesto_id: number; tipo: string; cantidad: number; precio_unitario: number; costo_unitario: number; descuento_pct: number }
type Fila = { pres: Pres; ganancia: number }
type ObraAct = { id: number; nombre_obra: string; cliente_id: number; porcentaje_avance: number | null }
type Deuda = { obra: ObraAct; saldo: number; faltaAvance: number; extras: number; situacion: 'rojo' | 'naranja' | 'verde' }
type DebePersonal = { clave: string; obraId: number; nombre: string; obra: string; debe: number }

export type Tarea = { clave: string; icono: string; tono: 'r' | 'n' | 'a' | 'v'; titulo: string; detalle: string; boton: string; principal?: boolean; accion: () => void }
export type DestinoInicio = 'obras' | 'presupuestos' | 'gastos' | 'catalogo'

type Props = {
  nombre: string
  verFinanzas: boolean
  presupuestos: Pres[]
  costos: Costo[]
  gastos: Gasto[]
  adicionales: Adicional[]
  empleadosObra: Record<number, FilaEmpleado[]> // personal de cada obra (acordado y pagado)
  deudas: Deuda[]
  porCobrar: number
  obrasActivas: ObraAct[]
  debePersonal: DebePersonal[]
  tareas: Tarea[]
  nombreCli: (id: number) => string
  onAbrirObra: (id: number) => void
  onAbrirPresupuesto?: (id: number) => void
  onIr: (destino: DestinoInicio) => void
  ia?: ReactNode
  acciones?: ReactNode
}

type Rango = 6 | 12 | 0 // 0 = este año
type Clave = 'vendido' | 'productos' | 'servicios' | 'gastos' | 'impuestos' | 'ganancia'
type Hoja = Clave | 'cobrar' | 'obras' | 'hoy' | 'stock'

const SERIES: { k: Clave; t: string; c: string }[] = [
  { k: 'vendido', t: 'Aceptados', c: '#475569' },
  { k: 'productos', t: 'Ganancia productos', c: '#e0701a' },
  { k: 'servicios', t: 'Ganancia servicios', c: '#2f63b8' },
  { k: 'gastos', t: 'Gastos empresa', c: '#cf4b37' },
  { k: 'impuestos', t: 'Impuestos', c: '#7c3aed' },
  { k: 'ganancia', t: 'Ganancia final', c: '#1d9a5b' },
]
const pesos = (n: number) => `${n < 0 ? '− ' : ''}$ ${Math.round(Math.abs(n)).toLocaleString('es-AR')}`
const corto = (n: number) => { const a = Math.abs(n); const s = n < 0 ? '− ' : ''; return a >= 1e6 ? `${s}$ ${(a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 2 })} M` : a >= 1e3 ? `${s}$ ${Math.round(a / 1e3).toLocaleString('es-AR')} k` : `${s}$ ${Math.round(a)}` }
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const ymDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const mesNombre = (ym: string, f: 'long' | 'short') => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: f }).replace('.', '')
const esImpuesto = (g: Gasto) => (g.categoria ?? '').trim().toLowerCase() === 'impuestos'
const esInvProductos = (g: Gasto) => (g.categoria ?? '').trim().toLowerCase() === 'inversión en productos'

export default function InicioSimple(p: Props) {
  const hoy = new Date()
  const ymHoy = ymDe(hoy)
  const [rango, setRango] = useState<Rango>(12)
  const [sel, setSel] = useState(ymHoy)
  const [ocultas, setOcultas] = useState<Set<Clave>>(new Set())
  const [hoja, setHoja] = useState<Hoja | null>(null)

  // Ítems de los presupuestos aceptados (para separar productos de servicios).
  const aceptados = useMemo(() => p.presupuestos.filter((x) => x.estado === 'aceptado'), [p.presupuestos])
  const [items, setItems] = useState<Item[] | null>(null)
  useEffect(() => {
    if (!p.verFinanzas) return
    let vigente = true
    async function cargar() {
      const ids = aceptados.map((x) => x.id)
      const filas: Array<Record<string, unknown>> = []
      for (let i = 0; i < ids.length; i += 200) {
        const r = await supabase.from('presupuesto_items').select('presupuesto_id,catalogo_id,tipo,cantidad,precio_unitario,costo_unitario,descuento_pct').in('presupuesto_id', ids.slice(i, i + 200))
        if (!r.error) filas.push(...((r.data ?? []) as Array<Record<string, unknown>>))
      }
      // Ítem guardado sin costo: se usa el costo actual del catálogo.
      const idsCat = Array.from(new Set(filas.map((f) => Number(f.catalogo_id)).filter((x) => x > 0)))
      const costoCat: Record<number, number> = {}
      for (let i = 0; i < idsCat.length; i += 200) {
        const r = await supabase.from('productos_servicios').select('id,costo_unitario').in('id', idsCat.slice(i, i + 200))
        for (const c of (r.error ? [] : (r.data ?? [])) as Array<{ id: number; costo_unitario: unknown }>) costoCat[c.id] = Number(c.costo_unitario) || 0
      }
      if (!vigente) return
      setItems(filas.map((f) => ({
        presupuesto_id: Number(f.presupuesto_id),
        tipo: String(f.tipo ?? '').trim().toLowerCase(),
        cantidad: Number(f.cantidad) || 0,
        precio_unitario: Number(f.precio_unitario) || 0,
        costo_unitario: Number(f.costo_unitario) || costoCat[Number(f.catalogo_id)] || 0,
        descuento_pct: Number(f.descuento_pct) || 0,
      })))
    }
    void cargar()
    return () => { vigente = false }
  }, [aceptados, p.verFinanzas])

  // Meses que muestra el gráfico.
  const meses = useMemo(() => {
    const n = rango === 0 ? hoy.getMonth() + 1 : rango
    return Array.from({ length: Math.max(n, 2) }, (_, i) => ymDe(new Date(hoy.getFullYear(), hoy.getMonth() - (Math.max(n, 2) - 1 - i), 1)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rango, ymHoy])

  // Stock: plata invertida y lo que ganarías vendiéndolo.
  const [stock, setStock] = useState<{ invertido: number; ganarias: number } | null>(null)
  useEffect(() => {
    if (!p.verFinanzas) return
    void supabase.from('productos_servicios').select('tipo, activo, stock, costo_unitario, precio_venta').then(({ data, error }) => {
      if (error) return
      const prods = ((data ?? []) as { tipo: string; activo: boolean | null; stock: unknown; costo_unitario: unknown; precio_venta: unknown }[]).filter((x) => x.tipo === 'producto' && x.activo !== false && Number(x.stock) > 0)
      const invertido = prods.reduce((s2, x) => s2 + Number(x.costo_unitario || 0) * Number(x.stock), 0)
      const valor = prods.reduce((s2, x) => s2 + Number(x.precio_venta || 0) * Number(x.stock), 0)
      setStock({ invertido, ganarias: valor - invertido })
    })
  }, [p.verFinanzas])

  // Cuentas de un mes (mismas reglas para la curva y para el detalle).
  const calcular = useMemo(() => {
    const itemsPor: Record<number, Item[]> = {}
    ;(items ?? []).forEach((it) => { (itemsPor[it.presupuesto_id] ??= []).push(it) })
    // Lo que es de toda la obra (personal, extras, cambios) va con su primer presupuesto aceptado.
    const primero: Record<number, Pres> = {}
    const estimadoObra: Record<number, number> = {}
    aceptados.forEach((x) => {
      if (x.obra_id == null) return
      estimadoObra[x.obra_id] = (estimadoObra[x.obra_id] ?? 0) + (Number(x.pago_empleados_estimado) || 0)
      const pr = primero[x.obra_id]
      if (!pr || (x.fecha ?? '') < (pr.fecha ?? '')) primero[x.obra_id] = x
    })
    return (ym: string) => {
      const en = (f: string | null | undefined) => (f ?? '').slice(0, 7) === ym
      let ventaProductos = 0, costoProductos = 0, servicios = 0, bonificacion = 0, adicionales = 0, empleados = 0, extras = 0, sinCosto = 0, conEstimado = 0
      const filas: Fila[] = aceptados.filter((x) => en(x.fecha)).map((x) => {
        const deObra = x.obra_id != null && primero[x.obra_id]?.id === x.id
        const adic = deObra ? p.adicionales.filter((a) => a.obra_id === x.obra_id && a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s2, a) => s2 + a.importe, 0) : 0
        let emp = 0
        if (x.obra_id == null) { emp = Number(x.pago_empleados_estimado) || 0; if (emp) conEstimado++ }
        else if (deObra) {
          // Lo acordado + (lo estimado para los que cobran por pagos, o lo ya pagado si es más).
          const t = totalEmpleados(p.empleadosObra[x.obra_id] ?? [], estimadoObra[x.obra_id] ?? 0)
          emp = t.total
          if (!t.hayAsignados && (estimadoObra[x.obra_id] ?? 0) > 0) conEstimado++
        }
        const ext = deObra ? p.costos.filter((c) => c.obra_id === x.obra_id && esExtraDeObra(c)).reduce((s2, c) => s2 + c.monto, 0) : 0
        const c = cuentaTrabajo(itemsPor[x.id] ?? [], x.total, emp, ext, adic)
        ventaProductos += c.ventaProductos; costoProductos += c.costoProductos; servicios += c.servicios; bonificacion += c.bonificacion
        adicionales += adic; empleados += emp; extras += ext; sinCosto += c.sinCosto
        return { pres: x, ganancia: c.ganancia }
      }).sort((a2, b2) => b2.pres.total - a2.pres.total)
      const vendido = filas.reduce((s2, f2) => s2 + f2.pres.total, 0) + adicionales
      const ganProductos = ventaProductos - costoProductos
      const ganServicios = servicios + adicionales - bonificacion - empleados - extras

      // Gastos de la empresa: todo menos impuestos (van aparte) e inversión en productos (es stock, no gasto).
      const gastosEmp = p.gastos.filter((g) => !esImpuesto(g) && !esInvProductos(g) && en(g.fecha))
      const porCat: Record<string, number> = {}
      gastosEmp.forEach((g) => { const k = g.categoria || 'Otros'; porCat[k] = (porCat[k] || 0) + g.monto })
      const gastos = gastosEmp.reduce((s2, g) => s2 + g.monto, 0)
      const invProductos = p.gastos.filter((g) => esInvProductos(g) && en(g.fecha)).reduce((s2, g) => s2 + g.monto, 0)
      const impuestosLista = p.gastos.filter((g) => esImpuesto(g) && en(g.fecha)).sort((a2, b2) => b2.fecha.localeCompare(a2.fecha))
      const impuestos = impuestosLista.reduce((s2, g) => s2 + g.monto, 0)
      const reintegrar = p.costos.filter((c) => c.tipo === 'gasto_extra' && en(c.fecha)).reduce((s2, c) => s2 + c.monto, 0)
      return {
        filas, vendido, ventaProductos, costoProductos, productos: ganProductos, sinCosto,
        serviciosVendidos: servicios, adicionales, bonificacion, empleados, extras, conEstimado, servicios: ganServicios,
        gastos, porCat: Object.entries(porCat).sort((a2, b2) => b2[1] - a2[1]), invProductos, reintegrar,
        impuestos, impuestosLista,
        ganancia: ganProductos + ganServicios - gastos - impuestos,
      }
    }
  }, [aceptados, items, p.costos, p.gastos, p.adicionales, p.empleadosObra])

  const serie = useMemo(() => meses.map((ym) => ({ ym, ...calcular(ym) })), [meses, calcular])
  const d = useMemo(() => calcular(sel), [calcular, sel])

  // ---- Gráfico de barras por mes ----
  const colores = Object.fromEntries(SERIES.map((x) => [x.k, x.c])) as Record<Clave, string>
  const alternar = (k: Clave) => setOcultas((o) => {
    const n = new Set(o)
    if (n.has(k)) n.delete(k)
    else if (n.size < SERIES.length - 1) n.add(k)
    return n
  })
  const margen = d.vendido > 0 ? Math.round((d.ganancia / d.vendido) * 100) : null
  const nombreMes = mesNombre(sel, 'long')

  const lista = (filas: [string, string, number, (() => void)?][], color: string) => {
    const tot = filas.reduce((s, f) => s + Math.max(0, f[2]), 0)
    return <div className="isLista2">{filas.map(([a, b, m, accion]) => {
      const cuerpo = <><div><b>{a}</b>{b && <small>{b}</small>}<span className="isMiniBar"><i style={{ width: `${tot > 0 ? Math.max(0, m) / tot * 100 : 0}%`, background: color }} /></span></div><em>{pesos(m)}</em></>
      return accion ? <button key={a + b} type="button" className="isFila2" onClick={accion}>{cuerpo}</button> : <div key={a + b} className="isFila2">{cuerpo}</div>
    })}</div>
  }
  const ir = (texto: string, destino: DestinoInicio) => <button type="button" className="isIr" onClick={() => p.onIr(destino)}>{texto} ›</button>

  const contenidoHoja = (h: Hoja): [string, ReactNode, string, ReactNode] => {
    const s = SERIES.find((x) => x.k === h)
    if (h === 'vendido') return [`Presupuestos aceptados · ${nombreMes}`, pesos(d.vendido), s!.c, <>
      {d.filas.length === 0 ? <p className="isVacio">No hay presupuestos aceptados en {nombreMes}.</p>
        : lista(d.filas.map((f) => [f.pres.titulo, `${p.nombreCli(f.pres.cliente_id)} · ganancia ${corto(f.ganancia)}`, f.pres.total, () => (p.onAbrirPresupuesto ? p.onAbrirPresupuesto(f.pres.id) : p.onIr('presupuestos'))]), s!.c)}
      {d.adicionales > 0.5 && <p className="isNota">Incluye {pesos(d.adicionales)} de cambios y adicionales aprobados.</p>}
      {ir('Ir a Presupuestos', 'presupuestos')}
    </>]
    if (h === 'productos') return [`Ganancia en productos · ${nombreMes}`, pesos(d.productos), s!.c, <>
      <div className="isMini">
        <div><small>Vendiste en productos</small><b>{pesos(d.ventaProductos)}</b></div>
        <div><small>Te costaron</small><b>{pesos(d.costoProductos)}</b></div>
      </div>
      <p className="isNota">Venta menos costo de cada producto vendido en los presupuestos aceptados del mes.</p>
      {d.sinCosto > 0 && <p className="isAviso">⚠️ {d.sinCosto} producto{d.sinCosto === 1 ? '' : 's'} sin costo cargado: se toman como ganancia completa. Cargales el costo en Productos.</p>}
      {items == null && <p className="isNota">Calculando…</p>}
      {ir('Ir a Productos', 'catalogo')}
    </>]
    if (h === 'servicios') return [`Ganancia en servicios · ${nombreMes}`, pesos(d.servicios), s!.c, <>
      <div className="isLista2">
        <div className="isFila2"><div><b>Servicios vendidos</b><small>100% tuyos</small></div><em>{pesos(d.serviciosVendidos)}</em></div>
        {d.adicionales !== 0 && <div className="isFila2"><div><b>Cambios y adicionales</b><small>aprobados en las obras</small></div><em>{pesos(d.adicionales)}</em></div>}
        {d.bonificacion > 0.5 && <div className="isFila2"><div><b>Bonificaciones</b></div><em className="r">− {pesos(d.bonificacion)}</em></div>}
        <div className="isFila2"><div><b>Empleados</b><small>{d.conEstimado ? 'lo acordado en las obras y el estimado de los presupuestos' : 'lo acordado con el personal de las obras'}</small></div><em className="r">− {pesos(d.empleados)}</em></div>
        <div className="isFila2"><div><b>Extras de las obras</b><small>nafta, tercerizados y otros</small></div><em className="r">− {pesos(d.extras)}</em></div>
        <div className="isFila2 tot"><div><b>= Ganancia en servicios</b></div><em className={d.servicios < 0 ? 'r' : 'v'}>{pesos(d.servicios)}</em></div>
      </div>
      {p.debePersonal.length > 0 && <>
        <p className="isSub">Pendiente de pagar al personal (según avance)</p>
        {lista(p.debePersonal.map((f) => [f.nombre, `${f.obra} · tocá para pagar`, f.debe, () => p.onAbrirObra(f.obraId)]), '#e0701a')}
      </>}
    </>]
    if (h === 'gastos') return [`Gastos de la empresa · ${nombreMes}`, `− ${pesos(d.gastos)}`, s!.c, <>
      {d.porCat.length === 0 ? <p className="isVacio">No hay gastos cargados en {nombreMes}.</p> : lista(d.porCat.map(([k, v]) => [k, '', v]), s!.c)}
      {d.invProductos > 0.5 && <p className="isNota">📦 Inversión en productos ({pesos(d.invProductos)}) no resta: es stock, se vuelve ganancia cuando lo vendés.</p>}
      {d.reintegrar > 0.5 && <p className="isNota">Adelantaste {pesos(d.reintegrar)} en gastos extra que te devuelve el cliente: no se restan.</p>}
      {ir('Cargar o ver gastos', 'gastos')}
    </>]
    if (h === 'impuestos') return [`Impuestos · ${nombreMes}`, `− ${pesos(d.impuestos)}`, s!.c, <>
      {d.impuestosLista.length === 0 ? <p className="isVacio">No hay impuestos cargados en {nombreMes}. Cargalos en Gastos → Empresa → 🏛️ Impuestos.</p>
        : lista(d.impuestosLista.map((g) => [g.descripcion || 'Impuesto', new Date(`${g.fecha.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }), g.monto]), s!.c)}
      {ir('Cargar o ver gastos', 'gastos')}
    </>]
    if (h === 'ganancia') return [`Ganancia final · ${nombreMes}`, pesos(d.ganancia), d.ganancia < 0 ? '#cf4b37' : s!.c, <>
      <div className="isLista2">
        <div className="isFila2"><div><b>Ganancia en productos</b></div><em>{pesos(d.productos)}</em></div>
        <div className="isFila2"><div><b>Ganancia en servicios</b><small>ya descontados empleados y extras</small></div><em>{pesos(d.servicios)}</em></div>
        <div className="isFila2"><div><b>Gastos de la empresa</b></div><em className="r">− {pesos(d.gastos)}</em></div>
        <div className="isFila2"><div><b>Impuestos</b></div><em className="r">− {pesos(d.impuestos)}</em></div>
        <div className="isFila2 tot"><div><b>= Te queda</b></div><em className={d.ganancia < 0 ? 'r' : 'v'}>{pesos(d.ganancia)}</em></div>
      </div>
      <p className="isNota">Es la misma cuenta del cuadro “Vas a ganar” de cada presupuesto, sumada por mes, menos los gastos de la empresa y los impuestos.</p>
    </>]
    if (h === 'stock') return ['Invertido en stock', stock ? pesos(stock.invertido) : '…', 'inherit', <>
      <div className="isMini">
        <div><small>Plata invertida</small><b>{stock ? pesos(stock.invertido) : '…'}</b></div>
        <div><small>Ganarías vendiéndolo</small><b className="v">{stock ? pesos(stock.ganarias) : '…'}</b></div>
      </div>
      <p className="isNota">Comprar stock no es un gasto: la plata pasa a la estantería y se vuelve ganancia cuando lo vendés.</p>
      {ir('Ver producto por producto', 'catalogo')}
    </>]
    if (h === 'cobrar') return ['Te deben', pesos(p.porCobrar), 'inherit', <>
      {p.deudas.length === 0 ? <p className="isVacio">✓ Nadie te debe.</p>
        : lista(p.deudas.map((x) => [x.obra.nombre_obra, `${p.nombreCli(x.obra.cliente_id)} · ${x.situacion === 'rojo' ? 'terminada, cobrar ya' : x.faltaAvance + x.extras > 0.5 ? `corresponde cobrar ${corto(x.faltaAvance + x.extras)}` : 'al día, se cobra con el avance'}`, x.saldo, () => p.onAbrirObra(x.obra.id)]), '#e0701a')}
      <p className="isNota">Tocá una obra para registrar el cobro.</p>
    </>]
    if (h === 'obras') return ['Obras en curso', String(p.obrasActivas.length), 'inherit', <>
      {p.obrasActivas.length === 0 ? <p className="isVacio">No hay obras en curso.</p> : <div className="isLista2">
        {p.obrasActivas.map((o) => { const pct = Math.max(0, Math.min(100, Number(o.porcentaje_avance) || 0)); return <button key={o.id} type="button" className="isFila2" onClick={() => p.onAbrirObra(o.id)}>
          <div><b>{o.nombre_obra}</b><small>{p.nombreCli(o.cliente_id)} · {Math.round(pct)}% de avance</small><span className="isMiniBar"><i style={{ width: `${pct}%`, background: '#2f63b8' }} /></span></div><em>›</em>
        </button> })}
      </div>}
      {ir('Ir a Obras', 'obras')}
    </>]
    return ['Para hacer hoy', String(p.tareas.length || '✓'), p.tareas.length ? '#cf4b37' : '#1d9a5b', <>
      {p.tareas.length === 0 ? <p className="isVacio">✓ Todo al día.</p> : <div className="ipTareas">
        {p.tareas.map((t) => (
          <div key={t.clave} className="ipTarea">
            <span className={`ipIco ${t.tono}`} aria-hidden>{t.icono}</span>
            <div><b>{t.titulo}</b><small>{t.detalle}</small></div>
            <button type="button" className={t.principal ? 'prim' : ''} onClick={() => { setHoja(null); t.accion() }}>{t.boton}</button>
          </div>
        ))}
      </div>}
      {p.ia}
    </>]
  }

  useEffect(() => {
    if (!hoja) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setHoja(null) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [hoja])

  const abierta = hoja ? contenidoHoja(hoja) : null

  return <div className="ip is">
    <div className="ipCab">
      <span className="ipAvatar" aria-hidden>{(p.nombre[0] ?? 'M').toUpperCase()}</span>
      <div><small>{capital(hoy.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))}</small><h2>Hola{p.nombre ? `, ${p.nombre}` : ''}</h2></div>
      {p.acciones}
    </div>

    {p.verFinanzas && <section className="isCard" aria-label="Resumen de la plata">
      <div className="isIzq">
      <div className="ipPeriodo" role="tablist" aria-label="Período">
        {([[6, '6 meses'], [12, '12 meses'], [0, 'Este año']] as [Rango, string][]).map(([v, t]) => (
          <button key={v} type="button" role="tab" aria-selected={rango === v} className={rango === v ? 'on' : ''} onClick={() => { setRango(v); setSel(ymHoy) }}>{t}</button>
        ))}
      </div>

      <div className="isHero2">
        <div><small>GANANCIA FINAL · {nombreMes.toUpperCase()}{sel === ymHoy ? ' (EN CURSO)' : ''}</small><b className={d.ganancia < 0 ? 'r' : 'v'}>{pesos(d.ganancia)}</b></div>
        {margen != null && <em className={d.ganancia < 0 ? 'neg' : ''}>{margen}% de lo vendido</em>}
      </div>

      <GraficoMeses serie={serie} sel={sel} onSel={setSel} ocultas={ocultas} colores={colores} />

      <div className="isLey">
        {SERIES.filter((s) => s.k !== 'vendido').map((s) => <button key={s.k} type="button" aria-pressed={!ocultas.has(s.k)} className={ocultas.has(s.k) ? 'off' : ''} onClick={() => alternar(s.k)}><i style={{ background: s.c }} />{s.t}</button>)}
      </div>

      </div>
      <div className="isDer">
      <p className="isSub">Números de {nombreMes} · tocá uno para ver el detalle</p>
      <div className="isNums">
        {SERIES.map((s) => {
          const v = d[s.k]
          const sub = s.k === 'vendido' ? `${d.filas.length} presupuesto${d.filas.length === 1 ? '' : 's'} aceptado${d.filas.length === 1 ? '' : 's'}`
            : s.k === 'ganancia' ? 'Te queda'
              : s.k === 'productos' && d.sinCosto > 0 ? '⚠️ hay productos sin costo'
                : s.k === 'productos' && d.ventaProductos > 0 ? `${Math.round((v / d.ventaProductos) * 100)}% de margen`
                  : s.k === 'servicios' ? 'menos empleados y extras'
                    : d.vendido > 0 ? `${Math.round((v / d.vendido) * 100)}% de lo vendido` : '—'
          const resta = s.k === 'gastos' || s.k === 'impuestos'
          return <button key={s.k} type="button" className={`isNum${s.k === 'ganancia' ? ' gan' : s.k === 'vendido' ? ' ancho' : ''}`} style={{ borderLeftColor: s.c }} onClick={() => setHoja(s.k)}>
            <small>{s.t}</small><b className={s.k === 'ganancia' ? (v < 0 ? 'r' : 'v') : v < 0 ? 'r' : ''}>{resta ? '− ' : ''}{pesos(v)}</b><span>{sub}</span>
          </button>
        })}
      </div>
      </div>
    </section>}

    <div className="isChips">
      {p.verFinanzas && <button type="button" className="isChip" onClick={() => setHoja('cobrar')}><small>Te deben</small><b>{corto(p.porCobrar)}</b></button>}
      {p.verFinanzas && <button type="button" className="isChip" onClick={() => setHoja('stock')}><small>En stock</small><b>{stock ? corto(stock.invertido) : '…'}</b></button>}
      <button type="button" className="isChip" onClick={() => setHoja('obras')}><small>Obras</small><b>{p.obrasActivas.length}</b></button>
      <button type="button" className="isChip" onClick={() => setHoja('hoy')}><small>Hoy</small><b className={p.tareas.length ? 'r' : 'v'}>{p.tareas.length || '✓'}</b></button>
    </div>

    {abierta && <div className="isVelo" onClick={(e) => { if (e.target === e.currentTarget) setHoja(null) }}>
      <div className="isHoja" role="dialog" aria-modal="true" aria-label={abierta[0]}>
        <div className="isHojaCab"><h3>{abierta[0]}</h3><button type="button" className="isCerrar" aria-label="Cerrar" onClick={() => setHoja(null)}>✕</button></div>
        <div className="isTotal" style={{ color: abierta[2] }}>{abierta[1]}</div>
        {abierta[3]}
      </div>
    </div>}
  </div>
}
