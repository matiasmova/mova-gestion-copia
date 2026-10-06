// Regla única del acuerdo comercial, la misma del documento del cliente
// (estadoObra.ts): 70% de anticipo al confirmar, que cubre el avance de 0 a 70%.
// Desde ahí corresponde el % de avance sobre el total: 80% → 80%, 100% → todo.
// Fórmula: anticipo + resto × (avance − 70) / 30. Los gastos extra a reintegrar
// se cobran completos, aparte, y no generan un segundo cobro al marcarlos Pagados.
export const ANTICIPO_PCT = 70
export const redondearCuenta = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
// Lo que corresponde haber pagado de la obra con un % de avance.
export const correspondePorAvance = (anticipo: number, total: number, pct: number) =>
  redondearCuenta(anticipo + Math.max(0, total - anticipo) * Math.max(0, Math.min(100, pct) - ANTICIPO_PCT) / (100 - ANTICIPO_PCT))
export type MovimientoCuenta = { importe: number | string; tipo: string; estado: string }

export const obraTerminada = (estado: string | null | undefined) => estado === 'finalizada' || estado === 'observacion'
// Avance que se usa para las cuentas: 100% si la obra está terminada.
export const avanceEfectivo = (estado: string | null | undefined, porcentaje: number | string | null | undefined) =>
  obraTerminada(estado) ? 100 : Math.min(100, Math.max(0, Number(porcentaje) || 0))

export function valoresObra(presupuestos: { total: number | string; estado: string; activo?: boolean | null }[], adicionales: MovimientoCuenta[]) {
  const totalOriginal = redondearCuenta(presupuestos.filter(p => p.estado === 'aceptado' && p.activo !== false).reduce((s, p) => s + Number(p.total || 0), 0))
  const totalCambios = redondearCuenta(adicionales.filter(a => a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + Number(a.importe || 0), 0))
  const gastoExtraPendiente = redondearCuenta(adicionales.filter(a => a.estado === 'aprobado' && a.tipo === 'gasto_extra').reduce((s, a) => s + Math.abs(Number(a.importe || 0)), 0))
  const reintegrado = redondearCuenta(adicionales.filter(a => a.estado === 'pagado' && a.tipo === 'gasto_extra').reduce((s, a) => s + Math.abs(Number(a.importe || 0)), 0))
  const valorProgresivo = redondearCuenta(totalOriginal + totalCambios)
  return { totalOriginal, totalCambios, valorProgresivo, gastoExtraPendiente, reintegrado, valor: redondearCuenta(valorProgresivo + gastoExtraPendiente) }
}

export function cuentaObra(valor: number, extras: number, cobrado: number, porcentaje: number, finalizada = false, baseAnticipo = valor) {
  const pct = finalizada ? 100 : Math.min(100, Math.max(0, Number(porcentaje) || 0))
  const base = Math.max(0, valor)
  // El anticipo se pacta sobre lo aceptado (si el alcance se redujo, sobre el valor nuevo).
  const anticipo = redondearCuenta(Math.min(base, Math.max(0, baseAnticipo)) * ANTICIPO_PCT / 100)
  const correspondeObra = correspondePorAvance(anticipo, base, pct)
  const pendienteObra = redondearCuenta(Math.max(0, correspondeObra - cobrado))
  const corresponde = redondearCuenta(correspondeObra + Math.max(0, extras))
  return { pct, anticipo, correspondeObra, corresponde, cobrado: redondearCuenta(cobrado),
    diferencia: redondearCuenta(cobrado - corresponde),
    anticipoPendiente: redondearCuenta(Math.max(0, anticipo - cobrado)),
    pendienteObra,
    // Lo que el cliente tiene que pagar hoy: lo de la obra según el avance + los extras.
    pendienteHoy: redondearCuenta(pendienteObra + Math.max(0, extras)),
    // Saldo total: lo que falta de la obra + los extras sin devolver.
    saldo: redondearCuenta(Math.max(0, valor - cobrado) + Math.max(0, extras)),
    valorEjecutado: redondearCuenta(base * pct / 100) }
}

// Cuenta de cada obra con presupuesto aceptado (Inicio, Tablero y la lista de obras).
export function cuentasPorObra(
  obras: { id: number; estado: string | null; porcentaje_avance: number | string | null }[],
  presupuestos: { id: number; obra_id: number | null; total: number | string; estado: string; activo?: boolean | null }[],
  adicionales: { obra_id: number | null; importe: number | string; estado: string; tipo: string }[],
  pagos: { obra_id: number | null; presupuesto_id: number | null; monto: number | string }[],
) {
  const obraDePresupuesto: Record<number, number> = {}
  for (const p of presupuestos) if (p.obra_id != null) obraDePresupuesto[p.id] = p.obra_id
  const cobrado: Record<number, number> = {}
  for (const pago of pagos) {
    const id = pago.obra_id ?? (pago.presupuesto_id != null ? obraDePresupuesto[pago.presupuesto_id] : undefined)
    if (id != null) cobrado[id] = (cobrado[id] || 0) + (Number(pago.monto) || 0)
  }
  const salida: Record<number, ReturnType<typeof cuentaObra> & { valor: number; extras: number; terminada: boolean; avance: number }> = {}
  for (const o of obras) {
    const suyos = presupuestos.filter((p) => p.obra_id === o.id)
    const v = valoresObra(suyos, adicionales.filter((a) => a.obra_id === o.id))
    if (v.totalOriginal <= 0 && !suyos.some((p) => p.estado === 'aceptado' && p.activo !== false)) continue
    const avance = avanceEfectivo(o.estado, o.porcentaje_avance)
    const terminada = obraTerminada(o.estado) || avance >= 100
    salida[o.id] = { ...cuentaObra(v.valorProgresivo, v.gastoExtraPendiente, cobrado[o.id] || 0, avance, terminada, v.totalOriginal), valor: v.valorProgresivo, extras: v.gastoExtraPendiente, terminada, avance }
  }
  return salida
}
