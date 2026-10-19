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

// Lo acordado con el personal asignado a una obra (costo total previsto).
export function empleadosDeObra(
  asignaciones: AsignacionCalc[], personas: PersonaCalc[], pagos: { personal_id: number | null; monto: number }[], jornales: JornalCalc[], valorObra: number,
) {
  return asignaciones.map((a) => {
    const c = calcularPersona(a, personas.find((p) => p.id === a.personal_id), pagos, jornales, valorObra, 0)
    return { personal_id: a.personal_id, total: c.proyectado, pagado: c.pagado }
  })
}

// Extras de la obra: gastos cargados que no son personal, materiales ni Gasto extra (que devuelve el cliente).
export const esExtraDeObra = (c: { personal_id: number | null; tipo?: string | null }) =>
  c.personal_id == null && !['material', 'mano_obra', 'gasto_extra'].includes(c.tipo ?? '')
