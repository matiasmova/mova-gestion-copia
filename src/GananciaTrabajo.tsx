import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'
import CampoNumero from './CampoNumero'
import { cuentaTrabajo, empleadosDeObra, esExtraDeObra, esPagoEmpleado, type ItemCuenta } from './gananciaTrabajo'

// "Vas a ganar": la cuenta del trabajo, a la vista en todos los estados.
//  · Sin personal asignado (borrador, enviado): se usa el pago estimado a
//    empleados que se carga acá mismo.
//  · Con personal asignado a la obra: lo acordado con cada uno.
//  · Extras: los gastos cargados en la obra (nafta, tercerizados, otros).

type Props = {
  presupuestoIds: number[] // el estimado editable solo cuando es uno
  obraId: number | null
  items: ItemCuenta[]
  total: number
  adicionales?: number
}

export default function GananciaTrabajo({ presupuestoIds, obraId, items, total, adicionales = 0 }: Props) {
  const [estimado, setEstimado] = useState(0)
  const [faltaSql, setFaltaSql] = useState(false)
  const [personal, setPersonal] = useState<{ nombre: string; total: number; pagado: number; asignado: boolean; sinJornales: boolean }[]>([])
  const [extras, setExtras] = useState(0)
  const [abierta, setAbierta] = useState(false)
  const [guardado, setGuardado] = useState<'ok' | 'guardando' | 'error'>('ok')
  const ids = presupuestoIds.join(',')
  const unico = presupuestoIds.length === 1 ? presupuestoIds[0] : null

  useEffect(() => {
    let vigente = true
    void (async () => {
      if (presupuestoIds.length) {
        const r = await supabase.from('presupuestos').select('id, pago_empleados_estimado').in('id', presupuestoIds)
        if (!vigente) return
        if (r.error) setFaltaSql(true)
        else setEstimado(((r.data ?? []) as { pago_empleados_estimado: unknown }[]).reduce((s, p) => s + (Number(p.pago_empleados_estimado) || 0), 0))
      }
      if (obraId == null) { setPersonal([]); setExtras(0); return }
      const [rA, rP, rJ, rC] = await Promise.all([
        supabase.from('obra_asignaciones').select('personal_id, modalidad, valor_acordado').eq('obra_id', obraId),
        supabase.from('personal').select('id, nombre, apellido, costo_dia'),
        supabase.from('jornales').select('personal_id, jornada, horas').eq('obra_id', obraId),
        supabase.from('costos').select('monto, tipo, personal_id').eq('obra_id', obraId),
      ])
      if (!vigente) return
      const costos = ((rC.data ?? []) as { monto: unknown; tipo: string | null; personal_id: number | null }[]).map((c) => ({ ...c, monto: Number(c.monto) || 0 }))
      const asig = ((rA.data ?? []) as { personal_id: number | null; modalidad: string | null; valor_acordado: unknown }[]).map((a) => ({ ...a, valor_acordado: a.valor_acordado == null ? null : Number(a.valor_acordado) }))
      const gente = (rP.data ?? []) as { id: number; nombre: string | null; apellido: string | null; costo_dia: unknown }[]
      const filas = empleadosDeObra(
        asig,
        gente.map((p) => ({ id: p.id, costo_dia: p.costo_dia == null ? null : Number(p.costo_dia) })),
        costos.filter(esPagoEmpleado),
        ((rJ.data ?? []) as { personal_id: number | null; jornada: unknown; horas: unknown }[]).map((j) => ({ personal_id: j.personal_id, jornada: Number(j.jornada) || 0, horas: j.horas == null ? null : Number(j.horas) })),
        total + adicionales,
      )
      setPersonal(filas.map((f) => {
        const g = gente.find((p) => p.id === f.personal_id)
        return { ...f, nombre: g ? `${g.nombre ?? ''} ${g.apellido ?? ''}`.trim() || 'Persona' : 'Mano de obra sin persona' }
      }))
      setExtras(costos.filter(esExtraDeObra).reduce((s, c) => s + c.monto, 0))
    })()
    return () => { vigente = false }
    // El valor de la obra solo afecta al personal "por porcentaje": se recalcula al cambiar el total.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, obraId, Math.round(total + adicionales)])

  // Guarda el estimado cuando se deja de escribir.
  const tGuardar = useRef<ReturnType<typeof setTimeout> | null>(null)
  function cambiarEstimado(v: number) {
    setEstimado(v)
    if (unico == null) return
    setGuardado('guardando')
    if (tGuardar.current) clearTimeout(tGuardar.current)
    tGuardar.current = setTimeout(async () => {
      const { error } = await supabase.from('presupuestos').update({ pago_empleados_estimado: v }).eq('id', unico)
      if (error) { console.error(error); setFaltaSql(true) }
      setGuardado(error ? 'error' : 'ok')
    }, 800)
  }

  // Lo real (acordado con el personal o ya pagado); mientras dé $ 0, el estimado.
  const real = personal.reduce((s, f) => s + f.total, 0)
  const conPersonal = real > 0
  const empleados = conPersonal ? real : estimado
  const sinJornales = personal.filter((f) => f.sinJornales)
  const c = cuentaTrabajo(items, total, empleados, extras, adicionales)
  const base = total + adicionales
  const pct = base > 0 ? Math.round((c.ganancia / base) * 100) : null
  const partes: [number, string][] = [[c.ganProductos, '#e0701a'], [Math.max(0, c.servicios + c.adicionales - c.bonificacion - c.empleados - c.extras), '#2f63b8'], [c.empleados, '#a1530f'], [c.extras, '#cf4b37'], [c.costoProductos, '#b7bdc6']]

  return <section className="gtCaja" aria-label="Vas a ganar">
    <button type="button" className="gtCab" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
      <span><small>VAS A GANAR · interno, no lo ve el cliente</small><b className={c.ganancia < 0 ? 'r' : 'v'}>{moneda(c.ganancia)}</b>{pct != null && <em>Te queda el {pct}% de lo que paga el cliente</em>}</span>
      <i aria-hidden>{abierta ? '▴' : '▾'}</i>
    </button>
    <div className="gtBarra" aria-hidden>{partes.filter(([v]) => v > 0.5).map(([v, col], i) => <i key={i} style={{ flex: v, background: col }} />)}</div>
    {!conPersonal && !abierta && empleados === 0 && <button type="button" className="gtAviso" onClick={() => setAbierta(true)}>👷 Cargá cuánto vas a pagar a los empleados para ver la ganancia real ›</button>}
    {abierta && <>
      <div className="gtLineas">
        <div><span><i style={{ background: '#e0701a' }} />Ganancia en productos<small>Vendés {moneda(c.ventaProductos)} · te cuestan {moneda(c.costoProductos)}</small></span><b>{moneda(c.ganProductos)}</b></div>
        <div><span><i style={{ background: '#2f63b8' }} />Servicios<small>100% tuyo</small></span><b>{moneda(c.servicios)}</b></div>
        {c.adicionales !== 0 && <div><span><i style={{ background: '#2f63b8' }} />Cambios y adicionales<small>aprobados en la obra</small></span><b>{moneda(c.adicionales)}</b></div>}
        {c.bonificacion > 0.5 && <div><span><i style={{ background: '#b7bdc6' }} />Bonificación general</span><b className="r">− {moneda(c.bonificacion)}</b></div>}
        <div><span><i style={{ background: '#a1530f' }} />Empleados<small>{conPersonal ? 'Lo acordado con el personal y lo ya pagado' : 'Estimado (lo cargás abajo)'}</small></span><b className="r">− {moneda(c.empleados)}</b></div>
        {conPersonal && personal.filter((f) => f.total > 0.5 || f.sinJornales).map((f, i) => (
          <div key={i} className="gtSub"><span>{f.nombre}<small>{f.asignado ? (f.sinJornales ? 'por día/hora · sin jornales cargados' : f.pagado > 0.5 ? `acordado · pagado ${moneda(f.pagado)}` : 'acordado') : 'pagado (no está asignado a la obra)'}</small></span><b>{moneda(f.total)}</b></div>
        ))}
        <div><span><i style={{ background: '#cf4b37' }} />Extras de la obra<small>{obraId == null ? 'Se cargan cuando es obra' : c.extras ? 'Nafta, tercerizados y otros cargados en la obra' : 'Todavía no hay gastos cargados'}</small></span><b className="r">− {moneda(c.extras)}</b></div>
        <div className="tot"><span>= Vas a ganar</span><b className={c.ganancia < 0 ? 'r' : 'v'}>{moneda(c.ganancia)}</b></div>
      </div>
      {!conPersonal && unico != null && <label className="gtCampo">
        <span><b>Pago estimado a empleados</b><small>{guardado === 'guardando' ? 'Guardando…' : guardado === 'error' ? '⚠ No se guardó' : 'Lo que pensás pagar por este trabajo'}</small></span>
        <CampoNumero value={estimado} onChange={(e) => cambiarEstimado(Math.max(0, Number(e.target.value) || 0))} aria-label="Pago estimado a empleados" />
      </label>}
      {conPersonal && <p className="gtNota">Los empleados salen del personal de la obra: lo acordado con cada uno o lo que ya le pagaste, si es más. Se actualiza solo.</p>}
      {sinJornales.length > 0 && <p className="gtAlerta">📅 {sinJornales.map((f) => f.nombre).join(', ')} cobra{sinJornales.length === 1 ? '' : 'n'} por día y no tiene{sinJornales.length === 1 ? '' : 'n'} jornales cargados: su parte da $ 0 hasta que cargues los días.</p>}
      {c.sinCosto > 0 && <p className="gtAlerta">⚠️ {c.sinCosto} producto{c.sinCosto === 1 ? '' : 's'} sin costo cargado: se toman como ganancia completa. Cargá el costo en el ítem o en Productos.</p>}
      {faltaSql && <p className="gtAlerta">Para guardar el pago estimado falta correr en Supabase el SQL "supabase-ganancia-presupuesto-fase-33.sql".</p>}
    </>}
  </section>
}
