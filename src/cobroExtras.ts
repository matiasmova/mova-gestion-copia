import { supabase } from './supabase'

// Aplicar un cobro a los gastos extra pendientes (reintegros del cliente).
// · Si el monto cubre el gasto completo, el gasto pasa a Pagado.
// · Si lo cubre en parte, el gasto se divide: lo pagado queda como Pagado y el
//   resto sigue Pendiente (y sigue sumando como costo hasta que se pague).
// · Lo que sobra después de cubrir los gastos elegidos va como cobro de la obra.
// Los reintegros no son ingresos del negocio: no se cargan en "pagos".

export type ExtraPendiente = {
  id: number; obra_id: number; descripcion: string; importe: number; fecha: string
  motivo: string | null; observaciones: string | null; medio_pago: string | null; proveedor: string | null
  comprobante_path: string | null; costo_id: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function cargarExtrasPendientes(obraId: number): Promise<ExtraPendiente[]> {
  const { data, error } = await supabase.from('adicionales')
    .select('id,obra_id,descripcion,importe,fecha,motivo,observaciones,medio_pago,proveedor,comprobante_path,costo_id')
    .eq('obra_id', obraId).eq('tipo', 'gasto_extra').eq('estado', 'aprobado').order('fecha', { ascending: true }).order('id', { ascending: true })
  if (error || !data) return []
  return data.map((a) => ({ ...a, importe: Math.abs(Number(a.importe) || 0) })) as ExtraPendiente[]
}

// Reparte el monto entre los gastos elegidos (del más viejo al más nuevo).
export function repartirMonto(monto: number, extras: ExtraPendiente[]) {
  let resto = r2(Math.max(0, monto))
  const partes = extras.map((g) => {
    const aplicado = r2(Math.min(resto, g.importe))
    resto = r2(resto - aplicado)
    return { gasto: g, aplicado, queda: r2(g.importe - aplicado) }
  })
  return { partes, sobrante: resto }
}

export async function aplicarCobroAExtras(
  obraId: number, monto: number, extras: ExtraPendiente[],
  datos: { fecha: string; medio_pago: string; referencia: string },
): Promise<{ ok: boolean; error?: string; sobrante: number }> {
  const { partes, sobrante } = repartirMonto(monto, extras)
  const fechaTxt = datos.fecha.split('-').reverse().join('/')
  const nota = `Reintegrado el ${fechaTxt} (${datos.medio_pago}${datos.referencia.trim() ? ` · ${datos.referencia.trim()}` : ''})`
  try {
    for (const { gasto: g, aplicado, queda } of partes) {
      if (aplicado <= 0) continue
      const obs = [g.observaciones, nota].filter(Boolean).join(' · ')
      if (queda <= 0.005) {
        // Pagado completo: deja de ser costo.
        if (g.costo_id) { const { error } = await supabase.from('costos').delete().eq('id', g.costo_id); if (error) throw error }
        const { error } = await supabase.from('adicionales').update({ estado: 'pagado', costo_id: null, observaciones: obs }).eq('id', g.id)
        if (error) throw error
      } else {
        // Pago parcial: el gasto queda por lo que falta y se agrega la parte pagada.
        const { error: e1 } = await supabase.from('adicionales').insert({
          obra_id: g.obra_id, tipo: 'gasto_extra', descripcion: `${g.descripcion} (pago parcial)`, motivo: g.motivo,
          importe: aplicado, fecha: g.fecha, observaciones: nota, estado: 'pagado',
          medio_pago: g.medio_pago, proveedor: g.proveedor, comprobante_path: null,
        })
        if (e1) throw e1
        const { error: e2 } = await supabase.from('adicionales').update({ importe: queda }).eq('id', g.id)
        if (e2) throw e2
        if (g.costo_id) { const { error: e3 } = await supabase.from('costos').update({ monto: queda }).eq('id', g.costo_id); if (e3) throw e3 }
      }
    }
    if (sobrante > 0.005) {
      const { error } = await supabase.from('pagos').insert({
        obra_id: obraId, presupuesto_id: null, monto: sobrante, fecha: datos.fecha,
        medio_pago: datos.medio_pago, referencia: datos.referencia.trim() || null,
      })
      if (error) throw error
    }
    return { ok: true, sobrante }
  } catch (e) {
    console.error(e)
    return { ok: false, error: e instanceof Error ? e.message : String(e), sobrante }
  }
}
