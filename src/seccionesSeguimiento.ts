import type { ResumenModificaciones } from './presupuestoModificaciones'
import { moneda, fechaCorta } from './gestionFormat'
import { etiquetaObra } from './obraEstado'
import { importeNeto } from './presupuestoCalculos'
export type SeccionSeguimiento = { titulo: string; lineas: string[] }
export function fechaDocumento(r: ResumenModificaciones) {
  if (r.ultimaModificacion) return `Última modificación: ${new Date(r.ultimaModificacion).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' })}`
  return `Última actividad registrada: ${fechaCorta(r.fechaActividad)} (sin historial de edición anterior)`
}
export function otrosOriginales(r: ResumenModificaciones): SeccionSeguimiento[] {
  return r.otrosPresupuestos.map(p => ({ titulo: `Otro presupuesto aceptado N° ${String(p.id).padStart(4, '0')}`,
    lineas: [p.titulo, ...p.items.map(i => `${i.descripcion} · ${i.cantidad} × ${moneda(i.precio_unitario)}${i.descuento_pct ? ` · Descuento ${i.descuento_pct}%` : ''} = ${moneda(importeNeto(i))}`), `Total original de este presupuesto: ${moneda(p.total)}`] }))
}
export function seccionesSeguimiento(r: ResumenModificaciones): SeccionSeguimiento[] {
  const fin = ['finalizada', 'observacion'].includes(r.estado) || r.porcentaje === 100
  const secciones: SeccionSeguimiento[] = [{ titulo: 'Seguimiento de la obra', lineas: [
    `Estado: ${etiquetaObra(r.estado)} · Avance registrado: ${r.porcentaje}%`,
    ...r.avances.flatMap(a => [`${fechaCorta(a.fecha)} · ${a.titulo || 'Avance'} · ${a.porcentaje}%`, ...(a.descripcion ? [a.descripcion] : [])]),
    ...(r.avances.length ? [] : ['Todavía no hay avances registrados.']),
  ] }, { titulo: 'Pagos recibidos', lineas: r.pagos.length
    ? r.pagos.map(p => `${fechaCorta(p.fecha)} · ${(p.medio_pago || 'Sin medio indicado').replace(/_/g, ' ')}${p.referencia ? ` · Ref.: ${p.referencia}` : ''} · ${moneda(p.monto)}`)
    : ['No hay pagos registrados.'] }]
  if (r.gastos.length) secciones.push({ titulo: 'Gastos a reintegrar', lineas: [
    ...r.gastos.map(g => `${fechaCorta(g.fecha)} · ${g.descripcion} · ${moneda(g.importe)} · ${g.estado === 'pagado' ? 'Ya devuelto' : 'Pendiente de reintegro'}`),
    `Reintegros pendientes: ${moneda(r.gastoExtraPendiente)} · Ya devueltos: ${moneda(r.reintegrado)}`,
    'Los reintegros devueltos se registran por separado; no se vuelven a sumar al saldo ni a los pagos de la obra.',
  ] })
  secciones.push({ titulo: 'Condición de pago y saldo exigible', lineas: [
    `Acuerdo: 70% al confirmar y 30% al finalizar. Anticipo sobre el original aceptado: ${moneda(r.cuenta.anticipo)}${r.cuenta.anticipo < r.totalOriginal * .7 - .01 ? ' (limitado al valor actualizado por reducción de alcance)' : ''}.`,
    `Corresponde haber abonado a hoy${fin ? ' (obra finalizada)' : ' (anticipo)'}: ${moneda(r.cuenta.corresponde)}. Incluye reintegros pendientes.`,
    `Pendiente de pago hoy: ${moneda(r.cuenta.pendienteHoy)}.`,
    ...(r.cuenta.diferencia > 0 ? [`Adelanto sobre lo exigible hoy: ${moneda(r.cuenta.diferencia)}.`] : []),
    `Saldo total${r.saldo < 0 ? ' a favor del cliente' : ' para completar la cuenta'}: ${moneda(Math.abs(r.saldo))}.`,
    ...(r.cuenta.anticipoPendiente > 0 && !fin ? [
      `La obra se encuentra en ejecución y el anticipo del 70% aún no figura cubierto en los pagos registrados. Importe pendiente del anticipo: ${moneda(r.cuenta.anticipoPendiente)}. Solicitamos regularizarlo a la brevedad.`,
    ] : []),
    'El avance informa el trabajo realizado. No modifica los vencimientos del acuerdo 70/30.',
  ] })
  return secciones
}
