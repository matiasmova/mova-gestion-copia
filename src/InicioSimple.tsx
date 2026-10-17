import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { importeNeto } from './presupuestoCalculos'

// Inicio en una sola pantalla: de lo que vendiste (presupuestos aceptados) a lo
// que te queda (ganancia final), en un gráfico en cascada. Cada número se toca
// y abre su resumen, con el botón para ir a la sección completa.
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

export type Tarea = { clave: string; icono: string; tono: 'r' | 'n' | 'a' | 'v'; titulo: string; detalle: string; boton: string; principal?: boolean; accion: () => void }
export type DestinoInicio = 'obras' | 'presupuestos' | 'cobranzas' | 'personal' | 'gastos'

type Props = {
  nombre: string
  verFinanzas: boolean
  presupuestos: Pres[]
  costos: Costo[]
  gastos: Gasto[]
  adicionales: Adicional[]
  personas: Persona[]
  porCobrar: number
  obrasActivas: number
  tareas: Tarea[]
  nombreCli: (id: number) => string
  onAbrirPresupuesto?: (id: number) => void
  onIr: (destino: DestinoInicio) => void
  ia?: ReactNode
  acciones?: ReactNode
}

type Periodo = 'mes' | 'anio' | 'todo'
type Clave = 'vendido' | 'productos' | 'empleados' | 'gastos' | 'impuestos' | 'ganancia'

const pesos = (n: number) => `${n < 0 ? '− ' : ''}$ ${Math.round(Math.abs(n)).toLocaleString('es-AR')}`
const corto = (n: number) => { const a = Math.abs(n); const s = n < 0 ? '− ' : ''; return a >= 1e6 ? `${s}$ ${(a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 2 })} M` : a >= 1e3 ? `${s}$ ${Math.round(a / 1e3).toLocaleString('es-AR')} k` : `${s}$ ${Math.round(a)}` }
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const esImpuesto = (g: Gasto) => (g.categoria ?? '').trim().toLowerCase() === 'impuestos'
const esSueldo = (g: Gasto) => (g.categoria ?? '').trim().toLowerCase() === 'sueldos fijos'
const esEmpleado = (c: Costo) => c.personal_id != null || c.tipo === 'mano_obra'
const esProducto = (tipo: string) => tipo === 'producto' || tipo === 'material'
const ETQ_COSTO: Record<string, string> = { terciarizado: 'Tercerizados en obra', otro: 'Otros gastos de obra' }

