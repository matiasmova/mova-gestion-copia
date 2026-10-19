import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'
import CampoNumero from './CampoNumero'
import { cuentaTrabajo, empleadosDeObra, esExtraDeObra, esPagoEmpleado, totalEmpleados, type FilaEmpleado, type ItemCuenta } from './gananciaTrabajo'

// "Vas a ganar": la cuenta del trabajo, a la vista en todos los estados.
//  · Personal "por acuerdo" asignado a la obra: lo acordado con cada uno.
//  · Ayudantes "por pagos" (sin monto fijo): el estimado que se carga acá, o lo
//    ya pagado si es más.
//  · Extras: los gastos cargados en la obra (nafta, tercerizados, otros).
// Desde acá mismo se suma personal y queda asignado a la obra.

type Props = {
  presupuestoIds: number[] // el estimado editable solo cuando es uno
  obraId: number | null
  items: ItemCuenta[]
  total: number
  adicionales?: number
  reintegros?: number // Gasto extra que devuelve el cliente: no suma ni resta
  abiertaInicial?: boolean
  onGanancia?: (ganancia: number) => void
}
type Gente = { id: number; nombre: string | null; apellido: string | null; costo_dia: unknown; modalidad_pago: string | null; activo: boolean | null }
type FilaVista = FilaEmpleado & { nombre: string; asigId: number | null; modalidad: string | null; valor: number }

const nombreDe = (g?: Gente) => (g ? `${g.nombre ?? ''} ${g.apellido ?? ''}`.trim() || 'Persona' : 'Mano de obra sin persona')

