// "Para hacer": todo lo pendiente en una sola lista (Agenda + lo que el sistema
// detecta solo). Cada tarea tiene un tipo (color e ícono) y un grupo
// (Atrasado / Hoy / Esta semana / Cuando puedas).

export type TipoPH = 'cobro' | 'pres' | 'visita' | 'obra' | 'stock' | 'personal' | 'gasto' | 'otro'
export type GrupoPH = 'atr' | 'hoy' | 'sem' | 'luego'

export type TareaPH = {
  clave: string
  tipo: TipoPH
  grupo: GrupoPH
  icono?: string
  titulo: string
  detalle: string
  boton?: string
  accion?: () => void
  monto?: number
  // Texto para agendarla (si se pasa a la agenda).
  agendar?: string
  obra_id?: number | null
}

export const TIPOS_PH: Record<TipoPH, { icono: string; nombre: string }> = {
  cobro: { icono: '💵', nombre: 'Cobros' },
  pres: { icono: '📤', nombre: 'Presupuestos' },
  visita: { icono: '📍', nombre: 'Agenda' },
  obra: { icono: '📝', nombre: 'Obras e informes' },
  stock: { icono: '📦', nombre: 'Stock' },
  personal: { icono: '👷', nombre: 'Personal' },
  gasto: { icono: '🧾', nombre: 'Gastos' },
  otro: { icono: '🔔', nombre: 'Otros' },
}

export const GRUPOS_PH: [GrupoPH, string][] = [['atr', '⚠ Atrasado'], ['hoy', 'Hoy'], ['sem', 'Esta semana'], ['luego', 'Cuando puedas']]

// Tareas automáticas que marcaste "listo por hoy": no se muestran hasta mañana.
const CLAVE_OCULTAS = 'mova_ph_ocultas'
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export function leerOcultas(): Set<string> {
  try {
    const m = JSON.parse(localStorage.getItem(CLAVE_OCULTAS) ?? '{}') as Record<string, string>
    return new Set(Object.entries(m).filter(([, f]) => f === hoyISO()).map(([k]) => k))
  } catch { return new Set() }
}
export function ocultarPorHoy(clave: string) {
  try {
    const m = JSON.parse(localStorage.getItem(CLAVE_OCULTAS) ?? '{}') as Record<string, string>
    const hoy = hoyISO()
    const limpio = Object.fromEntries(Object.entries(m).filter(([, f]) => f === hoy))
    limpio[clave] = hoy
    localStorage.setItem(CLAVE_OCULTAS, JSON.stringify(limpio))
  } catch { /* sin almacenamiento: vale hasta recargar */ }
}
