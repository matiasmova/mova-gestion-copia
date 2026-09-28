// Regla única del acuerdo comercial: 70% al confirmar, 30% al finalizar.
// Los reintegros se llevan aparte y no generan un segundo cobro al marcarlos Pagados.
export const ANTICIPO_PCT = 70
export const redondearCuenta = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export type MovimientoCuenta = { importe: number | string; tipo: string; estado: string }
export function valoresObra(presupuestos: { total: number | string; estado: string; activo?: boolean | null }[], adicionales: MovimientoCuenta[]) {
  const totalOriginal = redondearCuenta(presupuestos.filter(p => p.estado === 'aceptado' && p.activo !== false).reduce((s, p) => s + Number(p.total || 0), 0))
  const totalCambios = redondearCuenta(adicionales.filter(a => a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + Number(a.importe || 0), 0))
  const gastoExtraPendiente = redondearCuenta(adicionales.filter(a => a.estado === 'aprobado' && a.tipo === 'gasto_extra').reduce((s, a) => s + Number(a.importe || 0), 0))
  const reintegrado = redondearCuenta(adicionales.filter(a => a.estado === 'pagado' && a.tipo === 'gasto_extra').reduce((s, a) => s + Number(a.importe || 0), 0))
  const valorProgresivo = redondearCuenta(totalOriginal + totalCambios)
  return { totalOriginal, totalCambios, valorProgresivo, gastoExtraPendiente, reintegrado, valor: redondearCuenta(valorProgresivo + gastoExtraPendiente) }
}
export function cuentaObra(valor: number, extras: number, cobrado: number, porcentaje: number, finalizada = false, baseAnticipo = valor) {
  const pct = Math.min(100, Math.max(0, Number(porcentaje) || 0))
  const base = Math.max(0, valor)
  // El anticipo se pacta sobre lo aceptado. Una reducción de alcance limita
  // lo exigible al nuevo valor; los adicionales no cambian retroactivamente la seña.
  const anticipo = redondearCuenta(Math.min(base, Math.max(0, baseAnticipo) * ANTICIPO_PCT / 100))
  const corresponde = redondearCuenta((finalizada || pct === 100 ? base : anticipo) + extras)
  return { pct, anticipo, corresponde, cobrado: redondearCuenta(cobrado),
    diferencia: redondearCuenta(cobrado - corresponde),
    anticipoPendiente: redondearCuenta(Math.max(0, anticipo - cobrado)),
    saldo: redondearCuenta(valor + extras - cobrado),
    pendienteHoy: redondearCuenta(Math.max(0, corresponde - cobrado)),
    valorEjecutado: redondearCuenta(base * pct / 100) }
}
