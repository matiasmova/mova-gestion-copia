// Moneda de visualización del catálogo y cotización del dólar guardada.
// La usan la pantalla de productos, la importación desde hoja de cálculo
// y la actualización de precios por cotización, para que sea la misma
// cotización en todos lados.

export const CLAVE_COTIZACION = 'mova_cotizacion_usd'
export const CLAVE_MONEDA = 'mova_moneda_vista'

export type Moneda = 'ARS' | 'USD'

export function leerCotizacion(): number {
  try {
    return Number((localStorage.getItem(CLAVE_COTIZACION) ?? '').replace(',', '.')) || 0
  } catch {
    return 0
  }
}

export function leerMoneda(): Moneda {
  try {
    return localStorage.getItem(CLAVE_MONEDA) === 'USD' ? 'USD' : 'ARS'
  } catch {
    return 'ARS'
  }
}

export function guardarMoneda(valor: Moneda) {
  try {
    localStorage.setItem(CLAVE_MONEDA, valor)
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

export function formatoDinero(valor: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(valor || 0))
}

export function formatoDolar(valor: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(valor || 0))
}
