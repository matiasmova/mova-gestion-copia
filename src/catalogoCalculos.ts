// Cálculo de precios del catálogo. Lo usan el formulario de productos
// y la importación desde hoja de cálculo, para que den lo mismo.
//
// Cómo se interpreta el "% de ganancia":
//  · margen:  % del precio de venta que es ganancia  -> precio = costo / (1 − %)
//  · recargo: % que se suma sobre el costo           -> precio = costo × (1 + %)

export type ModoGanancia = 'margen' | 'recargo'

export const dos = (n: number) => Math.round(n * 100) / 100

// Precio de lista (sin IVA) a partir del costo y del % de ganancia.
// Devuelve null si el margen es 100% o más (no existe un precio que lo cumpla).
export function precioDesdeGanancia(
  costo: number,
  pct: number,
  modo: ModoGanancia,
): number | null {
  if (modo === 'margen') return pct < 100 ? costo / (1 - pct / 100) : null
  return costo * (1 + pct / 100)
}

// % de ganancia a partir del costo y del precio de lista.
export function gananciaDesdePrecio(
  costo: number,
  precio: number,
  modo: ModoGanancia,
): number {
  if (modo === 'margen') return precio > 0 ? ((precio - costo) / precio) * 100 : 0
  return costo > 0 ? ((precio - costo) / costo) * 100 : 0
}
