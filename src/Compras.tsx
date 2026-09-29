import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { fechaCorta, moneda, hoy } from './gestionFormat'
import { confirmarEliminacion } from './confirmar'

// Compras de materiales por obra.
// Arriba cuatro números que filtran; abajo pestañas: la lista en tarjetas
// agrupadas por fecha, a quién le debés, análisis y la galería de comprobantes.
// Cada compra suma como costo de su obra (Movimientos y Rentabilidad).

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
type Pestana = 'lista' | 'deudas' | 'analisis' | 'comprobantes'
type FiltroEstado = 'todas' | 'impagas' | 'pagadas' | 'sin_comprobante'

// ---- Período ----
type Periodo = 'mes' | '3' | '6' | 'anio' | 'todo' | 'custom'
const PERIODOS: [Periodo, string][] = [['mes', 'Este mes'], ['3', 'Últimos 3 meses'], ['6', 'Últimos 6 meses'], ['anio', 'Este año'], ['todo', 'Todo'], ['custom', 'Elegir meses…']]
const mesActual = () => new Date().toISOString().slice(0, 7)
const sumarMeses = (ym: string, n: number) => {
  const [anio, mes] = ym.split('-').map(Number)
  const d = new Date(anio, mes - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const nombreMes = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
const nombreMesCorto = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')
const fechaLarga = (f: string) => new Date(`${f.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'long' })
const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const subtotal = (m: Material) => m.cantidad * m.precio_unitario
const estaVencida = (m: Material) => !m.pagado && !!m.fecha_vencimiento && m.fecha_vencimiento.slice(0, 10) < hoy()
const SIN_PROVEEDOR = 'Proveedor no informado'
const esPdf = (ruta: string | null) => !!ruta && ruta.toLowerCase().endsWith('.pdf')

// Abre un comprobante (el enlace se genera recién al tocarlo).
async function abrirComprobante(ruta: string) {
  const ventana = window.open('', '_blank')
  const { data, error } = await supabase.storage.from('comprobantes').createSignedUrl(ruta, 600)
  if (error || !data?.signedUrl) { ventana?.close(); window.alert('No se pudo abrir el comprobante.'); return }
  if (ventana) ventana.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}

function Compras() {
  const [obras, setObras] = useState<Obra[]>([])
  const [materiales, setMateriales] = useState<Material[]>([])
  const [pestana, setPestana] = useState<Pestana>('lista')
  const [formulario, setFormulario] = useState<{ compra: Material | null } | null>(null)
  const [actualizacion, setActualizacion] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [abiertoProv, setAbiertoProv] = useState<string | null>(null)

  // Filtros
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [desdeSel, setDesdeSel] = useState(mesActual())
  const [hastaSel, setHastaSel] = useState(mesActual())
  const [busqueda, setBusqueda] = useState('')
  const [filtroObra, setFiltroObra] = useState('todas')
  const [filtroProveedor, setFiltroProveedor] = useState('todos')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todas')

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      const [rObras, rMateriales] = await Promise.all([
        supabase.from('obras').select('id, nombre_obra').eq('activo', true).order('nombre_obra'),
        supabase.from('materiales').select('id, obra_id, nombre, cantidad, unidad, precio_unitario, proveedor, fecha, numero_comprobante, comprobante_path, pagado, fecha_vencimiento').order('fecha', { ascending: false }).order('created_at', { ascending: false }),
      ])
      if (!vigente) return
      if (rObras.error || rMateriales.error) {
        console.error(rObras.error || rMateriales.error)
        setError('No se pudieron cargar las compras.')
        setCargando(false)
        return
      }
      setObras((rObras.data ?? []) as Obra[])
      setMateriales((rMateriales.data ?? []).map((m) => ({ ...m, cantidad: Number(m.cantidad), precio_unitario: Number(m.precio_unitario) })) as Material[])
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
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
    const etiqueta = periodo === 'todo' ? 'todas las compras'
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
    const porProveedor: Record<string, { proveedor: string; compras: Material[]; total: number; vencidas: number; proximoVence: string | null }> = {}
    impagas.forEach((m) => {
      const p = proveedorDe(m)
      const g = (porProveedor[p] ??= { proveedor: p, compras: [], total: 0, vencidas: 0, proximoVence: null })
      g.compras.push(m)
      g.total += subtotal(m)
      if (estaVencida(m)) g.vencidas++
      const vence = m.fecha_vencimiento?.slice(0, 10) ?? null
      if (vence && (!g.proximoVence || vence < g.proximoVence)) g.proximoVence = vence
    })
    return {
      grupos: Object.values(porProveedor).sort((a, b) => b.vencidas - a.vencidas || b.total - a.total),
      total: impagas.reduce((s, m) => s + subtotal(m), 0),
      vencidas: impagas.filter(estaVencida).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materiales])

  // ---- Totales y análisis del período ----
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
      porProveedor: ordenar(porProveedor).slice(0, 6),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delPeriodo, obras])

  // Últimos 6 meses (independiente del período elegido), para ver la tendencia.
  const porMes = useMemo(() => {
    const hoyYm = mesActual()
    return Array.from({ length: 6 }, (_, i) => sumarMeses(hoyYm, i - 5)).map((ym) => ({
      ym, total: materiales.filter((m) => m.fecha?.slice(0, 7) === ym).reduce((s, m) => s + subtotal(m), 0),
    }))
  }, [materiales])

  const proveedores = useMemo(() => Array.from(new Set<string>(materiales.map(proveedorDe))).sort((a, b) => a.localeCompare(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [materiales])

  // Las impagas se muestran todas (aunque sean de otro período), para que ninguna deuda quede escondida.
  const filtrados = useMemo(() => {
    const texto = normalizar(busqueda.trim())
    const base = filtroEstado === 'impagas' ? materiales.filter((m) => !m.pagado) : delPeriodo
    return base.filter((m) => {
      if (filtroEstado === 'pagadas' && !m.pagado) return false
      if (filtroEstado === 'sin_comprobante' && m.comprobante_path) return false
      if (filtroObra !== 'todas' && m.obra_id !== Number(filtroObra)) return false
      if (filtroProveedor !== 'todos' && proveedorDe(m) !== filtroProveedor) return false
      if (texto && !normalizar(`${m.nombre} ${proveedorDe(m)} ${nombreObra(m.obra_id)} ${m.numero_comprobante ?? ''}`).includes(texto)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materiales, delPeriodo, busqueda, filtroObra, filtroProveedor, filtroEstado, obras])

  // Agrupadas por fecha.
  const porFecha = useMemo(() => {
    const g: { fecha: string; items: Material[]; total: number }[] = []
    for (const m of filtrados) {
      const f = m.fecha.slice(0, 10)
      let grupo = g.find((x) => x.fecha === f)
      if (!grupo) { grupo = { fecha: f, items: [], total: 0 }; g.push(grupo) }
      grupo.items.push(m)
      grupo.total += subtotal(m)
    }
    return g
  }, [filtrados])

  const hayFiltros = busqueda.trim() !== '' || filtroObra !== 'todas' || filtroProveedor !== 'todos' || filtroEstado !== 'todas'
  const totalFiltrado = filtrados.reduce((s, m) => s + subtotal(m), 0)
  function limpiarFiltros() { setBusqueda(''); setFiltroObra('todas'); setFiltroProveedor('todos'); setFiltroEstado('todas') }
  function verLista(estado: FiltroEstado) { limpiarFiltros(); setFiltroEstado(estado); setPestana('lista') }

  async function togglePagado(m: Material) {
    setTrabajando(`pago-${m.id}`)
    const { error: err } = await supabase.from('materiales').update({ pagado: !m.pagado }).eq('id', m.id)
    setTrabajando(null)
    if (err) { console.error(err); window.alert('No se pudo actualizar el estado de pago.'); return }
    setMateriales((arr) => arr.map((x) => (x.id === m.id ? { ...x, pagado: !x.pagado } : x)))
  }

  async function marcarPagadas(proveedor: string, compras: Material[]) {
    const total = compras.reduce((s, m) => s + subtotal(m), 0)
    if (!window.confirm(`¿Marcar como pagadas las ${compras.length} compras a ${proveedor} por ${moneda(total)}?`)) return
    setTrabajando(`prov-${proveedor}`)
    const ids = compras.map((m) => m.id)
    const { error: err } = await supabase.from('materiales').update({ pagado: true }).in('id', ids)
    setTrabajando(null)
    if (err) { console.error(err); window.alert('No se pudieron marcar como pagadas.'); return }
    setMateriales((arr) => arr.map((x) => (ids.includes(x.id) ? { ...x, pagado: true } : x)))
  }

  async function eliminar(m: Material) {
    if (!confirmarEliminacion(`¿Eliminar la compra "${m.nombre}" (${moneda(subtotal(m))}) de ${nombreObra(m.obra_id)}?\n\nTambién deja de sumar como costo de la obra.`)) return
    setTrabajando(`del-${m.id}`)
    const { error: err } = await supabase.from('materiales').delete().eq('id', m.id)
    if (err) { console.error(err); setTrabajando(null); window.alert('No se pudo eliminar la compra.'); return }
    // El archivo se borra solo si ninguna otra compra (del mismo ticket) lo usa.
    if (m.comprobante_path && !materiales.some((x) => x.id !== m.id && x.comprobante_path === m.comprobante_path)) {
      await supabase.storage.from('comprobantes').remove([m.comprobante_path])
    }
    setTrabajando(null)
    setMateriales((arr) => arr.filter((x) => x.id !== m.id))
  }

  // Adjuntar comprobante directo desde la tarjeta.
  async function adjuntar(m: Material, archivo: File) {
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
    setMateriales((arr) => arr.map((x) => (x.id === m.id ? { ...x, comprobante_path: ruta } : x)))
  }

  const barra = (etiqueta: string, monto: number, max: number, color: string, extra?: string) => (
    <div key={etiqueta} className="cpBarra">
      <span title={etiqueta}>{etiqueta}</span>
      <div className="tabBar"><span style={{ width: `${max > 0 ? (monto / max) * 100 : 0}%`, background: color }} /></div>
      <b>{moneda(monto)}{extra && <small> {extra}</small>}</b>
    </div>
  )

  const tarjeta = (m: Material) => {
    const vencida = estaVencida(m)
    return (
      <article key={m.id} className={`cpCompra ${m.pagado ? '' : 'impaga'} ${vencida ? 'vencida' : ''}`}>
        <div className="cpCompraInfo">
          <strong>{m.nombre}</strong>
          <small>{m.cantidad.toLocaleString('es-AR')} {m.unidad || 'u.'} × {moneda(m.precio_unitario)}</small>
          <div className="cpChips">
            <span className="cpChip obra">🏗 {nombreObra(m.obra_id)}</span>
            <span className="cpChip">🏪 {proveedorDe(m)}</span>
            {m.numero_comprobante && <span className="cpChip">N° {m.numero_comprobante}</span>}
          </div>
        </div>
        <div className="cpCompraLado">
          <b className="cpMonto">{moneda(subtotal(m))}</b>
          <div className="cpFila">
          <button type="button" className={`cpEstado ${m.pagado ? 'ok' : vencida ? 'venc' : 'pend'}`} disabled={trabajando !== null} onClick={() => void togglePagado(m)} title="Tocá para cambiar el estado de pago">
            {m.pagado ? '✓ Pagada' : vencida ? `Venció ${fechaCorta(m.fecha_vencimiento)}` : m.fecha_vencimiento ? `Impaga · vence ${fechaCorta(m.fecha_vencimiento)}` : 'Impaga'}
          </button>
          <div className="cpAcciones">
            {m.comprobante_path
              ? <button type="button" className="agBtn" title="Ver comprobante" onClick={() => void abrirComprobante(m.comprobante_path!)}>🧾</button>
              : <label className="agBtn cpAdjuntar" title="Adjuntar factura o ticket">
                  {trabajando === `adj-${m.id}` ? '…' : '📎'}
                  <input type="file" accept="image/*,application/pdf" disabled={trabajando !== null} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void adjuntar(m, f) }} />
                </label>}
            <button type="button" className="agBtn" title="Editar" onClick={() => setFormulario({ compra: m })}>✏️</button>
            <button type="button" className="agBtn peligro" title="Eliminar" disabled={trabajando !== null} onClick={() => void eliminar(m)}>🗑</button>
          </div>
          </div>
        </div>
      </article>
    )
  }

  const maxMes = Math.max(1, ...porMes.map((p) => p.total))

  return <div className="gestionPage compras">
    <div className="pageHeader cpHead">
      <div><p className="subtitle">COMPRAS Y MATERIALES</p><h2>Compras</h2><p className="welcome">Materiales, proveedores y comprobantes de cada obra</p></div>
      <button className="newButton" onClick={() => setFormulario({ compra: null })}>+ Registrar compra</button>
    </div>

    {/* ---- Período, compacto ---- */}
    <div className="cpPeriodo">
      <label>📅
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)} aria-label="Período">
          {PERIODOS.map(([clave, texto]) => <option key={clave} value={clave}>{texto}</option>)}
        </select>
      </label>
      {periodo === 'custom' && <>
        <input type="month" value={desdeSel} max={mesActual()} onChange={(e) => e.target.value && setDesdeSel(e.target.value)} aria-label="Desde" />
        <span>a</span>
        <input type="month" value={hastaSel} max={mesActual()} onChange={(e) => e.target.value && setHastaSel(e.target.value)} aria-label="Hasta" />
      </>}
      <small>Viendo {rango.etiqueta}</small>
    </div>

    {cargando && <p>Cargando compras...</p>}
    {error && <p className="loginError">{error}</p>}

    {!cargando && !error && <>
      {/* ---- Números clave (tocarlos filtra) ---- */}
      <div className="cpKpis">
        <button type="button" className={pestana === 'lista' && !hayFiltros ? 'activo' : ''} onClick={() => verLista('todas')}>
          <span>Compras del período</span><strong>{moneda(resumen.total)}</strong><small>{delPeriodo.length} compra{delPeriodo.length === 1 ? '' : 's'}</small>
        </button>
        <button type="button" className={pestana === 'deudas' ? 'activo' : ''} onClick={() => setPestana('deudas')}>
          <span>Por pagar</span><strong style={{ color: deudas.total > 0 ? '#b23b32' : undefined }}>{moneda(deudas.total)}</strong>
          <small>{deudas.vencidas > 0 ? <b style={{ color: '#b23b32' }}>{deudas.vencidas} vencida{deudas.vencidas === 1 ? '' : 's'}</b> : `${deudas.grupos.length} proveedor${deudas.grupos.length === 1 ? '' : 'es'}`}</small>
        </button>
        <button type="button" className={filtroEstado === 'sin_comprobante' && pestana === 'lista' ? 'activo' : ''} onClick={() => verLista('sin_comprobante')}>
          <span>Sin comprobante</span><strong style={{ color: resumen.sinComprobante > 0 ? '#b86608' : undefined }}>{resumen.sinComprobante}</strong>
          <small>{resumen.sinComprobante > 0 ? `${moneda(resumen.sinComprobanteMonto)} sin factura` : 'Todas con factura'}</small>
        </button>
        <button type="button" className={pestana === 'comprobantes' ? 'activo' : ''} onClick={() => setPestana('comprobantes')}>
          <span>Comprobantes</span><strong>{resumen.conComprobante.length}</strong><small>Facturas y tickets</small>
        </button>
      </div>

      <div className="gestionTabs homeTabs">
        <button className={pestana === 'lista' ? 'active' : ''} onClick={() => setPestana('lista')}>🧾 Compras</button>
        <button className={pestana === 'deudas' ? 'active' : ''} onClick={() => setPestana('deudas')}>🔴 Por pagar{deudas.grupos.length ? ` (${deudas.grupos.length})` : ''}</button>
        <button className={pestana === 'analisis' ? 'active' : ''} onClick={() => setPestana('analisis')}>📊 Análisis</button>
        <button className={pestana === 'comprobantes' ? 'active' : ''} onClick={() => setPestana('comprobantes')}>📎 Comprobantes</button>
      </div>

      {/* ---- Lista ---- */}
      {pestana === 'lista' && <>
        <div className="cpFiltros">
          <input type="search" placeholder="🔍 Buscar material, proveedor, obra o N°…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <select value={filtroObra} onChange={(e) => setFiltroObra(e.target.value)} aria-label="Obra">
            <option value="todas">Todas las obras</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
          </select>
          <select value={filtroProveedor} onChange={(e) => setFiltroProveedor(e.target.value)} aria-label="Proveedor">
            <option value="todos">Todos los proveedores</option>
            {proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="caChips cpEstados">
          {([['todas', 'Todas'], ['impagas', '🔴 Impagas'], ['pagadas', '✓ Pagadas'], ['sin_comprobante', '⚠ Sin comprobante']] as [FiltroEstado, string][]).map(([v, t]) => (
            <button key={v} type="button" className={filtroEstado === v ? 'activo' : ''} onClick={() => setFiltroEstado(v)}>{t}</button>
          ))}
          {hayFiltros && <button type="button" className="cpLimpiar" onClick={limpiarFiltros}>Limpiar ✕</button>}
        </div>
        {filtroEstado === 'impagas' && <p className="gestionAyuda" style={{ margin: '0 0 8px' }}>Se muestran todas las impagas, sin importar el período.</p>}
        {filtrados.length > 0 && <p className="cpTotalFiltro">{filtrados.length} compra{filtrados.length === 1 ? '' : 's'} · <strong>{moneda(totalFiltrado)}</strong></p>}

        {porFecha.length === 0
          ? <div className="agVacio cpVacio">{materiales.length === 0 ? 'Todavía no hay compras cargadas.' : hayFiltros ? 'No hay compras con esos filtros.' : `No hay compras en ${rango.etiqueta}.`} <button type="button" className="caLink" onClick={() => setFormulario({ compra: null })}>+ Registrar compra</button></div>
          : porFecha.map((g) => (
            <section key={g.fecha} className="cpDia">
              <div className="cpDiaHead"><span>{fechaLarga(g.fecha)}</span><b>{moneda(g.total)}</b></div>
              {g.items.map(tarjeta)}
            </section>
          ))}
        <p className="gestionAyuda">Cada compra suma como costo de su obra (Movimientos y Rentabilidad). Tocá el estado para pasarla de <strong>Impaga</strong> a <strong>Pagada</strong>, 📎 para subir la factura y 🧾 para verla.</p>
      </>}

      {/* ---- Por pagar ---- */}
      {pestana === 'deudas' && (
        deudas.grupos.length === 0
          ? <div className="empty comprasVacio"><span>✓</span><h3>No le debés nada a ningún proveedor</h3><p>Todas las compras están pagadas.</p></div>
          : <div className="cpDeudas">
            {deudas.grupos.map((g) => {
              const abierto = abiertoProv === g.proveedor
              return (
                <article key={g.proveedor} className={`cpProv ${g.vencidas > 0 ? 'vencida' : ''}`}>
                  <button type="button" className="cpProvHead" onClick={() => setAbiertoProv(abierto ? null : g.proveedor)} aria-expanded={abierto}>
                    <div>
                      <strong>🏪 {g.proveedor}</strong>
                      <small>
                        {g.compras.length} compra{g.compras.length === 1 ? '' : 's'} ·{' '}
                        {g.vencidas > 0 ? <b style={{ color: '#b23b32' }}>{g.vencidas} vencida{g.vencidas === 1 ? '' : 's'}</b> : g.proximoVence ? `vence ${fechaCorta(g.proximoVence)}` : 'sin fecha de vencimiento'}
                      </small>
                    </div>
                    <b className="cpMonto">{moneda(g.total)}</b>
                    <span className="homeChevron" style={{ transform: abierto ? 'rotate(90deg)' : undefined }}>›</span>
                  </button>
                  {abierto && <div className="cpProvCuerpo">{g.compras.map(tarjeta)}</div>}
                  <div className="cpProvPie">
                    <button type="button" className="newButton" disabled={trabajando !== null} onClick={() => void marcarPagadas(g.proveedor, g.compras)}>
                      {trabajando === `prov-${g.proveedor}` ? 'Guardando...' : `✓ Marcar todo pagado`}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
      )}

      {/* ---- Análisis ---- */}
      {pestana === 'analisis' && (
        <div className="cpAnalisis">
          <section>
            <h4>Últimos 6 meses</h4>
            <div className="cpMeses">
              {porMes.map((p) => (
                <div key={p.ym} className="cpMes" title={`${nombreMes(p.ym)}: ${moneda(p.total)}`}>
                  <small>{p.total > 0 ? moneda(p.total).replace(/,00$/, '') : ''}</small>
                  <div><span style={{ height: `${(p.total / maxMes) * 100}%` }} /></div>
                  <b>{nombreMesCorto(p.ym)}</b>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h4>En qué obra se va el material <small>· {rango.etiqueta}</small></h4>
            {resumen.porObra.length === 0 ? <p className="gestionAyuda">Sin compras en el período.</p>
              : resumen.porObra.map(([obra, monto]) => barra(obra, monto, resumen.porObra[0][1], '#2f6fb3', resumen.total > 0 ? `${Math.round((monto / resumen.total) * 100)}%` : undefined))}
          </section>
          <section>
            <h4>Proveedores a los que más les comprás <small>· {rango.etiqueta}</small></h4>
            {resumen.porProveedor.length === 0 ? <p className="gestionAyuda">Sin compras en el período.</p>
              : resumen.porProveedor.map(([prov, monto]) => barra(prov, monto, resumen.porProveedor[0][1], '#b86608'))}
          </section>
        </div>
      )}

      {/* ---- Comprobantes ---- */}
      {pestana === 'comprobantes' && <Galeria compras={resumen.conComprobante} nombreObra={nombreObra} etiqueta={rango.etiqueta} />}
    </>}

    {formulario && <FormularioCompra obras={obras} proveedores={proveedores.filter((p) => p !== SIN_PROVEEDOR)} compra={formulario.compra} onCancelar={() => setFormulario(null)} onGuardado={() => { setFormulario(null); setActualizacion((valor) => valor + 1) }} />}
  </div>
}

// ---------- Galería de comprobantes (los enlaces se piden al abrir la pestaña) ----------
function Galeria({ compras, nombreObra, etiqueta }: { compras: Material[]; nombreObra: (id: number) => string; etiqueta: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const rutas = Array.from(new Set(compras.map((m) => m.comprobante_path).filter((r): r is string => !!r && !esPdf(r))))
    if (!rutas.length) return
    let vigente = true
    void supabase.storage.from('comprobantes').createSignedUrls(rutas, 3600).then(({ data }) => {
      if (!vigente || !data) return
      const mapa: Record<string, string> = {}
      data.forEach((d) => { if (d.path && d.signedUrl) mapa[d.path] = d.signedUrl })
      setUrls(mapa)
    })
    return () => { vigente = false }
  }, [compras])

  if (compras.length === 0) return <div className="empty comprasVacio"><span>🧾</span><h3>No hay comprobantes en {etiqueta}</h3><p>Adjuntá una foto o PDF al registrar una compra, o con 📎 en la lista.</p></div>
  return <div className="comprobantesGrid">{compras.map((m) => (
    <button type="button" key={m.id} className="comprobanteCard" onClick={() => void abrirComprobante(m.comprobante_path!)}>
      <div className="comprobanteVista">{esPdf(m.comprobante_path) ? <span>PDF</span> : urls[m.comprobante_path!] ? <img src={urls[m.comprobante_path!]} alt={`Comprobante de ${m.proveedor || m.nombre}`} /> : <span>🧾</span>}</div>
      <div className="comprobanteInfo"><strong>{m.proveedor || SIN_PROVEEDOR}</strong><span>{m.numero_comprobante || 'Sin número'} · {fechaCorta(m.fecha)}</span><small>{m.nombre} · {nombreObra(m.obra_id)}</small><b>{moneda(subtotal(m))}</b></div>
    </button>
  ))}</div>
}

// ---------- Formulario: un ticket con uno o varios ítems ----------
type ItemCompra = { nombre: string; cantidad: string; unidad: string; precio_unitario: string }
const itemVacio = (): ItemCompra => ({ nombre: '', cantidad: '1', unidad: 'unidad', precio_unitario: '' })

function FormularioCompra({ obras, proveedores, compra, onCancelar, onGuardado }: { obras: Obra[]; proveedores: string[]; compra: Material | null; onCancelar: () => void; onGuardado: () => void }) {
  const editando = !!compra
  const [datos, setDatos] = useState({
    obra_id: compra ? String(compra.obra_id) : '',
    proveedor: compra?.proveedor ?? '',
    fecha: compra?.fecha ? compra.fecha.slice(0, 10) : hoy(),
    numero_comprobante: compra?.numero_comprobante ?? '',
    pagado: compra ? compra.pagado : true,
    fecha_vencimiento: compra?.fecha_vencimiento ? compra.fecha_vencimiento.slice(0, 10) : '',
  })
  const [items, setItems] = useState<ItemCompra[]>(compra
    ? [{ nombre: compra.nombre, cantidad: String(compra.cantidad), unidad: compra.unidad ?? '', precio_unitario: String(compra.precio_unitario) }]
    : [itemVacio()])
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (campo: string, valor: string | boolean) => setDatos((a) => ({ ...a, [campo]: valor }))
  const setItem = (i: number, campo: keyof ItemCompra, valor: string) => setItems((arr) => arr.map((it, k) => (k === i ? { ...it, [campo]: valor } : it)))
  const total = items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0)

  async function guardar(evento: FormEvent) {
    evento.preventDefault(); setError('')
    if (!datos.obra_id) { setError('Elegí la obra.'); return }
    const validos = items.filter((it) => it.nombre.trim())
    if (!validos.length) { setError('Cargá al menos un material.'); return }
    if (validos.some((it) => !(Number(it.cantidad) > 0) || it.precio_unitario === '' || Number(it.precio_unitario) < 0)) { setError('Revisá cantidad y precio de cada material.'); return }
    setGuardando(true)
    const comunes = {
      obra_id: Number(datos.obra_id), proveedor: datos.proveedor.trim() || null, fecha: datos.fecha,
      numero_comprobante: datos.numero_comprobante.trim() || null,
      pagado: datos.pagado, fecha_vencimiento: datos.pagado ? null : (datos.fecha_vencimiento || null),
    }
    const filas = validos.map((it) => ({ ...comunes, nombre: it.nombre.trim(), cantidad: Number(it.cantidad), unidad: it.unidad.trim() || null, precio_unitario: Number(it.precio_unitario) }))

    let ids: number[] = []
    if (editando) {
      const { error: e1 } = await supabase.from('materiales').update(filas[0]).eq('id', compra!.id)
      if (e1) { console.error(e1); setError('No se pudo actualizar la compra.'); setGuardando(false); return }
      ids = [compra!.id]
    } else {
      const { data, error: e2 } = await supabase.from('materiales').insert(filas).select('id')
      if (e2 || !data) { console.error(e2); setError('No se pudo guardar la compra.'); setGuardando(false); return }
      ids = data.map((d) => d.id as number)
    }

    // Un solo archivo para todo el ticket: queda vinculado a cada ítem.
    if (archivo) {
      const nombreSeguro = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase() || 'comprobante'
      const ruta = `${datos.obra_id}/${ids[0]}-${Date.now()}-${nombreSeguro}`
      const { error: e3 } = await supabase.storage.from('comprobantes').upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (e3) { console.error(e3); setError('La compra se guardó, pero no se pudo subir el comprobante. Adjuntalo después con 📎.'); setGuardando(false); return }
      const { error: e4 } = await supabase.from('materiales').update({ comprobante_path: ruta }).in('id', ids)
      if (e4) {
        console.error(e4)
        await supabase.storage.from('comprobantes').remove([ruta])
        setError('La compra se guardó, pero no se pudo vincular el comprobante.')
        setGuardando(false)
        return
      }
    }
    onGuardado()
  }

  return <div className="modalOverlay"><div className="modalCard cpModal"><div className="modalHeader"><div><p className="subtitle">{editando ? 'EDITAR COMPRA' : 'NUEVA COMPRA'}</p><h2>{editando ? 'Editar compra' : 'Registrar compra'}</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}>
      <div className="formGrid">
        <label>Obra *<select required value={datos.obra_id} onChange={(e) => set('obra_id', e.target.value)}><option value="">Seleccionar obra</option>{obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.nombre_obra}</option>)}</select></label>
        <label>Proveedor<input list="proveedores-cargados" value={datos.proveedor} onChange={(e) => set('proveedor', e.target.value)} placeholder="Escribí o elegí uno ya cargado" /><datalist id="proveedores-cargados">{proveedores.map((p) => <option key={p} value={p} />)}</datalist></label>
        <label>Fecha *<input type="date" required value={datos.fecha} onChange={(e) => set('fecha', e.target.value)} /></label>
        <label>N° de factura o ticket<input value={datos.numero_comprobante} onChange={(e) => set('numero_comprobante', e.target.value)} /></label>
      </div>

      <div className="cpItems">
        <div className="cpItemsHead"><strong>{editando ? 'Material' : 'Materiales del ticket'}</strong>{!editando && <small>Cargá todo lo que compraste en la misma factura</small>}</div>
        {items.map((it, i) => (
          <div key={i} className="cpItem">
            <input className="cpItemNombre" value={it.nombre} onChange={(e) => setItem(i, 'nombre', e.target.value)} placeholder="Material (ej.: Cable UTP Cat 6)" aria-label="Material" />
            <input type="number" min="0.01" step="0.01" value={it.cantidad} onChange={(e) => setItem(i, 'cantidad', e.target.value)} aria-label="Cantidad" placeholder="Cant." />
            <input value={it.unidad} onChange={(e) => setItem(i, 'unidad', e.target.value)} aria-label="Unidad" placeholder="unidad" />
            <input type="number" min="0" step="0.01" value={it.precio_unitario} onChange={(e) => setItem(i, 'precio_unitario', e.target.value)} aria-label="Precio unitario" placeholder="$ unitario" />
            <b className="cpItemTotal">{moneda((Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0))}</b>
            {!editando && items.length > 1 && <button type="button" className="agBtn peligro" aria-label="Quitar material" onClick={() => setItems((arr) => arr.filter((_, k) => k !== i))}>✕</button>}
          </div>
        ))}
        {!editando && <button type="button" className="caAgregar" onClick={() => setItems((arr) => [...arr, itemVacio()])}>+ Agregar otro material</button>}
      </div>

      <div className="cpPagoFila">
        <span>¿Está pagada?</span>
        <div className="caChips">
          <button type="button" className={datos.pagado ? 'activo' : ''} onClick={() => set('pagado', true)}>✓ Sí, pagada</button>
          <button type="button" className={!datos.pagado ? 'activo' : ''} onClick={() => set('pagado', false)}>🔴 Queda por pagar</button>
        </div>
        {!datos.pagado && <label className="cpVence">Vence el<input type="date" value={datos.fecha_vencimiento} onChange={(e) => set('fecha_vencimiento', e.target.value)} /></label>}
      </div>

      <label className="cpArchivo">
        <span>{archivo ? `📎 ${archivo.name}` : editando && compra?.comprobante_path ? '📎 Reemplazar factura o ticket (opcional)' : '📷 Sacar foto o adjuntar factura / ticket (opcional)'}</span>
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
      </label>

      <p className="compraSubtotal">Costo que se {editando ? 'actualizará' : 'sumará'} a la obra: <strong>{moneda(total)}</strong></p>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : editando ? 'Guardar cambios' : `Guardar compra${items.filter((it) => it.nombre.trim()).length > 1 ? ` (${items.filter((it) => it.nombre.trim()).length} ítems)` : ''}`}</button></div>
    </form>
  </div></div>
}

export default Compras
