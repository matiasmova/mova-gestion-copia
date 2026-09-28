// Código del presupuesto que ve el cliente: combina letras y números y NO es
// correlativo, así no se sabe cuántos presupuestos se hicieron.
// Es fijo para cada presupuesto (siempre da el mismo código) y no se repite.

const MODULO = 36 ** 5 // 60.466.176 códigos posibles de 5 caracteres
const MULTIPLICADOR = 48_271_337 // impar y no múltiplo de 3: no hay dos presupuestos con el mismo código
const DESPLAZAMIENTO = 19_870_613

export function codigoPresupuesto(id: number): string {
  const n = ((Number(id) * MULTIPLICADOR + DESPLAZAMIENTO) % MODULO + MODULO) % MODULO
  return `MV-${n.toString(36).toUpperCase().padStart(5, '0')}`
}

const limpiar = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

// Nombre de archivo: Cliente_Obra_fecha_código.pdf
export function nombreArchivo(cliente: string, obra: string | null | undefined, id: number): string {
  const partes = [limpiar(cliente || 'Cliente')]
  if (obra && obra !== 'Sin obra asociada') partes.push(limpiar(obra))
  partes.push(new Date().toISOString().slice(0, 10), codigoPresupuesto(id))
  return `${partes.filter(Boolean).join('_')}.pdf`
}
