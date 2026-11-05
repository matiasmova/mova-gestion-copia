import { useSyncExternalStore } from 'react'
import { ocultarPorHoy } from './paraHacer'

// Recorrido de pendientes: desde Para hacer entrás a un pendiente (la obra, el
// presupuesto…) y con "Siguiente" pasás al próximo del mismo tipo sin volver
// a la lista. Lo muestra BarraRecorrido, encima de cualquier pantalla.

export type PasoRecorrido = { clave: string; titulo: string; ir: () => void; hecho?: () => void }
export type Recorrido = { nombre: string; icono: string; pasos: PasoRecorrido[]; i: number }

let actual: Recorrido | null = null
const avisar = new Set<() => void>()
const fijar = (r: Recorrido | null) => { actual = r; avisar.forEach((f) => f()) }

export function iniciarRecorrido(r: Recorrido) { fijar(r); r.pasos[r.i]?.ir() }
export function terminarRecorrido() { fijar(null) }
export function siguientePaso(marcarHecho: boolean) {
  if (!actual) return
  const paso = actual.pasos[actual.i]
  if (marcarHecho && paso) { if (paso.hecho) paso.hecho(); else ocultarPorHoy(paso.clave) }
  const i = actual.i + 1
  if (i >= actual.pasos.length) { fijar(null); return 'fin' as const }
  fijar({ ...actual, i })
  actual?.pasos[i].ir()
  return 'sigue' as const
}
export function useRecorrido() {
  return useSyncExternalStore((f) => { avisar.add(f); return () => { avisar.delete(f) } }, () => actual)
}
