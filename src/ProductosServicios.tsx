import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import VistaToggle, { useVista } from './VistaToggle'

export type ProductoServicio = {
  id: number
  created_at: string
  tipo: 'producto' | 'servicio'
  nombre: string
  descripcion: string | null
  categoria: string | null
  unidad: string
  precio_venta: number
  costo_unitario: number
  stock: number
  stock_minimo: number
  proveedor: string | null
  link_compra: string | null
  iva_pct: number
  foto_url: string | null
  aplica_descuento: boolean
  descuento_pct: number
  descuento_monto: number
  activo: boolean
  fotoView?: string | null
}

type TipoFiltro = 'todos' | 'producto' | 'servicio'
type EstadoFiltro = 'activos' | 'inactivos' | 'todos'

const BUCKET = 'productos'
const TIPOS_KANBAN = [
  { v: 'producto', t: 'Productos' },
  { v: 'servicio', t: 'Servicios' },
]
const esHttp = (u: string | null | undefined) => !!u && /^https?:\/\//.test(u)

// Comprime y redimensiona la imagen antes de subirla, para ocupar el mínimo de storage.
// Reescala a máx. 1000px y exporta WebP ~0.8 (una foto de celular de ~4MB queda en ~100-200KB).
async function comprimirImagen(file: File): Promise<Blob> {
  try {
    const url = URL.createObjectURL(file)
    const img = document.createElement('img')
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('img')); img.src = url })
    const max = 1000
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
    if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r) }
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/webp', 0.8))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

function formatoDinero(valor: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(valor || 0))
}

function precioFinalUnidad(el: { precio_venta: number; aplica_descuento: boolean; descuento_pct: number; descuento_monto: number }) {
  if (!el.aplica_descuento) return el.precio_venta
  if (el.descuento_pct > 0) return Math.max(0, el.precio_venta * (1 - el.descuento_pct / 100))
  if (el.descuento_monto > 0) return Math.max(0, el.precio_venta - el.descuento_monto)
  return el.precio_venta
}

const nivelStock = (el: ProductoServicio) =>
  el.tipo !== 'producto' ? 'na' : el.stock <= 0 ? 'sin' : el.stock <= (el.stock_minimo ?? 5) ? 'bajo' : 'ok'

