import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { importeNeto } from './presupuestoCalculos'

// Inicio en una sola pantalla: un gráfico con una curva por mes para cada
// número (aceptados, costo de productos, empleados, gastos extras, impuestos y
// ganancia final), los seis números del mes elegido y, al tocar cualquiera, su
// resumen en una hoja que sube desde abajo. No hay más pestañas aparte.
//  · Ganancia de cada presupuesto: los servicios quedan al 100%; los productos
//    dejan venta − costo. La bonificación general ya está en el total.
//  · Después se restan lo pagado a empleados, los gastos extras y los impuestos.
//  · Las compras de materiales no se restan aparte: ya están en el costo de
//    los productos (si no, se contarían dos veces). El Gasto extra que el
//    cliente devuelve tampoco cuenta.

type Pres = { id: number; cliente_id: number; obra_id: number | null; titulo: string; estado: string; total: number; fecha: string | null }
type Costo = { monto: number; fecha: string; tipo?: string | null; personal_id: number | null; obra_id: number | null }
type Gasto = { id: number; fecha: string; categoria: string | null; descripcion: string | null; monto: number }
type Adicional = { obra_id: number; importe: number; estado: string; tipo: string }
type Persona = { id: number; nombre: string; apellido: string | null }
type Item = { presupuesto_id: number; tipo: string; cantidad: number; precio_unitario: number; costo_unitario: number; descuento_pct: number }
type ObraAct = { id: number; nombre_obra: string; cliente_id: number; porcentaje_avance: number | null }
type Deuda = { obra: ObraAct; saldo: number; faltaAvance: number; extras: number; situacion: 'rojo' | 'naranja' | 'verde' }
type DebePersonal = { clave: string; obraId: number; nombre: string; obra: string; debe: number }

export type Tarea = { clave: string; icono: string; tono: 'r' | 'n' | 'a' | 'v'; titulo: string; detalle: string; boton: string; principal?: boolean; accion: () => void }
export type DestinoInicio = 'obras' | 'presupuestos' | 'gastos'

type Props = {
  nombre: string
  verFinanzas: boolean
  presupuestos: Pres[]
  costos: Costo[]
  gastos: Gasto[]
  adicionales: Adicional[]
  personas: Persona[]
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
type Clave = 'vendido' | 'productos' | 'empleados' | 'gastos' | 'impuestos' | 'ganancia'
type Hoja = Clave | 'cobrar' | 'obras' | 'hoy'

const SERIES: { k: Clave; t: string; c: string }[] = [
  { k: 'vendido', t: 'Aceptados', c: '#2f63b8' },
  { k: 'productos', t: 'Costo productos', c: '#e0701a' },
  { k: 'empleados', t: 'Empleados', c: '#a1530f' },
  { k: 'gastos', t: 'Gastos extras', c: '#cf4b37' },
  { k: 'impuestos', t: 'Impuestos', c: '#7c3aed' },
  { k: 'ganancia', t: 'Ganancia final', c: '#1d9a5b' },
]
const pesos = (n: number) => `${n < 0 ? '− ' : ''}$ ${Math.round(Math.abs(n)).toLocaleString('es-AR')}`
const corto = (n: number) => { const a = Math.abs(n); const s = n < 0 ? '− ' : ''; return a >= 1e6 ? `${s}$ ${(a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 2 })} M` : a >= 1e3 ? `${s}$ ${Math.round(a / 1e3).toLocaleString('es-AR')} k` : `${s}$ ${Math.round(a)}` }
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const ymDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const mesNombre = (ym: string, f: 'long' | 'short') => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: f }).replace('.', '')
const esImpuesto = (g: Gasto) => (g.categoria ?? '').trim().toLowerCase() === 'impuestos'
const esSueldo = (g: Gasto) => (g.categoria ?? '').trim().toLowerCase() === 'sueldos fijos'
const esEmpleado = (c: Costo) => c.personal_id != null || c.tipo === 'mano_obra'
const esProducto = (tipo: string) => tipo === 'producto' || tipo === 'material'
const ETQ_COSTO: Record<string, string> = { terciarizado: 'Tercerizados en obra', otro: 'Otros gastos de obra' }