export default function GananciaTrabajo({ presupuestoIds, obraId, items, total, adicionales = 0, reintegros = 0, abiertaInicial = false, onGanancia }: Props) {
  const [estimado, setEstimado] = useState(0)
  const [faltaSql, setFaltaSql] = useState(false)
  const [personal, setPersonal] = useState<FilaVista[]>([])
  const [gente, setGente] = useState<Gente[]>([])
  const [extras, setExtras] = useState(0)
  const [abierta, setAbierta] = useState(abiertaInicial)
  const [guardado, setGuardado] = useState<'ok' | 'guardando' | 'error'>('ok')
  const [revision, setRevision] = useState(0)
  const [nuevo, setNuevo] = useState<{ personaId: string; modalidad: 'por_obra' | 'libre'; monto: string } | null>(null)
  const [errorPer, setErrorPer] = useState('')
  const [ocupado, setOcupado] = useState(false)
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
      const rP = await supabase.from('personal').select('id, nombre, apellido, costo_dia, modalidad_pago, activo')
      if (!vigente) return
      const todos = (rP.data ?? []) as Gente[]
      setGente(todos)
      if (obraId == null) { setPersonal([]); setExtras(0); return }
      const [rA, rJ, rC] = await Promise.all([
        supabase.from('obra_asignaciones').select('id, personal_id, modalidad, valor_acordado').eq('obra_id', obraId),
        supabase.from('jornales').select('personal_id, jornada, horas').eq('obra_id', obraId),
        supabase.from('costos').select('monto, tipo, personal_id').eq('obra_id', obraId),
      ])
      if (!vigente) return
      const costos = ((rC.data ?? []) as { monto: unknown; tipo: string | null; personal_id: number | null }[]).map((c) => ({ ...c, monto: Number(c.monto) || 0 }))
      const asig = ((rA.data ?? []) as { id: number; personal_id: number | null; modalidad: string | null; valor_acordado: unknown }[]).map((a) => ({ ...a, valor_acordado: a.valor_acordado == null ? null : Number(a.valor_acordado) }))
      const filas = empleadosDeObra(
        asig,
        todos.map((p) => ({ id: p.id, costo_dia: p.costo_dia == null ? null : Number(p.costo_dia) })),
        costos.filter(esPagoEmpleado),
        ((rJ.data ?? []) as { personal_id: number | null; jornada: unknown; horas: unknown }[]).map((j) => ({ personal_id: j.personal_id, jornada: Number(j.jornada) || 0, horas: j.horas == null ? null : Number(j.horas) })),
        total + adicionales,
      )
      setPersonal(filas.map((f, i) => {
        const a = f.asignado ? asig[i] : undefined
        return { ...f, nombre: nombreDe(todos.find((p) => p.id === f.personal_id)), asigId: a?.id ?? null, modalidad: a?.modalidad ?? null, valor: Number(a?.valor_acordado) || 0 }
      }))
      setExtras(costos.filter(esExtraDeObra).reduce((s, c) => s + c.monto, 0))
    })()
    return () => { vigente = false }
    // El valor de la obra solo afecta al personal "por porcentaje": se recalcula al cambiar el total.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, obraId, Math.round(total + adicionales), revision])

  // ---- Personal: sumar, cambiar el monto acordado o sacar de la obra ----
  async function agregarPersona() {
    if (!nuevo || obraId == null) return
    setErrorPer('')
    if (!nuevo.personaId) { setErrorPer('Elegí una persona.'); return }
    if (nuevo.modalidad === 'por_obra' && !(Number(nuevo.monto) > 0)) { setErrorPer('Ingresá el monto acordado por este trabajo.'); return }
    if (nuevo.modalidad === 'libre' && !(Number(nuevo.monto) > 0)) { setErrorPer('Ingresá cuánto estimás pagarle por este trabajo.'); return }
    setOcupado(true)
    const { error } = await supabase.from('obra_asignaciones').insert({ obra_id: obraId, personal_id: Number(nuevo.personaId), modalidad: nuevo.modalidad, valor_acordado: Number(nuevo.monto) || 0 })
    setOcupado(false)
    if (error) { console.error(error); setErrorPer('No se pudo asignar. Probá de nuevo.'); return }
    setNuevo(null)
    setRevision((v) => v + 1)
  }
  const tMonto = useRef<ReturnType<typeof setTimeout> | null>(null)
  function cambiarMonto(asigId: number, v: number) {
    setPersonal((l) => l.map((f) => (f.asigId === asigId ? { ...f, valor: v, total: Math.max(v, f.pagado) } : f)))
    if (tMonto.current) clearTimeout(tMonto.current)
    tMonto.current = setTimeout(async () => {
      const { error } = await supabase.from('obra_asignaciones').update({ valor_acordado: v }).eq('id', asigId)
      if (error) { console.error(error); setErrorPer('No se pudo guardar el monto.') }
    }, 800)
  }
  async function sacar(f: FilaVista) {
    if (f.asigId == null) return
    if (!window.confirm(`¿Sacar a ${f.nombre} de esta obra?`)) return
    const { error } = await supabase.from('obra_asignaciones').delete().eq('id', f.asigId)
    if (error) { console.error(error); setErrorPer('No se pudo sacar.'); return }
    setRevision((v) => v + 1)
  }

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

  const t = totalEmpleados(personal, estimado)
  const empleados = t.total
  const sinJornales = personal.filter((f) => f.sinJornales)
  const asignados = new Set(personal.filter((f) => f.asignado).map((f) => f.personal_id))
  const disponibles = gente.filter((g) => g.activo !== false && !asignados.has(g.id))
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
    {!abierta && empleados === 0 && <button type="button" className="gtAviso" onClick={() => setAbierta(true)}>👷 Sumá el personal de este trabajo para ver la ganancia real ›</button>}
    {abierta && <>
      <div className="gtLineas">
        <div><span><i style={{ background: '#e0701a' }} />Ganancia en productos<small>{c.ventaProductos > 0 ? `Vendés ${moneda(c.ventaProductos)} · te cuestan ${moneda(c.costoProductos)}` : 'No hay productos de tu lista en este trabajo'}</small></span><b>{moneda(c.ganProductos)}</b></div>
        <div><span><i style={{ background: '#2f63b8' }} />Mano de obra y servicios<small>100% tuyo (antes de pagar al personal)</small></span><b>{moneda(c.servicios)}</b></div>
        {c.adicionales !== 0 && <div><span><i style={{ background: '#2f63b8' }} />Cambios y adicionales<small>aprobados en la obra</small></span><b>{moneda(c.adicionales)}</b></div>}
        {c.bonificacion > 0.5 && <div><span><i style={{ background: '#b7bdc6' }} />Bonificación general</span><b className="r">− {moneda(c.bonificacion)}</b></div>}
        <div><span><i style={{ background: '#a1530f' }} />Empleados<small>{t.hayAsignados ? 'Lo de cada persona del trabajo (abajo)' : 'Estimado (cargalo abajo)'}</small></span><b className="r">− {moneda(c.empleados)}</b></div>
        <div><span><i style={{ background: '#cf4b37' }} />Extras de la obra<small>{obraId == null ? 'Se cargan cuando es obra' : c.extras ? 'Nafta, tercerizados y otros cargados en la obra' : 'Todavía no hay gastos cargados'}</small></span><b className="r">− {moneda(c.extras)}</b></div>
        {reintegros > 0.5 && <div className="gtSub"><span>Gastos extra que te devuelve el cliente<small>compras en otros locales: no suman ni restan a tu ganancia</small></span><b>{moneda(reintegros)}</b></div>}
        <div className="tot"><span>= Vas a ganar</span><b className={c.ganancia < 0 ? 'r' : 'v'}>{moneda(c.ganancia)}</b></div>
      </div>

      {/* ---- Personal de este trabajo ---- */}
      <div className="gtPersonal">
        <div className="gtPerCab"><b>👷 Personal de este trabajo</b>{obraId != null && !nuevo && <button type="button" onClick={() => { setErrorPer(''); setNuevo({ personaId: '', modalidad: 'por_obra', monto: '' }) }}>＋ Agregar</button>}</div>
        {obraId == null && <p className="gtNota">Para asignar personal, primero vinculá una obra a este presupuesto. Mientras tanto, cargá el estimado de abajo.</p>}
        {personal.map((f, i) => (
          <div key={i} className="gtPer">
            <span className="gtPerNom"><b>{f.nombre}</b><small>{!f.asignado ? 'pago cargado en la obra' : f.acuerdo ? (f.sinJornales ? 'por día · sin jornales cargados' : 'por acuerdo · monto pactado') : 'por pagos · lo que estimás pagarle'}</small></span>
            {f.asignado && (f.modalidad === 'por_obra' || f.modalidad === 'libre')
              ? <CampoNumero className="gtMonto" value={f.valor} onChange={(e) => cambiarMonto(f.asigId!, Math.max(0, Number(e.target.value) || 0))} aria-label={`Monto de ${f.nombre}`} />
              : <em>{moneda(f.total)}</em>}
            {f.asignado && f.pagado < 0.5 && <button type="button" className="gtSacar" aria-label={`Sacar a ${f.nombre} de la obra`} onClick={() => void sacar(f)}>✕</button>}
          </div>
        ))}
        {nuevo && <div className="gtNuevo">
          <select value={nuevo.personaId} onChange={(e) => { const g = gente.find((x) => x.id === Number(e.target.value)); setNuevo({ ...nuevo, personaId: e.target.value, modalidad: g?.modalidad_pago === 'libre' ? 'libre' : 'por_obra' }) }} aria-label="Persona">
            <option value="">Elegí a quién…</option>
            {disponibles.map((g) => <option key={g.id} value={g.id}>{nombreDe(g)}</option>)}
          </select>
          <div className="gtModo" role="tablist">
            <button type="button" className={nuevo.modalidad === 'por_obra' ? 'on' : ''} onClick={() => setNuevo({ ...nuevo, modalidad: 'por_obra' })}>🤝 Por acuerdo</button>
            <button type="button" className={nuevo.modalidad === 'libre' ? 'on' : ''} onClick={() => setNuevo({ ...nuevo, modalidad: 'libre' })}>💵 Por pagos</button>
          </div>
          {nuevo.modalidad === 'por_obra'
            ? <label className="gtCampo"><span><b>Monto acordado</b><small>se le paga según el avance</small></span><CampoNumero value={nuevo.monto} onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })} aria-label="Monto acordado" /></label>
            : <label className="gtCampo"><span><b>Cuánto estimás pagarle</b><small>solo para calcular la ganancia aproximada</small></span><CampoNumero value={nuevo.monto} onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })} aria-label="Estimado a pagarle" /></label>}
          <div className="gtNuevoAcc"><button type="button" onClick={() => setNuevo(null)}>Cancelar</button><button type="button" className="prim" disabled={ocupado} onClick={() => void agregarPersona()}>{ocupado ? 'Asignando…' : 'Asignar a la obra'}</button></div>
          {disponibles.length === 0 && <p className="gtNota">No hay más personas activas para sumar. Cargalas en Personal.</p>}
        </div>}
        {errorPer && <p className="gtAlerta">{errorPer}</p>}
        {unico != null && !t.hayAsignados && <label className="gtCampo">
          <span><b>Estimado de personal</b><small>{guardado === 'guardando' ? 'Guardando…' : guardado === 'error' ? '⚠ No se guardó' : 'Si todavía no sabés quién va: cuánto pensás pagar en total'}</small></span>
          <CampoNumero value={estimado} onChange={(e) => cambiarEstimado(Math.max(0, Number(e.target.value) || 0))} aria-label="Estimado para ayudantes por pagos" />
        </label>}
      </div>
      {sinJornales.length > 0 && <p className="gtAlerta">📅 {sinJornales.map((f) => f.nombre).join(', ')} cobra{sinJornales.length === 1 ? '' : 'n'} por día y no tiene{sinJornales.length === 1 ? '' : 'n'} jornales cargados: su parte da $ 0 hasta que cargues los días.</p>}
      {c.sinCosto > 0 && <p className="gtAlerta">⚠️ {c.sinCosto} producto{c.sinCosto === 1 ? '' : 's'} sin costo cargado: se toman como ganancia completa. Cargá el costo en el ítem o en Productos.</p>}
      {faltaSql && <p className="gtAlerta">Para guardar el estimado falta correr en Supabase el SQL "supabase-ganancia-presupuesto-fase-33.sql".</p>}
    </>}
  </section>
}
