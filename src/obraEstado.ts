// Estados de obra unificados para toda la app (Fase 5)
export const OBRA_ESTADOS: { v: string; t: string }[] = [
  { v: 'en_proceso', t: 'En proceso' },
  { v: 'finalizada', t: 'Finalizada' },
  { v: 'observacion', t: 'Finalizada en observación' },
]

export function etiquetaObra(estado: string | null): string {
  return OBRA_ESTADOS.find((e) => e.v === estado)?.t ?? 'En proceso'
}

// Sufijo de clase del sistema de diseño: est-proceso / est-finalizada / est-observacion
export function claseObra(estado: string | null): string {
  if (estado === 'finalizada') return 'finalizada'
  if (estado === 'observacion') return 'observacion'
  return 'proceso'
}
