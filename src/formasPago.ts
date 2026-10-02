import { supabase } from './supabase'

// Formas de pago que acepta un presupuesto. Son solo informativas: no cambian
// el precio (los descuentos se manejan aparte).

export type MedioPago = 'efectivo' | 'transferencia' | 'tarjeta'
export type FormasPago = { medios: MedioPago[]; nota: string }

export const MEDIOS_PAGO: { id: MedioPago; texto: string; icono: string }[] = [
  { id: 'efectivo', texto: 'Efectivo', icono: '💵' },
  { id: 'transferencia', texto: 'Transferencia', icono: '🏦' },
  { id: 'tarjeta', texto: 'Tarjeta', icono: '💳' },
]

export const FORMAS_DEFECTO: FormasPago = { medios: ['efectivo', 'transferencia', 'tarjeta'], nota: '' }

export function normalizarFormas(x: unknown): FormasPago {
  if (!x || typeof x !== 'object') return { ...FORMAS_DEFECTO, medios: [...FORMAS_DEFECTO.medios] }
  const o = x as { medios?: unknown; nota?: unknown }
  const medios = (Array.isArray(o.medios) ? o.medios : []).filter((m): m is MedioPago => MEDIOS_PAGO.some((x) => x.id === m))
  return { medios: MEDIOS_PAGO.map((m) => m.id).filter((id) => medios.includes(id)), nota: String(o.nota ?? '').trim().slice(0, 200) }
}

// "Efectivo · Transferencia · Tarjeta"
export const textoMedios = (f: FormasPago) => f.medios.map((id) => MEDIOS_PAGO.find((m) => m.id === id)?.texto ?? id).join(' · ')

// Lee las formas de pago guardadas (si la columna todavía no existe, las de siempre).
export async function cargarFormasPago(presupuestoId: number): Promise<FormasPago> {
  try {
    const { data, error } = await supabase.from('presupuestos').select('formas_pago').eq('id', presupuestoId).maybeSingle()
    if (error || !data) return normalizarFormas(null)
    return normalizarFormas(data.formas_pago)
  } catch { return normalizarFormas(null) }
}

// Guarda aparte del resto del presupuesto: si falta el SQL, no rompe el guardado.
export async function guardarFormasPago(presupuestoId: number, f: FormasPago): Promise<boolean> {
  const { error } = await supabase.from('presupuestos').update({ formas_pago: { medios: f.medios, nota: f.nota.trim() } }).eq('id', presupuestoId)
  if (error) console.error(error)
  return !error
}

// Cobros agrupados por medio (Finanzas).
export function cobradoPorMedio(cobros: { monto: number; medio_pago: string | null }[]) {
  const etiquetas: Record<string, string> = { efectivo: '💵 Efectivo', transferencia: '🏦 Transferencia', tarjeta: '💳 Tarjeta', cheque: '🧾 Cheque' }
  const suma: Record<string, number> = {}
  for (const c of cobros) {
    const k = c.medio_pago && etiquetas[c.medio_pago] ? c.medio_pago : 'otro'
    suma[k] = (suma[k] || 0) + (Number(c.monto) || 0)
  }
  return Object.entries(suma).filter(([, v]) => Math.abs(v) > 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ medio: k, texto: etiquetas[k] ?? '• Otro / sin medio', monto: Math.round(v * 100) / 100 }))
}
