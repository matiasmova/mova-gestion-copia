import { supabase } from './supabase'
import { configActual } from './config'
import { codigoPresupuesto } from './codigoPresupuesto'
import { PCT_ANTICIPO, totalAPagarHoy } from './estadoObra'
import type { DatosPdf } from './pdfPresupuesto'

// Link de pago del cliente: una página pública (sin login) con lo que tiene que
// pagar hoy y los datos para transferir o coordinar efectivo. Sin comisiones.
// La página lee solo una "foto" de los datos (pago_links.datos), que se
// actualiza cada vez que la app prepara el documento.

export type DatosPago = {
  cliente: string; titulo: string; obra: string | null; codigo: string
  a_pagar: number; detalle: { t: string; v: number }[]; ya_pago: number
  efectivo: boolean; transferencia: boolean
  alias: string; cbu: string; titular: string; banco: string
  empresa: string; telefono: string; web: string
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function armarDatosPago(d: DatosPdf): DatosPago | null {
  const e = configActual().empresa
  const alias = (e.alias ?? '').trim(), cbu = (e.cbu ?? '').trim()
  const medios = d.formasPago?.medios ?? ['efectivo', 'transferencia', 'tarjeta']
  const transferencia = (!!alias || !!cbu) && medios.includes('transferencia')
  const efectivo = medios.includes('efectivo') && !!e.telefono
  if (!transferencia && !efectivo) return null
  const est = d.estado ?? null
  let a_pagar = 0, ya_pago = 0
  const detalle: { t: string; v: number }[] = []
  if (est) {
    a_pagar = totalAPagarHoy(est)
    ya_pago = est.cobrado
    if (est.pendienteHoy > 0.5) detalle.push({ t: est.anticipoCubierto ? `Avance de obra (${est.avance}%)` : `Anticipo ${PCT_ANTICIPO}%${est.avance > 0 ? ' + avance de obra' : ''}`, v: est.pendienteHoy })
    if (est.gastoExtraPendiente > 0.5) detalle.push({ t: `Gastos a reintegrar (${est.gastosExtra.filter((g) => !g.devuelto).length})`, v: est.gastoExtraPendiente })
  } else {
    a_pagar = r2(Number(d.total) * PCT_ANTICIPO / 100)
    detalle.push({ t: `Seña ${PCT_ANTICIPO}% para confirmar`, v: a_pagar })
  }
  const hayObra = !!d.obra && d.obra !== 'Sin obra asociada'
  return {
    cliente: d.cliente, titulo: d.titulo, obra: hayObra ? d.obra : null, codigo: codigoPresupuesto(d.id),
    a_pagar: r2(Math.max(0, a_pagar)), detalle, ya_pago: r2(ya_pago),
    efectivo, transferencia, alias: transferencia ? alias : '', cbu: transferencia ? cbu : '',
    titular: transferencia ? (e.titular || e.nombre).trim() : '', banco: transferencia ? (e.banco ?? '').trim() : '',
    empresa: e.nombre, telefono: e.telefono, web: e.web,
  }
}

export const urlPago = (token: string) => `${window.location.origin}/?pagar=${token}`

// Crea o actualiza el link del presupuesto con los montos de hoy. Devuelve la
// dirección, o null si falta el SQL, los datos para transferir o está desactivado.
export async function asegurarLinkPago(d: DatosPdf): Promise<string | null> {
  try {
    const datos = armarDatosPago(d)
    if (!datos) return null
    const { data: previo, error: e1 } = await supabase.from('pago_links').select('token, activo').eq('presupuesto_id', d.id).maybeSingle()
    if (e1) return null
    if (previo) {
      if (!previo.activo) return null
      await supabase.from('pago_links').update({ datos, actualizado_at: new Date().toISOString() }).eq('presupuesto_id', d.id)
      return urlPago(String(previo.token))
    }
    const { data, error } = await supabase.from('pago_links').insert({ presupuesto_id: d.id, datos }).select('token').single()
    if (error || !data) return null
    return urlPago(String(data.token))
  } catch { return null }
}

// Estado del link (para el panel): null = sin SQL o sin link todavía.
export async function estadoLinkPago(presupuestoId: number): Promise<{ token: string; activo: boolean } | null> {
  const { data, error } = await supabase.from('pago_links').select('token, activo').eq('presupuesto_id', presupuestoId).maybeSingle()
  if (error || !data) return null
  return { token: String(data.token), activo: !!data.activo }
}

export async function activarLinkPago(presupuestoId: number, activo: boolean) {
  const { error } = await supabase.from('pago_links').update({ activo }).eq('presupuesto_id', presupuestoId)
  return !error
}

// Lo que ve el cliente (sin login).
export async function leerPagoPublico(token: string): Promise<(DatosPago & { actualizado_at: string }) | null> {
  const { data, error } = await supabase.rpc('pago_publico', { p_token: token })
  if (error || !data) return null
  return data as DatosPago & { actualizado_at: string }
}
