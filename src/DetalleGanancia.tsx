import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'
import { importeNeto } from './presupuestoCalculos'
import { esProducto, esExtraDeObra, esPagoEmpleado } from './gananciaTrabajo'
import { etiquetaModificacion, type CambioTipo } from './presupuestoModificaciones'

// "Vas a ganar" en detalle: cada cosa que suma (ítems, cambios y extras) y cada
// cosa que resta (bonificación, ayudantes, gastos de la obra). Es la misma
// cuenta que la tarjeta "Vas a ganar" de la obra, desarmada renglón por renglón.

type Renglon = { clave: string; titulo: string; detalle: string; valor: number }
type Datos = { suma: Renglon[]; resta: Renglon[] }

const num = (x: unknown) => Number(x) || 0

async function cargar(obraId: number): Promise<Datos> {
  const rP = await supabase.from('presupuestos').select('*').eq('obra_id', obraId)
  if (rP.error) throw rP.error
  const presus = ((rP.data ?? []) as { id: number; total: unknown; estado: string; activo: boolean | null; pago_empleados_estimado?: unknown }[])
    .filter((p) => p.estado === 'aceptado' && p.activo !== false)
  const ids = presus.map((p) => p.id)
  const [rI, rA, rC, rG] = await Promise.all([
    ids.length ? supabase.from('presupuesto_items').select('*').in('presupuesto_id', ids).order('orden', { ascending: true }) : Promise.resolve({ data: [], error: null }),
    supabase.from('adicionales').select('*').eq('obra_id', obraId).order('fecha'),
    supabase.from('costos').select('*').eq('obra_id', obraId).order('fecha'),
    supabase.from('personal').select('id, nombre, apellido'),
  ])
  if (rI.error || rA.error || rC.error) throw rI.error || rA.error || rC.error
  const items = (rI.data ?? []) as { id: number; descripcion: string; tipo: string | null; cantidad: unknown; precio_unitario: unknown; costo_unitario: unknown; descuento_pct: unknown; catalogo_id: number | null }[]
  const adic = (rA.data ?? []) as { id: number; tipo: string; cambio_tipo: CambioTipo | null; descripcion: string | null; importe: unknown; estado: string; cantidad_nueva: unknown; costo_unitario?: unknown }[]
  const costos = (rC.data ?? []) as { id: number; monto: unknown; tipo: string | null; personal_id: number | null; fecha: string; descripcion: string | null }[]
  const gente = (rG.data ?? []) as { id: number; nombre: string | null; apellido: string | null }[]

  const suma: Renglon[] = [], resta: Renglon[] = []
  // Ítems del presupuesto: productos de tu lista = venta − costo; el resto es 100% tuyo.
  let ventaItems = 0
  for (const it of items) {
    const neto = importeNeto({ cantidad: num(it.cantidad), precio_unitario: num(it.precio_unitario), descuento_pct: num(it.descuento_pct) })
    ventaItems += neto
    const deLista = it.catalogo_id != null || num(it.costo_unitario) > 0
    if (esProducto(it.tipo ?? '') && deLista) {
      const costo = num(it.cantidad) * num(it.costo_unitario)
      suma.push({ clave: `i${it.id}`, titulo: it.descripcion, detalle: costo > 0 ? `Vendés ${moneda(neto)} · te cuesta ${moneda(costo)}` : `Vendés ${moneda(neto)} · sin costo cargado (se toma todo como ganancia)`, valor: neto - costo })
    } else suma.push({ clave: `i${it.id}`, titulo: it.descripcion, detalle: 'Mano de obra / servicio: 100% tuyo', valor: neto })
  }
  const total = presus.reduce((s, p) => s + num(p.total), 0)
  if (!items.length && total > 0) suma.push({ clave: 'tot', titulo: 'Presupuesto aceptado', detalle: 'Cargado sin ítems', valor: total })
  const bonif = items.length ? ventaItems - total : 0
  if (bonif > 0.5) resta.push({ clave: 'bonif', titulo: 'Bonificación general', detalle: 'Descuento sobre el total del presupuesto', valor: -bonif })
  else if (bonif < -0.5) suma.push({ clave: 'ajuste', titulo: 'Ajuste del total', detalle: 'El total aceptado es mayor que la suma de los ítems', valor: -bonif })

  // Cambios y extras aprobados en la obra (los "gasto extra" los devuelve el cliente: no cuentan).
  for (const a of adic.filter((x) => x.tipo !== 'gasto_extra' && (x.estado === 'aprobado' || x.estado === 'pagado'))) {
    const importe = num(a.importe)
    const costo = a.tipo === 'cambio' && a.cambio_tipo === 'agregado' ? (num(a.cantidad_nueva) || 1) * num(a.costo_unitario) : 0
    const valor = importe - costo
    const r = { clave: `a${a.id}`, titulo: a.descripcion || 'Cambio en la obra', detalle: `${etiquetaModificacion(a)}${costo > 0 ? ` · cobrás ${moneda(importe)} · te cuesta ${moneda(costo)}` : ''}`, valor }
    ;(valor < 0 ? resta : suma).push(r)
  }

  // Gasto por ayudantes: lo pagado a cada uno y, si el estimado es mayor, lo que falta pagar.
  const pagos = costos.filter(esPagoEmpleado)
  for (const p of pagos) {
    const g = gente.find((x) => x.id === p.personal_id)
    resta.push({ clave: `p${p.id}`, titulo: g ? `${g.nombre ?? ''} ${g.apellido ?? ''}`.trim() || 'Ayudante' : 'Mano de obra', detalle: `Pago al personal · ${fechaCorta(p.fecha)}`, valor: -num(p.monto) })
  }
  const pagado = pagos.reduce((s, p) => s + num(p.monto), 0)
  const estimado = presus.reduce((s, p) => s + num(p.pago_empleados_estimado), 0)
  if (estimado > pagado + 0.5) resta.push({ clave: 'est', titulo: 'Resto del gasto por ayudantes estimado', detalle: `Estimado ${moneda(estimado)} · pagado ${moneda(pagado)} · todavía sin pagar`, valor: -(estimado - pagado) })

  // Gastos de la obra (nafta, tercerizados, otros).
  for (const c of costos.filter(esExtraDeObra)) {
    resta.push({ clave: `c${c.id}`, titulo: c.descripcion || 'Gasto de la obra', detalle: `${(c.tipo ?? 'gasto').replace('_', ' ')} · ${fechaCorta(c.fecha)}`, valor: -num(c.monto) })
  }
  suma.sort((a, b) => b.valor - a.valor)
  resta.sort((a, b) => a.valor - b.valor)
  return { suma, resta }
}

