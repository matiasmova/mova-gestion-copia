import { supabase } from './supabase'

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
}

export type ResumenModificaciones = {
  totalOriginal: number
  modificaciones: Modificacion[]
  totalCambios: number
  nuevoTotal: number
  cobrado: number
  saldo: number
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

// Devuelve null si el presupuesto no está aceptado, no tiene obra, o todavía
// no hay cambios ni cobros para mostrar.
export async function cargarResumenModificaciones(presupuestoId: number, totalOriginal: number): Promise<ResumenModificaciones | null> {
  if (!presupuestoId) return null
  const { data: pres, error } = await supabase.from('presupuestos').select('id, obra_id, estado').eq('id', presupuestoId).maybeSingle()
  if (error || !pres || pres.obra_id == null || pres.estado !== 'aceptado') return null
  const obraId = Number(pres.obra_id)

  const [rAdic, rPagos, rPres] = await Promise.all([
    supabase.from('adicionales').select('*').eq('obra_id', obraId).in('estado', ['aprobado', 'pagado']).order('fecha', { ascending: true }).order('id', { ascending: true }),
    supabase.from('pagos').select('monto, presupuesto_id, obra_id').or(`presupuesto_id.eq.${presupuestoId},obra_id.eq.${obraId}`),
    supabase.from('presupuestos').select('id').eq('obra_id', obraId).eq('estado', 'aceptado').eq('activo', true),
  ])
  if (rAdic.error || rPagos.error) { console.error(rAdic.error || rPagos.error); return null }

  // Si la obra tiene un solo presupuesto aceptado, los adicionales y cobros cargados
  // a la obra (sin presupuesto) se atribuyen a este presupuesto.
  const unico = (rPres.data ?? []).length <= 1
  const modificaciones: Modificacion[] = (rAdic.data ?? [])
    .filter((a) => Number(a.presupuesto_id) === presupuestoId || (a.presupuesto_id == null && unico))
    .map((a) => ({
      id: a.id, fecha: a.fecha, tipo: a.tipo, cambio_tipo: (a.cambio_tipo ?? null) as CambioTipo | null,
      descripcion: a.descripcion, motivo: a.motivo ?? null,
      descripcion_anterior: a.descripcion_anterior ?? null,
      cantidad_anterior: num(a.cantidad_anterior), precio_anterior: num(a.precio_anterior),
      cantidad_nueva: num(a.cantidad_nueva), precio_nuevo: num(a.precio_nuevo),
      importe: Number(a.importe) || 0,
    }))
  const cobrado = (rPagos.data ?? [])
    .filter((p) => Number(p.presupuesto_id) === presupuestoId || (p.presupuesto_id == null && Number(p.obra_id) === obraId && unico))
    .reduce((s, p) => s + (Number(p.monto) || 0), 0)

  if (modificaciones.length === 0 && cobrado === 0) return null
  const totalCambios = modificaciones.reduce((s, m) => s + m.importe, 0)
  const nuevoTotal = totalOriginal + totalCambios
  return { totalOriginal, modificaciones, totalCambios, nuevoTotal, cobrado, saldo: nuevoTotal - cobrado }
}
