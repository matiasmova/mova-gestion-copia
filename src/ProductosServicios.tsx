import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import VistaToggle, { useVista } from './VistaToggle'
import ImportarCatalogo from './ImportarCatalogo'
import ActualizarCotizacion from './ActualizarCotizacion'
import { dos, gananciaDesdePrecio, precioDesdeGanancia, type ModoGanancia } from './catalogoCalculos'
import { formatoDinero, formatoDolar, guardarMoneda, leerCotizacion, leerMoneda, type Moneda } from './catalogoMoneda'

export type ProductoServicio = {
  id: number
  created_at: string
  codigo: string | null
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
type AccionStockMasivo = 'sumar' | 'restar' | 'fijar'
type EstadoGuardadoFila = 'guardando' | 'ok' | 'error'

const BUCKET = 'productos'
const CLAVE_MODO = 'mova_modo_ganancia'
const TIPOS_KANBAN = [
  { v: 'producto', t: 'Productos' },
  { v: 'servicio', t: 'Servicios' },
]
const UNIDADES = ['unidad', 'metro', 'hora', 'servicio', 'kit', 'boca', 'circuito']
const esHttp = (u: string | null | undefined) => !!u && /^https?:\/\//.test(u)

// El modo elegido se recuerda en este navegador.
function leerModo(): ModoGanancia {
  try {
    return localStorage.getItem(CLAVE_MODO) === 'recargo' ? 'recargo' : 'margen'
  } catch {
    return 'margen'
  }
}

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
  const [mostrarImportar, setMostrarImportar] = useState(false)
  const [mostrarCotizacion, setMostrarCotizacion] = useState(false)
  const [editando, setEditando] = useState<ProductoServicio | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorFormulario, setErrorFormulario] = useState('')

  const [tipo, setTipo] = useState<'producto' | 'servicio'>('producto')
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [categoria, setCategoria] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [linkCompra, setLinkCompra] = useState('')
  const [unidad, setUnidad] = useState('unidad')
  const [precioCompra, setPrecioCompra] = useState('')
  const [gananciaPct, setGananciaPct] = useState('')
  const [modoGanancia, setModoGanancia] = useState<ModoGanancia>(leerModo)
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

  // Moneda de visualización (no afecta lo guardado; solo cómo se muestra).
  const [moneda, setMoneda] = useState<Moneda>(leerMoneda)
  const [cotizacion, setCotizacion] = useState<number>(leerCotizacion)

  // Edición rápida: selección múltiple, edición en la tabla y acciones masivas.
  const [modoEdicion, setModoEdicion] = useState(false)
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [estadoFila, setEstadoFila] = useState<Record<number, EstadoGuardadoFila>>({})
  const [accionStockMasivo, setAccionStockMasivo] = useState<AccionStockMasivo>('sumar')
  const [valorStockMasivo, setValorStockMasivo] = useState('')
  const [aplicandoMasivo, setAplicandoMasivo] = useState(false)
  const [eliminandoMasivo, setEliminandoMasivo] = useState(false)

  useEffect(() => { cargarCatalogo() }, [])

  async function cargarCatalogo() {
    setCargando(true)
    setError('')
    const { data, error: errorConsulta } = await supabase
      .from('productos_servicios')
      .select(`id, created_at, codigo, tipo, nombre, descripcion, categoria, unidad, precio_venta, costo_unitario, stock, stock_minimo, proveedor, link_compra, iva_pct, foto_url, aplica_descuento, descuento_pct, descuento_monto, activo`)
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
      const coincideBusqueda = !texto || (el.codigo ?? '').toLowerCase().includes(texto) || el.nombre.toLowerCase().includes(texto) || (el.descripcion ?? '').toLowerCase().includes(texto) || (el.categoria ?? '').toLowerCase().includes(texto) || (el.proveedor ?? '').toLowerCase().includes(texto)
      const coincideTipo = tipoFiltro === 'todos' || el.tipo === tipoFiltro
      const coincideEstado = estadoFiltro === 'todos' || (estadoFiltro === 'activos' && el.activo) || (estadoFiltro === 'inactivos' && !el.activo)
      const coincideStock = !soloStockBajo || nivelStock(el) === 'bajo' || nivelStock(el) === 'sin'
      return coincideBusqueda && coincideTipo && coincideEstado && coincideStock
    })
  }, [elementos, busqueda, tipoFiltro, estadoFiltro, soloStockBajo])

  const inversionStock = elementos.filter((el) => el.tipo === 'producto' && el.activo).reduce((s, el) => s + el.costo_unitario * el.stock, 0)
  const bajos = elementos.filter((el) => el.activo && (nivelStock(el) === 'bajo' || nivelStock(el) === 'sin'))

  // Muestra un valor guardado en pesos según la moneda elegida (solo visual).
  const mostrar = (valorArs: number) => (moneda === 'USD' && cotizacion > 0 ? formatoDolar(valorArs / cotizacion) : formatoDinero(valorArs))

  function cambiarMoneda(m: Moneda) {
    setMoneda(m)
    guardarMoneda(m)
  }

  function alCerrarCotizacion() {
    setMostrarCotizacion(false)
    setCotizacion(leerCotizacion())
  }

  function limpiarFormulario() {
    setTipo('producto'); setCodigo(''); setNombre(''); setDescripcion(''); setCategoria(''); setProveedor(''); setLinkCompra('')
    setUnidad('unidad'); setPrecioCompra(''); setGananciaPct(''); setPrecioLista(''); setStock(''); setStockMinimo('5'); setIvaPct('21')
    setAplicaDescuento(false); setDescuentoTipo('porcentaje'); setDescuentoValor('')
    setFotoUrl(null); setFotoPreview(''); setErrorFormulario('')
  }
  function abrirNuevo() { setEditando(null); limpiarFormulario(); setMostrarFormulario(true) }
  async function abrirEdicion(el: ProductoServicio) {
    if (modoEdicion) return
    setEditando(el)
    setTipo(el.tipo); setCodigo(el.codigo ?? ''); setNombre(el.nombre); setDescripcion(el.descripcion ?? ''); setCategoria(el.categoria ?? '')
    setProveedor(el.proveedor ?? ''); setLinkCompra(el.link_compra ?? ''); setUnidad(el.unidad)
    setPrecioCompra(el.costo_unitario ? String(el.costo_unitario) : '')
    setPrecioLista(el.precio_venta ? String(el.precio_venta) : '')
    setGananciaPct(el.costo_unitario > 0 && el.precio_venta > 0 ? String(dos(gananciaDesdePrecio(el.costo_unitario, el.precio_venta, modoGanancia))) : '')
    setStock(String(el.stock)); setStockMinimo(String(el.stock_minimo ?? 5)); setIvaPct(String(el.iva_pct ?? 21))
    setAplicaDescuento(el.aplica_descuento); setDescuentoTipo(el.descuento_monto > 0 ? 'monto' : 'porcentaje')
    setDescuentoValor(String(el.descuento_monto > 0 ? el.descuento_monto : el.descuento_pct))
    setFotoUrl(el.foto_url); setErrorFormulario('')
    setFotoPreview(esHttp(el.foto_url) ? (el.foto_url as string) : (el.fotoView ?? ''))
    setMostrarFormulario(true)
  }
  function cerrarFormulario() { setMostrarFormulario(false); setEditando(null); setErrorFormulario('') }

  // Recalcular precios de forma bidireccional (precio de compra + % de ganancia <=> precio de lista)
  function cambiarCompra(v: string) {
    setPrecioCompra(v)
    const c = Number(v || 0), g = Number(gananciaPct || 0)
    if (c > 0 && gananciaPct !== '') {
      const p = precioDesdeGanancia(c, g, modoGanancia)
      if (p != null) setPrecioLista(String(dos(p)))
    }
  }
  function cambiarGanancia(v: string) {
    setGananciaPct(v)
    const c = Number(precioCompra || 0), g = Number(v || 0)
    if (c > 0) {
      const p = precioDesdeGanancia(c, g, modoGanancia)
      if (p != null) setPrecioLista(String(dos(p)))
    }
  }
  function cambiarLista(v: string) {
    setPrecioLista(v)
    const c = Number(precioCompra || 0), l = Number(v || 0)
    if (c > 0) setGananciaPct(String(dos(gananciaDesdePrecio(c, l, modoGanancia))))
  }
  // Al cambiar de modo se mantienen los precios y se convierte el porcentaje.
  function cambiarModo(nuevo: ModoGanancia) {
    setModoGanancia(nuevo)
    try { localStorage.setItem(CLAVE_MODO, nuevo) } catch { /* sin almacenamiento: no pasa nada */ }
    const c = Number(precioCompra || 0), l = Number(precioLista || 0)
    if (c > 0 && l > 0) setGananciaPct(String(dos(gananciaDesdePrecio(c, l, nuevo))))
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
      tipo, codigo: codigo.trim() || null, nombre: nombre.trim(), descripcion: descripcion.trim() || null, categoria: categoria.trim() || null,
      proveedor: proveedor.trim() || null, link_compra: linkCompra.trim() || null, unidad,
      precio_venta: Number(precioLista || 0), costo_unitario: Number(precioCompra || 0),
      stock: Number(stock || 0), stock_minimo: Number(stockMinimo || 0), iva_pct: Number(ivaPct || 21),
      foto_url: fotoUrl, aplica_descuento: aplicaDescuento, descuento_pct: descuentoPct, descuento_monto: descuentoMonto,
    }
    const resultado = editando
      ? await supabase.from('productos_servicios').update(datos).eq('id', editando.id)
      : await supabase.from('productos_servicios').insert({ ...datos, activo: true })
    if (resultado.error) {
      console.error(resultado.error)
      setErrorFormulario(resultado.error.code === '23505' ? 'Ya existe un producto con ese código.' : 'No se pudo guardar el producto o servicio.')
      setGuardando(false)
      return
    }
    setGuardando(false); cerrarFormulario(); await cargarCatalogo()
  }

  async function cambiarEstado(el: ProductoServicio) {
    const accion = el.activo ? 'desactivar' : 'activar'
    if (!window.confirm(`¿Querés ${accion} "${el.nombre}"?`)) return
    const { error: err } = await supabase.from('productos_servicios').update({ activo: !el.activo }).eq('id', el.id)
    if (err) { console.error(err); window.alert('No se pudo cambiar el estado.'); return }
    setElementos((arr) => arr.map((x) => (x.id === el.id ? { ...x, activo: !x.activo } : x)))
  }

  // ───────────────────────── Edición rápida ─────────────────────────

  function entrarEdicion() { setModoEdicion(true); setSeleccion(new Set()) }
  function salirEdicion() { setModoEdicion(false); setSeleccion(new Set()); setEstadoFila({}) }

  function alternarSeleccion(id: number) {
    setSeleccion((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function alternarSeleccionTodos() {
    const todosMarcados = elementosFiltrados.length > 0 && elementosFiltrados.every((el) => seleccion.has(el.id))
    setSeleccion(todosMarcados ? new Set() : new Set(elementosFiltrados.map((el) => el.id)))
  }

  function actualizarCampoLocal<K extends keyof ProductoServicio>(id: number, campo: K, valor: ProductoServicio[K]) {
    setElementos((arr) => arr.map((el) => (el.id === id ? { ...el, [campo]: valor } : el)))
  }

  async function persistirCampo(id: number, campo: string, valor: unknown) {
    setEstadoFila((s) => ({ ...s, [id]: 'guardando' }))
    const { error: err } = await supabase.from('productos_servicios').update({ [campo]: valor }).eq('id', id)
    if (err) {
      console.error(err)
      setEstadoFila((s) => ({ ...s, [id]: 'error' }))
      window.alert(err.code === '23505' ? 'Ya existe un producto con ese código.' : 'No se pudo guardar ese cambio.')
      return
    }
    setEstadoFila((s) => ({ ...s, [id]: 'ok' }))
    setTimeout(() => {
      setEstadoFila((s) => {
        if (!(id in s)) return s
        const copia = { ...s }
        delete copia[id]
        return copia
      })
    }, 1500)
  }

  function alSalirNombre(id: number, valor: string) {
    const v = valor.trim()
    if (!v) { window.alert('El nombre no puede quedar vacío: no se guardó ese cambio.'); return }
    void persistirCampo(id, 'nombre', v)
  }

  async function aplicarStockMasivo() {
    const valor = Number(valorStockMasivo.replace(',', '.'))
    if (!Number.isFinite(valor) || valor < 0 || (accionStockMasivo !== 'fijar' && valor <= 0)) {
      window.alert('Ingresá una cantidad válida.')
      return
    }
    const ids = [...seleccion]
    if (ids.length === 0) return
    setAplicandoMasivo(true)
    let cursor = 0
    const trabajador = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++]
        const el = elementos.find((e) => e.id === id)
        if (!el) continue
        const nuevo = accionStockMasivo === 'fijar' ? Math.max(0, valor) : accionStockMasivo === 'sumar' ? el.stock + valor : Math.max(0, el.stock - valor)
        const { error: err } = await supabase.from('productos_servicios').update({ stock: nuevo }).eq('id', id)
        if (!err) setElementos((arr) => arr.map((x) => (x.id === id ? { ...x, stock: nuevo } : x)))
      }
    }
    await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()])
    setAplicandoMasivo(false)
    setValorStockMasivo('')
  }

  async function aplicarEstadoMasivoIds(ids: number[], activo: boolean) {
    if (ids.length === 0) return
    setAplicandoMasivo(true)
    const { error: err } = await supabase.from('productos_servicios').update({ activo }).in('id', ids)
    if (err) { console.error(err); window.alert('No se pudo actualizar el estado.') }
    else setElementos((arr) => arr.map((x) => (ids.includes(x.id) ? { ...x, activo } : x)))
    setAplicandoMasivo(false)
  }

  async function eliminarSeleccionados() {
    const ids = [...seleccion]
    if (ids.length === 0) return
    if (!window.confirm(`¿Eliminar ${ids.length} producto(s) del catálogo? Los que estén usados en algún presupuesto no se van a poder borrar.`)) return
    setEliminandoMasivo(true)
    const eliminados: number[] = []
    const bloqueados: ProductoServicio[] = []
    let cursor = 0
    const trabajador = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++]
        const { error: err } = await supabase.from('productos_servicios').delete().eq('id', id)
        if (err) {
          console.error(err)
          const el = elementos.find((e) => e.id === id)
          if (el) bloqueados.push(el)
        } else {
          eliminados.push(id)
        }
      }
    }
    await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()])
    setElementos((arr) => arr.filter((x) => !eliminados.includes(x.id)))
    setEliminandoMasivo(false)
    if (bloqueados.length > 0) {
      const nombres = bloqueados.map((b) => b.nombre).join(', ')
      const quiereDesactivar = window.confirm(`Se eliminaron ${eliminados.length}. ${bloqueados.length} no se pudieron borrar porque están usados en presupuestos: ${nombres}. ¿Los desactivo en su lugar?`)
      if (quiereDesactivar) await aplicarEstadoMasivoIds(bloqueados.map((b) => b.id), false)
      setSeleccion(new Set(quiereDesactivar ? [] : bloqueados.map((b) => b.id)))
    } else {
      setSeleccion(new Set())
      window.alert(`Se eliminaron ${eliminados.length} producto(s).`)
    }
  }

  // Simulación en vivo (usa precio de lista + descuento). Los precios son SIN IVA:
  // el IVA se suma solo cuando el cliente pide factura.
  const simDescuentoPct = aplicaDescuento && descuentoTipo === 'porcentaje' ? Number(descuentoValor || 0) : 0
  const simDescuentoMonto = aplicaDescuento && descuentoTipo === 'monto' ? Number(descuentoValor || 0) : 0
  const simPrecioFinal = precioFinalUnidad({ precio_venta: Number(precioLista || 0), aplica_descuento: aplicaDescuento, descuento_pct: simDescuentoPct, descuento_monto: simDescuentoMonto })
  const simGanancia = simPrecioFinal - Number(precioCompra || 0)
  const simMargen = simPrecioFinal > 0 ? (simGanancia / simPrecioFinal) * 100 : 0
  const simInversion = Number(precioCompra || 0) * Number(stock || 0)
  const simIvaPct = Number(ivaPct || 0)
  const simConIva = simPrecioFinal * (1 + simIvaPct / 100)
  const margenIgualAPct = modoGanancia === 'margen' && Number(gananciaPct || 0) >= 100

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
        {el.codigo && <small className="prodCat">Cód. {el.codigo}</small>}
        <small className="prodCat">{el.categoria || el.descripcion || 'Sin categoría'}{el.proveedor ? ` · ${el.proveedor}` : ''}</small>
        <div className="prodPrecio">
          {tieneDesc ? (<>
            <strong>{mostrar(final)}</strong><s>{mostrar(el.precio_venta)}</s>
            <span className="prodBadgeDesc">{el.descuento_pct > 0 ? `-${el.descuento_pct}%` : `-${mostrar(el.descuento_monto)}`}</span>
          </>) : <strong>{mostrar(el.precio_venta)}</strong>}
        </div>
        {el.iva_pct > 0 && <small className="prodCat">Sin IVA · con IVA {String(el.iva_pct).replace('.', ',')}%: {mostrar(final * (1 + el.iva_pct / 100))}</small>}
        <div className="prodDatos">
          <span>Compra <b>{mostrar(el.costo_unitario)}</b></span>
          <span>Ganancia <b>{mostrar(ganancia)}</b></span>
          <span>Margen <b>{margen.toFixed(1)}%</b></span>
          {el.tipo === 'producto' && <span>Invertido <b>{mostrar(el.costo_unitario * el.stock)}</b></span>}
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
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className={`editButton ${modoEdicion ? 'active' : ''}`} onClick={() => (modoEdicion ? salirEdicion() : entrarEdicion())}>
            {modoEdicion ? '✕ Salir de edición' : '✏️ Edición rápida'}
          </button>
          {!modoEdicion && <button className="editButton" onClick={() => setMostrarImportar(true)}>⬆ Importar CSV</button>}
          {!modoEdicion && <button className="newButton" onClick={abrirNuevo}>+ Nuevo</button>}
        </div>
      </div>

      {!cargando && !error && (
        <div className="prodKpis">
          <div><span>INVERSIÓN EN STOCK</span><strong>{mostrar(inversionStock)}</strong><small>Precio de compra × stock</small></div>
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
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por código, nombre, categoría o proveedor..." />
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
        {!modoEdicion && (
          <div className="crmFiltros">
            <div className="segTipo">
              <button type="button" className={moneda === 'ARS' ? 'active' : ''} onClick={() => cambiarMoneda('ARS')}>$ Pesos</button>
              <button type="button" className={moneda === 'USD' ? 'active' : ''} onClick={() => cambiarMoneda('USD')}>USD</button>
            </div>
            <button type="button" className="editButton" onClick={() => setMostrarCotizacion(true)}>
              {cotizacion > 0 ? `💲 USD 1 = $ ${String(cotizacion).replace('.', ',')}` : '💲 Cargar cotización'}
            </button>
          </div>
        )}
        {!modoEdicion && <VistaToggle vista={vista} onCambio={setVista} />}
      </div>

      {moneda === 'USD' && cotizacion <= 0 && !modoEdicion && (
        <p className="gestionAyuda">Para ver los valores en dólares, cargá primero la cotización con el botón "Cargar cotización".</p>
      )}

      {cargando && <p>Cargando lista...</p>}
      {error && <p className="loginError">{error}</p>}
      {!cargando && !error && elementosFiltrados.length === 0 && (
        <div className="empty"><span>📦</span><h3>Sin resultados</h3><p>Probá con otra búsqueda o filtro.</p></div>
      )}

      {!cargando && !error && elementosFiltrados.length > 0 && !modoEdicion && vista === 'kanban' && (
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

      {!cargando && !error && elementosFiltrados.length > 0 && !modoEdicion && vista === 'lista' && (
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
                    <td><strong>{el.nombre}</strong>{el.codigo && <><br /><small>{el.codigo}</small></>}</td>
                    <td>{el.proveedor || '—'}</td>
                    <td>{mostrar(el.costo_unitario)}</td>
                    <td>{mostrar(final)}</td>
                    <td>{mostrar(final - el.costo_unitario)}</td>
                    <td>{el.tipo === 'producto' ? <span className={`crmBadge ${nivel === 'sin' ? 'est-rechazado' : nivel === 'bajo' ? 'est-observacion' : 'est-aceptado'}`}>{el.stock}</span> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!cargando && !error && elementosFiltrados.length > 0 && modoEdicion && (
        <div className="crmListaWrap">
          {seleccion.size > 0 && (
            <div className="stockAviso" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
              <strong>{seleccion.size} seleccionado{seleccion.size === 1 ? '' : 's'}</strong>
              <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <select value={accionStockMasivo} onChange={(e) => setAccionStockMasivo(e.target.value as AccionStockMasivo)}>
                  <option value="sumar">Sumar stock</option>
                  <option value="restar">Restar stock</option>
                  <option value="fijar">Fijar stock en</option>
                </select>
                <input type="number" min="0" step="1" value={valorStockMasivo} onChange={(e) => setValorStockMasivo(e.target.value)} placeholder="cantidad" style={{ width: '90px' }} />
                <button type="button" className="editButton" disabled={aplicandoMasivo} onClick={() => void aplicarStockMasivo()}>Aplicar</button>
              </span>
              <button type="button" className="activateButton" disabled={aplicandoMasivo} onClick={() => void aplicarEstadoMasivoIds([...seleccion], true)}>Activar</button>
              <button type="button" className="deactivateButton" disabled={aplicandoMasivo} onClick={() => void aplicarEstadoMasivoIds([...seleccion], false)}>Desactivar</button>
              <button type="button" className="cancelButton" disabled={eliminandoMasivo} onClick={() => void eliminarSeleccionados()}>🗑 Eliminar</button>
            </div>
          )}
          <table className="crmLista">
            <thead>
              <tr>
                <th><input type="checkbox" checked={elementosFiltrados.length > 0 && elementosFiltrados.every((el) => seleccion.has(el.id))} onChange={alternarSeleccionTodos} /></th>
                <th>Código</th><th>Nombre</th><th>Tipo</th><th>Categoría</th><th>Proveedor</th><th>Unidad</th>
                <th>P. compra ($)</th><th>P. lista ($)</th><th>IVA</th><th>Stock</th><th>Stock mín.</th><th>Activo</th>
              </tr>
            </thead>
            <tbody>
              {elementosFiltrados.map((el) => (
                <tr key={el.id}>
                  <td>
                    <input type="checkbox" checked={seleccion.has(el.id)} onChange={() => alternarSeleccion(el.id)} />
                    {estadoFila[el.id] === 'guardando' && <small style={{ marginLeft: 4 }}>⏳</small>}
                    {estadoFila[el.id] === 'ok' && <small style={{ marginLeft: 4, color: '#1f7a4d' }}>✓</small>}
                    {estadoFila[el.id] === 'error' && <small style={{ marginLeft: 4, color: '#b23b32' }}>✕</small>}
                  </td>
                  <td><input value={el.codigo ?? ''} onChange={(e) => actualizarCampoLocal(el.id, 'codigo', e.target.value)} onBlur={(e) => persistirCampo(el.id, 'codigo', e.target.value.trim() || null)} style={{ width: '100px' }} /></td>
                  <td><input value={el.nombre} onChange={(e) => actualizarCampoLocal(el.id, 'nombre', e.target.value)} onBlur={(e) => alSalirNombre(el.id, e.target.value)} style={{ width: '180px' }} /></td>
                  <td>
                    <select value={el.tipo} onChange={(e) => { const v = e.target.value as 'producto' | 'servicio'; actualizarCampoLocal(el.id, 'tipo', v); void persistirCampo(el.id, 'tipo', v) }}>
                      <option value="producto">Producto</option><option value="servicio">Servicio</option>
                    </select>
                  </td>
                  <td><input value={el.categoria ?? ''} onChange={(e) => actualizarCampoLocal(el.id, 'categoria', e.target.value)} onBlur={(e) => persistirCampo(el.id, 'categoria', e.target.value.trim() || null)} style={{ width: '120px' }} /></td>
                  <td><input value={el.proveedor ?? ''} onChange={(e) => actualizarCampoLocal(el.id, 'proveedor', e.target.value)} onBlur={(e) => persistirCampo(el.id, 'proveedor', e.target.value.trim() || null)} style={{ width: '110px' }} /></td>
                  <td>
                    <select value={el.unidad} onChange={(e) => { actualizarCampoLocal(el.id, 'unidad', e.target.value); void persistirCampo(el.id, 'unidad', e.target.value) }}>
                      {UNIDADES.map((u) => <option key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}</option>)}
                    </select>
                  </td>
                  <td><input type="number" min="0" step="0.01" value={el.costo_unitario} onChange={(e) => actualizarCampoLocal(el.id, 'costo_unitario', Number(e.target.value))} onBlur={(e) => persistirCampo(el.id, 'costo_unitario', Number(e.target.value || 0))} style={{ width: '95px' }} /></td>
                  <td><input type="number" min="0" step="0.01" value={el.precio_venta} onChange={(e) => actualizarCampoLocal(el.id, 'precio_venta', Number(e.target.value))} onBlur={(e) => persistirCampo(el.id, 'precio_venta', Number(e.target.value || 0))} style={{ width: '95px' }} /></td>
                  <td>
                    <select value={el.iva_pct} onChange={(e) => { const v = Number(e.target.value); actualizarCampoLocal(el.id, 'iva_pct', v); void persistirCampo(el.id, 'iva_pct', v) }}>
                      <option value={21}>21%</option><option value={10.5}>10,5%</option><option value={27}>27%</option><option value={0}>0%</option>
                    </select>
                  </td>
                  <td><input type="number" min="0" step="1" value={el.stock} onChange={(e) => actualizarCampoLocal(el.id, 'stock', Number(e.target.value))} onBlur={(e) => persistirCampo(el.id, 'stock', Number(e.target.value || 0))} style={{ width: '70px' }} /></td>
                  <td><input type="number" min="0" step="1" value={el.stock_minimo} onChange={(e) => actualizarCampoLocal(el.id, 'stock_minimo', Number(e.target.value))} onBlur={(e) => persistirCampo(el.id, 'stock_minimo', Number(e.target.value || 0))} style={{ width: '70px' }} /></td>
                  <td><input type="checkbox" checked={el.activo} onChange={(e) => { const v = e.target.checked; actualizarCampoLocal(el.id, 'activo', v); void persistirCampo(el.id, 'activo', v) }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="gestionAyuda">
            Los cambios se guardan solos al salir de cada campo (Tab o clic afuera). Los precios acá siempre están en pesos.
            Foto, descuento y link se editan desde la ficha completa (salí de la edición rápida y tocá "Editar" en el producto).
          </p>
        </div>
      )}

      {mostrarImportar && (
        <ImportarCatalogo
          existentes={elementos}
          modoInicial={modoGanancia}
          onCerrar={() => setMostrarImportar(false)}
          onTerminado={() => { void cargarCatalogo() }}
        />
      )}

      {mostrarCotizacion && (
        <ActualizarCotizacion
          elementos={elementos}
          onCerrar={alCerrarCotizacion}
          onActualizado={() => { void cargarCatalogo() }}
        />
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
                <label>Código / SKU<input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej.: QS-1234 (para importar desde hoja)" /></label>
                <label>Nombre *<input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Módulo inteligente" required /></label>
                <label>Categoría<input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ej.: Domótica" /></label>
                <label>Proveedor<input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Ej.: Tuya / Sonoff" /></label>

                <div className="formFull" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 14px' }}>
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>El % de ganancia es un:</span>
                  <div className="segTipo">
                    <button type="button" className={modoGanancia === 'margen' ? 'active' : ''} onClick={() => cambiarModo('margen')}>Margen sobre la venta</button>
                    <button type="button" className={modoGanancia === 'recargo' ? 'active' : ''} onClick={() => cambiarModo('recargo')}>Recargo sobre el costo</button>
                  </div>
                  <small style={{ color: '#78828f', flexBasis: '100%' }}>
                    {modoGanancia === 'margen'
                      ? 'Margen 50%: la mitad del precio de venta es ganancia. Costo 45.000 → precio 90.000.'
                      : 'Recargo 50%: se suma la mitad del costo. Costo 45.000 → precio 67.500 (margen real 33,3%).'}
                  </small>
                </div>

                <label>Precio de compra<input type="number" min="0" step="0.01" value={precioCompra} onChange={(e) => cambiarCompra(e.target.value)} placeholder="0,00" /></label>
                <label>{modoGanancia === 'margen' ? '% de margen (sobre la venta)' : '% de recargo (sobre el costo)'}<input type="number" step="0.1" max={modoGanancia === 'margen' ? 99.9 : undefined} value={gananciaPct} onChange={(e) => cambiarGanancia(e.target.value)} placeholder="Ej.: 50" /></label>
                <label>Precio de lista (sin IVA)<input type="number" min="0" step="0.01" value={precioLista} onChange={(e) => cambiarLista(e.target.value)} placeholder="0,00" /></label>
                {margenIgualAPct && <p className="loginError formFull">Un margen de 100% o más no es posible: el precio de venta sería infinito. Usá menos de 100%.</p>}

                {tipo === 'producto' && <label>Stock (cantidad)<input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" /></label>}
                {tipo === 'producto' && <label>Stock mínimo (alerta)<input type="number" min="0" step="1" value={stockMinimo} onChange={(e) => setStockMinimo(e.target.value)} placeholder="5" /></label>}
                <label>Unidad
                  <select value={unidad} onChange={(e) => setUnidad(e.target.value)}>
                    <option value="unidad">Unidad</option><option value="metro">Metro</option><option value="hora">Hora</option>
                    <option value="servicio">Servicio</option><option value="kit">Kit</option><option value="boca">Boca</option><option value="circuito">Circuito</option>
                  </select>
                </label>
                <label>IVA (se suma si el cliente pide factura)
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
                    <div><small>Precio sin IVA / unidad</small><strong>{formatoDinero(simPrecioFinal)}</strong></div>
                    <div><small>Con factura (IVA {String(simIvaPct).replace('.', ',')}%)</small><strong>{formatoDinero(simConIva)}</strong></div>
                    <div><small>Ganancia / unidad</small><strong className={simGanancia < 0 ? 'neg' : ''}>{formatoDinero(simGanancia)}</strong></div>
                    <div><small>Margen sobre la venta</small><strong>{simMargen.toFixed(1)}%</strong></div>
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
