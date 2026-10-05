import { supabase } from './supabase'
import type { antesYAhora } from './presupuestoModificaciones'

// =====================================================================
//  Estado de la obra para el documento único del presupuesto.
//
//  Regla de cobro (acuerdo 70 / 30):
//   · ANTICIPO = 70% del presupuesto original aceptado (si las modificaciones
//     bajan el total, se limita al total actualizado). Los pagos del cliente se
//     aplican primero al anticipo, aunque la obra ya haya empezado.
//   · RESTO = total actualizado − anticipo. Se va habilitando según el avance,
//     desde 0%: a hoy corresponde  anticipo + resto × avance%.
//   · GASTOS EXTRA = reintegros aparte: aprobado = pendiente de reintegro,
//     "Pagado" = ya reintegrado. No se mezclan con el total de la obra.
// =====================================================================

export const PCT_ANTICIPO = 70

type Modificacion = Parameters<typeof antesYAhora>[0]

export type PagoEstado = { id: number; fecha: string; monto: number; medio: string | null; referencia: string | null }
export type AvanceEstado = { id: number; fecha: string; titulo: string; descripcion: string | null; porcentaje: number }
export type GastoExtraEstado = { id: number; fecha: string; descripcion: string; importe: number; devuelto: boolean; comprobante: string | null }

export type PasoLinea = {
  tipo: 'anticipo' | 'avance' | 'final'
  avanceId?: number
  fecha: string | null
  titulo: string
  detalle: string | null
  porcentaje: number | null // avance acumulado de la obra
  importe: number // lo que se habilita en este paso
  acumulado: number // lo que corresponde pagar hasta este paso
  pagadoALaFecha: number
  estado: 'ok' | 'pendiente' | 'futuro'
  falta: number
}

export type EstadoPresupuesto = {
  enObra: boolean
  obraEstado: string | null
  terminada: boolean
  avance: number
  obraIniciada: boolean
  modificaciones: Modificacion[]
  totalOriginal: number
  totalCambios: number
  totalActualizado: number
  anticipo: number
  anticipoCubierto: boolean
  faltaAnticipo: number
  resto: number
  corresponde: number
  pendienteHoy: number
  adelanto: number
  saldoTotal: number
  gastosExtra: GastoExtraEstado[]
  gastoExtraPendiente: number
  pagos: PagoEstado[]
  cobrado: number
  avances: AvanceEstado[]
  linea: PasoLinea[]
  ultimaActualizacion: string
}

const num = (x: unknown) => (x == null || x === '' ? null : Number(x))
const r2 = (n: number) => Math.round(n * 100) / 100
const dia = (f: unknown) => String(f ?? '').slice(0, 10)

