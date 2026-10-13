// Estado único de un trabajo (el presupuesto y su obra, juntos):
// Armando → Enviado → En obra → Terminado → Cobrado. Si el cliente no acepta: No salió.

export type EstadoTrabajo = 'armando' | 'enviado' | 'obra' | 'terminado' | 'cobrado' | 'no'

export const ESTADOS_TRABAJO: Record<EstadoTrabajo, { texto: string; corto: string; clase: string; paso: number }> = {
  armando: { texto: '✏️ Armando', corto: 'armando', clase: 'etArmando', paso: 0 },
  enviado: { texto: '📤 Enviado', corto: 'enviado', clase: 'etEnviado', paso: 1 },
  obra: { texto: '🏗️ En obra', corto: 'en obra', clase: 'etObra', paso: 2 },
  terminado: { texto: '✅ Terminado', corto: 'terminado', clase: 'etListo', paso: 3 },
  cobrado: { texto: '💰 Cobrado', corto: 'cobrado', clase: 'etListo', paso: 4 },
  no: { texto: '❌ No salió', corto: 'no salió', clase: 'etNo', paso: 1 },
}

type ObraBase = { estado: string | null; porcentaje_avance?: number | string | null }
const obraTerminada = (o: ObraBase) => o.estado === 'finalizada' || o.estado === 'observacion' || Number(o.porcentaje_avance) >= 100

// presupuesto: su estado guardado (o null si la obra todavía no tiene presupuesto).
export function estadoTrabajo(presupuesto: string | null, obra: ObraBase | null, saldo = 0): EstadoTrabajo {
  if (presupuesto === 'rechazado') return 'no'
  if (presupuesto === 'enviado') return 'enviado'
  if (presupuesto === 'aceptado' && obra) {
    if (!obraTerminada(obra)) return 'obra'
    return saldo > 0.5 ? 'terminado' : 'cobrado'
  }
  // Borrador, aceptado sin obra creada, u obra sin presupuesto: todavía se está armando.
  return 'armando'
}

export const ORDEN_TRABAJO: EstadoTrabajo[] = ['armando', 'enviado', 'obra', 'terminado', 'cobrado', 'no']

// Obras que todavía se están armando: activas, sin terminar y sin ningún presupuesto vinculado.
export function obrasSinPresupuesto<O extends { id: number; estado: string | null; porcentaje_avance?: number | string | null; activo?: boolean | null }>(
  obras: O[], presupuestos: { obra_id: number | null; activo?: boolean | null }[],
): O[] {
  const conPresupuesto = new Set(presupuestos.filter((p) => p.obra_id != null && p.activo !== false).map((p) => Number(p.obra_id)))
  return obras.filter((o) => o.activo !== false && !obraTerminada(o) && !conPresupuesto.has(Number(o.id)))
}
