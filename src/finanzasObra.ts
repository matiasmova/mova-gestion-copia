import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { valoresObra, cuentaObra } from './cuentaObra'

// Valor de la obra y cobros del cliente. Lo usan la pestaña Finanzas
// y la línea de avances (Estados), para que muestren los mismos números.

export type CobroObra = {
  id: number
  monto: number
  fecha: string
  medio_pago: string | null
  referencia: string | null
}

export type FinanzasObra = {
  // Presupuestos aceptados + adicionales aprobados que no son Gasto extra.
  // Valor contratado actualizado, sin reintegros.
  valorProgresivo: number
  totalOriginal?: number
  // Gasto extra aprobado y todavía no marcado "Pagado": el cliente te lo debe
  // completo ya, no depende del avance de la obra.
  gastoExtraPendiente: number
  // Total: valorProgresivo + gastoExtraPendiente. Es "Valor de la obra" / "Saldo total".
  valor: number
  // Cobros cargados en la obra y en sus presupuestos, del más nuevo al más viejo.
  cobros: CobroObra[]
}

export async function leerFinanzasObra(obraId: number): Promise<FinanzasObra> {
  const [pres, adic] = await Promise.all([
    supabase.from('presupuestos').select('id,total,estado,activo').eq('obra_id', obraId),
    supabase.from('adicionales').select('importe,estado,tipo').eq('obra_id', obraId),
  ])
  const presupuestos = (pres.data ?? []) as { id: number; total: number | string; estado: string; activo: boolean }[]
  const adicionales = (adic.data ?? []) as { importe: number | string; estado: string; tipo: string }[]
  if (pres.error || adic.error) throw pres.error || adic.error
  const { valorProgresivo, gastoExtraPendiente, valor, totalOriginal } = valoresObra(presupuestos, adicionales)

  const filtros = [`obra_id.eq.${obraId}`]
  if (presupuestos.length > 0) {
    filtros.push(`presupuesto_id.in.(${presupuestos.map((p) => p.id).join(',')})`)
  }

  const { data, error } = await supabase
    .from('pagos')
    .select('id,monto,fecha,medio_pago,referencia')
    .or(filtros.join(','))
    .order('fecha', { ascending: false })

  if (error) throw error
  const cobros = (data ?? []).map(
    (p: { id: number; monto: number | string; fecha: string; medio_pago: string | null; referencia: string | null }) => ({
      ...p,
      monto: Number(p.monto),
    }),
  ) as CobroObra[]

  return { valorProgresivo, gastoExtraPendiente, valor, cobros, totalOriginal }
}

// Carga las finanzas de una obra. `clave` fuerza una recarga cuando cambia.
export function useFinanzasObra(obraId: number | null, clave: string | number) {
  const [datos, setDatos] = useState<FinanzasObra>({ valorProgresivo: 0, gastoExtraPendiente: 0, valor: 0, cobros: [] })
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDatos({ valorProgresivo: 0, gastoExtraPendiente: 0, valor: 0, cobros: [] })
    setError('')
    if (obraId == null) { setCargando(false); return }
    let vigente = true
    setCargando(true)
    leerFinanzasObra(obraId)
      .then((resultado) => {
        if (vigente) setDatos(resultado)
      })
      .catch((fallo) => { console.error(fallo); if (vigente) setError('No se pudo cargar el estado de cuenta.') })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [obraId, clave])

  return { ...datos, cargando, error }
}

const redondear = (n: number) => Math.round(n * 100) / 100

// Cobro exigible por acuerdo 70/30. El avance permanece como dato informativo.
// Los reintegros pendientes se exigen completos. hastaFecha solo filtra pagos;
// no reconstruye un estado histórico del contrato.
export function situacionCobro(
  valorProgresivo: number,
  gastoExtraPendiente: number,
  cobros: CobroObra[],
  porcentaje: number,
  hastaFecha?: string,
  finalizada = false,
  baseAnticipo = valorProgresivo,
) {
  const pct = Math.min(Math.max(Number(porcentaje) || 0, 0), 100)
  const limite = hastaFecha ? hastaFecha.slice(0, 10) : null
  const cobrado = redondear(
    cobros
      .filter((c) => !limite || String(c.fecha).slice(0, 10) <= limite)
      .reduce((t, c) => t + c.monto, 0),
  )
  return cuentaObra(valorProgresivo, gastoExtraPendiente, cobrado, pct, finalizada, baseAnticipo)
}
