import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Pedido } from './BuscadorGlobal'
import { supabase } from './supabase'
import { fechaCorta, moneda, hoy } from './gestionFormat'
import { confirmarEliminacion } from './confirmar'
import CampoNumero from './CampoNumero'

// Movimientos: toda la plata que entra y sale, en una sola lista ordenada por fecha.
//  · Entra: cobros a clientes (tabla pagos).
//  · Sale: pagos a personal y costos de obra (tabla costos) y gastos fijos (tabla gastos_generales).
// El análisis (balance, cobranzas, personal, gastos fijos) está en Tablero; acá se busca y controla cada movimiento.

type Obra = { id: number; nombre_obra: string; porcentaje_avance: number | null }
type Presupuesto = { id: number; obra_id: number | null; titulo: string; total: number; total_pagado: number; saldo: number; estado: string; activo: boolean }
type Pago = { id: number; presupuesto_id: number | null; obra_id: number | null; monto: number; fecha: string; medio_pago: string; referencia: string | null; notas: string | null; origen: string }
type Categoria = { id: number; nombre: string; deducible: boolean }
type Costo = { id: number; obra_id: number | null; categoria_id: number | null; personal_id: number | null; tipo: string; descripcion: string | null; monto: number; fecha: string }
type GastoFijo = { id: number; fecha: string; categoria: string | null; descripcion: string | null; monto: number; recurrente: boolean }
type Persona = { id: number; nombre: string; apellido: string | null }
type Compra = { id: number; obra_id: number | null; nombre: string; cantidad: number; precio_unitario: number; fecha: string; proveedor: string | null; numero_comprobante: string | null; pagado: boolean | null }

type TipoMov = 'cobro' | 'personal' | 'obra' | 'compra' | 'fijo'
type Movimiento = {
  clave: string
  tipo: TipoMov
  fecha: string
  concepto: string
  detalle: string
  obraId: number | null
  entra: boolean
  monto: number
  sinObra: boolean
  pago?: Pago
  costo?: Costo
  gasto?: GastoFijo
  compras?: Compra[]
}

const TIPOS: Record<TipoMov, { t: string; icono: string }> = {
  cobro: { t: 'Cobro', icono: '🟢' },
  personal: { t: 'Pago a personal', icono: '👷' },
  obra: { t: 'Costo de obra', icono: '🧱' },
  compra: { t: 'Compra', icono: '🧾' },
  fijo: { t: 'Gasto fijo', icono: '💸' },
}
const TIPOS_COSTO: Record<string, string> = { material: 'Material', mano_obra: 'Mano de obra', terciarizado: 'Terciarizado', otro: 'Otro', gasto_extra: 'Gasto extra (te lo reintegra el cliente)' }

