import { supabase } from './supabase'
import { valoresObra, cuentaObra, redondearCuenta } from './cuentaObra'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import type { CobroObra } from './finanzasObra'

// Cambios al presupuesto durante la obra.
// El presupuesto aceptado nunca se modifica: cada cambio se guarda como un
// adicional de tipo 'cambio' (con el detalle de antes y después). Esta función
// junta esos cambios (y los demás adicionales aprobados de la obra) para mostrar
// al pie del presupuesto el nuevo total y el estado de cuenta.

export type CambioTipo = 'reemplazo' | 'cantidad' | 'agregado' | 'quitado'

export type Modificacion = {
  id: number
  fecha: string
  tipo: string
  cambio_tipo: CambioTipo | null
  descripcion: string
  motivo: string | null
  descripcion_anterior: string | null
  cantidad_anterior: number | null
  precio_anterior: number | null
  cantidad_nueva: number | null
  precio_nuevo: number | null
  importe: number
  estado?: string
}

export type ResumenModificaciones = {
  totalOriginal: number
  modificaciones: Modificacion[]
  totalCambios: number
  nuevoTotal: number
  cobrado: number
  saldo: number
  gastos: Modificacion[]
  gastoExtraPendiente: number
  reintegrado: number
  pagos: CobroObra[]
  avances: { id: number; fecha: string; titulo: string; descripcion: string | null; porcentaje: number; estado: string }[]
  estado: string
  porcentaje: number
  ultimaModificacion: string | null
  fechaActividad: string | null
  cuenta: ReturnType<typeof cuentaObra>
  otrosPresupuestos: { id: number; titulo: string; total: number; items: ItemPresupuesto[] }[]
}

export const ETIQUETA_CAMBIO: Record<CambioTipo, string> = {
  reemplazo: 'Cambio de ítem',
  cantidad: 'Cambio de cantidad',
  agregado: 'Ítem agregado',
  quitado: 'Ítem quitado',
}

export const ETIQUETA_ADICIONAL: Record<string, string> = {
  adicional: 'Adicional',
  producto: 'Producto extra',
  servicio: 'Servicio extra',
  cambio: 'Cambio al presupuesto',
  gasto_extra: 'Gasto extra',
  ajuste: 'Ajuste',
  bonificacion: 'Bonificación',
}

export function etiquetaModificacion(m: Pick<Modificacion, 'tipo' | 'cambio_tipo'>) {
  if (m.tipo === 'cambio' && m.cambio_tipo) return ETIQUETA_CAMBIO[m.cambio_tipo]
  return ETIQUETA_ADICIONAL[m.tipo] ?? m.tipo
}

const num = (x: unknown) => (x == null || x === '' ? null : Number(x))
const cant = (n: number | null) => (n == null ? '' : `${Number(n.toFixed(3))}`)

// Texto "antes" y "ahora" para mostrar un cambio de ítem.
export function antesYAhora(m: Modificacion, formatoMoneda: (n: number) => string): { antes: string | null; ahora: string | null } {
  if (m.tipo !== 'cambio' || !m.cambio_tipo) return { antes: null, ahora: null }
  const linea = (desc: string | null, c: number | null, p: number | null) =>
    `${desc ?? ''}${c != null ? ` · ${cant(c)} × ${formatoMoneda(p ?? 0)}` : ''}`
  switch (m.cambio_tipo) {
    case 'reemplazo':
      return { antes: linea(m.descripcion_anterior, m.cantidad_anterior, m.precio_anterior), ahora: linea(m.descripcion, m.cantidad_nueva, m.precio_nuevo) }
    case 'cantidad':
      return { antes: `${cant(m.cantidad_anterior)} × ${formatoMoneda(m.precio_anterior ?? 0)}`, ahora: `${cant(m.cantidad_nueva)} × ${formatoMoneda(m.precio_nuevo ?? 0)}` }
    case 'agregado':
      return { antes: null, ahora: linea(m.descripcion, m.cantidad_nueva, m.precio_nuevo) }
    case 'quitado':
      return { antes: linea(m.descripcion_anterior ?? m.descripcion, m.cantidad_anterior, m.precio_anterior), ahora: 'Se quita' }
  }
}

