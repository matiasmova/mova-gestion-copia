import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { fechaCorta, moneda, hoy } from './gestionFormat'

type Obra = { id: number; nombre_obra: string; porcentaje_avance: number | null }
type Presupuesto = { id: number; obra_id: number | null; titulo: string; total: number; total_pagado: number; saldo: number; estado: string; activo: boolean }
type Pago = { id: number; presupuesto_id: number | null; obra_id: number | null; monto: number; fecha: string; medio_pago: string; referencia: string | null; notas: string | null; origen: string }
type Categoria = { id: number; nombre: string; deducible: boolean }
type Costo = { id: number; obra_id: number; categoria_id: number | null; tipo: string; descripcion: string | null; monto: number; fecha: string }
type Adicional = { id: number; obra_id: number; importe: number; estado: string }
type Pestana = 'resumen' | 'cobros' | 'costos'

function Finanzas({ onAbrirObra }: { onAbrirObra?: (obraId: number) => void } = {}) {
  const [obras, setObras] = useState<Obra[]>([])
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [costos, setCostos] = useState<Costo[]>([])
  const [adicionales, setAdicionales] = useState<Adicional[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [pestana, setPestana] = useState<Pestana>('resumen')
  const [formulario, setFormulario] = useState<'pago' | 'costo' | null>(null)
  const [pagoEditar, setPagoEditar] = useState<Pago | null>(null)
  const [actualizacion, setActualizacion] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  async function eliminarPago(p: Pago) {
    if (!window.confirm('¿Eliminar este cobro? No se puede deshacer.')) return
    const { error: err } = await supabase.from('pagos').delete().eq('id', p.id)
    if (err) { console.error(err); window.alert('No se pudo eliminar el cobro.'); return }
    setActualizacion((v) => v + 1)
  }

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      setError('')
      const [rObras, rPresupuestos, rPagos, rCostos, rCategorias, rAdicionales] = await Promise.all([
        supabase.from('obras').select('id, nombre_obra, porcentaje_avance').eq('activo', true).order('nombre_obra'),
        supabase.from('presupuestos').select('id, obra_id, titulo, total, total_pagado, saldo, estado, activo').eq('activo', true),
        supabase.from('pagos').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('costos').select('*').order('fecha', { ascending: false }),
        supabase.from('categorias_gasto').select('*').eq('activo', true).order('nombre'),
        supabase.from('adicionales').select('id, obra_id, importe, estado').eq('estado', 'aprobado'),
      ])

      const fallo = rObras.error || rPresupuestos.error || rPagos.error || rCostos.error || rCategorias.error
      if (fallo) {
        console.error(fallo)
        setError('Falta ejecutar el archivo supabase-pagos-fase-4.sql en Supabase.')
        setCargando(false)
        return
      }

      setObras((rObras.data ?? []) as Obra[])
      setPresupuestos((rPresupuestos.data ?? []).map((p) => ({ ...p, total: Number(p.total), total_pagado: Number(p.total_pagado), saldo: Number(p.saldo) })) as Presupuesto[])
      setPagos((rPagos.data ?? []).map((p) => ({ ...p, monto: Number(p.monto) })) as Pago[])
      setCostos((rCostos.data ?? []).map((c) => ({ ...c, monto: Number(c.monto) })) as Costo[])
      setCategorias((rCategorias.data ?? []) as Categoria[])
      // Los adicionales son opcionales: si la tabla no existe todavía, seguimos sin ellos.
      setAdicionales(rAdicionales.error ? [] : (rAdicionales.data ?? []).map((a) => ({ ...a, importe: Number(a.importe) })) as Adicional[])
      setCargando(false)
    }
    cargar()
  }, [actualizacion])

  const resumen = useMemo(() => obras.map((obra) => {
    const aprobados = presupuestos.filter((p) => p.obra_id === obra.id && p.estado === 'aceptado')
    const total = aprobados.reduce((s, p) => s + p.total, 0)
    const cobrado = aprobados.reduce((s, p) => s + p.total_pagado, 0)
    const costo = costos.filter((c) => c.obra_id === obra.id).reduce((s, c) => s + c.monto, 0)
    // Valor actualizado = presupuestos aceptados + adicionales aprobados (pueden ser negativos).
    const extra = adicionales.filter((a) => a.obra_id === obra.id).reduce((s, a) => s + a.importe, 0)
    const actualizado = total + extra
    const pagadoPct = actualizado > 0 ? Math.min(100, Math.round((cobrado / actualizado) * 100)) : 0
    const avance = Number(obra.porcentaje_avance) || 0
    const habilitado = Math.round((actualizado * avance) / 100)
    const pendienteAvance = Math.max(0, habilitado - cobrado)
    return { ...obra, total, extra, actualizado, cobrado, costo, saldo: Math.max(0, actualizado - cobrado), pagadoPct, habilitado, pendienteAvance, alerta: avance - pagadoPct >= 25 }
  }), [obras, presupuestos, costos, adicionales])

  const totales = resumen.reduce((a, r) => ({ total: a.total + r.total, actualizado: a.actualizado + r.actualizado, cobrado: a.cobrado + r.cobrado, saldo: a.saldo + r.saldo, costo: a.costo + r.costo }), { total: 0, actualizado: 0, cobrado: 0, saldo: 0, costo: 0 })
  const manoObraTotal = costos.filter((c) => c.tipo === 'mano_obra' || c.tipo === 'terciarizado').reduce((s, c) => s + c.monto, 0)
  const variosTotal = costos.filter((c) => c.tipo === 'material' || c.tipo === 'otro' || !['mano_obra', 'terciarizado'].includes(c.tipo)).reduce((s, c) => s + c.monto, 0)
  const gananciaNeta = totales.actualizado - totales.costo
  const nombreObra = (id: number | null) => obras.find((obra) => obra.id === id)?.nombre_obra ?? 'Sin obra asociada'
  const presupuestoPorId = (id: number) => presupuestos.find((presupuesto) => presupuesto.id === id)
  const nombreCategoria = (id: number | null) => categorias.find((categoria) => categoria.id === id)?.nombre ?? 'Sin categoría'
  function recargar() { setFormulario(null); setPagoEditar(null); setActualizacion((valor) => valor + 1) }

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div><p className="subtitle">CONTROL FINANCIERO</p><h2>Finanzas</h2><p className="welcome">Cobros, costos y avance por obra</p></div>
        {pestana === 'cobros' && <button className="newButton" onClick={() => { setPagoEditar(null); setFormulario('pago') }}>+ Registrar cobro</button>}
        {pestana === 'costos' && <button className="newButton" onClick={() => setFormulario('costo')}>+ Registrar gasto</button>}
      </div>

      <div className="gestionTabs">
        <button className={pestana === 'resumen' ? 'active' : ''} onClick={() => setPestana('resumen')}>Resumen por obra</button>
        <button className={pestana === 'cobros' ? 'active' : ''} onClick={() => setPestana('cobros')}>Cobros</button>
        <button className={pestana === 'costos' ? 'active' : ''} onClick={() => setPestana('costos')}>Gastos</button>
      </div>

      {cargando && <p>Cargando movimientos...</p>}
      {error && <p className="loginError">{error}</p>}

      {!cargando && pestana === 'resumen' && !error && <>
        <div className="gestionKpis">
          <div><span>VALOR ACTUAL</span><strong>{moneda(totales.actualizado)}</strong><small>Presupuestos + adicionales</small></div>
          <div><span>COBRADO</span><strong>{moneda(totales.cobrado)}</strong><small>Total recibido</small></div>
          <div><span>GASTOS</span><strong>{moneda(totales.costo)}</strong><small>Todo lo invertido</small></div>
          <div className="destacado"><span>GANANCIA NETA</span><strong>{moneda(gananciaNeta)}</strong><small>Valor actual − gastos</small></div>
        </div>
        <div className="finBreakdown">
          <span>Por cobrar: <strong>{moneda(totales.saldo)}</strong></span>
          <span>Pago total a ayudantes: <strong>{moneda(manoObraTotal)}</strong></span>
          <span>Materiales y varios: <strong>{moneda(variosTotal)}</strong></span>
        </div>
        <div className="gestionTabla"><table>
          <thead><tr><th>Obra</th><th>Valor actual.</th><th>Cobrado</th><th>Saldo</th><th>Pend. s/avance</th><th>Pagado / avance</th><th>Situación</th></tr></thead>
          <tbody>{resumen.length === 0 ? <tr><td colSpan={7}>No hay obras activas.</td></tr> : resumen.map((fila) => <tr key={fila.id} onClick={() => onAbrirObra?.(fila.id)} style={onAbrirObra ? { cursor: 'pointer' } : undefined} title={onAbrirObra ? 'Ver ficha de la obra' : undefined}>
            <td><strong>{fila.nombre_obra}</strong></td>
            <td><strong>{moneda(fila.actualizado)}</strong>{fila.extra !== 0 && <><br /><small style={{ color: fila.extra > 0 ? '#23764e' : '#b23b32' }}>base {moneda(fila.total)} · adic {fila.extra > 0 ? '+' : '−'}{moneda(Math.abs(fila.extra))}</small></>}</td>
            <td>{moneda(fila.cobrado)}</td><td>{moneda(fila.saldo)}</td><td>{fila.pendienteAvance > 0 ? <strong style={{ color: '#b86608' }}>{moneda(fila.pendienteAvance)}</strong> : moneda(0)}</td><td>{fila.pagadoPct}% / {fila.porcentaje_avance ?? 0}%</td><td><span className={fila.alerta ? 'gestionEstado alerta' : 'gestionEstado ok'}>{fila.alerta ? '⚠ Financiando' : 'OK'}</span></td>
          </tr>)}</tbody>
        </table></div>
        <p className="gestionAyuda">El <strong>valor actualizado</strong> suma los adicionales aprobados al presupuesto original. “Financiando” aparece cuando el avance supera en 25 puntos o más lo cobrado.</p>
      </>}

      {!cargando && pestana === 'cobros' && !error && <div className="gestionTabla"><table>
        <thead><tr><th>Fecha</th><th>Presupuesto</th><th>Obra</th><th>Medio</th><th>Referencia</th><th>Monto</th><th>Acción</th></tr></thead>
        <tbody>{pagos.length === 0 ? <tr><td colSpan={7}>Todavía no hay cobros registrados.</td></tr> : pagos.map((pago) => {
          const presupuesto = pago.presupuesto_id ? presupuestoPorId(pago.presupuesto_id) : undefined
          const obraId = pago.obra_id ?? presupuesto?.obra_id ?? null
          return <tr key={pago.id}><td>{fechaCorta(pago.fecha)}</td><td><strong>{presupuesto?.titulo ?? 'Cobro directo a obra'}</strong></td><td>{nombreObra(obraId)}</td><td><span className="pagoMedio">{pago.medio_pago.replace('_', ' ')}</span></td><td>{pago.referencia || pago.notas || '—'}</td><td><strong>{moneda(pago.monto)}</strong></td><td><div className="adicAcciones"><button className="editButton" onClick={() => { setPagoEditar(pago); setFormulario('pago') }}>Editar</button><button className="adicNo" onClick={() => eliminarPago(pago)}>Eliminar</button></div></td></tr>
        })}</tbody>
      </table></div>}

      {!cargando && pestana === 'costos' && !error && <div className="gestionTabla"><table>
        <thead><tr><th>Obra</th><th>Tipo</th><th>Categoría</th><th>Detalle</th><th>Fecha</th><th>Monto</th></tr></thead>
        <tbody>{costos.length === 0 ? <tr><td colSpan={6}>Todavía no hay gastos cargados.</td></tr> : costos.map((costo) => <tr key={costo.id}><td>{nombreObra(costo.obra_id)}</td><td>{costo.tipo.replace('_', ' ')}</td><td>{nombreCategoria(costo.categoria_id)}</td><td>{costo.descripcion || '—'}</td><td>{fechaCorta(costo.fecha)}</td><td><strong>{moneda(costo.monto)}</strong></td></tr>)}</tbody>
      </table></div>}

      {formulario === 'pago' && <FormularioPago presupuestos={presupuestos} obras={obras} pago={pagoEditar} onCancelar={() => { setFormulario(null); setPagoEditar(null) }} onGuardado={recargar} />}
      {formulario === 'costo' && <FormularioCosto obras={obras} categorias={categorias} onCancelar={() => setFormulario(null)} onGuardado={recargar} />}
    </div>
  )
}

function FormularioPago({ presupuestos, obras, pago, onCancelar, onGuardado }: { presupuestos: Presupuesto[]; obras: Obra[]; pago?: Pago | null; onCancelar: () => void; onGuardado: () => void }) {
  const editando = !!pago
  const [formulario, setFormulario] = useState({
    obra_id: pago?.obra_id ? String(pago.obra_id) : '',
    presupuesto_id: pago?.presupuesto_id ? String(pago.presupuesto_id) : '',
    monto: pago ? String(pago.monto) : '',
    fecha: pago?.fecha ? pago.fecha.slice(0, 10) : hoy(),
    medio_pago: pago?.medio_pago ?? 'transferencia',
    referencia: pago?.referencia ?? '',
    notas: pago?.notas ?? '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const actualizar = (campo: string, valor: string) => setFormulario((actual) => ({ ...actual, [campo]: valor }))
  // Presupuestos aceptados con saldo, filtrados por la obra elegida (si hay una)
  const disponibles = presupuestos.filter((p) => p.estado === 'aceptado' && p.saldo > 0 && (!formulario.obra_id || p.obra_id === Number(formulario.obra_id)))
  const seleccionado = disponibles.find((p) => p.id === Number(formulario.presupuesto_id))

  async function guardar(evento: FormEvent) {
    evento.preventDefault(); setError('')
    const monto = Number(formulario.monto)
    const obraId = formulario.obra_id ? Number(formulario.obra_id) : (seleccionado?.obra_id ?? null)
    if (!obraId && !seleccionado) { setError('Elegí una obra o un presupuesto.'); return }
    if (monto <= 0) { setError('Ingresá un monto mayor que cero.'); return }
    if (!editando && seleccionado && monto > seleccionado.saldo) { setError(`El monto supera el saldo de ${moneda(seleccionado.saldo)}.`); return }
    setGuardando(true)
    const datos = {
      presupuesto_id: seleccionado ? seleccionado.id : (formulario.presupuesto_id ? Number(formulario.presupuesto_id) : null),
      obra_id: obraId,
      monto,
      fecha: formulario.fecha,
      medio_pago: formulario.medio_pago,
      referencia: formulario.referencia.trim() || null,
      notas: formulario.notas.trim() || null,
    }
    const { error: errorPago } = editando
      ? await supabase.from('pagos').update(datos).eq('id', pago!.id)
      : await supabase.from('pagos').insert(datos)
    if (errorPago) { console.error(errorPago); setError('No se pudo registrar el cobro.'); setGuardando(false); return }
    onGuardado()
  }

  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">{editando ? 'EDITAR INGRESO' : 'NUEVO INGRESO'}</p><h2>{editando ? 'Editar cobro' : 'Registrar cobro'}</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}>
      <div className="formGrid">
        <label>Obra{seleccionado ? '' : ' *'}<select value={formulario.obra_id} onChange={(e) => { actualizar('obra_id', e.target.value); actualizar('presupuesto_id', '') }}><option value="">Seleccionar obra</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}</select></label>
        <label>Presupuesto (opcional)<select value={formulario.presupuesto_id} onChange={(e) => actualizar('presupuesto_id', e.target.value)}><option value="">Cobro a la obra (sin presupuesto)</option>{disponibles.map((p) => <option key={p.id} value={p.id}>{p.titulo} · saldo {moneda(p.saldo)}</option>)}</select></label>
        <label>Monto *<input type="number" min="0.01" step="0.01" required value={formulario.monto} onChange={(e) => actualizar('monto', e.target.value)} /></label>
        <label>Fecha *<input type="date" required value={formulario.fecha} onChange={(e) => actualizar('fecha', e.target.value)} /></label>
        <label>Medio de pago<select value={formulario.medio_pago} onChange={(e) => actualizar('medio_pago', e.target.value)}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="cheque">Cheque</option><option value="otro">Otro</option></select></label>
        <label>Referencia<input value={formulario.referencia} onChange={(e) => actualizar('referencia', e.target.value)} placeholder="Ej.: transferencia 09/05" /></label>
        <label>Observaciones<input value={formulario.notas} onChange={(e) => actualizar('notas', e.target.value)} /></label>
      </div>
      {seleccionado && <p className="pagoSaldo">Saldo disponible: <strong>{moneda(seleccionado.saldo)}</strong></p>}
      {error && <p className="loginError">{error}</p>}<div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar cobro'}</button></div>
    </form>
  </div></div>
}

function FormularioCosto({ obras, categorias, onCancelar, onGuardado }: { obras: Obra[]; categorias: Categoria[]; onCancelar: () => void; onGuardado: () => void }) {
  const [formulario, setFormulario] = useState({ obra_id: '', tipo: 'material', categoria_id: '', descripcion: '', monto: '', fecha: hoy() })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const actualizar = (campo: string, valor: string) => setFormulario((a) => ({ ...a, [campo]: valor }))
  async function guardar(evento: FormEvent) {
    evento.preventDefault(); setGuardando(true); setError('')
    const { error: errorCosto } = await supabase.from('costos').insert({ obra_id: Number(formulario.obra_id), tipo: formulario.tipo, categoria_id: formulario.categoria_id ? Number(formulario.categoria_id) : null, descripcion: formulario.descripcion.trim() || null, monto: Number(formulario.monto), fecha: formulario.fecha })
    if (errorCosto) { console.error(errorCosto); setError('No se pudo registrar el gasto.'); setGuardando(false); return }
    onGuardado()
  }
  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">NUEVO MOVIMIENTO</p><h2>Registrar gasto</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}><div className="formGrid">
      <label>Obra *<select required value={formulario.obra_id} onChange={(e) => actualizar('obra_id', e.target.value)}><option value="">Seleccionar obra</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}</select></label>
      <label>Tipo<select value={formulario.tipo} onChange={(e) => actualizar('tipo', e.target.value)}><option value="material">Material</option><option value="mano_obra">Mano de obra</option><option value="terciarizado">Terciarizado</option><option value="otro">Otro</option></select></label>
      <label>Categoría<select value={formulario.categoria_id} onChange={(e) => actualizar('categoria_id', e.target.value)}><option value="">Sin categoría</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
      <label>Monto *<input type="number" min="0" step="0.01" required value={formulario.monto} onChange={(e) => actualizar('monto', e.target.value)} /></label>
      <label>Fecha<input type="date" value={formulario.fecha} onChange={(e) => actualizar('fecha', e.target.value)} /></label>
      <label>Detalle<input value={formulario.descripcion} onChange={(e) => actualizar('descripcion', e.target.value)} /></label>
    </div>{error && <p className="loginError">{error}</p>}<div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar gasto'}</button></div></form>
  </div></div>
}

export default Finanzas