// Devuelve null si el presupuesto no está aceptado (es un presupuesto común).
export async function cargarEstadoPresupuesto(presupuestoId: number, totalOriginal: number): Promise<EstadoPresupuesto | null> {
  if (!presupuestoId) return null
  const { data: pres, error } = await supabase.from('presupuestos').select('id, obra_id, estado, fecha').eq('id', presupuestoId).maybeSingle()
  if (error) throw error
  if (!pres || pres.estado !== 'aceptado') return null
  const obraId = pres.obra_id != null ? Number(pres.obra_id) : null

  const vacio = Promise.resolve({ data: [] as unknown[], error: null })
  const [rObra, rAdic, rPagos, rPres, rAv] = await Promise.all([
    obraId != null ? supabase.from('obras').select('id, estado, porcentaje_avance').eq('id', obraId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    obraId != null ? supabase.from('adicionales').select('*').eq('obra_id', obraId).order('fecha', { ascending: true }).order('id', { ascending: true }) : vacio,
    supabase.from('pagos').select('id, monto, fecha, medio_pago, referencia, notas, presupuesto_id, obra_id').or(obraId != null ? `presupuesto_id.eq.${presupuestoId},obra_id.eq.${obraId}` : `presupuesto_id.eq.${presupuestoId}`).order('fecha', { ascending: true }),
    obraId != null ? supabase.from('presupuestos').select('id').eq('obra_id', obraId).eq('estado', 'aceptado').eq('activo', true) : Promise.resolve({ data: [{ id: presupuestoId }], error: null }),
    obraId != null ? supabase.from('obra_avances').select('id, fecha, titulo, descripcion, porcentaje, created_at').eq('obra_id', obraId).order('fecha', { ascending: true }).order('id', { ascending: true }) : vacio,
  ])
  for (const r of [rObra, rAdic, rPagos, rAv]) if (r.error) throw r.error

  // Con un solo presupuesto aceptado en la obra, lo cargado a la obra (sin presupuesto) es de este presupuesto.
  const unico = ((rPres.data ?? []) as unknown[]).length <= 1
  const propio = (fila: Record<string, unknown>) =>
    Number(fila.presupuesto_id) === presupuestoId || (unico && fila.presupuesto_id == null && obraId != null && Number(fila.obra_id) === obraId)

  const adicionales = ((rAdic.data ?? []) as Record<string, unknown>[]).filter(propio)
  const modificaciones: Modificacion[] = adicionales
    .filter((a) => a.estado === 'aprobado' && a.tipo !== 'gasto_extra')
    .map((a) => ({
      id: Number(a.id), fecha: dia(a.fecha), tipo: String(a.tipo), cambio_tipo: (a.cambio_tipo ?? null) as Modificacion['cambio_tipo'],
      descripcion: String(a.descripcion ?? ''), motivo: (a.motivo as string) ?? null,
      descripcion_anterior: (a.descripcion_anterior as string) ?? null,
      cantidad_anterior: num(a.cantidad_anterior), precio_anterior: num(a.precio_anterior),
      cantidad_nueva: num(a.cantidad_nueva), precio_nuevo: num(a.precio_nuevo),
      importe: Number(a.importe) || 0,
    }) as Modificacion)
  const gastosExtra: GastoExtraEstado[] = adicionales
    .filter((a) => a.tipo === 'gasto_extra' && (a.estado === 'aprobado' || a.estado === 'pagado'))
    .map((a) => ({ id: Number(a.id), fecha: dia(a.fecha), descripcion: String(a.descripcion ?? ''), importe: Math.abs(Number(a.importe) || 0), devuelto: a.estado === 'pagado', comprobante: (a.comprobante_path as string) || null }))
  const pagos: PagoEstado[] = ((rPagos.data ?? []) as Record<string, unknown>[]).filter(propio).map((p) => ({
    id: Number(p.id), fecha: dia(p.fecha), monto: Number(p.monto) || 0,
    medio: (p.medio_pago as string) ?? null, referencia: ((p.referencia as string) || (p.notas as string)) || null,
  }))
  const avances: AvanceEstado[] = ((rAv.data ?? []) as Record<string, unknown>[]).map((a) => ({
    id: Number(a.id), fecha: dia(a.fecha), titulo: String(a.titulo ?? 'Avance'), descripcion: (a.descripcion as string) || null,
    porcentaje: Math.min(100, Math.max(0, Number(a.porcentaje) || 0)),
  }))

  const obra = rObra.data as { estado?: string | null; porcentaje_avance?: number | null } | null
  const obraEstado = obra?.estado ?? null
  const terminada = obraEstado === 'finalizada' || obraEstado === 'observacion'
  const avance = terminada ? 100 : Math.min(100, Math.max(0, Number(obra?.porcentaje_avance ?? 0)))
  const obraIniciada = avances.length > 0 || avance > 0

  const totalCambios = r2(modificaciones.reduce((s, m) => s + (Number(m.importe) || 0), 0))
  const totalActualizado = r2(totalOriginal + totalCambios)
  const anticipo = r2(Math.max(0, Math.min(totalOriginal, totalActualizado)) * PCT_ANTICIPO / 100)
  const resto = r2(Math.max(0, totalActualizado - anticipo))
  const cobrado = r2(pagos.reduce((s, p) => s + p.monto, 0))
  const gastoExtraPendiente = r2(gastosExtra.filter((g) => !g.devuelto).reduce((s, g) => s + g.importe, 0))
  const corresponde = r2(anticipo + resto * avance / 100)
  const pendienteHoy = r2(Math.max(0, corresponde - cobrado))
  const adelanto = r2(Math.max(0, cobrado - corresponde))
  const saldoTotal = r2(totalActualizado - cobrado)
  const anticipoCubierto = cobrado >= anticipo - 0.5
  const faltaAnticipo = r2(Math.max(0, anticipo - cobrado))

  const pagadoHasta = (fecha: string | null) => r2(pagos.filter((p) => !fecha || p.fecha <= fecha).reduce((s, p) => s + p.monto, 0))
  // Fecha en que los pagos acumulados cubrieron el anticipo.
  let fechaAnticipo: string | null = null
  let acum = 0
  for (const p of pagos) { acum += p.monto; if (acum >= anticipo - 0.5) { fechaAnticipo = p.fecha; break } }

  // ---- Línea de tiempo ----
  const linea: PasoLinea[] = [{
    tipo: 'anticipo', fecha: fechaAnticipo, titulo: `Anticipo por aceptación del presupuesto (${PCT_ANTICIPO}%)`,
    detalle: anticipoCubierto ? (fechaAnticipo ? `Completado el ${fechaAnticipo.split('-').reverse().join('/')}` : 'Recibido') : obraIniciada ? 'La obra se inició sin el anticipo completo. Te pedimos regularizarlo a la brevedad.' : 'Pendiente para confirmar el inicio de los trabajos.',
    porcentaje: null, importe: anticipo, acumulado: anticipo, pagadoALaFecha: cobrado,
    estado: anticipoCubierto ? 'ok' : 'pendiente', falta: faltaAnticipo,
  }]
  let pctPrevio = 0
  for (const a of avances) {
    // Cada avance vale lo que dice (puede bajar: por ejemplo, una reforma atrasa la obra).
    const pct = Math.min(100, Math.max(0, a.porcentaje))
    const acumulado = r2(anticipo + resto * pct / 100)
    const pagado = pagadoHasta(a.fecha)
    // Lo pendiente de un paso se evalúa con lo pagado HOY: si ya se pagó después, queda al día.
    const falta = r2(Math.max(0, acumulado - cobrado))
    linea.push({
      tipo: 'avance', avanceId: a.id, fecha: a.fecha, titulo: a.titulo, detalle: a.descripcion, porcentaje: pct,
      importe: r2(resto * (pct - pctPrevio) / 100), acumulado, pagadoALaFecha: pagado,
      estado: falta > 0.5 ? 'pendiente' : 'ok', falta,
    })
    pctPrevio = pct
  }
  if (pctPrevio < 100 || !terminada) {
    const pctFinal = terminada ? 100 : pctPrevio
    linea.push({
      tipo: 'final', fecha: null, titulo: terminada ? 'Obra finalizada' : 'Al finalizar la obra (100%)',
      detalle: terminada ? null : 'Saldo final a abonar al terminar los trabajos.',
      porcentaje: 100, importe: r2(resto * (100 - pctFinal) / 100), acumulado: totalActualizado, pagadoALaFecha: cobrado,
      estado: terminada ? (cobrado >= totalActualizado - 0.5 ? 'ok' : 'pendiente') : 'futuro',
      falta: r2(Math.max(0, totalActualizado - cobrado)),
    })
  }

  const fechas = [dia(pres.fecha), ...pagos.map((p) => p.fecha), ...avances.map((a) => a.fecha), ...modificaciones.map((m) => m.fecha), ...gastosExtra.map((g) => g.fecha)].filter(Boolean)
  const ultimaActualizacion = fechas.sort().pop() ?? dia(pres.fecha)

  return {
    enObra: obraId != null, obraEstado, terminada, avance, obraIniciada,
    modificaciones, totalOriginal, totalCambios, totalActualizado,
    anticipo, anticipoCubierto, faltaAnticipo, resto, corresponde, pendienteHoy, adelanto, saldoTotal,
    gastosExtra, gastoExtraPendiente, pagos, cobrado, avances, linea, ultimaActualizacion,
  }
}

// Mensaje principal para el cliente.
// Lo que el cliente tiene que pagar hoy: lo de la obra según el avance más los
// gastos a reintegrar que todavía no devolvió.
export const totalAPagarHoy = (e: EstadoPresupuesto) => Math.round((Math.max(0, e.pendienteHoy) + Math.max(0, e.gastoExtraPendiente)) * 100) / 100

export function mensajeEstado(e: EstadoPresupuesto, formatoMoneda: (n: number) => string): { tono: 'ok' | 'alerta'; titulo: string; detalle: string } {
  const m = mensajeBase(e, formatoMoneda)
  if (e.gastoExtraPendiente <= 0.5 || m.tono === 'ok') return m
  return { ...m, detalle: `${m.detalle} Además hay gastos a reintegrar por ${formatoMoneda(e.gastoExtraPendiente)}: en total, a pagar hoy ${formatoMoneda(totalAPagarHoy(e))}.` }
}

function mensajeBase(e: EstadoPresupuesto, formatoMoneda: (n: number) => string): { tono: 'ok' | 'alerta'; titulo: string; detalle: string } {
  if (e.saldoTotal <= 0.5 && e.gastoExtraPendiente <= 0.5) return { tono: 'ok', titulo: 'Está todo pago', detalle: '¡Gracias! No hay saldos pendientes.' }
  if (!e.anticipoCubierto && e.obraIniciada) {
    return { tono: 'alerta', titulo: `Falta completar el anticipo: ${formatoMoneda(e.faltaAnticipo)}`, detalle: `Los trabajos se iniciaron sin haber recibido el anticipo del ${PCT_ANTICIPO}% (${formatoMoneda(e.anticipo)}). Te pedimos regularizarlo a la brevedad para continuar según lo previsto.` }
  }
  if (!e.anticipoCubierto) {
    return { tono: 'alerta', titulo: `Anticipo pendiente: ${formatoMoneda(e.faltaAnticipo)}`, detalle: `Con el anticipo del ${PCT_ANTICIPO}% confirmamos la fecha y compramos los materiales.` }
  }
  if (e.pendienteHoy > 0.5) {
    return { tono: 'alerta', titulo: `Pendiente a hoy: ${formatoMoneda(e.pendienteHoy)}`, detalle: `Corresponde al avance de la obra (${e.avance}%). El resto se abona a medida que avanzamos.` }
  }
  // La obra está al día pero quedan gastos por devolver.
  if (e.gastoExtraPendiente > 0.5) {
    return { tono: 'alerta', titulo: `Gastos a reintegrar: ${formatoMoneda(e.gastoExtraPendiente)}`, detalle: 'Los pagos de la obra están al día. Queda devolver los gastos que compramos para tu obra (detalle abajo).' }
  }
  return { tono: 'ok', titulo: 'Estás al día', detalle: e.terminada ? 'Obra finalizada.' : `Lo que queda (${formatoMoneda(Math.max(0, e.saldoTotal))}) se abona a medida que avanza la obra y al finalizar.` }
}
