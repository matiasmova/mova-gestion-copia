export function moneda(valor: number | string | null | undefined) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(Number(valor) || 0)
}

export function fechaCorta(valor: string | null | undefined) {
  if (!valor) return 'Sin fecha'
  return new Date(`${valor.slice(0, 10)}T00:00:00`).toLocaleDateString(
    'es-AR',
  )
}

export function hoy() {
  return new Date().toISOString().slice(0, 10)
}