// ---- Período (mismo criterio que el Tablero) ----
type Periodo = 'mes' | '3' | '6' | 'anio' | 'todo' | 'custom'
const PERIODOS: [Periodo, string][] = [['mes', 'Este mes'], ['3', 'Últimos 3 meses'], ['6', 'Últimos 6 meses'], ['anio', 'Este año'], ['todo', 'Todo'], ['custom', 'Elegir período']]
const mesActual = () => new Date().toISOString().slice(0, 7)
const sumarMeses = (ym: string, n: number) => {
  const [anio, mes] = ym.split('-').map(Number)
  const d = new Date(anio, mes - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const nombreMes = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
const nombreMesCorto = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' }).replace('.', '')
const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

function Finanzas({ onAbrirObra, pedido, onPedidoAtendido }: { onAbrirObra?: (obraId: number) => void; pedido?: Pedido | null; onPedidoAtendido?: () => void } = {}) {
  const [obras, setObras] = useState<Obra[]>([])
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [costos, setCostos] = useState<Costo[]>([])
  const [gastos, setGastos] = useState<GastoFijo[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [formulario, setFormulario] = useState<'pago' | 'costo' | null>(null)
  const [pagoEditar, setPagoEditar] = useState<Pago | null>(null)
  // Pedido del buscador general o del botón "+".
  useEffect(() => {
    if (!pedido) return
    if (pedido.accion === 'cobro') { setPagoEditar(null); setFormulario('pago') }
    else if (pedido.accion === 'gasto') setFormulario('costo')
    onPedidoAtendido?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido])
  const [actualizacion, setActualizacion] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  // Filtros
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [desdeSel, setDesdeSel] = useState(mesActual())
  const [hastaSel, setHastaSel] = useState(mesActual())
  const [compras, setCompras] = useState<Compra[]>([])
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'entra' | 'sale' | TipoMov>('todos')
  const [filtroObra, setFiltroObra] = useState<string>('todas') // 'todas' | 'sin' | id de obra
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      setError('')
      const [rObras, rPresupuestos, rPagos, rCostos, rCategorias, rGastos, rPersonas, rCompras] = await Promise.all([
        supabase.from('obras').select('id, nombre_obra, porcentaje_avance').eq('activo', true).order('nombre_obra'),
        supabase.from('presupuestos').select('id, obra_id, titulo, total, total_pagado, saldo, estado, activo').eq('activo', true),
        supabase.from('pagos').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('costos').select('*').order('fecha', { ascending: false }),
        supabase.from('categorias_gasto').select('*').eq('activo', true).order('nombre'),
        supabase.from('gastos_generales').select('id,fecha,categoria,descripcion,monto,recurrente'),
        supabase.from('personal').select('id,nombre,apellido'),
        supabase.from('materiales').select('id,obra_id,nombre,cantidad,precio_unitario,fecha,proveedor,numero_comprobante,pagado'),
      ])

      const fallo = rObras.error || rPresupuestos.error || rPagos.error || rCostos.error || rCategorias.error
      if (fallo) {
        console.error(fallo)
        setError('No se pudieron cargar los movimientos.')
        setCargando(false)
        return
      }

      setObras((rObras.data ?? []) as Obra[])
      setPresupuestos((rPresupuestos.data ?? []).map((p) => ({ ...p, total: Number(p.total), total_pagado: Number(p.total_pagado), saldo: Number(p.saldo) })) as Presupuesto[])
      setPagos((rPagos.data ?? []).map((p) => ({ ...p, monto: Number(p.monto) })) as Pago[])
      setCostos((rCostos.data ?? []).map((c) => ({ ...c, monto: Number(c.monto) })) as Costo[])
      setCategorias((rCategorias.data ?? []) as Categoria[])
      // Gastos fijos y personal son opcionales: si fallan, se sigue sin ellos.
      setGastos(rGastos.error ? [] : (rGastos.data ?? []).map((g) => ({ ...g, monto: Number(g.monto) })) as GastoFijo[])
      setPersonas(rPersonas.error ? [] : (rPersonas.data ?? []) as Persona[])
      setCompras(rCompras.error ? [] : (rCompras.data ?? []).map((c) => ({ ...c, cantidad: Number(c.cantidad) || 0, precio_unitario: Number(c.precio_unitario) || 0 })) as Compra[])
      setCargando(false)
    }
    cargar()
  }, [actualizacion])

  const nombreObra = (id: number | null) => (id == null ? 'Sin obra asociada' : obras.find((o) => o.id === id)?.nombre_obra ?? `Obra #${id}`)
  const nombreCategoria = (id: number | null) => categorias.find((c) => c.id === id)?.nombre ?? null
  const nombrePersona = (id: number | null) => { const p = personas.find((x) => x.id === id); return p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : 'Personal' }

  // ---- Todos los movimientos, unificados ----
  const movimientos = useMemo<Movimiento[]>(() => {
    const lista: Movimiento[] = []
    pagos.forEach((p) => {
      const presupuesto = p.presupuesto_id ? presupuestos.find((x) => x.id === p.presupuesto_id) : undefined
      const obraId = p.obra_id ?? presupuesto?.obra_id ?? null
      lista.push({
        clave: `p-${p.id}`, tipo: 'cobro', fecha: p.fecha, entra: true, monto: p.monto, obraId, sinObra: obraId == null, pago: p,
        concepto: presupuesto?.titulo ?? 'Cobro a obra',
        detalle: [p.medio_pago?.replace('_', ' '), p.referencia || p.notas].filter(Boolean).join(' · '),
      })
    })
    costos.forEach((c) => {
      const esPersonal = c.personal_id != null
      lista.push({
        clave: `c-${c.id}`, tipo: esPersonal ? 'personal' : 'obra', fecha: c.fecha, entra: false, monto: c.monto,
        obraId: c.obra_id ?? null, sinObra: c.obra_id == null, costo: c,
        concepto: esPersonal ? `Pago a ${nombrePersona(c.personal_id)}` : (c.descripcion || TIPOS_COSTO[c.tipo] || 'Costo'),
        detalle: [esPersonal ? c.descripcion : TIPOS_COSTO[c.tipo], nombreCategoria(c.categoria_id)].filter(Boolean).join(' · '),
      })
    })
    // Compras a proveedores ya pagadas: un movimiento por ticket (mismo día, obra, proveedor y comprobante).
    const tickets: Record<string, Compra[]> = {}
    compras.filter((c) => c.pagado !== false).forEach((c) => {
      const k = `${c.obra_id}|${c.fecha}|${c.proveedor ?? ''}|${c.numero_comprobante ?? ''}`
      ;(tickets[k] ??= []).push(c)
    })
    Object.entries(tickets).forEach(([k, filas]) => {
      const c = filas[0]
      lista.push({
        clave: `m-${k}`, tipo: 'compra', fecha: c.fecha, entra: false, monto: Math.round(filas.reduce((t, f) => t + f.cantidad * f.precio_unitario, 0) * 100) / 100,
        obraId: c.obra_id ?? null, sinObra: c.obra_id == null, compras: filas,
        concepto: c.proveedor ? `Compra a ${c.proveedor}` : filas.length === 1 ? c.nombre : 'Compra de materiales',
        detalle: [filas.length === 1 ? (c.proveedor ? c.nombre : '') : `${filas.length} ítems`, c.numero_comprobante ? `Comp. ${c.numero_comprobante}` : ''].filter(Boolean).join(' · '),
      })
    })
    gastos.forEach((g) => {
      lista.push({
        clave: `g-${g.id}`, tipo: 'fijo', fecha: g.fecha, entra: false, monto: g.monto, obraId: null, sinObra: false, gasto: g,
        concepto: g.descripcion || g.categoria || 'Gasto fijo',
        detalle: [g.categoria, g.recurrente ? 'Recurrente' : 'Puntual'].filter(Boolean).join(' · '),
      })
    })
    return lista.sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagos, costos, gastos, compras, presupuestos, obras, personas, categorias])

  // ---- Período ----
  const rango = useMemo(() => {
    const hoyYm = mesActual()
    let desde = hoyYm
    let hasta = hoyYm
    if (periodo === '3') desde = sumarMeses(hoyYm, -2)
    else if (periodo === '6') desde = sumarMeses(hoyYm, -5)
    else if (periodo === 'anio') desde = `${hoyYm.slice(0, 4)}-01`
    else if (periodo === 'todo') desde = '0000-01'
    else if (periodo === 'custom') {
      desde = desdeSel <= hastaSel ? desdeSel : hastaSel
      hasta = desdeSel <= hastaSel ? hastaSel : desdeSel
    }
    const etiqueta = periodo === 'todo' ? 'Todos los movimientos'
      : desde === hasta ? nombreMes(desde) : `${nombreMesCorto(desde)} – ${nombreMesCorto(hasta)}`
    return { desde, hasta, etiqueta }
  }, [periodo, desdeSel, hastaSel])

  const delPeriodo = useMemo(() => movimientos.filter((m) => {
    const ym = (m.fecha ?? '').slice(0, 7)
    return ym >= rango.desde && ym <= rango.hasta
  }), [movimientos, rango])

  const filtrados = useMemo(() => {
    const texto = normalizar(busqueda.trim())
    return delPeriodo.filter((m) => {
      if (filtroTipo === 'entra' && !m.entra) return false
      if (filtroTipo === 'sale' && m.entra) return false
      if (filtroTipo !== 'todos' && filtroTipo !== 'entra' && filtroTipo !== 'sale' && m.tipo !== filtroTipo) return false
      if (filtroObra === 'sin' && !m.sinObra) return false
      if (filtroObra !== 'todas' && filtroObra !== 'sin' && m.obraId !== Number(filtroObra)) return false
      if (texto && !normalizar(`${m.concepto} ${m.detalle} ${m.obraId != null ? nombreObra(m.obraId) : ''} ${TIPOS[m.tipo].t}`).includes(texto)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delPeriodo, filtroTipo, filtroObra, busqueda, obras])

  const totales = useMemo(() => {
    const entro = filtrados.filter((m) => m.entra).reduce((s, m) => s + m.monto, 0)
    const salio = filtrados.filter((m) => !m.entra).reduce((s, m) => s + m.monto, 0)
    return { entro, salio, quedo: entro - salio }
  }, [filtrados])

  const sinObraPeriodo = delPeriodo.filter((m) => m.sinObra)
  const hayFiltros = filtroTipo !== 'todos' || filtroObra !== 'todas' || busqueda.trim() !== ''

  function recargar() { setFormulario(null); setPagoEditar(null); setActualizacion((v) => v + 1) }

  async function eliminar(m: Movimiento) {
    const tabla = m.pago ? 'pagos' : m.costo ? 'costos' : 'gastos_generales'
    const id = m.pago?.id ?? m.costo?.id ?? m.gasto?.id
    if (id == null) return
    const aviso = m.tipo === 'personal'
      ? '¿Eliminar este pago a personal? Va a cambiar el saldo que le debés a esa persona.'
      : `¿Eliminar "${m.concepto}" de ${moneda(m.monto)}? No se puede deshacer.`
    if (!confirmarEliminacion(aviso)) return
    const { error: err } = await supabase.from(tabla).delete().eq('id', id)
    if (err) { console.error(err); window.alert('No se pudo eliminar.'); return }
    setActualizacion((v) => v + 1)
  }

  const colorMonto = (v: number) => (v > 0 ? '#23764e' : v < 0 ? '#b23b32' : undefined)
  const estiloMes = { padding: '8px 10px', border: '1px solid var(--mova-border)', borderRadius: 10 }
  const estiloFiltro = { padding: '9px 12px', border: '1px solid var(--mova-border)', borderRadius: 10, background: 'var(--mova-bg, #fff)' }

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div><p className="subtitle">CONTROL FINANCIERO</p><h2>Movimientos</h2><p className="welcome">Toda la plata que entra y sale, en orden</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="newButton" onClick={() => { setPagoEditar(null); setFormulario('pago') }}>+ Registrar cobro</button>
          <button className="editButton" onClick={() => setFormulario('costo')}>+ Registrar costo de obra</button>
        </div>
      </div>

      {/* ---- Período ---- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '4px 0 6px' }}>
        {PERIODOS.map(([clave, texto]) => (
          <button key={clave} type="button" className={periodo === clave ? 'newButton' : 'editButton'} onClick={() => setPeriodo(clave)}>{texto}</button>
        ))}
        {periodo === 'custom' && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--mova-muted)' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Desde
              <input type="month" value={desdeSel} max={mesActual()} onChange={(e) => e.target.value && setDesdeSel(e.target.value)} style={estiloMes} />
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Hasta
              <input type="month" value={hastaSel} max={mesActual()} onChange={(e) => e.target.value && setHastaSel(e.target.value)} style={estiloMes} />
            </label>
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--mova-muted)' }}>Período: <strong style={{ color: 'inherit' }}>{rango.etiqueta}</strong></p>

      {cargando && <p>Cargando movimientos...</p>}
      {error && <p className="loginError">{error}</p>}

      {!cargando && !error && <>
        {/* ---- Totales ---- */}
        <div className="gestionKpis">
          <div><span>🟢 ENTRÓ</span><strong style={{ color: '#23764e' }}>{moneda(totales.entro)}</strong><small>Cobros</small></div>
          <div><span>🔴 SALIÓ</span><strong style={{ color: totales.salio > 0 ? '#b23b32' : undefined }}>{moneda(totales.salio)}</strong><small>Personal, costos, compras y gastos fijos</small></div>
          <div className="destacado"><span>QUEDÓ</span><strong style={{ color: colorMonto(totales.quedo) }}>{moneda(totales.quedo)}</strong><small>{hayFiltros ? 'Según los filtros elegidos' : 'Entró − salió'}</small></div>
          <button
            type="button"
            className={`prodKpiBtn ${filtroObra === 'sin' ? 'activo' : ''}`}
            onClick={() => setFiltroObra(filtroObra === 'sin' ? 'todas' : 'sin')}
            disabled={sinObraPeriodo.length === 0}
          >
            <span>⚠️ SIN OBRA ASOCIADA</span>
            <strong style={{ color: sinObraPeriodo.length ? '#b86608' : undefined }}>{sinObraPeriodo.length}</strong>
            <small>{sinObraPeriodo.length === 0 ? 'Todo asignado' : filtroObra === 'sin' ? 'Filtrando ✓' : 'Tocá para verlos'}</small>
          </button>
        </div>

        {/* ---- Filtros ---- */}
        <div className="crmToolbar">
          <div className="crmFiltros" style={{ flexWrap: 'wrap' }}>
            <input type="search" placeholder="Buscar concepto, obra, persona, referencia..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as typeof filtroTipo)} style={estiloFiltro}>
              <option value="todos">Todos los tipos</option>
              <option value="entra">🟢 Solo lo que entró</option>
              <option value="sale">🔴 Solo lo que salió</option>
              <option value="cobro">Cobros</option>
              <option value="personal">Pagos a personal</option>
              <option value="obra">Costos de obra</option>
              <option value="compra">Compras</option>
              <option value="fijo">Gastos fijos</option>
            </select>
            <select value={filtroObra} onChange={(e) => setFiltroObra(e.target.value)} style={estiloFiltro}>
              <option value="todas">Todas las obras</option>
              <option value="sin">⚠️ Sin obra asociada</option>
              {obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
            </select>
            {hayFiltros && <button type="button" className="editButton" onClick={() => { setFiltroTipo('todos'); setFiltroObra('todas'); setBusqueda('') }}>Limpiar filtros ✕</button>}
          </div>
        </div>

        {/* ---- Lista ---- */}
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Obra</th><th>Detalle</th><th>Monto</th><th>Acción</th></tr></thead>
            <tbody>
              {filtrados.length === 0 ? <tr><td colSpan={7}>{hayFiltros ? 'No hay movimientos con esos filtros.' : 'No hay movimientos en este período.'}</td></tr> : filtrados.map((m) => (
                <tr key={m.clave} style={m.sinObra ? { background: '#fff8ec' } : undefined}>
                  <td>{fechaCorta(m.fecha)}</td>
                  <td><span style={{ whiteSpace: 'nowrap' }}>{TIPOS[m.tipo].icono} {TIPOS[m.tipo].t}</span></td>
                  <td><strong>{m.concepto}</strong></td>
                  <td>
                    {m.tipo === 'fijo' ? <span style={{ color: 'var(--mova-muted)' }}>Estructura</span>
                      : m.sinObra ? <strong style={{ color: '#b86608' }}>⚠️ Sin obra</strong>
                      : onAbrirObra && m.obraId != null
                        ? <button type="button" className="editButton" style={{ padding: '3px 10px' }} onClick={() => onAbrirObra(m.obraId as number)}>{nombreObra(m.obraId)}</button>
                        : nombreObra(m.obraId)}
                  </td>
                  <td>{m.detalle || '—'}</td>
                  <td><strong style={{ color: m.entra ? '#23764e' : '#b23b32', whiteSpace: 'nowrap' }}>{m.entra ? '+ ' : '− '}{moneda(m.monto)}</strong></td>
                  <td>
                    <div className="adicAcciones">
                      {m.pago && <button className="editButton" onClick={() => { setPagoEditar(m.pago ?? null); setFormulario('pago') }}>{m.sinObra ? 'Asignar obra' : 'Editar'}</button>}
                      {m.compras ? <span style={{ color: 'var(--mova-muted)', fontSize: 12 }}>Se edita en Compras</span> : <button className="adicNo" onClick={() => void eliminar(m)}>Eliminar</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="gestionAyuda">
          Los cobros se editan acá (o desde la ficha de la obra). Las compras aparecen cuando están pagadas y se editan en <strong>Compras</strong>. Los gastos fijos se cargan y editan en <strong>Inicio → Gastos fijos</strong>, y los pagos al personal desde la ficha de cada obra.
          Los movimientos <strong>sin obra asociada</strong> no suman a ninguna obra: asignales una para que los números de cobranzas cierren.
        </p>
      </>}

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
  const disponibles = presupuestos.filter((p) => p.estado === 'aceptado' && (p.saldo > 0 || p.id === Number(formulario.presupuesto_id)) && (!formulario.obra_id || p.obra_id === Number(formulario.obra_id)))
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
      presupuesto_id: seleccionado ? seleccionado.id : null,
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
        <label>Monto *<CampoNumero min="0.01" required value={formulario.monto} onChange={(e) => actualizar('monto', e.target.value)} /></label>
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
    evento.preventDefault(); setError('')
    if (!(Number(formulario.monto) > 0)) { setError('Ingresá un monto mayor que cero.'); return }
    setGuardando(true)
    const { error: errorCosto } = await supabase.from('costos').insert({ obra_id: Number(formulario.obra_id), tipo: formulario.tipo, categoria_id: formulario.categoria_id ? Number(formulario.categoria_id) : null, descripcion: formulario.descripcion.trim() || null, monto: Number(formulario.monto), fecha: formulario.fecha })
    if (errorCosto) { console.error(errorCosto); setError('No se pudo registrar el costo.'); setGuardando(false); return }
    onGuardado()
  }
  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">NUEVO MOVIMIENTO</p><h2>Registrar costo de obra</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}><div className="formGrid">
      <label>Obra *<select required value={formulario.obra_id} onChange={(e) => actualizar('obra_id', e.target.value)}><option value="">Seleccionar obra</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}</select></label>
      <label>Tipo<select value={formulario.tipo} onChange={(e) => actualizar('tipo', e.target.value)}><option value="material">Material</option><option value="mano_obra">Mano de obra</option><option value="terciarizado">Terciarizado</option><option value="otro">Otro</option></select></label>
      <label>Categoría<select value={formulario.categoria_id} onChange={(e) => actualizar('categoria_id', e.target.value)}><option value="">Sin categoría</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
      <label>Monto *<CampoNumero min="0.01" required value={formulario.monto} onChange={(e) => actualizar('monto', e.target.value)} /></label>
      <label>Fecha<input type="date" value={formulario.fecha} onChange={(e) => actualizar('fecha', e.target.value)} /></label>
      <label>Detalle<input value={formulario.descripcion} onChange={(e) => actualizar('descripcion', e.target.value)} /></label>
    </div>{error && <p className="loginError">{error}</p>}<div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar costo'}</button></div></form>
  </div></div>
}

export default Finanzas
