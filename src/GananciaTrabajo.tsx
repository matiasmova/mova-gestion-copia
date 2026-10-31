import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'
import CampoNumero from './CampoNumero'
import { cuentaTrabajo, esExtraDeObra, esPagoEmpleado, totalEmpleados, type ItemCuenta } from './gananciaTrabajo'

// "Vas a ganar": la cuenta del trabajo, a la vista en todos los estados.
//  · Gasto por ayudantes: el estimado del presupuesto, o lo ya pagado desde
//    Personal a esta obra si es más. Cada pago se descuenta del estimado.
//  · Extras: los gastos cargados en la obra (nafta, tercerizados, otros).

type Props = {
  presupuestoIds: number[] // el estimado editable solo cuando es uno
  obraId: number | null
  items: ItemCuenta[]
  total: number
  adicionales?: number
  reintegros?: number // Gasto extra que devuelve el cliente: no suma ni resta
  abiertaInicial?: boolean
  // Si el estimado se carga en otro lado (en el presupuesto), se pasa acá y no se muestra el campo.
  estimadoFijo?: number
  onGanancia?: (ganancia: number) => void
  onCargarPago?: () => void
}
type Pago = { id: number; fecha: string; monto: number; nombre: string }

export default function GananciaTrabajo({ presupuestoIds, obraId, items, total, adicionales = 0, reintegros = 0, abiertaInicial = false, estimadoFijo, onGanancia, onCargarPago }: Props) {
  const [estimadoGuardado, setEstimado] = useState(0)
  const [faltaSql, setFaltaSql] = useState(false)
  const [pagos, setPagos] = useState<Pago[]>([])
  const [extras, setExtras] = useState(0)
  const [abierta, setAbierta] = useState(abiertaInicial)
  const [guardado, setGuardado] = useState<'ok' | 'guardando' | 'error'>('ok')
  const ids = presupuestoIds.join(',')
  const unico = presupuestoIds.length === 1 ? presupuestoIds[0] : null
  const estimado = estimadoFijo ?? estimadoGuardado

  useEffect(() => {
    let vigente = true
    void (async () => {
      if (presupuestoIds.length && estimadoFijo == null) {
        const r = await supabase.from('presupuestos').select('id, pago_empleados_estimado').in('id', presupuestoIds)
        if (!vigente) return
        if (r.error) setFaltaSql(true)
        else setEstimado(((r.data ?? []) as { pago_empleados_estimado: unknown }[]).reduce((s, p) => s + (Number(p.pago_empleados_estimado) || 0), 0))
      }
      if (obraId == null) { setPagos([]); setExtras(0); return }
      const [rC, rP] = await Promise.all([
        supabase.from('costos').select('id, monto, tipo, personal_id, fecha').eq('obra_id', obraId),
        supabase.from('personal').select('id, nombre, apellido'),
      ])
      if (!vigente) return
      const gente = (rP.data ?? []) as { id: number; nombre: string | null; apellido: string | null }[]
      const costos = ((rC.data ?? []) as { id: number; monto: unknown; tipo: string | null; personal_id: number | null; fecha: string }[]).map((c) => ({ ...c, monto: Number(c.monto) || 0 }))
      setPagos(costos.filter(esPagoEmpleado).sort((a, b) => b.fecha.localeCompare(a.fecha)).map((c) => {
        const g = gente.find((x) => x.id === c.personal_id)
        return { id: c.id, fecha: c.fecha, monto: c.monto, nombre: g ? `${g.nombre ?? ''} ${g.apellido ?? ''}`.trim() || 'Persona' : 'Mano de obra' }
      }))
      setExtras(costos.filter(esExtraDeObra).reduce((s, c) => s + c.monto, 0))
    })()
    return () => { vigente = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, obraId, estimadoFijo == null])

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

  const t = totalEmpleados(pagos.map((p) => ({ personal_id: null, total: p.monto, pagado: p.monto })), estimado)
  const empleados = t.total
  const queda = t.estimado - t.pagado
  const c = cuentaTrabajo(items, total, empleados, extras, adicionales)
  const base = total + adicionales
  useEffect(() => { onGanancia?.(c.ganancia) }, [c.ganancia]) // eslint-disable-line react-hooks/exhaustive-deps
  const pct = base > 0 ? Math.round((c.ganancia / base) * 100) : null
  const partes: [number, string][] = [[c.ganProductos, '#e0701a'], [Math.max(0, c.servicios + c.adicionales - c.bonificacion - c.empleados - c.extras), '#2f63b8'], [c.empleados, '#a1530f'], [c.extras, '#cf4b37'], [c.costoProductos, '#b7bdc6']]

  return <section className="gtCaja" aria-label="Vas a ganar">
    <button type="button" className="gtCab" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
      <span><small>VAS A GANAR · interno, no lo ve el cliente</small><b className={c.ganancia < 0 ? 'r' : 'v'}>{moneda(c.ganancia)}</b>{pct != null && <em>Te queda el {pct}% de lo que paga el cliente</em>}</span>
      <i aria-hidden>{abierta ? '▴' : '▾'}</i>
    </button>
    <div className="gtBarra" aria-hidden>{partes.filter(([v]) => v > 0.5).map(([v, col], i) => <i key={i} style={{ flex: v, background: col }} />)}</div>
    {!abierta && empleados === 0 && <button type="button" className="gtAviso" onClick={() => setAbierta(true)}>👷 Cargá el gasto por ayudantes estimado para ver la ganancia real ›</button>}
    {abierta && <>
      <div className="gtLineas">
        <div><span><i style={{ background: '#e0701a' }} />Ganancia en productos<small>{c.ventaProductos > 0 ? `Vendés ${moneda(c.ventaProductos)} · te cuestan ${moneda(c.costoProductos)}` : 'No hay productos de tu lista en este trabajo'}</small></span><b>{moneda(c.ganProductos)}</b></div>
        <div><span><i style={{ background: '#2f63b8' }} />Mano de obra y servicios<small>100% tuyo (antes de pagar al personal)</small></span><b>{moneda(c.servicios)}</b></div>
        {c.adicionales !== 0 && <div><span><i style={{ background: '#2f63b8' }} />Cambios y adicionales<small>aprobados en la obra</small></span><b>{moneda(c.adicionales)}</b></div>}
        {c.bonificacion > 0.5 && <div><span><i style={{ background: '#b7bdc6' }} />Bonificación general</span><b className="r">− {moneda(c.bonificacion)}</b></div>}
        <div><span><i style={{ background: '#a1530f' }} />Gasto por ayudantes<small>{t.pagado > t.estimado + 0.5 ? 'Lo ya pagado (superó lo estimado)' : t.estimado > 0 ? 'El estimado del presupuesto' : 'Todavía sin estimado'}</small></span><b className="r">− {moneda(c.empleados)}</b></div>
        <div><span><i style={{ background: '#cf4b37' }} />Extras de la obra<small>{obraId == null ? 'Se cargan cuando es obra' : c.extras ? 'Nafta, tercerizados y otros cargados en la obra' : 'Todavía no hay gastos cargados'}</small></span><b className="r">− {moneda(c.extras)}</b></div>
        {reintegros > 0.5 && <div className="gtSub"><span>Gastos extra que te devuelve el cliente<small>compras en otros locales: no suman ni restan a tu ganancia</small></span><b>{moneda(reintegros)}</b></div>}
        <div className="tot"><span>= Vas a ganar</span><b className={c.ganancia < 0 ? 'r' : 'v'}>{moneda(c.ganancia)}</b></div>
      </div>

      {/* ---- Gasto por ayudantes: estimado y lo pagado desde Personal ---- */}
      <div className="gtPersonal">
        <div className="gtPerCab"><b>👷 Gasto por ayudantes</b>{onCargarPago && obraId != null && <button type="button" onClick={onCargarPago}>＋ Cargar pago</button>}</div>
        {estimadoFijo == null && unico != null && <label className="gtCampo">
          <span><b>Gasto por ayudantes estimado</b><small>{guardado === 'guardando' ? 'Guardando…' : guardado === 'error' ? '⚠ No se guardó' : 'Lo que pensás pagar en total al personal en este trabajo'}</small></span>
          <CampoNumero value={estimadoGuardado} onChange={(e) => cambiarEstimado(Math.max(0, Number(e.target.value) || 0))} aria-label="Gasto por ayudantes estimado" />
        </label>}
        {estimadoFijo != null && <p className="gtNota">Estimado: <b>{moneda(estimado)}</b> (se carga en el presupuesto).</p>}
        {obraId == null
          ? <p className="gtNota">Los pagos se cargan desde Personal cuando el trabajo ya es una obra.</p>
          : <>
            <div className="gtAvance">
              <div className="gtAvNums"><span>Pagado desde Personal</span><b>{moneda(t.pagado)}</b></div>
              <div className="gtAvBarra"><i className={queda < -0.5 ? 'pasado' : ''} style={{ width: `${t.estimado > 0 ? Math.min(100, (t.pagado / t.estimado) * 100) : t.pagado > 0 ? 100 : 0}%` }} /></div>
              <div className="gtAvNums"><span>{queda >= -0.5 ? `Queda del estimado (de ${moneda(t.estimado)})` : `Te pasaste del estimado (${moneda(t.estimado)})`}</span><b className={queda >= -0.5 ? 'v' : 'r'}>{moneda(Math.abs(queda))}</b></div>
            </div>
            {pagos.length > 0 && <ul className="gtPagos">{pagos.slice(0, 20).map((p) => <li key={p.id}><span>{fechaCorta(p.fecha)}</span><b>{p.nombre}</b><em>{moneda(p.monto)}</em></li>)}</ul>}
          </>}
      </div>
      {c.sinCosto > 0 && <p className="gtAlerta">⚠️ {c.sinCosto} producto{c.sinCosto === 1 ? '' : 's'} sin costo cargado: se toman como ganancia completa. Cargá el costo en el ítem o en Productos.</p>}
      {faltaSql && <p className="gtAlerta">Para guardar el estimado falta correr en Supabase el SQL "supabase-pagos-personal-fase-42.sql".</p>}
    </>}
  </section>
}
