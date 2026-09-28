import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { fechaCorta, moneda, hoy } from './gestionFormat'

type Obra = { id: number; nombre_obra: string }
type Material = {
  id: number
  obra_id: number
  nombre: string
  cantidad: number
  unidad: string | null
  precio_unitario: number
  proveedor: string | null
  fecha: string
  numero_comprobante: string | null
  comprobante_path: string | null
  pagado: boolean
  fecha_vencimiento: string | null
}
type MaterialConUrl = Material & { comprobante_url: string | null }
type Pestana = 'materiales' | 'comprobantes'

// ---- Período (mismo criterio que Tablero y Movimientos) ----
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
const subtotal = (m: Material) => m.cantidad * m.precio_unitario
const estaVencida = (m: Material) => !m.pagado && !!m.fecha_vencimiento && m.fecha_vencimiento.slice(0, 10) < hoy()
const SIN_PROVEEDOR = 'Proveedor no informado'

const ROJO = '#b23b32'
const NARANJA = '#b86608'

function Compras() {
  const [obras, setObras] = useState<Obra[]>([])
  const [materiales, setMateriales] = useState<MaterialConUrl[]>([])
  const [pestana, setPestana] = useState<Pestana>('materiales')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [compraEditando, setCompraEditando] = useState<MaterialConUrl | null>(null)
  const [actualizacion, setActualizacion] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState<string | null>(null) // acción en curso (para deshabilitar botones)

  // Filtros
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [desdeSel, setDesdeSel] = useState(mesActual())
  const [hastaSel, setHastaSel] = useState(mesActual())
  const [busqueda, setBusqueda] = useState('')
  const [filtroObra, setFiltroObra] = useState('todas')
  const [filtroProveedor, setFiltroProveedor] = useState('todos')
  const [filtroPago, setFiltroPago] = useState<'todos' | 'impagas' | 'pagadas'>('todos')
  const [soloSinComprobante, setSoloSinComprobante] = useState(false)

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      setError('')
      const [rObras, rMateriales] = await Promise.all([
        supabase.from('obras').select('id, nombre_obra').eq('activo', true).order('nombre_obra'),
        supabase.from('materiales').select('id, obra_id, nombre, cantidad, unidad, precio_unitario, proveedor, fecha, numero_comprobante, comprobante_path, pagado, fecha_vencimiento').order('fecha', { ascending: false }).order('created_at', { ascending: false }),
      ])
      if (rObras.error || rMateriales.error) {
        console.error(rObras.error || rMateriales.error)
        setError('No se pudieron cargar las compras.')
        setCargando(false)
        return
      }

      setObras((rObras.data ?? []) as Obra[])
      const base = (rMateriales.data ?? []).map((material) => ({
        ...material,
        cantidad: Number(material.cantidad),
        precio_unitario: Number(material.precio_unitario),
        comprobante_url: null,
      })) as MaterialConUrl[]

      const conUrls = await Promise.all(base.map(async (material) => {
        if (!material.comprobante_path) return material
        const { data } = await supabase.storage.from('comprobantes').createSignedUrl(material.comprobante_path, 3600)
        return { ...material, comprobante_url: data?.signedUrl ?? null }
      }))
      setMateriales(conUrls)
      setCargando(false)
    }
    cargar()
  }, [actualizacion])

  const nombreObra = (id: number) => obras.find((obra) => obra.id === id)?.nombre_obra ?? 'Obra no disponible'
  const proveedorDe = (m: Material) => m.proveedor?.trim() || SIN_PROVEEDOR

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
    const etiqueta = periodo === 'todo' ? 'Todas las compras'
      : desde === hasta ? nombreMes(desde) : `${nombreMesCorto(desde)} – ${nombreMesCorto(hasta)}`
    return { desde, hasta, etiqueta }
  }, [periodo, desdeSel, hastaSel])

  const delPeriodo = useMemo(() => materiales.filter((m) => {
    const ym = (m.fecha ?? '').slice(0, 7)
    return ym >= rango.desde && ym <= rango.hasta
  }), [materiales, rango])

  // ---- Lo que se debe: siempre todas las impagas, sin importar el período ----
  const deudas = useMemo(() => {
    const impagas = materiales.filter((m) => !m.pagado)
    const porProveedor: Record<string, { proveedor: string; compras: MaterialConUrl[]; total: number; vencidas: number; proximoVence: string | null }> = {}
    impagas.forEach((m) => {
      const p = proveedorDe(m)
      const g = (porProveedor[p] ??= { proveedor: p, compras: [], total: 0, vencidas: 0, proximoVence: null })
      g.compras.push(m)
      g.total += subtotal(m)
      if (estaVencida(m)) g.vencidas++
      const vence = m.fecha_vencimiento?.slice(0, 10) ?? null
      if (vence && (!g.proximoVence || vence < g.proximoVence)) g.proximoVence = vence
    })
    const grupos = Object.values(porProveedor).sort((a, b) => b.vencidas - a.vencidas || b.total - a.total)
    return {
      grupos,
      total: impagas.reduce((s, m) => s + subtotal(m), 0),
      vencidas: impagas.filter(estaVencida).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materiales])

  // ---- Totales y gráficos del período ----
  const resumen = useMemo(() => {
    const total = delPeriodo.reduce((s, m) => s + subtotal(m), 0)
    const sinComprobante = delPeriodo.filter((m) => !m.comprobante_path)
    const porObra: Record<string, number> = {}
    const porProveedor: Record<string, number> = {}
    delPeriodo.forEach((m) => {
      const o = nombreObra(m.obra_id)
      porObra[o] = (porObra[o] || 0) + subtotal(m)
      const p = proveedorDe(m)
      porProveedor[p] = (porProveedor[p] || 0) + subtotal(m)
    })
    const ordenar = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1])
    return {
      total,
      sinComprobante: sinComprobante.length,
      sinComprobanteMonto: sinComprobante.reduce((s, m) => s + subtotal(m), 0),
      conComprobante: delPeriodo.filter((m) => m.comprobante_path),
      porObra: ordenar(porObra),
      porProveedor: ordenar(porProveedor).slice(0, 5),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delPeriodo, obras])

  const proveedores = useMemo(() => Array.from(new Set<string>(materiales.map(proveedorDe))).sort((a, b) => a.localeCompare(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [materiales])

  // Las impagas se muestran siempre (aunque sean de otro período), para que ninguna deuda quede escondida.
  const filtrados = useMemo(() => {
    const texto = normalizar(busqueda.trim())
    const base = filtroPago === 'impagas' ? materiales.filter((m) => !m.pagado) : delPeriodo
    return base.filter((m) => {
      if (filtroPago === 'pagadas' && !m.pagado) return false
      if (filtroObra !== 'todas' && m.obra_id !== Number(filtroObra)) return false
      if (filtroProveedor !== 'todos' && proveedorDe(m) !== filtroProveedor) return false
      if (soloSinComprobante && m.comprobante_path) return false
      if (texto && !normalizar(`${m.nombre} ${proveedorDe(m)} ${nombreObra(m.obra_id)} ${m.numero_comprobante ?? ''}`).includes(texto)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materiales, delPeriodo, busqueda, filtroObra, filtroProveedor, filtroPago, soloSinComprobante, obras])

  const hayFiltros = busqueda.trim() !== '' || filtroObra !== 'todas' || filtroProveedor !== 'todos' || filtroPago !== 'todos' || soloSinComprobante
  const totalFiltrado = filtrados.reduce((s, m) => s + subtotal(m), 0)
  function limpiarFiltros() { setBusqueda(''); setFiltroObra('todas'); setFiltroProveedor('todos'); setFiltroPago('todos'); setSoloSinComprobante(false) }

  async function togglePagado(m: MaterialConUrl) {
    setTrabajando(`pago-${m.id}`)
    const { error: err } = await supabase.from('materiales').update({ pagado: !m.pagado }).eq('id', m.id)
    setTrabajando(null)
    if (err) { console.error(err); window.alert('No se pudo actualizar el estado de pago.'); return }
    setMateriales((arr) => arr.map((x) => (x.id === m.id ? { ...x, pagado: !x.pagado } : x)))
  }

  async function marcarPagadas(proveedor: string, compras: MaterialConUrl[]) {
    const total = compras.reduce((s, m) => s + subtotal(m), 0)
    if (!window.confirm(`¿Marcar como pagadas las ${compras.length} compras a ${proveedor} por ${moneda(total)}?`)) return
    setTrabajando(`prov-${proveedor}`)
    const ids = compras.map((m) => m.id)
    const { error: err } = await supabase.from('materiales').update({ pagado: true }).in('id', ids)
    setTrabajando(null)
    if (err) { console.error(err); window.alert('No se pudieron marcar como pagadas.'); return }
    setMateriales((arr) => arr.map((x) => (ids.includes(x.id) ? { ...x, pagado: true } : x)))
  }

  // Adjuntar comprobante directo desde la tabla, sin abrir el formulario.
  async function adjuntar(m: MaterialConUrl, archivo: File) {
    setTrabajando(`adj-${m.id}`)
    const nombreSeguro = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase() || 'comprobante'
    const ruta = `${m.obra_id}/${m.id}-${Date.now()}-${nombreSeguro}`
    const { error: errArchivo } = await supabase.storage.from('comprobantes').upload(ruta, archivo, { contentType: archivo.type, upsert: false })
    if (errArchivo) { console.error(errArchivo); setTrabajando(null); window.alert('No se pudo subir el comprobante.'); return }
    const { error: errRuta } = await supabase.from('materiales').update({ comprobante_path: ruta }).eq('id', m.id)
    if (errRuta) {
      console.error(errRuta)
      await supabase.storage.from('comprobantes').remove([ruta])
      setTrabajando(null)
      window.alert('No se pudo vincular el comprobante.')
      return
    }
    setTrabajando(null)
    setActualizacion((v) => v + 1)
  }

  const estiloMes = { padding: '8px 10px', border: '1px solid var(--mova-border)', borderRadius: 10 }
  const estiloFiltro = { padding: '9px 12px', border: '1px solid var(--mova-border)', borderRadius: 10, background: 'var(--mova-bg, #fff)' }
  const filaBarra = (etiqueta: string, monto: number, max: number, color: string) => (
    <div key={etiqueta} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 150px) 1fr auto', gap: 10, alignItems: 'center', padding: '5px 0', fontSize: 13 }}>
      <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={etiqueta}>{etiqueta}</strong>
      <div className="tabBar"><span style={{ width: `${max > 0 ? (monto / max) * 100 : 0}%`, background: color }} /></div>
      <span style={{ whiteSpace: 'nowrap' }}>{moneda(monto)}</span>
    </div>
  )

  return <div className="gestionPage">
    <div className="pageHeader"><div><p className="subtitle">COMPRAS Y MATERIALES</p><h2>Compras</h2><p className="welcome">Materiales, proveedores y comprobantes de cada obra</p></div><button className="newButton" onClick={() => { setCompraEditando(null); setMostrarFormulario(true) }}>+ Registrar compra</button></div>

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

    {cargando && <p>Cargando compras...</p>}
    {error && <p className="loginError">{error}</p>}

    {!cargando && !error && <>
      {/* ---- Cuadros (tocarlos filtra la lista) ---- */}
      <div className="gestionKpis">
        <button type="button" className={`prodKpiBtn ${!hayFiltros ? 'activo' : ''}`} onClick={() => { limpiarFiltros(); setPestana('materiales') }}>
          <span>COMPRAS DEL PERÍODO</span><strong>{moneda(resumen.total)}</strong><small>{delPeriodo.length} compra{delPeriodo.length === 1 ? '' : 's'}</small>
        </button>
        <button type="button" className={`prodKpiBtn ${filtroPago === 'impagas' ? 'activo' : ''}`} onClick={() => { setFiltroPago(filtroPago === 'impagas' ? 'todos' : 'impagas'); setPestana('materiales') }}>
          <span>🔴 POR PAGAR</span><strong style={{ color: deudas.total > 0 ? ROJO : undefined }}>{moneda(deudas.total)}</strong>
          <small>{deudas.vencidas > 0 ? `${deudas.vencidas} vencida${deudas.vencidas === 1 ? '' : 's'} · total, sin importar el período` : 'Total, sin importar el período'}</small>
        </button>
        <button type="button" className={`prodKpiBtn ${soloSinComprobante ? 'activo' : ''}`} onClick={() => { setSoloSinComprobante(!soloSinComprobante); setPestana('materiales') }}>
          <span>⚠️ SIN COMPROBANTE</span><strong style={{ color: resumen.sinComprobante > 0 ? NARANJA : undefined }}>{resumen.sinComprobante}</strong>
          <small>{resumen.sinComprobante > 0 ? `${moneda(resumen.sinComprobanteMonto)} sin factura ni ticket` : 'Todas con comprobante'}</small>
        </button>
        <button type="button" className={`prodKpiBtn ${pestana === 'comprobantes' ? 'activo' : ''}`} onClick={() => setPestana(pestana === 'comprobantes' ? 'materiales' : 'comprobantes')}>
          <span>🧾 COMPROBANTES</span><strong>{resumen.conComprobante.length}</strong><small>{pestana === 'comprobantes' ? 'Viendo comprobantes ✓' : 'Tocá para verlos'}</small>
        </button>
      </div>

      {/* ---- A quién le debés ---- */}
      {deudas.grupos.length > 0 && (
        <div className="crmListaWrap" style={{ marginBottom: 14 }}>
          <table className="crmLista">
            <thead><tr><th>A quién le debés</th><th>Compras</th><th>Vencimiento</th><th>Total</th><th></th></tr></thead>
            <tbody>
              {deudas.grupos.map((g) => (
                <tr key={g.proveedor}>
                  <td><strong>{g.proveedor}</strong></td>
                  <td>
                    <button type="button" className="editButton" style={{ padding: '3px 10px' }} onClick={() => { limpiarFiltros(); setFiltroPago('impagas'); setFiltroProveedor(g.proveedor); setPestana('materiales') }}>
                      Ver {g.compras.length}
                    </button>
                  </td>
                  <td>
                    {g.vencidas > 0
                      ? <strong style={{ color: ROJO }}>🔴 {g.vencidas} vencida{g.vencidas === 1 ? '' : 's'}</strong>
                      : g.proximoVence ? `Vence ${fechaCorta(g.proximoVence)}` : <span style={{ color: 'var(--mova-muted)' }}>Sin fecha</span>}
                  </td>
                  <td><strong style={{ color: ROJO }}>{moneda(g.total)}</strong></td>
                  <td>
                    <button type="button" className="newButton" style={{ padding: '6px 12px', fontSize: 13 }} disabled={trabajando !== null} onClick={() => void marcarPagadas(g.proveedor, g.compras)}>
                      {trabajando === `prov-${g.proveedor}` ? 'Guardando...' : 'Marcar pagado'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Gráficos del período ---- */}
      {resumen.porObra.length > 0 && (
        <div className="crmListaWrap" style={{ padding: '14px 18px', marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
          <div>
            <h4 style={{ margin: '0 0 8px' }}>En qué obra se va el material</h4>
            {resumen.porObra.map(([obra, monto]) => filaBarra(obra, monto, resumen.porObra[0][1], '#2f6fb3'))}
          </div>
          <div>
            <h4 style={{ margin: '0 0 8px' }}>Proveedores a los que más les comprás</h4>
            {resumen.porProveedor.map(([prov, monto]) => filaBarra(prov, monto, resumen.porProveedor[0][1], NARANJA))}
          </div>
        </div>
      )}

      {pestana === 'materiales' && <>
        {/* ---- Filtros ---- */}
        <div className="crmToolbar">
          <div className="crmFiltros" style={{ flexWrap: 'wrap' }}>
            <input type="search" placeholder="Buscar material, proveedor, obra o N° de comprobante..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            <select value={filtroObra} onChange={(e) => setFiltroObra(e.target.value)} style={estiloFiltro}>
              <option value="todas">Todas las obras</option>
              {obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
            </select>
            <select value={filtroProveedor} onChange={(e) => setFiltroProveedor(e.target.value)} style={estiloFiltro}>
              <option value="todos">Todos los proveedores</option>
              {proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={filtroPago} onChange={(e) => setFiltroPago(e.target.value as typeof filtroPago)} style={estiloFiltro}>
              <option value="todos">Pagadas e impagas</option>
              <option value="impagas">🔴 Solo impagas (todas)</option>
              <option value="pagadas">Solo pagadas</option>
            </select>
            {hayFiltros && <button type="button" className="editButton" onClick={limpiarFiltros}>Limpiar filtros ✕</button>}
          </div>
        </div>
        {hayFiltros && filtrados.length > 0 && <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--mova-muted)' }}>{filtrados.length} compra{filtrados.length === 1 ? '' : 's'} · <strong>{moneda(totalFiltrado)}</strong></p>}

        {/* ---- Tabla ---- */}
        <div className="gestionTabla"><table><thead><tr><th>Fecha</th><th>Material</th><th>Obra</th><th>Cantidad</th><th>Precio unitario</th><th>Subtotal</th><th>Proveedor</th><th>Pago</th><th>Comprobante</th><th>Acción</th></tr></thead><tbody>
          {filtrados.length === 0 ? <tr><td colSpan={10}>{materiales.length === 0 ? 'Todavía no hay compras cargadas.' : hayFiltros ? 'No hay compras con esos filtros.' : 'No hay compras en este período.'}</td></tr> : filtrados.map((material) => {
            const vencida = estaVencida(material)
            return <tr key={material.id} style={vencida ? { background: '#fdf1f0' } : undefined}>
              <td>{fechaCorta(material.fecha)}</td>
              <td><strong>{material.nombre}</strong></td>
              <td>{nombreObra(material.obra_id)}</td>
              <td>{material.cantidad} {material.unidad}</td>
              <td>{moneda(material.precio_unitario)}</td>
              <td><strong>{moneda(subtotal(material))}</strong></td>
              <td>{material.proveedor || '—'}</td>
              <td>
                <button type="button" className={`crmBadge ${material.pagado ? 'est-aceptado' : 'est-rechazado'}`} style={{ border: 0, cursor: 'pointer' }} disabled={trabajando !== null} onClick={() => void togglePagado(material)} title="Tocá para cambiar el estado de pago">
                  {material.pagado ? 'Pagado' : 'Impago'}
                </button>
                {!material.pagado && material.fecha_vencimiento && (
                  <small style={{ display: 'block', marginTop: 3, color: vencida ? ROJO : 'var(--mova-muted)', fontWeight: vencida ? 700 : undefined }}>
                    {vencida ? 'Venció' : 'Vence'} {fechaCorta(material.fecha_vencimiento)}
                  </small>
                )}
              </td>
              <td>
                {material.comprobante_url
                  ? <a className="comprobanteEnlace" href={material.comprobante_url} target="_blank" rel="noreferrer">Ver archivo</a>
                  : <label className="editButton" style={{ display: 'inline-block', cursor: trabajando ? 'wait' : 'pointer', padding: '3px 10px', whiteSpace: 'nowrap' }}>
                      {trabajando === `adj-${material.id}` ? 'Subiendo...' : '📎 Adjuntar'}
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" style={{ display: 'none' }} disabled={trabajando !== null} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void adjuntar(material, f) }} />
                    </label>}
              </td>
              <td><button className="editButton" onClick={() => { setCompraEditando(material); setMostrarFormulario(true) }}>Editar</button></td>
            </tr>
          })}
        </tbody></table></div>
        <p className="gestionAyuda">Cada compra se suma como costo de su obra (se ve en Movimientos y en la rentabilidad de la obra). Tocá <strong>Impago / Pagado</strong> para cambiar el estado, y <strong>📎 Adjuntar</strong> para subir la factura o ticket sin abrir la compra.</p>
      </>}

      {pestana === 'comprobantes' && (
        resumen.conComprobante.length === 0 ? <div className="empty comprasVacio"><span>🧾</span><h3>No hay comprobantes en este período</h3><p>Podés adjuntar una foto o PDF al registrar una compra, o con 📎 Adjuntar en la lista.</p></div> : <div className="comprobantesGrid">{resumen.conComprobante.map((material) => {
          const esPdf = material.comprobante_path?.toLowerCase().endsWith('.pdf')
          return <a key={material.id} href={material.comprobante_url ?? '#'} target="_blank" rel="noreferrer" className="comprobanteCard">
            <div className="comprobanteVista">{esPdf ? <span>PDF</span> : material.comprobante_url ? <img src={material.comprobante_url} alt={`Comprobante de ${material.proveedor || material.nombre}`} /> : <span>🧾</span>}</div>
            <div className="comprobanteInfo"><strong>{material.proveedor || SIN_PROVEEDOR}</strong><span>{material.numero_comprobante || 'Sin número'} · {fechaCorta(material.fecha)}</span><small>{nombreObra(material.obra_id)}</small><b>{moneda(subtotal(material))}</b></div>
          </a>
        })}</div>
      )}
    </>}

    {mostrarFormulario && <FormularioCompra obras={obras} proveedores={proveedores.filter((p) => p !== SIN_PROVEEDOR)} compra={compraEditando} onCancelar={() => { setMostrarFormulario(false); setCompraEditando(null) }} onGuardado={() => { setMostrarFormulario(false); setCompraEditando(null); setActualizacion((valor) => valor + 1) }} />}
  </div>
}

function FormularioCompra({ obras, proveedores, compra, onCancelar, onGuardado }: { obras: Obra[]; proveedores: string[]; compra: Material | null; onCancelar: () => void; onGuardado: () => void }) {
  const editando = !!compra
  const [formulario, setFormulario] = useState({
    obra_id: compra ? String(compra.obra_id) : '',
    nombre: compra?.nombre ?? '',
    cantidad: compra ? String(compra.cantidad) : '1',
    unidad: compra?.unidad ?? 'unidad',
    precio_unitario: compra ? String(compra.precio_unitario) : '',
    proveedor: compra?.proveedor ?? '',
    fecha: compra?.fecha ? compra.fecha.slice(0, 10) : hoy(),
    numero_comprobante: compra?.numero_comprobante ?? '',
    pagado: compra ? (compra.pagado ? 'si' : 'no') : 'si',
    fecha_vencimiento: compra?.fecha_vencimiento ? compra.fecha_vencimiento.slice(0, 10) : '',
  })
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const archivoRef = useRef<HTMLInputElement>(null)
  const actualizar = (campo: string, valor: string) => setFormulario((actual) => ({ ...actual, [campo]: valor }))
  const total = Number(formulario.cantidad || 0) * Number(formulario.precio_unitario || 0)

  async function guardar(evento: FormEvent) {
    evento.preventDefault(); setGuardando(true); setError('')
    const datos = {
      obra_id: Number(formulario.obra_id), nombre: formulario.nombre.trim(), cantidad: Number(formulario.cantidad), unidad: formulario.unidad.trim() || null, precio_unitario: Number(formulario.precio_unitario), proveedor: formulario.proveedor.trim() || null, fecha: formulario.fecha, numero_comprobante: formulario.numero_comprobante.trim() || null,
      pagado: formulario.pagado === 'si', fecha_vencimiento: formulario.pagado === 'no' ? (formulario.fecha_vencimiento || null) : null,
    }
    let materialId = compra?.id ?? 0
    if (editando) {
      const { error: errorUpdate } = await supabase.from('materiales').update(datos).eq('id', compra!.id)
      if (errorUpdate) { console.error(errorUpdate); setError('No se pudo actualizar la compra.'); setGuardando(false); return }
    } else {
      const { data: material, error: errorMaterial } = await supabase.from('materiales').insert(datos).select('id').single()
      if (errorMaterial || !material) { console.error(errorMaterial); setError('No se pudo guardar la compra.'); setGuardando(false); return }
      materialId = material.id
    }

    if (archivo) {
      const extension = archivo.name.split('.').pop()?.toLowerCase() || 'archivo'
      const nombreSeguro = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
      const ruta = `${formulario.obra_id}/${materialId}-${Date.now()}-${nombreSeguro || `comprobante.${extension}`}`
      const { error: errorArchivo } = await supabase.storage.from('comprobantes').upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (errorArchivo) { console.error(errorArchivo); setError('La compra se guardó, pero no se pudo subir el comprobante.'); setGuardando(false); return }

      const { error: errorRuta } = await supabase.from('materiales').update({ comprobante_path: ruta }).eq('id', materialId)
      if (errorRuta) {
        console.error(errorRuta)
        await supabase.storage.from('comprobantes').remove([ruta])
        setError('La compra se guardó, pero no se pudo vincular el comprobante.')
        setGuardando(false)
        return
      }
    }
    onGuardado()
  }

  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">{editando ? 'EDITAR COMPRA' : 'NUEVA COMPRA'}</p><h2>{editando ? 'Editar compra' : 'Registrar compra'}</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div><form className="clienteForm" onSubmit={guardar}><div className="formGrid">
    <label>Obra *<select required value={formulario.obra_id} onChange={(e) => actualizar('obra_id', e.target.value)}><option value="">Seleccionar obra</option>{obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.nombre_obra}</option>)}</select></label>
    <label>Material *<input required value={formulario.nombre} onChange={(e) => actualizar('nombre', e.target.value)} placeholder="Ej.: Cable UTP Cat 6" /></label>
    <label>Cantidad *<input type="number" min="0.01" step="0.01" required value={formulario.cantidad} onChange={(e) => actualizar('cantidad', e.target.value)} /></label>
    <label>Unidad<input value={formulario.unidad} onChange={(e) => actualizar('unidad', e.target.value)} placeholder="unidad, metro, caja..." /></label>
    <label>Precio unitario *<input type="number" min="0" step="0.01" required value={formulario.precio_unitario} onChange={(e) => actualizar('precio_unitario', e.target.value)} /></label>
    <label>Proveedor<input list="proveedores-cargados" value={formulario.proveedor} onChange={(e) => actualizar('proveedor', e.target.value)} placeholder="Escribí o elegí uno ya cargado" /><datalist id="proveedores-cargados">{proveedores.map((p) => <option key={p} value={p} />)}</datalist></label>
    <label>Fecha *<input type="date" required value={formulario.fecha} onChange={(e) => actualizar('fecha', e.target.value)} /></label>
    <label>Número de comprobante<input value={formulario.numero_comprobante} onChange={(e) => actualizar('numero_comprobante', e.target.value)} /></label>
    <label>¿Está pagada?<select value={formulario.pagado} onChange={(e) => actualizar('pagado', e.target.value)}><option value="si">Sí, ya pagada</option><option value="no">No, queda por pagar</option></select></label>
    {formulario.pagado === 'no' && <label>Vence el<input type="date" value={formulario.fecha_vencimiento} onChange={(e) => actualizar('fecha_vencimiento', e.target.value)} /></label>}
    <label className="formFull">{editando ? 'Reemplazar factura o ticket (opcional)' : 'Factura o ticket (opcional)'}<input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></label>
  </div><p className="compraSubtotal">Costo que se {editando ? 'actualizará' : 'sumará'} a la obra: <strong>{moneda(total)}</strong></p>{error && <p className="loginError">{error}</p>}<div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Guardar compra'}</button></div></form></div></div>
}

export default Compras
