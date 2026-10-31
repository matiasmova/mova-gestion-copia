import { importeNeto } from './presupuestoCalculos'

// La cuenta de MOVA, igual en el presupuesto, en Productos y en el Inicio:
//  · Productos: ganás lo que lo vendés menos lo que te costó.
//  · Servicios: el 100% es tuyo…
//  · …menos el gasto por ayudantes (lo estimado, o lo pagado si es más)
//  · …menos los extras de la obra (nafta, tercerizados, otros).
// Comprar stock NO es un gasto: es plata invertida (se ve en Productos).

export type ItemCuenta = { tipo: string; cantidad: number; precio_unitario: number; costo_unitario: number; descuento_pct?: number | null; catalogo_id?: number | null }

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
    // Un "producto" escrito a mano (no viene de tu lista) y sin costo es en la
    // práctica mano de obra o algo que el cliente paga aparte: cuenta como servicio.
    const deLista = it.catalogo_id != null || Number(it.costo_unitario) > 0
    if (esProducto(it.tipo) && deLista) {
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

// Pagos al personal de una obra, agrupados por persona (se cargan desde Personal).
export type FilaEmpleado = { personal_id: number | null; total: number; pagado: number }
export function empleadosDeObra(pagos: { personal_id: number | null; monto: number }[]): FilaEmpleado[] {
  const porPersona: Record<string, FilaEmpleado> = {}
  pagos.forEach((p) => {
    const f = (porPersona[String(p.personal_id)] ??= { personal_id: p.personal_id, total: 0, pagado: 0 })
    f.total += Number(p.monto) || 0
    f.pagado += Number(p.monto) || 0
  })
  return Object.values(porPersona)
}

// Pagos de empleados: los que tienen persona o son mano de obra.
export const esPagoEmpleado = (c: { personal_id: number | null; tipo?: string | null }) => c.personal_id != null || c.tipo === 'mano_obra'

// Extras de la obra: gastos cargados que no son personal, materiales ni Gasto extra (que devuelve el cliente).
export const esExtraDeObra = (c: { personal_id: number | null; tipo?: string | null }) =>
  c.personal_id == null && !['material', 'mano_obra', 'gasto_extra'].includes(c.tipo ?? '')

// Lo que se resta por personal en un trabajo: el "Gasto por ayudantes estimado"
// del presupuesto, o lo ya pagado (desde Personal) si es más.
export function totalEmpleados(filas: FilaEmpleado[], estimado: number) {
  const pagado = filas.reduce((s, f) => s + f.pagado, 0)
  return { pagado, estimado, total: Math.max(estimado, pagado) }
}
