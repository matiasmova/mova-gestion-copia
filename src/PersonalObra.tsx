import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'
import { confirmarEliminacion } from './confirmar'
import CargarPago, { nombrePersona } from './CargarPago'

// Personal de una obra: lo pagado a cada persona (se carga desde Personal o
// desde acá) contra el "Gasto por ayudantes estimado" del presupuesto.

type Pago = { id: number; fecha: string; monto: number; personal_id: number | null; descripcion: string | null }
type Persona = { id: number; nombre: string; apellido: string | null }

function PersonalObra({ obraId, onCambio, abrir }: { obraId: number; avance?: number; puedeEditar?: boolean; onCambio?: () => void; abrir?: { form: 'pago' | 'jornal'; n: number } | null }) {
  const [pagos, setPagos] = useState<Pago[] | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [estimado, setEstimado] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [revision, setRevision] = useState(0)
  const [aviso, setAviso] = useState('')

  useEffect(() => { if (abrir) setCargando(true) }, [abrir?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let vigente = true
    void Promise.all([
      supabase.from('costos').select('id,fecha,monto,personal_id,descripcion,tipo').eq('obra_id', obraId).order('fecha', { ascending: false }),
      supabase.from('personal').select('id,nombre,apellido'),
      supabase.from('presupuestos').select('pago_empleados_estimado,estado,activo').eq('obra_id', obraId),
    ]).then(([rC, rP, rPr]) => {
      if (!vigente) return
      const filas = ((rC.data ?? []) as (Pago & { tipo: string | null })[]).filter((c) => c.personal_id != null || c.tipo === 'mano_obra' || c.tipo === 'terciarizado')
      setPagos(filas.map((c) => ({ ...c, monto: Number(c.monto) || 0 })))
      setPersonas((rP.data ?? []) as Persona[])
      setEstimado(((rPr.data ?? []) as { pago_empleados_estimado: unknown; estado: string; activo: boolean | null }[])
        .filter((p) => p.estado === 'aceptado' && p.activo !== false).reduce((s, p) => s + (Number(p.pago_empleados_estimado) || 0), 0))
    })
    return () => { vigente = false }
  }, [obraId, revision])

  async function borrar(p: Pago) {
    if (!confirmarEliminacion(`¿Eliminar el pago de ${moneda(p.monto)} del ${fechaCorta(p.fecha)}?`)) return
    const { error } = await supabase.from('costos').delete().eq('id', p.id)
    if (error) { window.alert('No se pudo eliminar.'); return }
    setRevision((v) => v + 1); onCambio?.()
  }

  const pagado = (pagos ?? []).reduce((s, p) => s + p.monto, 0)
  const queda = estimado - pagado
  const porPersona = Object.entries((pagos ?? []).reduce<Record<string, number>>((m, p) => { const k = String(p.personal_id); m[k] = (m[k] ?? 0) + p.monto; return m }, {}))
  const persona = (id: number | null) => personas.find((x) => x.id === id) ?? null

  return <div className="poWrap">
    <div className="poCab">
      <div><b>👷 Gasto por ayudantes</b><small>Los pagos se cargan desde Personal (o con el botón) y se descuentan del estimado del presupuesto.</small></div>
      <button type="button" className="newButton" onClick={() => setCargando(true)}>＋ Cargar pago</button>
    </div>
    {aviso && <p className="gestionAyuda" role="status">✓ {aviso}</p>}
    {pagos == null ? <p>Cargando…</p> : <>
      <div className="gtAvance">
        <div className="gtAvNums"><span>Pagado a ayudantes</span><b>{moneda(pagado)}</b></div>
        <div className="gtAvBarra"><i className={queda < -0.5 ? 'pasado' : ''} style={{ width: `${estimado > 0 ? Math.min(100, (pagado / estimado) * 100) : pagado > 0 ? 100 : 0}%` }} /></div>
        <div className="gtAvNums"><span>{estimado <= 0 ? 'Sin estimado cargado en el presupuesto' : queda >= -0.5 ? `Queda del estimado (de ${moneda(estimado)})` : `Te pasaste del estimado (${moneda(estimado)})`}</span><b className={queda >= -0.5 ? 'v' : 'r'}>{estimado > 0 ? moneda(Math.abs(queda)) : ''}</b></div>
      </div>
      {porPersona.length > 0 && <div className="poChips">{porPersona.map(([id, m]) => <span key={id}>{nombrePersona(persona(id === 'null' ? null : Number(id)))} · <b>{moneda(m)}</b></span>)}</div>}
      {pagos.length === 0 ? <p className="gestionAyuda">Todavía no hay pagos a esta obra.</p> : <div className="poLista">
        {pagos.map((p) => <div key={p.id} className="poFila">
          <span className="poFecha">{fechaCorta(p.fecha)}</span>
          <span className="poInfo"><b>{nombrePersona(persona(p.personal_id))}</b><small>{(p.descripcion ?? '').replace(/^Pago a [^·]+(· ?|$)/, '').trim() || 'Pago'}</small></span>
          <b>{moneda(p.monto)}</b>
          <button type="button" className="adicNo" aria-label="Eliminar pago" onClick={() => void borrar(p)}>✕</button>
        </div>)}
      </div>}
    </>}
    {cargando && <CargarPago obraId={obraId} onCancelar={() => setCargando(false)} onGuardado={(t) => { setCargando(false); setAviso(t); setRevision((v) => v + 1); onCambio?.() }} />}
  </div>
}

export default PersonalObra
