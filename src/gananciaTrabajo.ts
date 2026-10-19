import { importeNeto } from './presupuestoCalculos'
import { calcularPersona, type AsignacionCalc, type JornalCalc, type PersonaCalc } from './personalCalculos'

// La cuenta de MOVA, igual en el presupuesto, en Productos y en el Inicio:
//  · Productos: ganás lo que lo vendés menos lo que te costó.
//  · Servicios: el 100% es tuyo…
//  · …menos lo que le pagás a los empleados por ese trabajo
//  · …menos los extras de la obra (nafta, tercerizados, otros).
// Comprar stock NO es un gasto: es plata invertida (se ve en Productos).

export type ItemCuenta = { tipo: string; cantidad: number; precio_unitario: number; costo_unitario: number; descuento_pct?: number | null }

export const esProducto = (tipo: string) => { const t = (tipo || '').trim().toLowerCase(); return t === 'producto' || t === 'material' }

export type Cuenta = {
  ventaProductos: number
  costoProductos: number
  ganProductos: number
  servicios: number
  bonificacion: number
  adicionales: number
  empleados: number
  extras: number
  ganancia: number
  sinCosto: number // productos sin costo cargado
}

// total: lo que paga el cliente (con la bonificación general ya restada).
// adicionales: cambios y extras aprobados que suman o restan al trabajo.
export function cuentaTrabajo(items: ItemCuenta[], total: number, empleados: number, extras: number, adicionales = 0): Cuenta {
  let ventaProductos = 0, costoProductos = 0, servicios = 0, sinCosto = 0
  for (const it of items) {
    const n = importeNeto(it)
    if (esProducto(it.tipo)) {
      ventaProductos += n
      costoProductos += (Number(it.cantidad) || 0) * (Number(it.costo_unitario) || 0)
      if (!(Number(it.costo_unitario) > 0) && n > 0) sinCosto++
    } else servicios += n
  }
  // Presupuesto sin ítems (cargado solo con el total): todo cuenta como servicio.
  if (!items.length) servicios = total
  const bonificacion = Math.max(0, ventaProductos + servicios - total)
  return {
    ventaProductos, costoProductos, ganProductos: ventaProductos - costoProductos,
    servicios, bonificacion, adicionales, empleados, extras, sinCosto,
    ganancia: total + adicionales - costoProductos - empleados - extras,
  }
}

// Empleados de una obra: por cada persona asignada, lo acordado (o lo ya
// pagado, si es más); y además todo lo pagado a gente que no está asignada
// (o mano de obra cargada sin persona). Así ningún pago queda afuera.
export type FilaEmpleado = { personal_id: number | null; total: number; pagado: number; asignado: boolean; sinJornales: boolean; acuerdo: boolean }
export function empleadosDeObra(
  asignaciones: AsignacionCalc[], personas: PersonaCalc[], pagos: { personal_id: number | null; monto: number }[], jornales: JornalCalc[], valorObra: number,
): FilaEmpleado[] {
  const filas: FilaEmpleado[] = asignaciones.map((a) => {
    const c = calcularPersona(a, personas.find((p) => p.id === a.personal_id), pagos, jornales, valorObra, 0)
    const porTiempo = c.modalidad === 'por_dia' || c.modalidad === 'por_hora'
    // "Por pagos": para la ganancia se usa lo estimado a pagarle (o lo ya pagado, si es más).
    const total = c.modalidad === 'libre' ? Math.max(Number(a.valor_acordado) || 0, c.pagado) : c.proyectado
    return { personal_id: a.personal_id, total, pagado: c.pagado, asignado: true, sinJornales: porTiempo && c.devengado === 0, acuerdo: c.modalidad !== 'libre' }
  })
  const asignados = new Set(asignaciones.map((a) => a.personal_id))
  const otros: Record<string, FilaEmpleado> = {}
  pagos.filter((p) => p.personal_id == null || !asignados.has(p.personal_id)).forEach((p) => {
    const k = String(p.personal_id)
    const f = (otros[k] ??= { personal_id: p.personal_id, total: 0, pagado: 0, asignado: false, sinJornales: false, acuerdo: false })
    f.total += Number(p.monto) || 0
    f.pagado += Number(p.monto) || 0
  })
  return [...filas, ...Object.values(otros)]
}

// Pagos de empleados: los que tienen persona o son mano de obra.
export const esPagoEmpleado = (c: { personal_id: number | null; tipo?: string | null }) => c.personal_id != null || c.tipo === 'mano_obra'

// Extras de la obra: gastos cargados que no son personal, materiales ni Gasto extra (que devuelve el cliente).
export const esExtraDeObra = (c: { personal_id: number | null; tipo?: string | null }) =>
  c.personal_id == null && !['material', 'mano_obra', 'gasto_extra'].includes(c.tipo ?? '')

// Lo que se resta por empleados en un trabajo: lo de cada persona de la obra
// (acordado, o estimado para los que cobran por pagos). Si todavía no hay
// nadie asignado, el estimado general del presupuesto.
export function totalEmpleados(filas: FilaEmpleado[], estimado: number) {
  const personas = filas.reduce((s, f) => s + f.total, 0)
  const hayAsignados = filas.some((f) => f.asignado)
  return { personas, hayAsignados, total: hayAsignados ? personas : personas + estimado }
}
