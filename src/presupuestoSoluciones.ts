import { supabase } from './supabase'

// Soluciones (beneficios) elegidas para un presupuesto.
// Se guarda una COPIA del texto en el presupuesto (columna "soluciones"), así
// lo que se le envió al cliente no cambia aunque después edites el catálogo.

export type SolucionPresupuesto = { titulo: string; descripcion: string }

export function normalizarSoluciones(valor: unknown): SolucionPresupuesto[] {
  if (!Array.isArray(valor)) return []
  return valor
    .filter((s) => s && typeof s === 'object' && (s as { titulo?: unknown }).titulo)
    .map((s) => ({ titulo: String((s as { titulo: unknown }).titulo), descripcion: String((s as { descripcion?: unknown }).descripcion ?? '') }))
}

export async function cargarSolucionesPresupuesto(presupuestoId: number): Promise<SolucionPresupuesto[]> {
  if (!presupuestoId) return []
  const { data, error } = await supabase.from('presupuestos').select('soluciones').eq('id', presupuestoId).maybeSingle()
  if (error || !data) return [] // si todavía no se ejecutó el SQL, simplemente no se muestra la sección
  return normalizarSoluciones((data as { soluciones?: unknown }).soluciones)
}