// Documento y estado de cuenta de toda la obra. Si tiene varios presupuestos,
// se incluyen los otros originales expresamente; nunca se reparten pagos sin asignación.
export async function cargarResumenModificaciones(presupuestoId: number, _totalOriginal: number): Promise<ResumenModificaciones | null> {
  if (!presupuestoId) return null
  const r = await supabase.from('presupuestos').select('*').eq('id', presupuestoId).maybeSingle()
  if (r.error) throw r.error
  const pres = r.data
  if (!pres || pres.obra_id == null || pres.estado !== 'aceptado' || pres.activo === false) return null
  const obraId = Number(pres.obra_id)
  const [rAdic, rPres, rObra, rAv] = await Promise.all([
    supabase.from('adicionales').select('*').eq('obra_id', obraId).order('fecha').order('id'),
    supabase.from('presupuestos').select('*').eq('obra_id', obraId).order('id'),
    supabase.from('obras').select('*').eq('id', obraId).single(),
    supabase.from('obra_avances').select('*').eq('obra_id', obraId).order('fecha').order('id'),
  ])
  for (const resultado of [rAdic, rPres, rObra, rAv]) if (resultado.error) throw resultado.error
  const presupuestos = rPres.data ?? []
  const aceptados = presupuestos.filter(p => p.estado === 'aceptado' && p.activo !== false)
  const ids = presupuestos.map(p => p.id)
  const [rPagos, rItems] = await Promise.all([
    supabase.from('pagos').select('*').or(`obra_id.eq.${obraId},presupuesto_id.in.(${ids.join(',')})`).order('fecha').order('id'),
    supabase.from('presupuesto_items').select('*').in('presupuesto_id', aceptados.map(p => p.id)).order('orden'),
  ])
  if (rPagos.error || rItems.error) throw rPagos.error || rItems.error
  const adicionales = rAdic.data ?? []
  const valores = valoresObra(presupuestos, adicionales)
  const convertir = (a: typeof adicionales[number]): Modificacion => ({
    id: a.id, fecha: a.fecha, tipo: a.tipo, estado: a.estado, cambio_tipo: (a.cambio_tipo ?? null) as CambioTipo | null,
    descripcion: a.descripcion ?? '', motivo: a.motivo ?? null, descripcion_anterior: a.descripcion_anterior ?? null,
    cantidad_anterior: num(a.cantidad_anterior), precio_anterior: num(a.precio_anterior),
    cantidad_nueva: num(a.cantidad_nueva), precio_nuevo: num(a.precio_nuevo), importe: Number(a.importe) || 0,
  })
  const modificaciones = adicionales.filter(a => a.estado === 'aprobado' && a.tipo !== 'gasto_extra').map(convertir)
  const gastos = adicionales.filter(a => a.tipo === 'gasto_extra' && ['aprobado', 'pagado'].includes(a.estado)).map(convertir)
  const pagos = (rPagos.data ?? []).map(p => ({ ...p, monto: Number(p.monto) })) as CobroObra[]
  const cobrado = redondearCuenta(pagos.reduce((s, p) => s + p.monto, 0))
  const obra = rObra.data!
  const avances = (rAv.data ?? []).map(a => ({ ...a, porcentaje: Number(a.porcentaje) || 0 })) as ResumenModificaciones['avances']
  const porcentaje = Math.min(100, Math.max(0, Number(obra.porcentaje_avance) || 0))
  const cuenta = cuentaObra(valores.valorProgresivo, valores.gastoExtraPendiente, cobrado, porcentaje,
    ['finalizada', 'observacion'].includes(obra.estado), valores.totalOriginal)
  // Sin la migración no inventamos una fecha de edición: mostramos la última actividad conocida.
  const fechas = [pres.fecha, ...adicionales.map(a => a.fecha), ...pagos.map(p => p.fecha), ...avances.map(a => a.fecha)].filter(Boolean).sort()
  return {
    totalOriginal: valores.totalOriginal, modificaciones, totalCambios: valores.totalCambios,
    nuevoTotal: valores.valorProgresivo, cobrado, saldo: cuenta.saldo, gastos,
    gastoExtraPendiente: valores.gastoExtraPendiente, reintegrado: valores.reintegrado,
    pagos, avances, porcentaje, estado: obra.estado ?? 'en_proceso', cuenta,
    ultimaModificacion: obra.documento_actualizado_at ?? null,
    fechaActividad: fechas.at(-1) ?? null,
    otrosPresupuestos: aceptados.filter(p => p.id !== presupuestoId).map(p => ({
      id: p.id, titulo: p.titulo, total: Number(p.total),
      items: (rItems.data ?? []).filter(i => i.presupuesto_id === p.id).map(i => ({ ...i,
        cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario),
        costo_unitario: Number(i.costo_unitario || 0), descuento_pct: Number(i.descuento_pct || 0),
      })) as ItemPresupuesto[],
    })),
  }
}
