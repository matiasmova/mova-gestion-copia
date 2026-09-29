import { configActual, guardarConfig } from './config'

// Moneda de visualización del catálogo y cotización del dólar guardada.
// La usan la pantalla de productos, la importación desde hoja de cálculo
// y la actualización de precios por cotización, para que sea la misma
// cotización en todos lados.

export const CLAVE_COTIZACION = 'mova_cotizacion_usd'
export const CLAVE_MONEDA = 'mova_moneda_vista'

export type Moneda = 'ARS' | 'USD'

// La cotización se guarda en la base (Configuración, compartida entre PC y
// celular). Si todavía no hay una ahí, se usa la que quedó en este navegador.
export function leerCotizacion(): number {
  const enBase = configActual().cotizacion.usd
  if (enBase > 0) return enBase
  try {
    return Number((localStorage.getItem(CLAVE_COTIZACION) ?? '').replace(',', '.')) || 0
  } catch {
    return 0
  }
}

export async function guardarCotizacion(valor: number, fuente: string | null = null) {
  try { localStorage.setItem(CLAVE_COTIZACION, String(valor)) } catch { /* sin almacenamiento */ }
  await guardarConfig('cotizacion', { usd: valor, fecha: new Date().toISOString(), fuente })
}

// Cotización del día desde dolarapi.com (oficial, blue o MEP), en pesos por dólar (venta).
export async function traerCotizacionOnline(casa: 'oficial' | 'blue' | 'bolsa'): Promise<{ venta: number; fecha: string }> {
  const r = await fetch(`https://dolarapi.com/v1/dolares/${casa}`)
  if (!r.ok) throw new Error('No se pudo consultar la cotización')
  const d = (await r.json()) as { venta?: number; fechaActualizacion?: string }
  if (!d.venta) throw new Error('Respuesta sin cotización')
  return { venta: d.venta, fecha: d.fechaActualizacion ?? new Date().toISOString() }
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