export default function InicioSimple(p: Props) {
  const hoy = new Date()
  const ymHoy = ymDe(hoy)
  const [rango, setRango] = useState<Rango>(12)
  const [sel, setSel] = useState(ymHoy)
  const [ocultas, setOcultas] = useState<Set<Clave>>(new Set())
  const [hoja, setHoja] = useState<Hoja | null>(null)
  const [tocando, setTocando] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

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

  // Cuentas de un mes (mismas reglas para la curva y para el detalle).
  const calcular = useMemo(() => {
    const itemsPor: Record<number, Item[]> = {}
    ;(items ?? []).forEach((it) => { (itemsPor[it.presupuesto_id] ??= []).push(it) })
    // Los adicionales de una obra se cuentan en el mes de su primer presupuesto aceptado.
    const primera: Record<number, string> = {}
    aceptados.forEach((x) => { if (x.obra_id != null && (!primera[x.obra_id] || (x.fecha ?? '') < primera[x.obra_id])) primera[x.obra_id] = x.fecha ?? '' })
    return (ym: string) => {
      const en = (f: string | null | undefined) => (f ?? '').slice(0, 7) === ym
      const adic = p.adicionales.filter((a) => a.estado === 'aprobado' && a.tipo !== 'gasto_extra' && en(primera[a.obra_id]))
      const adicionales = adic.reduce((s, a) => s + a.importe, 0)
      let ventaProductos = 0, costoProductos = 0, ventaServicios = 0, sinDetalle = 0, bonificacion = 0, productosSinCosto = 0
      const filas = aceptados.filter((x) => en(x.fecha)).map((x) => {
        const suyos = itemsPor[x.id] ?? []
        let costo = 0, neto = 0
        if (!suyos.length) sinDetalle += x.total
        for (const it of suyos) {
          const n = importeNeto(it)
          neto += n
          if (esProducto(it.tipo)) {
            ventaProductos += n
            const c = it.cantidad * it.costo_unitario
            costoProductos += c
            costo += c
            if (it.costo_unitario <= 0 && n > 0) productosSinCosto++
          } else ventaServicios += n
        }
        if (suyos.length) bonificacion += Math.max(neto - x.total, 0)
        return { pres: x, ganancia: x.total - costo }
      }).sort((a, b) => b.pres.total - a.pres.total)
      const vendido = filas.reduce((s, f) => s + f.pres.total, 0) + adicionales

      const pagosEmp = p.costos.filter((c) => esEmpleado(c) && en(c.fecha))
      const sueldos = p.gastos.filter((g) => esSueldo(g) && en(g.fecha))
      const porPersona: Record<string, number> = {}
      pagosEmp.forEach((c) => {
        const pe = p.personas.find((x) => x.id === c.personal_id)
        const k = pe ? `${pe.nombre} ${pe.apellido ?? ''}`.trim() : 'Mano de obra sin asignar'
        porPersona[k] = (porPersona[k] || 0) + c.monto
      })
      sueldos.forEach((g) => { const k = g.descripcion?.trim() || 'Sueldos fijos'; porPersona[k] = (porPersona[k] || 0) + g.monto })
      const empleados = pagosEmp.reduce((s, c) => s + c.monto, 0) + sueldos.reduce((s, g) => s + g.monto, 0)

      const gastosEmp = p.gastos.filter((g) => !esImpuesto(g) && !esSueldo(g) && en(g.fecha))
      const gastosObra = p.costos.filter((c) => !esEmpleado(c) && c.tipo !== 'material' && c.tipo !== 'gasto_extra' && en(c.fecha))
      const porCat: Record<string, number> = {}
      gastosEmp.forEach((g) => { const k = g.categoria || 'Otros'; porCat[k] = (porCat[k] || 0) + g.monto })
      gastosObra.forEach((c) => { const k = ETQ_COSTO[c.tipo ?? ''] ?? 'Otros gastos de obra'; porCat[k] = (porCat[k] || 0) + c.monto })
      const gastos = gastosEmp.reduce((s, g) => s + g.monto, 0) + gastosObra.reduce((s, c) => s + c.monto, 0)

      const impuestosLista = p.gastos.filter((g) => esImpuesto(g) && en(g.fecha)).sort((a, b) => b.fecha.localeCompare(a.fecha))
      const impuestos = impuestosLista.reduce((s, g) => s + g.monto, 0)
      return {
        filas, vendido, adicionales, ventaProductos, productos: costoProductos, ventaServicios, sinDetalle, bonificacion, productosSinCosto,
        empleados, porPersona: Object.entries(porPersona).sort((a, b) => b[1] - a[1]),
        gastos, porCat: Object.entries(porCat).sort((a, b) => b[1] - a[1]),
        impuestos, impuestosLista,
        ganancia: vendido - costoProductos - empleados - gastos - impuestos,
      }
    }
  }, [aceptados, items, p.costos, p.gastos, p.adicionales, p.personas])

  const serie = useMemo(() => meses.map((ym) => ({ ym, ...calcular(ym) })), [meses, calcular])
  const d = useMemo(() => calcular(sel), [calcular, sel])

  // ---- Gráfico de curvas ----
  const W = 340, H = 200, PAD = 12
  const visibles = SERIES.filter((s) => !ocultas.has(s.k))
  const valores = visibles.flatMap((s) => serie.map((m) => m[s.k]))
  const max = Math.max(1, ...valores)
  const min = Math.min(0, ...valores)
  const X = (j: number) => PAD + (j / (serie.length - 1)) * (W - 2 * PAD)
  const Y = (v: number) => H - 8 - ((v - min) / (max - min)) * (H - 22)
  const curva = (k: Clave) => {
    const pts = serie.map((m, j) => [X(j), Y(m[k])])
    let path = `M${pts[0][0]} ${pts[0][1]}`
    for (let q = 1; q < pts.length; q++) { const [x0, y0] = pts[q - 1], [x1, y1] = pts[q]; const cx = (x0 + x1) / 2; path += ` C${cx} ${y0} ${cx} ${y1} ${x1} ${y1}` }
    return path
  }
  const jSel = Math.max(0, serie.findIndex((m) => m.ym === sel))
  const tocar = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r) return
    const f = ((clientX - r.left) / r.width * W - PAD) / (W - 2 * PAD)
    const j = Math.round(Math.min(1, Math.max(0, f)) * (serie.length - 1))
    setSel(serie[j].ym)
  }
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
    if (h === 'productos') return [`Costo de productos · ${nombreMes}`, `− ${pesos(d.productos)}`, s!.c, <>
      <div className="isMini">
        <div><small>Vendiste en productos</small><b>{pesos(d.ventaProductos)}</b></div>
        <div><small>Te costaron</small><b>{pesos(d.productos)}</b></div>
        <div><small>Ganancia productos</small><b className="v">{pesos(d.ventaProductos - d.productos)}</b></div>
        <div><small>Servicios (100%)</small><b className="v">{pesos(d.ventaServicios + d.sinDetalle)}</b></div>
      </div>
      {d.bonificacion > 0.5 && <p className="isNota">Bonificaciones generales: − {pesos(d.bonificacion)} (ya descontadas del total).</p>}
      {d.productosSinCosto > 0 && <p className="isAviso">⚠️ {d.productosSinCosto} producto{d.productosSinCosto === 1 ? '' : 's'} sin costo cargado: se toman como ganancia completa. Cargales el costo en Productos y el número se corrige solo.</p>}
      {items == null && <p className="isNota">Calculando…</p>}
    </>]
    if (h === 'empleados') return [`Empleados · ${nombreMes}`, `− ${pesos(d.empleados)}`, s!.c, <>
      {d.porPersona.length === 0 ? <p className="isVacio">No hay pagos a empleados en {nombreMes}.</p> : lista(d.porPersona.map(([k, v]) => [k, '', v]), s!.c)}
      {p.debePersonal.length > 0 && <>
        <p className="isSub">Pendiente de pagar (según avance)</p>
        {lista(p.debePersonal.map((f) => [f.nombre, `${f.obra} · tocá para pagar`, f.debe, () => p.onAbrirObra(f.obraId)]), '#e0701a')}
      </>}
    </>]
    if (h === 'gastos') return [`Gastos extras · ${nombreMes}`, `− ${pesos(d.gastos)}`, s!.c, <>
      {d.porCat.length === 0 ? <p className="isVacio">No hay gastos cargados en {nombreMes}.</p> : lista(d.porCat.map(([k, v]) => [k, '', v]), s!.c)}
      <p className="isNota">Gastos de la empresa (sin sueldos ni impuestos) y gastos de obra que no son materiales.</p>
      {ir('Cargar o ver gastos', 'gastos')}
    </>]
    if (h === 'impuestos') return [`Impuestos · ${nombreMes}`, `− ${pesos(d.impuestos)}`, s!.c, <>
      {d.impuestosLista.length === 0 ? <p className="isVacio">No hay impuestos cargados en {nombreMes}. Cargalos en Gastos con la categoría “Impuestos”.</p>
        : lista(d.impuestosLista.map((g) => [g.descripcion || 'Impuesto', new Date(`${g.fecha.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }), g.monto]), s!.c)}
      {ir('Cargar o ver gastos', 'gastos')}
    </>]
    if (h === 'ganancia') return [`Ganancia final · ${nombreMes}`, pesos(d.ganancia), d.ganancia < 0 ? '#cf4b37' : s!.c, <>
      <div className="isLista2">
        {SERIES.slice(0, 5).map((x) => <div key={x.k} className="isFila2"><div><b>{x.t}</b></div><em style={{ color: x.c }}>{x.k === 'vendido' ? '' : '− '}{pesos(d[x.k])}</em></div>)}
        <div className="isFila2 tot"><div><b>= Te queda</b></div><em className={d.ganancia < 0 ? 'r' : 'v'}>{pesos(d.ganancia)}</em></div>
      </div>
      <p className="isNota">Los servicios quedan al 100% y los productos dejan su diferencia entre venta y costo.</p>
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
      <div className="ipPeriodo" role="tablist" aria-label="Período">
        {([[6, '6 meses'], [12, '12 meses'], [0, 'Este año']] as [Rango, string][]).map(([v, t]) => (
          <button key={v} type="button" role="tab" aria-selected={rango === v} className={rango === v ? 'on' : ''} onClick={() => { setRango(v); setSel(ymHoy) }}>{t}</button>
        ))}
      </div>

      <div className="isHero2">
        <div><small>GANANCIA FINAL · {nombreMes.toUpperCase()}{sel === ymHoy ? ' (EN CURSO)' : ''}</small><b className={d.ganancia < 0 ? 'r' : 'v'}>{pesos(d.ganancia)}</b></div>
        {margen != null && <em className={d.ganancia < 0 ? 'neg' : ''}>{margen}% de lo vendido</em>}
      </div>

      <div className="isGraf">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Curvas por mes de cada número. Deslizá para elegir el mes."
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setTocando(true); tocar(e.clientX) }}
          onPointerMove={(e) => { if (e.buttons) tocar(e.clientX) }}
          onPointerUp={() => setTocando(false)} onPointerCancel={() => setTocando(false)}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={Y(min + (max - min) * f)} y2={Y(min + (max - min) * f)} stroke="#e4e7eb" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />)}
          {min < 0 && <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="#9aa3b1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
          <line x1={X(jSel)} x2={X(jSel)} y1="2" y2={H} stroke="#9aa3b1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {!ocultas.has('ganancia') && <path d={`${curva('ganancia')} L${X(serie.length - 1)} ${H} L${X(0)} ${H} Z`} fill="#1d9a5b" fillOpacity=".12" />}
          {visibles.map((s) => <path key={s.k} d={curva(s.k)} fill="none" stroke={s.c} strokeWidth={s.k === 'ganancia' ? 3.5 : 2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
        </svg>
        {/* Los puntos van aparte para que no se deformen cuando el gráfico se estira */}
        {visibles.map((s) => <span key={s.k} className="isPto" style={{ background: s.c, left: `${(X(jSel) / W) * 100}%`, top: `${(Y(serie[jSel][s.k]) / H) * 100}%` }} aria-hidden />)}
        {tocando && <div className="isTip" style={{ left: `${Math.min(74, Math.max(26, (X(jSel) / W) * 100))}%` }}>
          <b>{capital(nombreMes)}</b>
          {visibles.map((s) => <div key={s.k}><span><i style={{ background: s.c }} />{s.t}</span><span>{corto(serie[jSel][s.k])}</span></div>)}
        </div>}
      </div>
      <div className="ipMeses">{serie.map((m) => <button key={m.ym} type="button" className={m.ym === sel ? 'on' : ''} onClick={() => setSel(m.ym)}>{capital(mesNombre(m.ym, 'short'))}</button>)}</div>

      <div className="isLey">
        {SERIES.map((s) => <button key={s.k} type="button" aria-pressed={!ocultas.has(s.k)} className={ocultas.has(s.k) ? 'off' : ''} onClick={() => alternar(s.k)}><i style={{ background: s.c }} />{s.t}</button>)}
      </div>

      <p className="isSub">Números de {nombreMes} · tocá uno para ver el detalle</p>
      <div className="isNums">
        {SERIES.map((s) => {
          const v = d[s.k]
          const sub = s.k === 'vendido' ? `${d.filas.length} presupuesto${d.filas.length === 1 ? '' : 's'}`
            : s.k === 'ganancia' ? 'Te queda'
              : s.k === 'productos' && d.productosSinCosto > 0 ? '⚠️ hay productos sin costo'
                : s.k === 'productos' && d.ventaProductos > 0 ? `${Math.round((1 - v / d.ventaProductos) * 100)}% de margen`
                  : d.vendido > 0 ? `${Math.round((v / d.vendido) * 100)}% de lo vendido` : '—'
          return <button key={s.k} type="button" className={`isNum${s.k === 'ganancia' ? ' gan' : s.k === 'vendido' ? ' ancho' : ''}`} style={{ borderLeftColor: s.c }} onClick={() => setHoja(s.k)}>
            <small>{s.t}</small><b className={s.k === 'ganancia' ? (v < 0 ? 'r' : 'v') : ''}>{s.k === 'vendido' || s.k === 'ganancia' ? '' : '− '}{pesos(v)}</b><span>{sub}</span>
          </button>
        })}
      </div>
    </section>}

    <div className="isChips">
      {p.verFinanzas && <button type="button" className="isChip" onClick={() => setHoja('cobrar')}><small>Te deben</small><b>{corto(p.porCobrar)}</b></button>}
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