export default function DetalleGanancia({ obraId, obra, onCerrar }: { obraId: number; obra: string; onCerrar: () => void }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let vigente = true
    cargar(obraId).then((d) => { if (vigente) setDatos(d) }).catch((e) => { console.error(e); if (vigente) setError('No se pudo armar el detalle. Probá de nuevo.') })
    return () => { vigente = false }
  }, [obraId])

  const totSuma = datos?.suma.reduce((s, r) => s + r.valor, 0) ?? 0
  const totResta = datos?.resta.reduce((s, r) => s + r.valor, 0) ?? 0
  const ganancia = totSuma + totResta
  const lista = (l: Renglon[]) => l.map((r) => <div key={r.clave} className="dgFila">
    <span><b>{r.titulo}</b><small>{r.detalle}</small></span>
    <em className={r.valor < 0 ? 'r' : 'v'}>{r.valor < 0 ? '− ' : '+ '}{moneda(Math.abs(r.valor))}</em>
  </div>)

  return <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
    <div className="modalCard dgCard" role="dialog" aria-modal="true" aria-label="Detalle de lo que vas a ganar">
      <div className="dgCab">
        <div><small>VAS A GANAR · {obra}</small><b className={ganancia < 0 ? 'r' : 'v'}>{datos ? moneda(ganancia) : '…'}</b><span>Interno: no lo ve el cliente</span></div>
        <button type="button" className="fichaIcono" aria-label="Cerrar" onClick={onCerrar}>×</button>
      </div>
      {error ? <p className="loginError" role="alert">{error}</p> : !datos ? <p role="status">Armando el detalle…</p> : <>
        <section className="dgGrupo">
          <h3><span>✅ Lo que suma</span><em className="v">+ {moneda(totSuma)}</em></h3>
          {datos.suma.length ? lista(datos.suma) : <p className="dgVacio">Nada todavía.</p>}
        </section>
        <section className="dgGrupo">
          <h3><span>➖ Lo que resta</span><em className="r">− {moneda(Math.abs(totResta))}</em></h3>
          {datos.resta.length ? lista(datos.resta) : <p className="dgVacio">No hay costos ni pagos cargados en esta obra.</p>}
        </section>
        <div className="dgTotal"><span>= Vas a ganar</span><b className={ganancia < 0 ? 'r' : 'v'}>{moneda(ganancia)}</b></div>
        <p className="dgNota">Los gastos extra que te devuelve el cliente (compras en otros locales) no suman ni restan. Comprar stock no es un gasto: es plata invertida.</p>
      </>}
    </div>
  </div>
}
