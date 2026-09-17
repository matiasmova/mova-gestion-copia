import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'

type Presupuesto = { id: number; total: number; estado: string; activo: boolean }
type Adicional = { importe: number; estado: string }
type Costo = { tipo: string; monto: number }
type Pago = { monto: number; obra_id: number | null; presupuesto_id: number | null }
type Asignacion = { valor_acordado: number | null }

const ETIQUETAS_EGRESO: Record<string, string> = {
  material: 'Materiales / compras', mano_obra: 'Mano de obra', terciarizado: 'Tercerizados', otro: 'Otros gastos',
}

function RentabilidadObra({ obraId }: { obraId: number }) {
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [adicionales, setAdicionales] = useState<Adicional[]>([])
  const [costos, setCostos] = useState<Costo[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [costoItems, setCostoItems] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      const rPres = await supabase.from('presupuestos').select('id,total,estado,activo').eq('obra_id', obraId)
      if (!vigente) return
      if (rPres.error) { console.error(rPres.error); setError('No se pudo calcular la rentabilidad.'); setCargando(false); return }
      const presu = (rPres.data ?? []).map((p) => ({ ...p, total: Number(p.total) })) as Presupuesto[]
      const idsPresu = presu.map((p) => p.id)
      const idsAceptados = presu.filter((p) => p.activo !== false && p.estado === 'aceptado').map((p) => p.id)

      const [rAdic, rCostos, rPagos, rAsig, rItems] = await Promise.all([
        supabase.from('adicionales').select('importe,estado').eq('obra_id', obraId),
        supabase.from('costos').select('tipo,monto').eq('obra_id', obraId),
        supabase.from('pagos').select('monto,obra_id,presupuesto_id'),
        supabase.from('obra_asignaciones').select('valor_acordado').eq('obra_id', obraId),
        idsAceptados.length
          ? supabase.from('presupuesto_items').select('cantidad,costo_unitario,presupuesto_id').in('presupuesto_id', idsAceptados)
          : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
      ])
      if (!vigente) return
      setPresupuestos(presu)
      const itemsData = (rItems.error ? [] : (rItems.data ?? [])) as Array<{ cantidad?: number; costo_unitario?: number }>
      setCostoItems(itemsData.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.costo_unitario) || 0), 0))
      setAdicionales(rAdic.error ? [] : (rAdic.data ?? []).map((a) => ({ ...a, importe: Number(a.importe) })) as Adicional[])
      setCostos(rCostos.error ? [] : (rCostos.data ?? []).map((c) => ({ ...c, monto: Number(c.monto) })) as Costo[])
      setAsignaciones(rAsig.error ? [] : (rAsig.data ?? []).map((a) => ({ valor_acordado: a.valor_acordado == null ? null : Number(a.valor_acordado) })) as Asignacion[])
      setPagos(rPagos.error ? [] : (rPagos.data ?? [])
        .map((p) => ({ ...p, monto: Number(p.monto) }))
        .filter((p) => p.obra_id === obraId || (p.presupuesto_id != null && idsPresu.includes(p.presupuesto_id))) as Pago[])
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [obraId, revision])

  const datos = useMemo(() => {
    const contratado = presupuestos.filter((p) => p.activo !== false && p.estado === 'aceptado').reduce((s, p) => s + p.total, 0)
    const extra = adicionales.filter((a) => a.estado === 'aprobado').reduce((s, a) => s + a.importe, 0)
    const valorActualizado = contratado + extra
    const cobrado = pagos.reduce((s, p) => s + p.monto, 0)
    const egresosPorTipo = costos.reduce<Record<string, number>>((acc, c) => {
      const clave = ETIQUETAS_EGRESO[c.tipo] ? c.tipo : 'otro'
      acc[clave] = (acc[clave] || 0) + c.monto
      return acc
    }, {})
    const egresosRegistrados = costos.reduce((s, c) => s + c.monto, 0)
    // El costo de los productos/servicios del presupuesto (lo que MOVA paga por los equipos) también es un egreso.
    const egresos = egresosRegistrados + costoItems
    // Personal: acordado (asignaciones) vs pagado (costos de mano de obra / tercerizados)
    const personalAcordado = asignaciones.reduce((s, a) => s + (Number(a.valor_acordado) || 0), 0)
    const personalPagado = costos.filter((c) => c.tipo === 'mano_obra' || c.tipo === 'terciarizado').reduce((s, c) => s + c.monto, 0)
    const personalPendiente = Math.max(0, personalAcordado - personalPagado)
    const resultadoProyectado = valorActualizado - egresos
    const resultadoCaja = cobrado - egresos
    const margenProyectado = valorActualizado > 0 ? Math.round((resultadoProyectado / valorActualizado) * 100) : 0
    return { contratado, extra, valorActualizado, cobrado, egresos, egresosPorTipo, costoItems, personalAcordado, personalPagado, personalPendiente, resultadoProyectado, resultadoCaja, margenProyectado }
  }, [presupuestos, adicionales, costos, pagos, asignaciones, costoItems])

  const color = (v: number) => (v > 0 ? '#23764e' : v < 0 ? '#b23b32' : '#4b525c')

  return (
    <section className="obraFotosSeccion" aria-label="Rentabilidad de la obra">
      <div className="seguimientoAcciones">
        <div>
          <h3>Rentabilidad de la obra</h3>
          <p>Costo vs ingreso. Resultado proyectado (todo cobrado) vs. resultado de caja (lo cobrado hoy).</p>
        </div>
        <button type="button" className="editButton" disabled={cargando} onClick={() => setRevision((v) => v + 1)}>Actualizar</button>
      </div>

      {cargando && <p role="status">Calculando...</p>}
      {error && <p className="loginError" role="alert">{error}</p>}

      {!cargando && !error && (<>
        <div className="rentGrid">
          <div className="rentCol">
            <h4>Costo</h4>
            {datos.costoItems > 0 && <div className="rentRow"><span>Costo de productos/servicios (presupuesto)</span><strong>{moneda(datos.costoItems)}</strong></div>}
            {Object.keys(datos.egresosPorTipo).length === 0 && datos.costoItems === 0 && <div className="rentRow"><span>Sin costos registrados</span><strong>{moneda(0)}</strong></div>}
            {Object.entries(datos.egresosPorTipo).map(([tipo, monto]) => (
              <div className="rentRow" key={tipo}><span>{ETIQUETAS_EGRESO[tipo] ?? tipo} (registrados)</span><strong>{moneda(monto)}</strong></div>
            ))}
            <div className="rentRow total"><span>Costo total</span><strong>{moneda(datos.egresos)}</strong></div>
          </div>
          <div className="rentCol">
            <h4>Ingreso</h4>
            <div className="rentRow"><span>Presupuestos aceptados</span><strong>{moneda(datos.contratado)}</strong></div>
            <div className="rentRow"><span>Adicionales aprobados</span><strong style={{ color: color(datos.extra) }}>{datos.extra >= 0 ? '+' : ''}{moneda(datos.extra)}</strong></div>
            <div className="rentRow total"><span>Valor actualizado</span><strong>{moneda(datos.valorActualizado)}</strong></div>
            <div className="rentRow"><span>Cobrado a la fecha</span><strong>{moneda(datos.cobrado)}</strong></div>
          </div>
        </div>

        <div className="rentResultados">
          <div className="rentResultado">
            <span>RESULTADO PROYECTADO</span>
            <strong style={{ color: color(datos.resultadoProyectado) }}>{moneda(datos.resultadoProyectado)}</strong>
            <small>Valor actualizado − egresos · margen {datos.margenProyectado}%</small>
          </div>
          <div className="rentResultado">
            <span>RESULTADO DE CAJA</span>
            <strong style={{ color: color(datos.resultadoCaja) }}>{moneda(datos.resultadoCaja)}</strong>
            <small>Cobrado − egresos (lo que quedó hoy)</small>
          </div>
        </div>
        {(datos.personalAcordado > 0 || datos.personalPagado > 0) && (
          <div className="rentPersonal">
            <h4>Personal (ayudantes)</h4>
            <div className="rentPersonalGrid">
              <div><span>Acordado</span><strong>{moneda(datos.personalAcordado)}</strong></div>
              <div><span>Pagado</span><strong>{moneda(datos.personalPagado)}</strong></div>
              <div><span>Por pagar</span><strong style={{ color: datos.personalPendiente > 0 ? '#b86608' : '#23764e' }}>{moneda(datos.personalPendiente)}</strong></div>
            </div>
          </div>
        )}
        <p className="gestionAyuda">Egresos = costo de los productos/servicios del presupuesto + gastos registrados (mano de obra, ferretería, varios). El <strong>resultado proyectado</strong> supone cobrar todo lo contratado; el <strong>de caja</strong> es lo cobrado hoy − egresos (por eso una obra aceptada sin cobrar aún da negativo). Tip: en Compras/gastos cargá lo extra (ferretería, mano de obra), no vuelvas a cargar los productos del catálogo (su costo ya sale del presupuesto).</p>
      </>)}
    </section>
  )
}

export default RentabilidadObra
