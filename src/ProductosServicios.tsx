import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'

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
  foto_url: string | null
  aplica_descuento: boolean
  descuento_pct: number
  descuento_monto: number
  activo: boolean
}

type TipoFiltro = 'todos' | 'producto' | 'servicio'
type EstadoFiltro = 'activos' | 'inactivos' | 'todos'

const BUCKET = 'productos'

function formatoDinero(valor: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(Number(valor || 0))
}

// Precio final por unidad aplicando el descuento (si corresponde)
function precioFinalUnidad(el: {
  precio_venta: number
  aplica_descuento: boolean
  descuento_pct: number
  descuento_monto: number
}) {
  if (!el.aplica_descuento) return el.precio_venta
  if (el.descuento_pct > 0) return Math.max(0, el.precio_venta * (1 - el.descuento_pct / 100))
  if (el.descuento_monto > 0) return Math.max(0, el.precio_venta - el.descuento_monto)
  return el.precio_venta
}

function ProductosServicios() {
  const [elementos, setElementos] = useState<ProductoServicio[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('todos')
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('activos')

  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [editando, setEditando] = useState<ProductoServicio | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorFormulario, setErrorFormulario] = useState('')

  // Campos del formulario
  const [tipo, setTipo] = useState<'producto' | 'servicio'>('producto')
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [categoria, setCategoria] = useState('')
  const [unidad, setUnidad] = useState('unidad')
  const [precioVenta, setPrecioVenta] = useState('')
  const [costoUnitario, setCostoUnitario] = useState('')
  const [stock, setStock] = useState('')
  const [aplicaDescuento, setAplicaDescuento] = useState(false)
  const [descuentoTipo, setDescuentoTipo] = useState<'porcentaje' | 'monto'>('porcentaje')
  const [descuentoValor, setDescuentoValor] = useState('')
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [fotoPreview, setFotoPreview] = useState('')
  const [subiendoFoto, setSubiendoFoto] = useState(false)

  useEffect(() => {
    cargarCatalogo()
  }, [])

  async function cargarCatalogo() {
    setCargando(true)
    setError('')
    const { data, error: errorConsulta } = await supabase
      .from('productos_servicios')
      .select(`
        id, created_at, tipo, nombre, descripcion, categoria, unidad,
        precio_venta, costo_unitario, stock, foto_url,
        aplica_descuento, descuento_pct, descuento_monto, activo
      `)
      .order('nombre', { ascending: true })

    if (errorConsulta) {
      console.error(errorConsulta)
      setError('No se pudo cargar la lista de productos y servicios.')
      setCargando(false)
      return
    }

    const datos = (data ?? []).map((el) => ({
      ...el,
      precio_venta: Number(el.precio_venta),
      costo_unitario: Number(el.costo_unitario),
      stock: Number(el.stock ?? 0),
      descuento_pct: Number(el.descuento_pct ?? 0),
      descuento_monto: Number(el.descuento_monto ?? 0),
      aplica_descuento: !!el.aplica_descuento,
    })) as ProductoServicio[]

    setElementos(datos)
    setCargando(false)
  }

  const elementosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    return elementos.filter((el) => {
      const coincideBusqueda =
        !texto ||
        el.nombre.toLowerCase().includes(texto) ||
        (el.descripcion ?? '').toLowerCase().includes(texto) ||
        (el.categoria ?? '').toLowerCase().includes(texto)
      const coincideTipo = tipoFiltro === 'todos' || el.tipo === tipoFiltro
      const coincideEstado =
        estadoFiltro === 'todos' ||
        (estadoFiltro === 'activos' && el.activo) ||
        (estadoFiltro === 'inactivos' && !el.activo)
      return coincideBusqueda && coincideTipo && coincideEstado
    })
  }, [elementos, busqueda, tipoFiltro, estadoFiltro])

  function limpiarFormulario() {
    setTipo('producto'); setNombre(''); setDescripcion(''); setCategoria('')
    setUnidad('unidad'); setPrecioVenta(''); setCostoUnitario(''); setStock('')
    setAplicaDescuento(false); setDescuentoTipo('porcentaje'); setDescuentoValor('')
    setFotoUrl(null); setFotoPreview(''); setErrorFormulario('')
  }

  function abrirNuevo() {
    setEditando(null)
    limpiarFormulario()
    setMostrarFormulario(true)
  }

  async function abrirEdicion(el: ProductoServicio) {
    setEditando(el)
    setTipo(el.tipo); setNombre(el.nombre); setDescripcion(el.descripcion ?? '')
    setCategoria(el.categoria ?? ''); setUnidad(el.unidad)
    setPrecioVenta(String(el.precio_venta)); setCostoUnitario(String(el.costo_unitario)); setStock(String(el.stock))
    setAplicaDescuento(el.aplica_descuento)
    setDescuentoTipo(el.descuento_monto > 0 ? 'monto' : 'porcentaje')
    setDescuentoValor(String(el.descuento_monto > 0 ? el.descuento_monto : el.descuento_pct))
    setFotoUrl(el.foto_url)
    setErrorFormulario('')
    setFotoPreview('')
    if (el.foto_url) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(el.foto_url, 3600)
      setFotoPreview(data?.signedUrl ?? '')
    }
    setMostrarFormulario(true)
  }

  function cerrarFormulario() {
    setMostrarFormulario(false)
    setEditando(null)
    setErrorFormulario('')
  }

  async function subirFoto(evento: React.ChangeEvent<HTMLInputElement>) {
    const file = evento.target.files?.[0]
    if (!file) return
    setSubiendoFoto(true)
    setErrorFormulario('')
    const path = `p-${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`
    const subida = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
    if (subida.error) {
      console.error(subida.error)
      setErrorFormulario('No se pudo subir la foto.')
      setSubiendoFoto(false)
      return
    }
    setFotoUrl(path)
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    setFotoPreview(data?.signedUrl ?? '')
    setSubiendoFoto(false)
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErrorFormulario('')
    if (!nombre.trim()) {
      setErrorFormulario('Ingresá el nombre del producto o servicio.')
      return
    }
    setGuardando(true)
    const descuentoPct = aplicaDescuento && descuentoTipo === 'porcentaje' ? Number(descuentoValor || 0) : 0
    const descuentoMonto = aplicaDescuento && descuentoTipo === 'monto' ? Number(descuentoValor || 0) : 0

    const datos = {
      tipo,
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      categoria: categoria.trim() || null,
      unidad,
      precio_venta: Number(precioVenta || 0),
      costo_unitario: Number(costoUnitario || 0),
      stock: Number(stock || 0),
      foto_url: fotoUrl,
      aplica_descuento: aplicaDescuento,
      descuento_pct: descuentoPct,
      descuento_monto: descuentoMonto,
    }

    const resultado = editando
      ? await supabase.from('productos_servicios').update(datos).eq('id', editando.id)
      : await supabase.from('productos_servicios').insert({ ...datos, activo: true })

    if (resultado.error) {
      console.error(resultado.error)
      setErrorFormulario('No se pudo guardar el producto o servicio.')
      setGuardando(false)
      return
    }
    setGuardando(false)
    cerrarFormulario()
    await cargarCatalogo()
  }

  async function cambiarEstado(el: ProductoServicio) {
    const accion = el.activo ? 'desactivar' : 'activar'
    if (!window.confirm(`¿Querés ${accion} "${el.nombre}"?`)) return
    const { error: err } = await supabase
      .from('productos_servicios')
      .update({ activo: !el.activo })
      .eq('id', el.id)
    if (err) {
      console.error(err)
      window.alert('No se pudo cambiar el estado.')
      return
    }
    setElementos((arr) => arr.map((x) => (x.id === el.id ? { ...x, activo: !x.activo } : x)))
  }

  // ---- Simulación en vivo (formulario) ----
  const simDescuentoPct = aplicaDescuento && descuentoTipo === 'porcentaje' ? Number(descuentoValor || 0) : 0
  const simDescuentoMonto = aplicaDescuento && descuentoTipo === 'monto' ? Number(descuentoValor || 0) : 0
  const simPrecioFinal = precioFinalUnidad({
    precio_venta: Number(precioVenta || 0),
    aplica_descuento: aplicaDescuento,
    descuento_pct: simDescuentoPct,
    descuento_monto: simDescuentoMonto,
  })
  const simGanancia = simPrecioFinal - Number(costoUnitario || 0)
  const simMargen = simPrecioFinal > 0 ? (simGanancia / simPrecioFinal) * 100 : 0
  const simTotal = simPrecioFinal * Number(stock || 0)

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

      <div className="catalogoFiltros">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, descripción o categoría..."
        />
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
      </div>

      <div className="catalogoPanel">
        {cargando && <p>Cargando lista...</p>}
        {error && <p className="loginError">{error}</p>}

        {!cargando && !error && elementosFiltrados.length === 0 && (
          <div className="empty">
            <span>📦</span>
            <h3>Todavía no hay productos o servicios</h3>
            <p>Los elementos que agregues aparecerán acá.</p>
          </div>
        )}

        {!cargando && !error && elementosFiltrados.length > 0 && (
          <div className="prodGrid">
            {elementosFiltrados.map((el) => {
              const final = precioFinalUnidad(el)
              const tieneDesc = el.aplica_descuento && final < el.precio_venta
              const ganancia = final - el.costo_unitario
              const margen = final > 0 ? (ganancia / final) * 100 : 0
              return (
                <article className={`prodCard ${el.activo ? '' : 'inactivo'}`} key={el.id}>
                  <div className="prodCardTop">
                    <span className={`catalogoTipo ${el.tipo}`}>{el.tipo === 'producto' ? 'Producto' : 'Servicio'}</span>
                    {el.tipo === 'producto' && (
                      <span className={`prodStock ${el.stock <= 0 ? 'sin' : el.stock <= 5 ? 'bajo' : ''}`}>
                        {el.stock <= 0 ? 'Sin stock' : `Stock: ${el.stock}`}
                      </span>
                    )}
                  </div>
                  <h3>{el.nombre}</h3>
                  <small className="prodCat">{el.categoria || el.descripcion || 'Sin categoría'}</small>
                  <div className="prodPrecio">
                    {tieneDesc ? (
                      <>
                        <strong>{formatoDinero(final)}</strong>
                        <s>{formatoDinero(el.precio_venta)}</s>
                        <span className="prodBadgeDesc">
                          {el.descuento_pct > 0 ? `-${el.descuento_pct}%` : `-${formatoDinero(el.descuento_monto)}`}
                        </span>
                      </>
                    ) : (
                      <strong>{formatoDinero(el.precio_venta)}</strong>
                    )}
                  </div>
                  <div className="prodDatos">
                    <span>Costo <b>{formatoDinero(el.costo_unitario)}</b></span>
                    <span>Ganancia <b>{formatoDinero(ganancia)}</b></span>
                    <span>Margen <b>{margen.toFixed(1)}%</b></span>
                    {el.tipo === 'producto' && <span>Total stock <b>{formatoDinero(final * el.stock)}</b></span>}
                  </div>
                  <div className="prodAcciones">
                    <button className="editButton" onClick={() => abrirEdicion(el)}>Editar</button>
                    <button className={el.activo ? 'deactivateButton' : 'activateButton'} onClick={() => cambiarEstado(el)}>
                      {el.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {mostrarFormulario && (
        <div className="modalOverlay">
          <div className="modalCard catalogoModal">
            <div className="modalHeader">
              <div>
                <p className="subtitle">CATÁLOGO MOVA</p>
                <h2>{editando ? 'Editar elemento' : 'Nuevo producto o servicio'}</h2>
              </div>
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
                <label>Nombre *
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Módulo inteligente" required />
                </label>
                <label>Categoría
                  <input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ej.: Domótica" />
                </label>
                <label>Unidad
                  <select value={unidad} onChange={(e) => setUnidad(e.target.value)}>
                    <option value="unidad">Unidad</option>
                    <option value="metro">Metro</option>
                    <option value="hora">Hora</option>
                    <option value="servicio">Servicio</option>
                    <option value="kit">Kit</option>
                    <option value="boca">Boca</option>
                    <option value="circuito">Circuito</option>
                  </select>
                </label>
                <label>Precio de costo
                  <input type="number" min="0" step="0.01" value={costoUnitario} onChange={(e) => setCostoUnitario(e.target.value)} placeholder="0,00" />
                </label>
                <label>Precio de venta
                  <input type="number" min="0" step="0.01" value={precioVenta} onChange={(e) => setPrecioVenta(e.target.value)} placeholder="0,00" />
                </label>
                <label>Stock (cantidad)
                  <input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" />
                </label>
                <label>Foto del producto
                  <input type="file" accept="image/*" onChange={subirFoto} disabled={subiendoFoto} />
                </label>

                {fotoPreview && (
                  <div className="prodFotoPreview formFull">
                    <img src={fotoPreview} alt="Foto del producto" />
                    <button type="button" onClick={() => { setFotoUrl(null); setFotoPreview('') }}>Quitar foto</button>
                  </div>
                )}

                <div className="descuentoBox formFull">
                  <div className="descuentoHead">
                    <span>Aplica descuento</span>
                    <button
                      type="button"
                      className={`swToggle ${aplicaDescuento ? 'on' : ''}`}
                      onClick={() => setAplicaDescuento((v) => !v)}
                      aria-label="Aplica descuento"
                    >
                      <i />
                    </button>
                  </div>
                  {aplicaDescuento && (
                    <div className="descuentoCampos">
                      <div className="segTipo">
                        <button type="button" className={descuentoTipo === 'porcentaje' ? 'active' : ''} onClick={() => setDescuentoTipo('porcentaje')}>%</button>
                        <button type="button" className={descuentoTipo === 'monto' ? 'active' : ''} onClick={() => setDescuentoTipo('monto')}>$</button>
                      </div>
                      <input
                        type="number" min="0" step="0.01" value={descuentoValor}
                        onChange={(e) => setDescuentoValor(e.target.value)}
                        placeholder={descuentoTipo === 'porcentaje' ? '% de descuento' : 'Monto en $'}
                      />
                    </div>
                  )}
                </div>

                <label className="formFull">Descripción
                  <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Descripción detallada..." />
                </label>

                {/* Simulación de precio de venta */}
                <div className="simulacionBox formFull">
                  <span className="simulacionTitulo">Simulación de venta</span>
                  <div className="simulacionGrid">
                    <div><small>Precio final / unidad</small><strong>{formatoDinero(simPrecioFinal)}</strong></div>
                    <div><small>Ganancia / unidad</small><strong className={simGanancia < 0 ? 'neg' : ''}>{formatoDinero(simGanancia)}</strong></div>
                    <div><small>Margen</small><strong>{simMargen.toFixed(1)}%</strong></div>
                    <div><small>Total final ({Number(stock || 0)} u.)</small><strong>{formatoDinero(simTotal)}</strong></div>
                  </div>
                </div>
              </div>

              {errorFormulario && <p className="loginError">{errorFormulario}</p>}

              <div className="modalActions formActions">
                <button type="button" className="cancelButton" onClick={cerrarFormulario}>Cancelar</button>
                <button type="submit" className="newButton" disabled={guardando || subiendoFoto}>
                  {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Agregar a la lista'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProductosServicios
