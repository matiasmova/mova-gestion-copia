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
type Item = { presupuesto_id: number; catalogo_id: number | null; tipo: string; cantidad: number; precio_unitario: number; costo_unitario: number; descuento_pct: number }
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

// Período: un mes (con flechas), últimos 3 o 12 meses, este año o personalizado.
type TipoPeriodo = 'mes' | '3' | '12' | 'anio' | 'pers'
type Clave = 'vendido' | 'productos' | 'servicios' | 'gastos' | 'impuestos' | 'ganancia'
type Hoja = Clave | 'cobrar' | 'obras' | 'hoy' | 'stock'

const COLOR: Record<Clave, string> = { vendido: '#3d6fd8', productos: '#e0701a', servicios: '#2f63b8', gastos: '#d9534a', impuestos: '#7c3aed', ganancia: '#14a06a' }
const pesos = (n: number) => `${n < 0 ? '− ' : ''}$ ${Math.round(Math.abs(n)).toLocaleString('es-AR')}`
const corto = (n: number) => { const a = Math.abs(n); const s = n < 0 ? '− ' : ''; return a >= 1e6 ? `${s}$ ${(a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 2 })} M` : a >= 1e3 ? `${s}$ ${Math.round(a / 1e3).toLocaleString('es-AR')} k` : `${s}$ ${Math.round(a)}` }
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const ymDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const mesNombre = (ym: string, f: 'long' | 'short') => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: f }).replace('.', '')
const mesAnio = (ym: string) => `${mesNombre(ym, 'long')} ${ym.slice(0, 4)}`
const sumarMeses = (ym: string, n: number) => { const [a, m] = ym.split('-').map(Number); return ymDe(new Date(a, m - 1 + n, 1)) }
function mesesEntre(desde: string, hasta: string) {
  const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde]
  const out: string[] = []
  for (let ym = a; ym <= b && out.length < 36; ym = sumarMeses(ym, 1)) out.push(ym)
  return out
}
const esImpuesto = (g: Gasto) => (g.categoria ?? '').trim().toLowerCase() === 'impuestos'
const esInvProductos = (g: Gasto) => (g.categoria ?? '').trim().toLowerCase() === 'inversión en productos'

export default function InicioSimple(p: Props) {
  const hoy = new Date()
  const ymHoy = ymDe(hoy)
  const [tipo, setTipo] = useState<TipoPeriodo>('12')
  const [mesUno, setMesUno] = useState(ymHoy)
  const [pers, setPers] = useState({ desde: sumarMeses(ymHoy, -5), hasta: ymHoy })
  const [foco, setFoco] = useState<string | null>(null) // un mes elegido en el gráfico
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
        catalogo_id: f.catalogo_id == null ? null : Number(f.catalogo_id),
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

  // Meses del período elegido.
  const meses = useMemo(() => {
    if (tipo === 'mes') return [mesUno] // (el gráfico igual muestra los 6 meses anteriores, para comparar)
    if (tipo === 'pers') return mesesEntre(pers.desde, pers.hasta)
    const n = tipo === '3' ? 3 : tipo === '12' ? 12 : Number(ymHoy.slice(5, 7))
    return mesesEntre(sumarMeses(ymHoy, -(n - 1)), ymHoy)
  }, [tipo, mesUno, pers, ymHoy])

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
    return (yms: string[]) => {
      const set = new Set(yms)
      const en = (f: string | null | undefined) => set.has((f ?? '').slice(0, 7))
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
      // Servicios: todo lo vendido que no es producto (con la bonificación ya descontada).
      const ganServicios = vendido - ventaProductos - empleados - extras

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

  const mesesGrafico = useMemo(() => (tipo === 'mes' ? mesesEntre(sumarMeses(mesUno, -5), mesUno) : meses), [tipo, mesUno, meses])
  const serie = useMemo(() => mesesGrafico.map((ym) => ({ ym, ...calcular([ym]) })), [mesesGrafico, calcular])
  const focoValido = foco && meses.includes(foco) ? foco : null
  const d = useMemo(() => calcular(focoValido ? [focoValido] : meses), [calcular, focoValido, meses])
  // Comparación con el mes anterior (cuando se mira un solo mes).
  const unMes = focoValido ?? (meses.length === 1 ? meses[0] : null)
  const previo = useMemo(() => (unMes ? calcular([sumarMeses(unMes, -1)]) : null), [calcular, unMes])

  const margen = d.vendido > 0 ? Math.round((d.ganancia / d.vendido) * 100) : null
  const etiquetaPeriodo = tipo === 'mes' ? mesAnio(mesUno) : tipo === '3' ? 'últimos 3 meses' : tipo === '12' ? 'últimos 12 meses' : tipo === 'anio' ? `${ymHoy.slice(0, 4)} hasta hoy` : meses.length === 1 ? mesAnio(meses[0]) : `${mesNombre(meses[0], 'short')} ${meses[0].slice(0, 4)} – ${mesNombre(meses[meses.length - 1], 'short')} ${meses[meses.length - 1].slice(0, 4)}`
  const nombreMes = focoValido ? mesAnio(focoValido) : etiquetaPeriodo
  const enCurso = unMes === ymHoy
  const cambio = previo && unMes && Math.abs(previo.ganancia) > 0.5 ? Math.round(((d.ganancia - previo.ganancia) / Math.abs(previo.ganancia)) * 100) : null
  const elegirTipo = (t: TipoPeriodo) => { setTipo(t); setFoco(null); if (t === 'mes') setMesUno(ymHoy) }

  const lista = (filas: [string, string, number, (() => void)?][], color: string) => {
    const tot = filas.reduce((s, f) => s + Math.max(0, f[2]), 0)
    return <div className="isLista2">{filas.map(([a, b, m, accion]) => {
      const cuerpo = <><div><b>{a}</b>{b && <small>{b}</small>}<span className="isMiniBar"><i style={{ width: `${tot > 0 ? Math.max(0, m) / tot * 100 : 0}%`, background: color }} /></span></div><em>{pesos(m)}</em></>
      return accion ? <button key={a + b} type="button" className="isFila2" onClick={accion}>{cuerpo}</button> : <div key={a + b} className="isFila2">{cuerpo}</div>
    })}</div>
  }
  const ir = (texto: string, destino: DestinoInicio) => <button type="button" className="isIr" onClick={() => p.onIr(destino)}>{texto} ›</button>

  const contenidoHoja = (h: Hoja): [string, ReactNode, string, ReactNode] => {
    const s = (h in COLOR) ? { c: COLOR[h as Clave] } : null
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

  // Cascada "¿De dónde sale tu ganancia?": de lo vendido a lo que te queda.
  const pasos: { k: string; t: string; sub: string; v: number; hoja: Hoja; tipo: 'base' | 'resta' | 'final' }[] = [
    { k: 'v', t: 'Vendido', sub: `${d.filas.length} presupuesto${d.filas.length === 1 ? '' : 's'} aceptado${d.filas.length === 1 ? '' : 's'}`, v: d.vendido, hoja: 'vendido', tipo: 'base' },
    { k: 'c', t: 'Productos', sub: 'lo que te costaron', v: d.costoProductos, hoja: 'productos', tipo: 'resta' },
    { k: 'e', t: 'Empleados', sub: d.extras > 0.5 ? `y ${corto(d.extras)} de extras` : 'pagos y acuerdos', v: d.empleados + d.extras, hoja: 'servicios', tipo: 'resta' },
    { k: 'g', t: 'Gastos', sub: 'de la empresa', v: d.gastos, hoja: 'gastos', tipo: 'resta' },
    { k: 'i', t: 'Impuestos', sub: '', v: d.impuestos, hoja: 'impuestos', tipo: 'resta' },
  ]
  const escala = Math.max(1, d.vendido, d.ganancia, ...pasos.map((x) => x.v))
  let corre = d.vendido
  const barras = pasos.map((x) => {
    if (x.tipo === 'base') return { ...x, desde: 0, ancho: x.v }
    corre -= x.v
    return { ...x, desde: Math.max(0, corre), ancho: Math.min(x.v, corre + x.v) }
  })
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / escala) * 100))}%`

  // Tarjetas de abajo.
  const vencido = p.deudas.filter((x) => x.situacion === 'rojo').reduce((s2, x) => s2 + x.saldo, 0)
  const avance = p.obrasActivas.length ? Math.round(p.obrasActivas.reduce((s2, o) => s2 + Math.max(0, Math.min(100, Number(o.porcentaje_avance) || 0)), 0) / p.obrasActivas.length) : 0
  const urgentes = p.tareas.filter((t) => t.tono === 'r').length
  const borradores = p.presupuestos.filter((x) => x.estado === 'borrador')
  const enviados = p.presupuestos.filter((x) => x.estado === 'enviado').sort((a2, b2) => (b2.fecha ?? '').localeCompare(a2.fecha ?? ''))
  const [etapa, setEtapa] = useState<'arm' | 'env' | 'obr' | null>(null)
  const filasTrabajo = [
    ...p.obrasActivas.map((o) => ({ k: `o${o.id}`, et: 'obr' as const, t: o.nombre_obra, sub: `${p.nombreCli(o.cliente_id)} · ${Math.round(Number(o.porcentaje_avance) || 0)}% de avance`, pct: Math.max(0, Math.min(100, Number(o.porcentaje_avance) || 0)), total: null as number | null, abrir: () => p.onAbrirObra(o.id) })),
    ...enviados.map((x) => ({ k: `e${x.id}`, et: 'env' as const, t: x.titulo, sub: `${p.nombreCli(x.cliente_id)} · esperando respuesta`, pct: null, total: x.total, abrir: () => (p.onAbrirPresupuesto ? p.onAbrirPresupuesto(x.id) : p.onIr('presupuestos')) })),
    ...borradores.map((x) => ({ k: `b${x.id}`, et: 'arm' as const, t: x.titulo, sub: `${p.nombreCli(x.cliente_id)} · falta enviarlo`, pct: null, total: x.total, abrir: () => (p.onAbrirPresupuesto ? p.onAbrirPresupuesto(x.id) : p.onIr('presupuestos')) })),
  ].filter((f) => !etapa || f.et === etapa).slice(0, 6)

  const periodos: [TipoPeriodo, string][] = [['mes', '1 mes'], ['3', '3 meses'], ['12', '12 meses'], ['anio', 'Este año'], ['pers', 'Elegir…']]

  return <div className="ip is is2">
    <div className="ipCab">
      <span className="ipAvatar" aria-hidden>{(p.nombre[0] ?? 'M').toUpperCase()}</span>
      <div><small>{capital(hoy.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))}</small><h2>Hola{p.nombre ? `, ${p.nombre}` : ''}</h2></div>
      {p.acciones}
    </div>

    {p.verFinanzas && <>
      <div className="is2Periodo">
        <div className="ipPeriodo" role="tablist" aria-label="Período">
          {periodos.map(([v, t]) => <button key={v} type="button" role="tab" aria-selected={tipo === v} className={tipo === v ? 'on' : ''} onClick={() => elegirTipo(v)}>{t}</button>)}
        </div>
        {tipo === 'mes' && <div className="is2Mes">
          <button type="button" aria-label="Mes anterior" onClick={() => setMesUno((m) => sumarMeses(m, -1))}>‹</button>
          <b>{capital(mesAnio(mesUno))}</b>
          <button type="button" aria-label="Mes siguiente" disabled={mesUno >= ymHoy} onClick={() => setMesUno((m) => sumarMeses(m, 1))}>›</button>
        </div>}
        {tipo === 'pers' && <div className="is2Pers">
          <label>Desde<input type="month" value={pers.desde} max={ymHoy} onChange={(e) => e.target.value && setPers((x) => ({ ...x, desde: e.target.value }))} /></label>
          <label>Hasta<input type="month" value={pers.hasta} max={ymHoy} onChange={(e) => e.target.value && setPers((x) => ({ ...x, hasta: e.target.value }))} /></label>
        </div>}
      </div>

      <section className="is2Hero" aria-label="Resumen de la plata">
        <div className="is2Graf">
          <div className="is2GCab">
            <div>
              <small className="is2Ojo">Ganancia final · {nombreMes}{enCurso ? ' (en curso)' : ''}</small>
              <b className={`is2Big${d.ganancia < 0 ? ' neg' : ''}`}>{pesos(d.ganancia)}</b>
              <div className="is2Sub">
                {cambio != null && <span className={`is2Pill ${cambio >= 0 ? 'up' : 'down'}`}>{cambio >= 0 ? '▲' : '▼'} {Math.abs(cambio)}% vs {mesNombre(sumarMeses(unMes!, -1), 'long')}</span>}
                {margen != null && <span>{margen}% de lo vendido te queda</span>}
                {focoValido && meses.length > 1 && <button type="button" className="is2Volver" onClick={() => setFoco(null)}>Ver todo el período ✕</button>}
              </div>
            </div>
            <div className="is2Ley"><span><i className="v" />Vendido</span><span><i className="g" />Ganancia final</span></div>
          </div>
          <GraficoMeses serie={serie} foco={tipo === 'mes' ? mesUno : focoValido} onFoco={(ym) => (tipo === 'mes' ? ym && setMesUno(ym) : setFoco(ym))} />
          <p className="is2Ayuda">Pasá el mouse por un mes para ver el detalle · tocalo para verlo solo</p>
        </div>

        <div className="is2Casc">
          <small className="is2Ojo">{capital(nombreMes)}</small>
          <h3>¿De dónde sale tu ganancia?</h3>
          <p className="is2Ayuda">Tocá un renglón para ver el detalle</p>
          <div className="is2Pasos">
            {barras.map((x) => <button key={x.k} type="button" className={`is2Paso ${x.tipo}`} onClick={() => setHoja(x.hoja)}>
              <span className="n">{x.t}{x.sub && <small>{x.sub}</small>}</span>
              <span className="track"><i style={{ left: pct(x.desde), width: x.ancho > 0 ? `max(3px, ${pct(x.ancho)})` : '0' }} /></span>
              <span className="v">{x.tipo === 'resta' && x.v > 0.5 ? '− ' : ''}{pesos(x.v)}</span>
            </button>)}
            <button type="button" className={`is2Paso final${d.ganancia < 0 ? ' neg' : ''}`} onClick={() => setHoja('ganancia')}>
              <span className="n">Te queda<small>ganancia final</small></span>
              <span className="track"><i style={{ left: 0, width: d.ganancia > 0 ? `max(3px, ${pct(d.ganancia)})` : '0' }} /></span>
              <span className="v">{pesos(d.ganancia)}</span>
            </button>
          </div>
          {d.sinCosto > 0 && <button type="button" className="is2Aviso" onClick={() => setHoja('productos')}><span aria-hidden>⚠</span><span><b>{d.sinCosto} producto{d.sinCosto === 1 ? '' : 's'} sin costo</b> en los presupuestos de este período: la ganancia de productos puede aparecer de más.</span></button>}
          {d.conEstimado > 0 && <p className="is2Ayuda">Empleados: en {d.conEstimado} trabajo{d.conEstimado === 1 ? '' : 's'} se usa lo estimado en el presupuesto.</p>}
        </div>
      </section>
    </>}

    <section className="is2Kpis">
      {p.verFinanzas && <button type="button" className="is2Kpi" onClick={() => setHoja('cobrar')}>
        <span className="k">Te deben <em>{p.deudas.length} obra{p.deudas.length === 1 ? '' : 's'}</em></span>
        <b>{corto(p.porCobrar)}</b>
        <span className="is2Barra">{p.porCobrar > 0 && <><i className="r" style={{ width: `${(vencido / p.porCobrar) * 100}%` }} /><i className="n" style={{ width: `${100 - (vencido / p.porCobrar) * 100}%` }} /></>}</span>
        <small>{p.porCobrar > 0.5 ? `${corto(vencido)} para cobrar ya · ${corto(p.porCobrar - vencido)} con el avance` : '✓ Nadie te debe'}</small>
      </button>}
      {p.verFinanzas && <button type="button" className="is2Kpi" onClick={() => setHoja('stock')}>
        <span className="k">En stock <em>invertido</em></span>
        <b>{stock ? corto(stock.invertido) : '…'}</b>
        <span className="is2Barra">{stock && stock.invertido + stock.ganarias > 0 && <><i className="b" style={{ width: `${(stock.invertido / (stock.invertido + Math.max(0, stock.ganarias))) * 100}%` }} /><i className="g" style={{ width: `${(Math.max(0, stock.ganarias) / (stock.invertido + Math.max(0, stock.ganarias))) * 100}%` }} /></>}</span>
        <small>{stock ? <>Si lo vendés todo ganás <strong className="v">{corto(stock.ganarias)}</strong></> : 'Calculando…'}</small>
      </button>}
      <button type="button" className="is2Kpi" onClick={() => setHoja('obras')}>
        <span className="k">Obras en curso <em>{p.obrasActivas.length}</em></span>
        <b>{p.obrasActivas.length ? `${avance}%` : '—'}</b>
        <span className="is2Barra"><i className="o" style={{ width: `${avance}%` }} /></span>
        <small>{p.obrasActivas.length ? 'avance promedio' : 'No hay obras en curso'}</small>
      </button>
      <button type="button" className="is2Kpi" onClick={() => setHoja('hoy')}>
        <span className="k">Para hoy <em>{p.tareas.length} tarea{p.tareas.length === 1 ? '' : 's'}</em></span>
        <b className={urgentes ? 'naranja' : 'v'}>{p.tareas.length === 0 ? '✓ Al día' : urgentes ? `${urgentes} urgente${urgentes === 1 ? '' : 's'}` : p.tareas.length}</b>
        <span className="is2Barra">{p.tareas.length > 0 && <><i className="r" style={{ width: `${(urgentes / p.tareas.length) * 100}%` }} /><i className="gr" style={{ width: `${100 - (urgentes / p.tareas.length) * 100}%` }} /></>}</span>
        <small>{p.tareas.length ? 'tocá para verlas' : 'Nada pendiente'}</small>
      </button>
    </section>

    <section className="is2Duo">
      <div className="is2Box">
        <h3>Trabajos <button type="button" onClick={() => p.onIr('presupuestos')}>Ver todos →</button></h3>
        <div className="is2Etapas">
          {([['arm', 'Armando', borradores.length], ['env', 'Enviados', enviados.length], ['obr', 'En obra', p.obrasActivas.length]] as const).map(([k, t, n]) => (
            <button key={k} type="button" className={`is2Et et-${k}${etapa === k ? ' on' : ''}`} aria-pressed={etapa === k} onClick={() => setEtapa((e) => (e === k ? null : k))}><b>{n}</b><span>{t}</span></button>
          ))}
        </div>
        {filasTrabajo.length === 0 ? <p className="isVacio">No hay trabajos {etapa === 'arm' ? 'armándose' : etapa === 'env' ? 'enviados' : etapa === 'obr' ? 'en obra' : 'en marcha'}.</p> : <div className="is2Trab">
          {filasTrabajo.map((f) => <button key={f.k} type="button" className={`is2Tr et-${f.et}`} onClick={f.abrir}>
            <i aria-hidden />
            <div><strong>{f.t}</strong><small>{f.sub}</small>{f.pct != null && <span className="is2Mini"><span style={{ width: `${f.pct}%` }} /></span>}</div>
            <span className="m">{f.total != null ? corto(f.total) : '›'}</span>
          </button>)}
        </div>}
      </div>
      <div className="is2Box">
        <h3>Para hacer hoy {p.tareas.length > 0 && <span className="is2Cuenta">{p.tareas.length}</span>}</h3>
        {p.tareas.length === 0 ? <p className="isVacio">✓ Todo al día.</p> : <div className="ipTareas">
          {p.tareas.slice(0, 6).map((t) => (
            <div key={t.clave} className="ipTarea">
              <span className={`ipIco ${t.tono}`} aria-hidden>{t.icono}</span>
              <div><b>{t.titulo}</b><small>{t.detalle}</small></div>
              <button type="button" className={t.principal ? 'prim' : ''} onClick={t.accion}>{t.boton}</button>
            </div>
          ))}
          {p.tareas.length > 6 && <button type="button" className="isIr" onClick={() => setHoja('hoy')}>Ver las {p.tareas.length} ›</button>}
        </div>}
        {p.verFinanzas && p.ia}
      </div>
    </section>

    {abierta && <div className="isVelo" onClick={(e) => { if (e.target === e.currentTarget) setHoja(null) }}>
      <div className="isHoja" role="dialog" aria-modal="true" aria-label={abierta[0]}>
        <div className="isHojaCab"><h3>{abierta[0]}</h3><button type="button" className="isCerrar" aria-label="Cerrar" onClick={() => setHoja(null)}>✕</button></div>
        <div className="isTotal" style={{ color: abierta[2] }}>{abierta[1]}</div>
        {abierta[3]}
      </div>
    </div>}
  </div>
}