export default function InicioSimple(p: Props) {
  const hoy = new Date()
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [ref, setRef] = useState({ anio: hoy.getFullYear(), mes: hoy.getMonth() })
  const [abierto, setAbierto] = useState<Clave | null>(null)
  const [verHoy, setVerHoy] = useState(false)

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

  const ymRef = `${ref.anio}-${String(ref.mes + 1).padStart(2, '0')}`
  const enPeriodo = (f: string | null | undefined) => {
    if (periodo === 'todo') return true
    const s = (f ?? '').slice(0, 10)
    return periodo === 'mes' ? s.slice(0, 7) === ymRef : s.slice(0, 4) === String(ref.anio)
  }
  const etiqueta = periodo === 'todo' ? 'Desde siempre' : periodo === 'anio' ? `Año ${ref.anio}` : capital(new Date(ref.anio, ref.mes, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }))
  const esActual = periodo === 'todo' || (ref.anio === hoy.getFullYear() && (periodo === 'anio' || ref.mes === hoy.getMonth()))
  const mover = (n: number) => setRef((r) => {
    if (periodo === 'anio') return { ...r, anio: r.anio + n }
    const d = new Date(r.anio, r.mes + n, 1)
    return { anio: d.getFullYear(), mes: d.getMonth() }
  })

  const d = useMemo(() => {
    // Presupuestos aceptados del período (por su fecha) y sus cambios/adicionales aprobados.
    const delPeriodo = aceptados.filter((x) => enPeriodo(x.fecha))
    const obrasPeriodo = new Set<number>()
    // Los adicionales de una obra se cuentan en el período de su primer presupuesto aceptado.
    const primeraFecha: Record<number, string> = {}
    aceptados.forEach((x) => { if (x.obra_id != null && (!primeraFecha[x.obra_id] || (x.fecha ?? '') < primeraFecha[x.obra_id])) primeraFecha[x.obra_id] = x.fecha ?? '' })
    Object.entries(primeraFecha).forEach(([o, f]) => { if (enPeriodo(f)) obrasPeriodo.add(Number(o)) })
    const adic = p.adicionales.filter((a) => a.estado === 'aprobado' && a.tipo !== 'gasto_extra' && obrasPeriodo.has(a.obra_id))
    const adicionales = adic.reduce((s, a) => s + a.importe, 0)

    let ventaProductos = 0, costoProductos = 0, ventaServicios = 0, sinDetalle = 0, bonificacion = 0, productosSinCosto = 0
    const filas = delPeriodo.map((x) => {
      const suyos = (items ?? []).filter((it) => it.presupuesto_id === x.id)
      let costo = 0
      if (!suyos.length) sinDetalle += x.total
      let neto = 0
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
      return { pres: x, costo, ganancia: x.total - costo }
    }).sort((a, b) => b.pres.total - a.pres.total)
    const vendido = delPeriodo.reduce((s, x) => s + x.total, 0) + adicionales

    // Empleados: pagos al personal + sueldos fijos de la empresa.
    const pagosEmp = p.costos.filter((c) => esEmpleado(c) && enPeriodo(c.fecha))
    const sueldos = p.gastos.filter((g) => esSueldo(g) && enPeriodo(g.fecha))
    const porPersona: Record<string, number> = {}
    pagosEmp.forEach((c) => {
      const pe = p.personas.find((x) => x.id === c.personal_id)
      const k = pe ? `${pe.nombre} ${pe.apellido ?? ''}`.trim() : 'Mano de obra sin asignar'
      porPersona[k] = (porPersona[k] || 0) + c.monto
    })
    sueldos.forEach((g) => { const k = g.descripcion?.trim() || 'Sueldos fijos'; porPersona[k] = (porPersona[k] || 0) + g.monto })
    const empleados = pagosEmp.reduce((s, c) => s + c.monto, 0) + sueldos.reduce((s, g) => s + g.monto, 0)

    // Gastos extras: gastos de la empresa (sin sueldos ni impuestos) + gastos de obra que no son material ni personal.
    const gastosEmp = p.gastos.filter((g) => !esImpuesto(g) && !esSueldo(g) && enPeriodo(g.fecha))
    const gastosObra = p.costos.filter((c) => !esEmpleado(c) && c.tipo !== 'material' && c.tipo !== 'gasto_extra' && enPeriodo(c.fecha))
    const porCat: Record<string, number> = {}
    gastosEmp.forEach((g) => { const k = g.categoria || 'Otros'; porCat[k] = (porCat[k] || 0) + g.monto })
    gastosObra.forEach((c) => { const k = ETQ_COSTO[c.tipo ?? ''] ?? 'Otros gastos de obra'; porCat[k] = (porCat[k] || 0) + c.monto })
    const gastos = gastosEmp.reduce((s, g) => s + g.monto, 0) + gastosObra.reduce((s, c) => s + c.monto, 0)

    const impuestosLista = p.gastos.filter((g) => esImpuesto(g) && enPeriodo(g.fecha)).sort((a, b) => b.fecha.localeCompare(a.fecha))
    const impuestos = impuestosLista.reduce((s, g) => s + g.monto, 0)

    const ganancia = vendido - costoProductos - empleados - gastos - impuestos
    return {
      filas, vendido, adicionales, ventaProductos, costoProductos, ventaServicios, sinDetalle, bonificacion, productosSinCosto,
      empleados, porPersona: Object.entries(porPersona).sort((a, b) => b[1] - a[1]),
      gastos, porCat: Object.entries(porCat).sort((a, b) => b[1] - a[1]),
      impuestos, impuestosLista, ganancia,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aceptados, items, p.costos, p.gastos, p.adicionales, p.personas, periodo, ymRef])

  // ---- Cascada: cada barra arranca donde terminó la anterior ----
  const pasos: { clave: Clave; t: string; icono: string; v: number; signo: '+' | '−' | '=' }[] = [
    { clave: 'vendido', t: 'Presupuestos aceptados', icono: '📄', v: d.vendido, signo: '+' },
    { clave: 'productos', t: 'Costo de productos', icono: '📦', v: d.costoProductos, signo: '−' },
    { clave: 'empleados', t: 'Empleados', icono: '👷', v: d.empleados, signo: '−' },
    { clave: 'gastos', t: 'Gastos extras', icono: '🧾', v: d.gastos, signo: '−' },
    { clave: 'impuestos', t: 'Impuestos', icono: '🏛️', v: d.impuestos, signo: '−' },
  ]
  let corrido = 0
  const tramos = pasos.map((x) => {
    const desde = corrido
    corrido = x.signo === '+' ? corrido + x.v : corrido - x.v
    return { ...x, a: Math.min(desde, corrido), b: Math.max(desde, corrido) }
  })
  const minimo = Math.min(0, d.ganancia, ...tramos.map((x) => x.a))
  const maximo = Math.max(1, ...tramos.map((x) => x.b))
  const pos = (v: number) => ((v - minimo) / (maximo - minimo)) * 100
  const margen = d.vendido > 0 ? Math.round((d.ganancia / d.vendido) * 100) : null

  const detalle = (clave: Clave): ReactNode => {
    const ir = (texto: string, destino: DestinoInicio) => <button type="button" className="isIr" onClick={() => p.onIr(destino)}>{texto} ›</button>
    if (clave === 'vendido') return <>
      {d.filas.length === 0 ? <p className="isVacio">No hay presupuestos aceptados en este período.</p> : <ul className="isLista">
        {d.filas.map((f) => <li key={f.pres.id}><button type="button" onClick={() => (p.onAbrirPresupuesto ? p.onAbrirPresupuesto(f.pres.id) : p.onIr('presupuestos'))}>
          <span><b>{f.pres.titulo}</b><small>{p.nombreCli(f.pres.cliente_id)} · ganancia {corto(f.ganancia)}</small></span><em>{pesos(f.pres.total)}</em>
        </button></li>)}
      </ul>}
      {d.adicionales > 0.5 && <p className="isNota">Incluye {pesos(d.adicionales)} de cambios y adicionales aprobados.</p>}
      {ir('Ir a Presupuestos', 'presupuestos')}
    </>
    if (clave === 'productos') return <>
      <div className="isMini">
        <div><small>Vendiste en productos</small><b>{pesos(d.ventaProductos)}</b></div>
        <div><small>Te costaron</small><b>{pesos(d.costoProductos)}</b></div>
        <div><small>Ganancia productos</small><b className="v">{pesos(d.ventaProductos - d.costoProductos)}</b></div>
        <div><small>Servicios (100% ganancia)</small><b className="v">{pesos(d.ventaServicios + d.sinDetalle)}</b></div>
      </div>
      {d.bonificacion > 0.5 && <p className="isNota">Bonificaciones generales: − {pesos(d.bonificacion)} (ya descontadas del total).</p>}
      {d.productosSinCosto > 0 && <p className="isAviso">⚠️ {d.productosSinCosto} producto{d.productosSinCosto === 1 ? '' : 's'} sin costo cargado: se toman como ganancia completa. Cargale el costo en Productos.</p>}
      {items == null && <p className="isNota">Calculando…</p>}
    </>
    if (clave === 'empleados') return <>
      {d.porPersona.length === 0 ? <p className="isVacio">No hay pagos a empleados en este período.</p> : <Barras filas={d.porPersona} total={d.empleados} />}
      {ir('Ver Personal', 'personal')}
    </>
    if (clave === 'gastos') return <>
      {d.porCat.length === 0 ? <p className="isVacio">No hay gastos cargados en este período.</p> : <Barras filas={d.porCat} total={d.gastos} />}
      <p className="isNota">Gastos de la empresa (sin sueldos ni impuestos) y gastos de obra que no son materiales.</p>
      {ir('Ver Gastos', 'gastos')}
    </>
    if (clave === 'impuestos') return <>
      {d.impuestosLista.length === 0 ? <p className="isVacio">No hay impuestos cargados en este período. Cargalos en Gastos con la categoría “Impuestos”.</p> : <ul className="isLista">
        {d.impuestosLista.map((g) => <li key={g.id}><div><span><b>{g.descripcion || 'Impuesto'}</b><small>{new Date(`${g.fecha.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</small></span><em>{pesos(g.monto)}</em></div></li>)}
      </ul>}
      {ir('Ver Gastos', 'gastos')}
    </>
    return <p className="isNota">Ganancia final = presupuestos aceptados − costo de productos − empleados − gastos extras − impuestos. Los servicios quedan al 100% y los productos dejan su diferencia entre venta y costo.</p>
  }

  return <div className="ip is">
    <div className="ipCab">
      <span className="ipAvatar" aria-hidden>{(p.nombre[0] ?? 'M').toUpperCase()}</span>
      <div><small>{capital(hoy.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))}</small><h2>Hola{p.nombre ? `, ${p.nombre}` : ''}</h2></div>
      {p.acciones}
    </div>

    {p.verFinanzas && <section className="isCard" aria-label="Resumen de la plata">
      <div className="isPer">
        <div className="ipPeriodo" role="tablist" aria-label="Período">
          {([['mes', 'Mes'], ['anio', 'Año'], ['todo', 'Todo']] as [Periodo, string][]).map(([v, t]) => (
            <button key={v} type="button" role="tab" aria-selected={periodo === v} className={periodo === v ? 'on' : ''} onClick={() => { setPeriodo(v); setRef({ anio: hoy.getFullYear(), mes: hoy.getMonth() }) }}>{t}</button>
          ))}
        </div>
        {periodo !== 'todo' && <div className="isNav">
          <button type="button" aria-label="Anterior" onClick={() => mover(-1)}>‹</button>
          <button type="button" aria-label="Siguiente" disabled={esActual} onClick={() => mover(1)}>›</button>
        </div>}
      </div>

      <button type="button" className={`isHero${abierto === 'ganancia' ? ' on' : ''}`} onClick={() => setAbierto(abierto === 'ganancia' ? null : 'ganancia')}>
        <small>GANANCIA FINAL · {etiqueta.toUpperCase()}</small>
        <span className={d.ganancia < 0 ? 'neg' : ''}>{pesos(d.ganancia)}</span>
        <em>{margen != null ? `Te queda el ${margen}% de lo vendido` : 'Sin ventas en este período'}{esActual && periodo !== 'todo' ? ' · en curso' : ''}</em>
      </button>
      {abierto === 'ganancia' && <div className="isDet">{detalle('ganancia')}</div>}

      <div className="isCascada" role="list">
        {tramos.map((x) => <div key={x.clave} role="listitem">
          <button type="button" className={`isFila${abierto === x.clave ? ' on' : ''}`} aria-expanded={abierto === x.clave} onClick={() => setAbierto(abierto === x.clave ? null : x.clave)}>
            <span className="isTxt"><i aria-hidden>{x.icono}</i>{x.t}</span>
            <b className={x.signo === '+' ? 'v' : 'r'}>{x.signo === '+' ? '' : '− '}{pesos(x.v)}</b>
            <span className={`isBar ${x.clave}`} aria-hidden><i style={{ left: `${pos(x.a)}%`, width: `${Math.max(x.v > 0 ? 0.8 : 0, pos(x.b) - pos(x.a))}%` }} /></span>
          </button>
          {abierto === x.clave && <div className="isDet">{detalle(x.clave)}</div>}
        </div>)}
        <button type="button" className={`isFila total${abierto === 'ganancia' ? ' on' : ''}`} onClick={() => setAbierto(abierto === 'ganancia' ? null : 'ganancia')}>
          <span className="isTxt"><i aria-hidden>💰</i>Ganancia final</span>
          <b className={d.ganancia < 0 ? 'r' : 'v'}>{pesos(d.ganancia)}</b>
          <span className={`isBar ${d.ganancia < 0 ? 'perdida' : 'ganancia'}`} aria-hidden><i style={{ left: `${pos(Math.min(0, d.ganancia))}%`, width: `${Math.abs(pos(d.ganancia) - pos(0))}%` }} /></span>
        </button>
      </div>
      <p className="isPie">Tocá cualquier número para ver de dónde sale.</p>
    </section>}

    <div className="isChips">
      {p.verFinanzas && <button type="button" className="isChip" onClick={() => p.onIr('cobranzas')}><small>Te deben</small><b>{corto(p.porCobrar)}</b></button>}
      <button type="button" className="isChip" onClick={() => p.onIr('obras')}><small>Obras en curso</small><b>{p.obrasActivas}</b></button>
      <button type="button" className={`isChip${verHoy ? ' on' : ''}`} onClick={() => setVerHoy((v) => !v)}><small>Para hacer hoy</small><b className={p.tareas.length ? 'r' : 'v'}>{p.tareas.length || '✓'}</b></button>
    </div>

    {verHoy && <section className="ipCard" aria-label="Hoy">
      {p.tareas.length === 0 ? <p className="isVacio">✓ Todo al día.</p> : <div className="ipTareas">
        {p.tareas.map((t) => (
          <div key={t.clave} className="ipTarea">
            <span className={`ipIco ${t.tono}`} aria-hidden>{t.icono}</span>
            <div><b>{t.titulo}</b><small>{t.detalle}</small></div>
            <button type="button" className={t.principal ? 'prim' : ''} onClick={t.accion}>{t.boton}</button>
          </div>
        ))}
      </div>}
      {p.ia}
    </section>}
  </div>
}

function Barras({ filas, total }: { filas: [string, number][]; total: number }) {
  return <ul className="isBarras">
    {filas.map(([k, v]) => <li key={k}>
      <span><b>{k}</b><em>{pesos(v)}</em></span>
      <span className="isMiniBar"><i style={{ width: `${total > 0 ? (v / total) * 100 : 0}%` }} /></span>
    </li>)}
  </ul>
}
