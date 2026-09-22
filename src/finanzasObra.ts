import { useEffect, useState } from 'react'
import { supabase } from './supabase'

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
  // Es la parte del valor que se cobra de a poco, según el avance.
  valorProgresivo: number
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
  const aprobados = adicionales.filter((a) => a.estado === 'aprobado')

  const valorProgresivo =
    presupuestos
      .filter((p) => p.activo !== false && p.estado === 'aceptado')
      .reduce((t, p) => t + (Number(p.total) || 0), 0) +
    aprobados
      .filter((a) => a.tipo !== 'gasto_extra')
      .reduce((t, a) => t + (Number(a.importe) || 0), 0)
  const gastoExtraPendiente = aprobados
    .filter((a) => a.tipo === 'gasto_extra')
    .reduce((t, a) => t + (Number(a.importe) || 0), 0)
  const valor = valorProgresivo + gastoExtraPendiente

  const filtros = [`obra_id.eq.${obraId}`]
  if (presupuestos.length > 0) {
    filtros.push(`presupuesto_id.in.(${presupuestos.map((p) => p.id).join(',')})`)
  }

  const { data } = await supabase
    .from('pagos')
    .select('id,monto,fecha,medio_pago,referencia')
    .or(filtros.join(','))
    .order('fecha', { ascending: false })

  const cobros = (data ?? []).map(
    (p: { id: number; monto: number | string; fecha: string; medio_pago: string | null; referencia: string | null }) => ({
      ...p,
      monto: Number(p.monto),
    }),
  ) as CobroObra[]

  return { valorProgresivo, gastoExtraPendiente, valor, cobros }
}

// Carga las finanzas de una obra. `clave` fuerza una recarga cuando cambia.
export function useFinanzasObra(obraId: number | null, clave: string | number) {
  const [datos, setDatos] = useState<FinanzasObra>({ valorProgresivo: 0, gastoExtraPendiente: 0, valor: 0, cobros: [] })
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (obraId == null) return
    let vigente = true
    setCargando(true)
    leerFinanzasObra(obraId)
      .then((resultado) => {
        if (vigente) setDatos(resultado)
      })
      .catch((fallo) => console.error(fallo))
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [obraId, clave])

  return { ...datos, cargando }
}

const redondear = (n: number) => Math.round(n * 100) / 100

// Lo que corresponde haber cobrado con un % de avance y lo cobrado hasta una
// fecha. El Gasto extra pendiente se suma completo, sin escalarlo por el
// avance: el cliente lo debe ya, no depende de cuánto se hizo de la obra.
export function situacionCobro(
  valorProgresivo: number,
  gastoExtraPendiente: number,
  cobros: CobroObra[],
  porcentaje: number,
  hastaFecha?: string,
) {
  const pct = Math.min(Math.max(Number(porcentaje) || 0, 0), 100)
  const corresponde = redondear((valorProgresivo * pct) / 100 + gastoExtraPendiente)
  const limite = hastaFecha ? hastaFecha.slice(0, 10) : null
  const cobrado = redondear(
    cobros
      .filter((c) => !limite || String(c.fecha).slice(0, 10) <= limite)
      .reduce((t, c) => t + c.monto, 0),
  )
  return { pct, corresponde, cobrado, diferencia: redondear(cobrado - corresponde) }
}
