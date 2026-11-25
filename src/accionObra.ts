import type { OpcionRegistrar } from './RegistrarObra'

// Algo para hacer apenas se abra una obra desde otra pantalla (por ejemplo,
// "Cobrar" en Para hacer abre la obra directo en el formulario de cobro).
let pendiente: { id: number; op: OpcionRegistrar; hasta: number } | null = null

export function pedirAccionObra(id: number, op: OpcionRegistrar) { pendiente = { id, op, hasta: Date.now() + 15_000 } }

// La toma una sola vez (si es de esta obra y no venció).
export function tomarAccionObra(id: number): OpcionRegistrar | null {
  const p = pendiente
  if (!p || p.id !== id || Date.now() > p.hasta) return null
  pendiente = null
  return p.op
}