function ProductosServicios() {
  const [elementos, setElementos] = useState<ProductoServicio[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('todos')
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('activos')
  const [soloStockBajo, setSoloStockBajo] = useState(false)
  const [vista, setVista] = useVista('productos', 'kanban')

  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [editando, setEditando] = useState<ProductoServicio | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorFormulario, setErrorFormulario] = useState('')

  const [tipo, setTipo] = useState<'producto' | 'servicio'>('producto')
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [categoria, setCategoria] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [linkCompra, setLinkCompra] = useState('')
  const [unidad, setUnidad] = useState('unidad')
  const [precioCompra, setPrecioCompra] = useState('')
  const [gananciaPct, setGananciaPct] = useState('')
  const [precioLista, setPrecioLista] = useState('')
  const [stock, setStock] = useState('')
  const [stockMinimo, setStockMinimo] = useState('5')
  const [ivaPct, setIvaPct] = useState('21')
  const [aplicaDescuento, setAplicaDescuento] = useState(false)
  const [descuentoTipo, setDescuentoTipo] = useState<'porcentaje' | 'monto'>('porcentaje')
  const [descuentoValor, setDescuentoValor] = useState('')
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [fotoPreview, setFotoPreview] = useState('')
  const [subiendoFoto, setSubiendoFoto] = useState(false)

  useEffect(() => { cargarCatalogo() }, [])

  async function cargarCatalogo() {
    setCargando(true)
    setError('')
    const { data, error: errorConsulta } = await supabase
      .from('productos_servicios')
      .select(`id, created_at, tipo, nombre, descripcion, categoria, unidad, precio_venta, costo_unitario, stock, stock_minimo, proveedor, link_compra, iva_pct, foto_url, aplica_descuento, descuento_pct, descuento_monto, activo`)
      .order('nombre', { ascending: true })
    if (errorConsulta) {
      console.error(errorConsulta)
      setError('Falta ejecutar supabase-productos-fase-9.sql en Supabase.')
      setCargando(false)
      return
    }
    const base = (data ?? []).map((el) => ({
      ...el,
      precio_venta: Number(el.precio_venta), costo_unitario: Number(el.costo_unitario),
      stock: Number(el.stock ?? 0), stock_minimo: Number(el.stock_minimo ?? 5),
      descuento_pct: Number(el.descuento_pct ?? 0), descuento_monto: Number(el.descuento_monto ?? 0),
      iva_pct: Number(el.iva_pct ?? 21),
      aplica_descuento: !!el.aplica_descuento, fotoView: null as string | null,
    })) as ProductoServicio[]
    // Resolver la foto: si es URL http la usamos directo; si es un path del storage, firmamos.
    const conFoto = await Promise.all(base.map(async (el) => {
      if (!el.foto_url) return el
      if (esHttp(el.foto_url)) return { ...el, fotoView: el.foto_url }
      const { data: firma } = await supabase.storage.from(BUCKET).createSignedUrl(el.foto_url, 3600)
      return { ...el, fotoView: firma?.signedUrl ?? null }
    }))
    setElementos(conFoto)
    setCargando(false)
  }

  const elementosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    return elementos.filter((el) => {
      const coincideBusqueda = !texto || el.nombre.toLowerCase().includes(texto) || (el.descripcion ?? '').toLowerCase().includes(texto) || (el.categoria ?? '').toLowerCase().includes(texto) || (el.proveedor ?? '').toLowerCase().includes(texto)
      const coincideTipo = tipoFiltro === 'todos' || el.tipo === tipoFiltro
      const coincideEstado = estadoFiltro === 'todos' || (estadoFiltro === 'activos' && el.activo) || (estadoFiltro === 'inactivos' && !el.activo)
      const coincideStock = !soloStockBajo || nivelStock(el) === 'bajo' || nivelStock(el) === 'sin'
      return coincideBusqueda && coincideTipo && coincideEstado && coincideStock
    })
  }, [elementos, busqueda, tipoFiltro, estadoFiltro, soloStockBajo])

  const inversionStock = elementos.filter((el) => el.tipo === 'producto' && el.activo).reduce((s, el) => s + el.costo_unitario * el.stock, 0)
  const bajos = elementos.filter((el) => el.activo && (nivelStock(el) === 'bajo' || nivelStock(el) === 'sin'))

  function limpiarFormulario() {
    setTipo('producto'); setNombre(''); setDescripcion(''); setCategoria(''); setProveedor(''); setLinkCompra('')
    setUnidad('unidad'); setPrecioCompra(''); setGananciaPct(''); setPrecioLista(''); setStock(''); setStockMinimo('5'); setIvaPct('21')
    setAplicaDescuento(false); setDescuentoTipo('porcentaje'); setDescuentoValor('')
    setFotoUrl(null); setFotoPreview(''); setErrorFormulario('')
  }
  function abrirNuevo() { setEditando(null); limpiarFormulario(); setMostrarFormulario(true) }
  async function abrirEdicion(el: ProductoServicio) {
    setEditando(el)
    setTipo(el.tipo); setNombre(el.nombre); setDescripcion(el.descripcion ?? ''); setCategoria(el.categoria ?? '')
    setProveedor(el.proveedor ?? ''); setLinkCompra(el.link_compra ?? ''); setUnidad(el.unidad)
    setPrecioCompra(el.costo_unitario ? String(el.costo_unitario) : '')
    setPrecioLista(el.precio_venta ? String(el.precio_venta) : '')
    setGananciaPct(el.costo_unitario > 0 ? String(Math.round(((el.precio_venta - el.costo_unitario) / el.costo_unitario) * 1000) / 10) : '')
    setStock(String(el.stock)); setStockMinimo(String(el.stock_minimo ?? 5)); setIvaPct(String(el.iva_pct ?? 21))
    setAplicaDescuento(el.aplica_descuento); setDescuentoTipo(el.descuento_monto > 0 ? 'monto' : 'porcentaje')
    setDescuentoValor(String(el.descuento_monto > 0 ? el.descuento_monto : el.descuento_pct))
    setFotoUrl(el.foto_url); setErrorFormulario('')
    setFotoPreview(esHttp(el.foto_url) ? (el.foto_url as string) : (el.fotoView ?? ''))
    setMostrarFormulario(true)
  }
  function cerrarFormulario() { setMostrarFormulario(false); setEditando(null); setErrorFormulario('') }

  // Recalcular precios de forma bidireccional (precio de compra + % ganancia => precio de lista)
  const dos = (n: number) => Math.round(n * 100) / 100
  function cambiarCompra(v: string) {
    setPrecioCompra(v)
    const c = Number(v || 0), g = Number(gananciaPct || 0)
    if (c > 0 && gananciaPct !== '') setPrecioLista(String(dos(c * (1 + g / 100))))
  }
  function cambiarGanancia(v: string) {
    setGananciaPct(v)
    const c = Number(precioCompra || 0), g = Number(v || 0)
    if (c > 0) setPrecioLista(String(dos(c * (1 + g / 100))))
  }
  function cambiarLista(v: string) {
    setPrecioLista(v)
    const c = Number(precioCompra || 0), l = Number(v || 0)
    if (c > 0) setGananciaPct(String(dos(((l - c) / c) * 100)))
  }

  async function subirFoto(evento: React.ChangeEvent<HTMLInputElement>) {
    const file = evento.target.files?.[0]
    if (!file) return
    setSubiendoFoto(true); setErrorFormulario('')
    const comprimida = await comprimirImagen(file)
    const path = `p-${Date.now()}.webp`
    const subida = await supabase.storage.from(BUCKET).upload(path, comprimida, { upsert: true, contentType: 'image/webp' })
    if (subida.error) { console.error(subida.error); setErrorFormulario('No se pudo subir la foto.'); setSubiendoFoto(false); return }
    setFotoUrl(path)
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    setFotoPreview(data?.signedUrl ?? ''); setSubiendoFoto(false)
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault(); setErrorFormulario('')
    if (!nombre.trim()) { setErrorFormulario('Ingresá el nombre del producto o servicio.'); return }
    setGuardando(true)
    const descuentoPct = aplicaDescuento && descuentoTipo === 'porcentaje' ? Number(descuentoValor || 0) : 0
    const descuentoMonto = aplicaDescuento && descuentoTipo === 'monto' ? Number(descuentoValor || 0) : 0
    const datos = {
      tipo, nombre: nombre.trim(), descripcion: descripcion.trim() || null, categoria: categoria.trim() || null,
      proveedor: proveedor.trim() || null, link_compra: linkCompra.trim() || null, unidad,
      precio_venta: Number(precioLista || 0), costo_unitario: Number(precioCompra || 0),
      stock: Number(stock || 0), stock_minimo: Number(stockMinimo || 0), iva_pct: Number(ivaPct || 21),
      foto_url: fotoUrl, aplica_descuento: aplicaDescuento, descuento_pct: descuentoPct, descuento_monto: descuentoMonto,
    }
    const resultado = editando
      ? await supabase.from('productos_servicios').update(datos).eq('id', editando.id)
      : await supabase.from('productos_servicios').insert({ ...datos, activo: true })
    if (resultado.error) { console.error(resultado.error); setErrorFormulario('No se pudo guardar el producto o servicio.'); setGuardando(false); return }
    setGuardando(false); cerrarFormulario(); await cargarCatalogo()
  }

  async function cambiarEstado(el: ProductoServicio) {
    const accion = el.activo ? 'desactivar' : 'activar'
    if (!window.confirm(`¿Querés ${accion} "${el.nombre}"?`)) return
    const { error: err } = await supabase.from('productos_servicios').update({ activo: !el.activo }).eq('id', el.id)
    if (err) { console.error(err); window.alert('No se pudo cambiar el estado.'); return }
    setElementos((arr) => arr.map((x) => (x.id === el.id ? { ...x, activo: !x.activo } : x)))
  }

  // Simulación en vivo (usa precio de lista + descuento)
  const simDescuentoPct = aplicaDescuento && descuentoTipo === 'porcentaje' ? Number(descuentoValor || 0) : 0
  const simDescuentoMonto = aplicaDescuento && descuentoTipo === 'monto' ? Number(descuentoValor || 0) : 0
  const simPrecioFinal = precioFinalUnidad({ precio_venta: Number(precioLista || 0), aplica_descuento: aplicaDescuento, descuento_pct: simDescuentoPct, descuento_monto: simDescuentoMonto })
  const simGanancia = simPrecioFinal - Number(precioCompra || 0)
  const simMargen = simPrecioFinal > 0 ? (simGanancia / simPrecioFinal) * 100 : 0
  const simInversion = Number(precioCompra || 0) * Number(stock || 0)

  const tarjeta = (el: ProductoServicio) => {
    const final = precioFinalUnidad(el)
    const tieneDesc = el.aplica_descuento && final < el.precio_venta
    const ganancia = final - el.costo_unitario
    const margen = final > 0 ? (ganancia / final) * 100 : 0
    const nivel = nivelStock(el)
    return (
      <article className={`prodCard ${el.activo ? '' : 'inactivo'}`} key={el.id}>
        <div className="prodCardFoto">
          {el.fotoView ? <img src={el.fotoView} alt={el.nombre} loading="lazy" /> : <span>{el.tipo === 'servicio' ? '🛠️' : '📦'}</span>}
        </div>
        <div className="prodCardTop">
          <span className={`catalogoTipo ${el.tipo}`}>{el.tipo === 'producto' ? 'Producto' : 'Servicio'}</span>
          {el.tipo === 'producto' && (
            <span className={`prodStock ${nivel === 'sin' ? 'sin' : nivel === 'bajo' ? 'bajo' : ''}`}>
              {nivel === 'sin' ? 'Sin stock' : `Stock: ${el.stock}`}{nivel === 'bajo' ? ' ⚠' : ''}
            </span>
          )}
        </div>
        <h3>{el.nombre}</h3>
        <small className="prodCat">{el.categoria || el.descripcion || 'Sin categoría'}{el.proveedor ? ` · ${el.proveedor}` : ''}</small>
        <div className="prodPrecio">
          {tieneDesc ? (<>
            <strong>{formatoDinero(final)}</strong><s>{formatoDinero(el.precio_venta)}</s>
            <span className="prodBadgeDesc">{el.descuento_pct > 0 ? `-${el.descuento_pct}%` : `-${formatoDinero(el.descuento_monto)}`}</span>
          </>) : <strong>{formatoDinero(el.precio_venta)}</strong>}
        </div>
        <div className="prodDatos">
          <span>Compra <b>{formatoDinero(el.costo_unitario)}</b></span>
          <span>Ganancia <b>{formatoDinero(ganancia)}</b></span>
          <span>Margen <b>{margen.toFixed(1)}%</b></span>
          {el.tipo === 'producto' && <span>Invertido <b>{formatoDinero(el.costo_unitario * el.stock)}</b></span>}
        </div>
        <div className="prodAcciones">
          <button className="editButton" onClick={() => abrirEdicion(el)}>Editar</button>
          {el.link_compra && <a className="editButton" href={el.link_compra} target="_blank" rel="noreferrer">Ver en web</a>}
          <button className={el.activo ? 'deactivateButton' : 'activateButton'} onClick={() => cambiarEstado(el)}>{el.activo ? 'Desactivar' : 'Activar'}</button>
        </div>
      </article>
    )
  }

  return (
    <div className="catalogoPage">
      <div className="pageHeader">
        <div>
          <p className="subtitle">GESTIÓN COMERCIAL</p>
          <h2>Productos y servicios</h2>
          <p className="welcome">Stock, precios, costos y descuentos</p>
        </div>
        <button className="newButton" onClick={abrirNuevo}>+ Nuevo</button>
      </div>

      {!cargando && !error && (
        <div className="prodKpis">
          <div><span>INVERSIÓN EN STOCK</span><strong>{formatoDinero(inversionStock)}</strong><small>Precio de compra × stock</small></div>
          <div><span>PRODUCTOS ACTIVOS</span><strong>{elementos.filter((e) => e.tipo === 'producto' && e.activo).length}</strong><small>En catálogo</small></div>
          <button type="button" className={`prodKpiBtn ${bajos.length ? 'alertaStock' : ''} ${soloStockBajo ? 'activo' : ''}`} onClick={() => setSoloStockBajo((v) => !v)}>
            <span>STOCK BAJO</span><strong>{bajos.length}</strong><small>{soloStockBajo ? 'Mostrando solo estos ✓' : 'Tocá para filtrar'}</small>
          </button>
        </div>
      )}

      {!cargando && !error && bajos.length > 0 && (
        <div className="stockAviso">
          <strong>⚠ Reponer stock:</strong> {bajos.map((el) => `${el.nombre} (${el.stock})`).join(' · ')}
        </div>
      )}

      <div className="crmToolbar">
        <div className="crmFiltros">
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, categoría o proveedor..." />
          <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value as TipoFiltro)}>
            <option value="todos">Productos y servicios</option>
            <option value="producto">Productos</option>
            <option value="servicio">Servicios</option>
          </select>
          <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value as EstadoFiltro)}>
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="todos">Todos</option>
          </select>
          {soloStockBajo && <button type="button" className="editButton" onClick={() => setSoloStockBajo(false)}>Ver todos ✕</button>}
        </div>
        <VistaToggle vista={vista} onCambio={setVista} />
      </div>

      {cargando && <p>Cargando lista...</p>}
      {error && <p className="loginError">{error}</p>}
      {!cargando && !error && elementosFiltrados.length === 0 && (
        <div className="empty"><span>📦</span><h3>Sin resultados</h3><p>Probá con otra búsqueda o filtro.</p></div>
      )}

      {!cargando && !error && elementosFiltrados.length > 0 && vista === 'kanban' && (
        <div className="crmKanban">
          {TIPOS_KANBAN.map((t) => {
            const cols = elementosFiltrados.filter((el) => el.tipo === t.v)
            return (
              <div className={`crmKanbanCol tope ${t.v === 'producto' ? 'col-proceso' : 'col-aceptado'}`} key={t.v}>
                <div className="crmKanbanHead"><h3>{t.t}</h3><span className="cuenta">{cols.length}</span></div>
                <div className="crmKanbanBody">
                  {cols.length === 0 ? <div className="crmKanbanVacio">—</div> : cols.map((el) => tarjeta(el))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!cargando && !error && elementosFiltrados.length > 0 && vista === 'lista' && (
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th></th><th>Nombre</th><th>Proveedor</th><th>P. compra</th><th>P. lista</th><th>Ganancia</th><th>Stock</th></tr></thead>
            <tbody>
              {elementosFiltrados.map((el) => {
                const final = precioFinalUnidad(el)
                const nivel = nivelStock(el)
                return (
                  <tr key={el.id} onClick={() => abrirEdicion(el)}>
                    <td className="prodListaFoto">{el.fotoView ? <img src={el.fotoView} alt="" /> : <span>{el.tipo === 'servicio' ? '🛠️' : '📦'}</span>}</td>
                    <td><strong>{el.nombre}</strong></td>
                    <td>{el.proveedor || '—'}</td>
                    <td>{formatoDinero(el.costo_unitario)}</td>
                    <td>{formatoDinero(final)}</td>
                    <td>{formatoDinero(final - el.costo_unitario)}</td>
                    <td>{el.tipo === 'producto' ? <span className={`crmBadge ${nivel === 'sin' ? 'est-rechazado' : nivel === 'bajo' ? 'est-observacion' : 'est-aceptado'}`}>{el.stock}</span> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {mostrarFormulario && (
        <div className="modalOverlay">
          <div className="modalCard catalogoModal">
            <div className="modalHeader">
              <div><p className="subtitle">CATÁLOGO MOVA</p><h2>{editando ? 'Editar elemento' : 'Nuevo producto o servicio'}</h2></div>
              <button type="button" className="modalClose closeButton" onClick={cerrarFormulario}>×</button>
            </div>
            <form className="catalogoForm" onSubmit={guardar}>
              <div className="formGrid">
                <label>Tipo *
                  <select value={tipo} onChange={(e) => setTipo(e.target.value as 'producto' | 'servicio')}>
                    <option value="producto">Producto</option>
                    <option value="servicio">Servicio</option>
                  </select>
                </label>
                <label>Nombre *<input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Módulo inteligente" required /></label>
                <label>Categoría<input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ej.: Domótica" /></label>
                <label>Proveedor<input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Ej.: Tuya / Sonoff" /></label>

                <label>Precio de compra<input type="number" min="0" step="0.01" value={precioCompra} onChange={(e) => cambiarCompra(e.target.value)} placeholder="0,00" /></label>
                <label>% de ganancia<input type="number" step="0.1" value={gananciaPct} onChange={(e) => cambiarGanancia(e.target.value)} placeholder="Ej.: 40" /></label>
                <label>Precio de lista<input type="number" min="0" step="0.01" value={precioLista} onChange={(e) => cambiarLista(e.target.value)} placeholder="0,00" /></label>

                {tipo === 'producto' && <label>Stock (cantidad)<input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" /></label>}
                {tipo === 'producto' && <label>Stock mínimo (alerta)<input type="number" min="0" step="1" value={stockMinimo} onChange={(e) => setStockMinimo(e.target.value)} placeholder="5" /></label>}
                <label>Unidad
                  <select value={unidad} onChange={(e) => setUnidad(e.target.value)}>
                    <option value="unidad">Unidad</option><option value="metro">Metro</option><option value="hora">Hora</option>
                    <option value="servicio">Servicio</option><option value="kit">Kit</option><option value="boca">Boca</option><option value="circuito">Circuito</option>
                  </select>
                </label>
                <label>IVA
                  <select value={ivaPct} onChange={(e) => setIvaPct(e.target.value)}>
                    <option value="21">21%</option><option value="10.5">10,5%</option><option value="27">27%</option><option value="0">Exento (0%)</option>
                  </select>
                </label>
                <label className="formFull">Link de compra (dónde se compra)<input type="url" value={linkCompra} onChange={(e) => setLinkCompra(e.target.value)} placeholder="https://..." /></label>
                <label>Foto del producto<input type="file" accept="image/*" onChange={subirFoto} disabled={subiendoFoto} /></label>

                {fotoPreview && (
                  <div className="prodFotoPreview formFull">
                    <img src={fotoPreview} alt="Foto del producto" />
                    <button type="button" onClick={() => { setFotoUrl(null); setFotoPreview('') }}>Quitar foto</button>
                  </div>
                )}

                <div className="descuentoBox formFull">
                  <div className="descuentoHead">
                    <span>Aplica descuento (sobre el precio de lista)</span>
                    <button type="button" className={`swToggle ${aplicaDescuento ? 'on' : ''}`} onClick={() => setAplicaDescuento((v) => !v)} aria-label="Aplica descuento"><i /></button>
                  </div>
                  {aplicaDescuento && (
                    <div className="descuentoCampos">
                      <div className="segTipo">
                        <button type="button" className={descuentoTipo === 'porcentaje' ? 'active' : ''} onClick={() => setDescuentoTipo('porcentaje')}>%</button>
                        <button type="button" className={descuentoTipo === 'monto' ? 'active' : ''} onClick={() => setDescuentoTipo('monto')}>$</button>
                      </div>
                      <input type="number" min="0" step="0.01" value={descuentoValor} onChange={(e) => setDescuentoValor(e.target.value)} placeholder={descuentoTipo === 'porcentaje' ? '% de descuento' : 'Monto en $'} />
                    </div>
                  )}
                </div>

                <label className="formFull">Descripción<textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Descripción detallada..." /></label>

                <div className="simulacionBox formFull">
                  <span className="simulacionTitulo">Resumen del producto</span>
                  <div className="simulacionGrid">
                    <div><small>Precio final / unidad</small><strong>{formatoDinero(simPrecioFinal)}</strong></div>
                    <div><small>Ganancia / unidad</small><strong className={simGanancia < 0 ? 'neg' : ''}>{formatoDinero(simGanancia)}</strong></div>
                    <div><small>Margen</small><strong>{simMargen.toFixed(1)}%</strong></div>
                    <div><small>Inversión en stock ({Number(stock || 0)} u.)</small><strong>{formatoDinero(simInversion)}</strong></div>
                  </div>
                </div>
              </div>

              {errorFormulario && <p className="loginError">{errorFormulario}</p>}
              <div className="modalActions formActions">
                <button type="button" className="cancelButton" onClick={cerrarFormulario}>Cancelar</button>
                <button type="submit" className="newButton" disabled={guardando || subiendoFoto}>{guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Agregar a la lista'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProductosServicios
