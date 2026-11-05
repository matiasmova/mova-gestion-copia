import { supabase } from './supabase'

// Cuándo mandar el aviso: fecha + hora (9:00 si no tiene) − anticipación, en hora de Argentina (UTC−3).
export function momentoAviso(fecha: string, hora: string | null, avisoMin: number | null): string | null {
  if (avisoMin == null) return null
  const base = new Date(`${fecha}T${(hora || '09:00').slice(0, 5)}:00-03:00`)
  return new Date(base.getTime() - avisoMin * 60000).toISOString()
}

export async function crearEvento(d: { titulo: string; fecha: string; hora: string | null; tipo: string; cliente_id: number | null; obra_id: number | null; aviso_min: number | null; lugar?: string | null; detalle?: string | null }): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser()
  const base = { titulo: d.titulo, fecha: d.fecha, hora: d.hora, tipo: d.tipo, obra_id: d.obra_id, cliente_id: d.cliente_id, detalle: d.detalle ?? null, notificado: false, completado: false, user_id: userData.user?.id ?? null }
  let r = await supabase.from('recordatorios').insert({ ...base, lugar: d.lugar ?? null, aviso_min: d.aviso_min, notificar_en: momentoAviso(d.fecha, d.hora, d.aviso_min) })
  if (r.error && /column|lugar|aviso_min|notificar_en/i.test(r.error.message)) r = await supabase.from('recordatorios').insert(base)
  if (r.error) { console.error(r.error); return 'No se pudo guardar.' }
  return null
}
