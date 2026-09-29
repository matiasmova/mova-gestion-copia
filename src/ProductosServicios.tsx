import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Pedido } from './BuscadorGlobal'
import { supabase } from './supabase'
import VistaToggle, { useVista } from './VistaToggle'
import ImportarCatalogo from './ImportarCatalogo'
import ActualizarCotizacion from './ActualizarCotizacion'
import { dos, gananciaDesdePrecio, precioDesdeGanancia, type ModoGanancia } from './catalogoCalculos'
import { formatoDinero, formatoDolar, guardarMoneda, leerCotizacion, leerMoneda, type Moneda } from './catalogoMoneda'
import { confirmarEliminacion } from './confirmar'
import { cargarConfig } from './config'

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
  // Moneda en la que se carga el precio. En USD, costo_unitario/precio_venta
  // (pesos) se calculan con la cotización y se recalculan al cambiarla.
  moneda: 'ARS' | 'USD'
  costo_usd: number | null
  precio_usd: number | null
  // Cómo aparece en el presupuesto (genérico, sin marca ni detalle interno).
  nombre_presupuesto: string | null
  // Vínculo con la tienda web (Tiendanube); si falta el SQL quedan vacíos.
  tn_variant_id?: number | null
  tn_sincronizar?: boolean
  fotoView?: string | null
}

type TipoFiltro = 'todos' | 'producto' | 'servicio'
type EstadoFiltro = 'activos' | 'inactivos' | 'todos'
type AccionStockMasivo = 'sumar' | 'restar' | 'fijar'
type EstadoGuardadoFila = 'guardando' | 'ok' | 'error'

const BUCKET = 'productos'
const CLAVE_MODO = 'mova_modo_ganancia'
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

function ProductosServicios({ pedido, onPedidoAtendido }: { pedido?: Pedido | null; onPedidoAtendido?: () => void } = {}) {
  const [elementos, setElementos] = useState<ProductoServicio[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('todos')
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('activos')
  const [soloStockBajo, setSoloStockBajo] = useState(false)
  // Pestaña y filtros avanzados
  const [pestana, setPestana] = useState<'catalogo' | 'stock'>('catalogo')
  const [verFiltros, setVerFiltros] = useState(false)
  const [fCategoria, setFCategoria] = useState('todas')
  const [fProveedor, setFProveedor] = useState('todos')
  const [fMoneda, setFMoneda] = useState<'todas' | 'ARS' | 'USD'>('todas')
  const [fStock, setFStock] = useState<'todos' | 'sin' | 'bajo' | 'ok'>('todos')
  const [fFoto, setFFoto] = useState<'todas' | 'con' | 'sin'>('todas')
  const [fDatos, setFDatos] = useState<'todos' | 'sinPrecio' | 'sinCosto'>('todos')
  const [fRotacion, setFRotacion] = useState<'todos' | 'parados' | 'vendidos'>('todos')
  const [orden, setOrden] = useState<'nombre' | 'precioAsc' | 'precioDesc' | 'stock' | 'vendidos' | 'inversion'>('nombre')
  // Ventas (presupuestos aceptados) por producto, para rotación.
  const [ventas, setVentas] = useState<Record<number, { unidades: number; veces: number; ultima: string | null; fechas: { f: string; c: number }[] }>>({})
  const [diasVendidos, setDiasVendidos] = useState(90)
  const [diasParado, setDiasParado] = useState(90)
  const [vista, setVista] = useVista('productos', 'kanban')

  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [mostrarImportar, setMostrarImportar] = useState(false)
  const [mostrarCotizacion, setMostrarCotizacion] = useState(false)
  const [editando, setEditando] = useState<ProductoServicio | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorFormulario, setErrorFormulario] = useState('')

  const [tipo, setTipo] = useState<'producto' | 'servicio'>('producto')
  const [monedaProd, setMonedaProd] = useState<'ARS' | 'USD'>('ARS')
  const [nombrePresupuesto, setNombrePresupuesto] = useState('')
  const [tnSincronizar, setTnSincronizar] = useState(true)
  const [faltaSqlMoneda, setFaltaSqlMoneda] = useState(false)
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
    void cargarConfig().then(() => setCotizacion(leerCotizacion()))
    const columnas = 'id, created_at, codigo, tipo, nombre, descripcion, categoria, unidad, precio_venta, costo_unitario, stock, stock_minimo, proveedor, link_compra, iva_pct, foto_url, aplica_descuento, descuento_pct, descuento_monto, activo'
    let consulta = await supabase.from('productos_servicios').select(`${columnas}, moneda, costo_usd, precio_usd, nombre_presupuesto`).order('nombre', { ascending: true })
    // Si todavía no se corrió el SQL de moneda por producto, se lee como antes (todo en pesos).
    setFaltaSqlMoneda(!!consulta.error)
    if (consulta.error) consulta = await supabase.from('productos_servicios').select(columnas).order('nombre', { ascending: true }) as typeof consulta
    const { data, error: errorConsulta } = consulta
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
      moneda: (el as { moneda?: string }).moneda === 'USD' ? 'USD' : 'ARS',
      costo_usd: (el as { costo_usd?: number | null }).costo_usd == null ? null : Number((el as { costo_usd?: number }).costo_usd),
      precio_usd: (el as { precio_usd?: number | null }).precio_usd == null ? null : Number((el as { precio_usd?: number }).precio_usd),
      nombre_presupuesto: (el as { nombre_presupuesto?: string | null }).nombre_presupuesto ?? null,
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
    void cargarVentas()
    // Vínculo con la tienda web (si ya se corrió el SQL de Tiendanube).
    void supabase.from('productos_servicios').select('id, tn_variant_id, tn_sincronizar').not('tn_variant_id', 'is', null)
      .then(({ data: tn, error: e }) => {
        if (e || !tn?.length) return
        const mapa = new Map((tn as { id: number; tn_variant_id: number; tn_sincronizar: boolean }[]).map((x) => [x.id, x]))
        setElementos((arr) => arr.map((x) => (mapa.has(x.id) ? { ...x, tn_variant_id: mapa.get(x.id)!.tn_variant_id, tn_sincronizar: mapa.get(x.id)!.tn_sincronizar } : x)))
      })
  }

  // Cuánto salió cada producto en presupuestos aceptados (y cuándo fue la última vez).
  async function cargarVentas() {
    const rP = await supabase.from('presupuestos').select('id, fecha, estado, activo').eq('estado', 'aceptado')
    if (rP.error) return
    const aceptados = new Map(((rP.data ?? []) as { id: number; fecha: string | null; activo: boolean }[]).filter((p) => p.activo !== false).map((p) => [p.id, p.fecha ?? '']))
    if (aceptados.size === 0) { setVentas({}); return }
    const items: { catalogo_id: number | null; cantidad: number; presupuesto_id: number }[] = []
    const ids = [...aceptados.keys()]
    for (let i = 0; i < ids.length; i += 200) {
      const r = await supabase.from('presupuesto_items').select('catalogo_id, cantidad, presupuesto_id').in('presupuesto_id', ids.slice(i, i + 200)).not('catalogo_id', 'is', null)
      if (!r.error) items.push(...((r.data ?? []) as typeof items))
    }
    const mapa: Record<number, { unidades: number; veces: number; ultima: string | null; fechas: { f: string; c: number }[] }> = {}
    for (const it of items) {
      if (it.catalogo_id == null) continue
      const f = (aceptados.get(it.presupuesto_id) ?? '').slice(0, 10)
      const v = (mapa[it.catalogo_id] ??= { unidades: 0, veces: 0, ultima: null, fechas: [] })
      v.unidades += Number(it.cantidad) || 0
      v.veces++
      v.fechas.push({ f, c: Number(it.cantidad) || 0 })
      if (f && (!v.ultima || f > v.ultima)) v.ultima = f
    }
    setVentas(mapa)
  }

  const hoyMs = Date.now()
  const diasDesde = (f: string | null) => (f ? Math.floor((hoyMs - new Date(`${f}T12:00:00`).getTime()) / 86400000) : null)
  const vendidasEn = (id: number, dias: number) => (ventas[id]?.fechas ?? []).filter((x) => { const d = diasDesde(x.f); return d != null && d <= dias }).reduce((s, x) => s + x.c, 0)
  const estaParado = (el: ProductoServicio) => {
    if (el.tipo !== 'producto' || !el.activo || el.stock <= 0) return false
    const d = diasDesde(ventas[el.id]?.ultima ?? null)
    return d == null || d > diasParado
  }
  const categorias = useMemo(() => Array.from(new Set(elementos.map((e) => e.categoria?.trim()).filter((x): x is string => !!x))).sort(), [elementos])
  const proveedoresLista = useMemo(() => Array.from(new Set(elementos.map((e) => e.proveedor?.trim()).filter((x): x is string => !!x))).sort(), [elementos])
  const filtrosAvanzadosActivos = [fCategoria !== 'todas', fProveedor !== 'todos', fMoneda !== 'todas', fStock !== 'todos', fFoto !== 'todas', fRotacion !== 'todos', fDatos !== 'todos'].filter(Boolean).length
  function limpiarFiltrosAvanzados() { setFCategoria('todas'); setFProveedor('todos'); setFMoneda('todas'); setFStock('todos'); setFFoto('todas'); setFRotacion('todos'); setFDatos('todos'); setOrden('nombre') }

  const elementosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    const lista = elementos.filter((el) => {
      const coincideBusqueda = !texto || (el.codigo ?? '').toLowerCase().includes(texto) || el.nombre.toLowerCase().includes(texto) || (el.nombre_presupuesto ?? '').toLowerCase().includes(texto) || (el.descripcion ?? '').toLowerCase().includes(texto) || (el.categoria ?? '').toLowerCase().includes(texto) || (el.proveedor ?? '').toLowerCase().includes(texto)
      const coincideTipo = tipoFiltro === 'todos' || el.tipo === tipoFiltro
      const coincideEstado = estadoFiltro === 'todos' || (estadoFiltro === 'activos' && el.activo) || (estadoFiltro === 'inactivos' && !el.activo)
      const coincideStock = !soloStockBajo || nivelStock(el) === 'bajo' || nivelStock(el) === 'sin'
      if (!(coincideBusqueda && coincideTipo && coincideEstado && coincideStock)) return false
      if (fCategoria !== 'todas' && (el.categoria?.trim() || 'Sin categoría') !== fCategoria && (el.categoria?.trim() ?? '') !== fCategoria) return false
      if (fProveedor !== 'todos' && (el.proveedor?.trim() ?? '') !== fProveedor) return false
      if (fMoneda !== 'todas' && el.moneda !== fMoneda) return false
      if (fStock !== 'todos' && nivelStock(el) !== fStock) return false
      if (fFoto === 'con' && !el.foto_url) return false
      if (fFoto === 'sin' && el.foto_url) return false
      if (fRotacion === 'parados' && !estaParado(el)) return false
      if (fDatos === 'sinPrecio' && el.precio_venta > 0) return false
      if (fDatos === 'sinCosto' && (el.costo_unitario > 0 || el.tipo !== 'producto')) return false
      if (fRotacion === 'vendidos' && !(vendidasEn(el.id, diasVendidos) > 0)) return false
      return true
    })
    const cmp: Record<typeof orden, (a: ProductoServicio, b: ProductoServicio) => number> = {
      nombre: (a, b) => a.nombre.localeCompare(b.nombre),
      precioAsc: (a, b) => a.precio_venta - b.precio_venta,
      precioDesc: (a, b) => b.precio_venta - a.precio_venta,
      stock: (a, b) => a.stock - b.stock,
      vendidos: (a, b) => vendidasEn(b.id, diasVendidos) - vendidasEn(a.id, diasVendidos),
      inversion: (a, b) => b.costo_unitario * b.stock - a.costo_unitario * a.stock,
    }
    return lista.sort(cmp[orden])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementos, busqueda, tipoFiltro, estadoFiltro, soloStockBajo, fCategoria, fProveedor, fMoneda, fStock, fFoto, fRotacion, fDatos, orden, ventas, diasVendidos, diasParado])

  const inversionStock = elementos.filter((el) => el.tipo === 'producto' && el.activo).reduce((s, el) => s + el.costo_unitario * el.stock, 0)
  const bajos = elementos.filter((el) => el.activo && (nivelStock(el) === 'bajo' || nivelStock(el) === 'sin'))
  const sinPrecio = elementos.filter((el) => el.activo && !(el.precio_venta > 0)).length
  const sinCosto = elementos.filter((el) => el.activo && el.tipo === 'producto' && !(el.costo_unitario > 0)).length
  // Categorías con cantidad, para los botones rápidos de la vista de tarjetas.
  const chipsCategoria = useMemo(() => {
    const m = new Map<string, number>()
    elementos.filter((el) => estadoFiltro === 'todos' || (estadoFiltro === 'activos') === el.activo).forEach((el) => { const c = el.categoria?.trim() || 'Sin categoría'; m.set(c, (m.get(c) ?? 0) + 1) })
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [elementos, estadoFiltro])

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
    setMonedaProd('ARS'); setNombrePresupuesto('')
    setTipo('producto'); setCodigo(''); setNombre(''); setDescripcion(''); setCategoria(''); setProveedor(''); setLinkCompra('')
    setUnidad('unidad'); setPrecioCompra(''); setGananciaPct(''); setPrecioLista(''); setStock(''); setStockMinimo('5'); setIvaPct('21')
    setAplicaDescuento(false); setDescuentoTipo('porcentaje'); setDescuentoValor('')
    setFotoUrl(null); setFotoPreview(''); setErrorFormulario('')
  }
  // Pedido del buscador general o del botón "+".
  useEffect(() => {
    if (!pedido) return
    if (pedido.accion === 'nuevo') { abrirNuevo(); onPedidoAtendido?.(); return }
    if (pedido.accion === 'abrir' && elementos.length > 0) {
      const el = elementos.find((x) => x.id === pedido.id)
      if (el) { setPestana('catalogo'); void abrirEdicion(el) }
      onPedidoAtendido?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido, elementos])

  function abrirNuevo() { setEditando(null); limpiarFormulario(); setMostrarFormulario(true) }
  async function abrirEdicion(el: ProductoServicio) {
    if (modoEdicion) return
    setEditando(el)
    setTipo(el.tipo); setCodigo(el.codigo ?? ''); setNombre(el.nombre); setDescripcion(el.descripcion ?? ''); setCategoria(el.categoria ?? '')
    setProveedor(el.proveedor ?? ''); setLinkCompra(el.link_compra ?? ''); setUnidad(el.unidad)
    setMonedaProd(el.moneda); setNombrePresupuesto(el.nombre_presupuesto ?? ''); setTnSincronizar(el.tn_sincronizar !== false)
    // En un producto en dólares, los precios del formulario son en dólares.
    const compra = el.moneda === 'USD' ? el.costo_usd ?? 0 : el.costo_unitario
    const lista = el.moneda === 'USD' ? el.precio_usd ?? 0 : el.precio_venta
    setPrecioCompra(compra ? String(compra) : '')
    setPrecioLista(lista ? String(lista) : '')
    setGananciaPct(compra > 0 && lista > 0 ? String(dos(gananciaDesdePrecio(compra, lista, modoGanancia))) : '')
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
    if (monedaProd === 'USD' && faltaSqlMoneda) { setErrorFormulario('Para cargar productos en dólares falta correr el SQL de Productos en Supabase.'); return }
    if (monedaProd === 'USD' && !(cotizacion > 0)) { setErrorFormulario('Para cargar precios en dólares, primero cargá la cotización (botón 💲).'); return }
    setGuardando(true)
    const enUsd = monedaProd === 'USD'
    const compraNum = Number(precioCompra || 0)
    const listaNum = Number(precioLista || 0)
    const descuentoPct = aplicaDescuento && descuentoTipo === 'porcentaje' ? Number(descuentoValor || 0) : 0
    const descuentoMonto = aplicaDescuento && descuentoTipo === 'monto' ? Number(descuentoValor || 0) : 0
    const datos = {
      tipo, codigo: codigo.trim() || null, nombre: nombre.trim(), descripcion: descripcion.trim() || null, categoria: categoria.trim() || null,
      proveedor: proveedor.trim() || null, link_compra: linkCompra.trim() || null, unidad,
      precio_venta: enUsd ? dos(listaNum * cotizacion) : listaNum, costo_unitario: enUsd ? dos(compraNum * cotizacion) : compraNum,
      ...(faltaSqlMoneda ? {} : { moneda: monedaProd, costo_usd: enUsd ? compraNum : null, precio_usd: enUsd ? listaNum : null, nombre_presupuesto: nombrePresupuesto.trim() || null }),
      stock: Number(stock || 0), stock_minimo: Number(stockMinimo || 0), iva_pct: Number(ivaPct || 21),
      foto_url: fotoUrl, aplica_descuento: aplicaDescuento, descuento_pct: descuentoPct, descuento_monto: descuentoMonto,
    }
    const resultado = editando
      ? await supabase.from('productos_servicios').update(datos).eq('id', editando.id)
      : await supabase.from('productos_servicios').insert({ ...datos, activo: true })
    if (!resultado.error && editando?.tn_variant_id && (editando.tn_sincronizar !== false) !== tnSincronizar) {
      await supabase.from('productos_servicios').update({ tn_sincronizar: tnSincronizar }).eq('id', editando.id)
    }
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
    return persistirCampos(id, { [campo]: valor })
  }

  async function persistirCampos(id: number, cambios: Record<string, unknown>) {
    setEstadoFila((s) => ({ ...s, [id]: 'guardando' }))
    const { error: err } = await supabase.from('productos_servicios').update(cambios).eq('id', id)
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
    if (!confirmarEliminacion(`¿Eliminar ${ids.length} producto(s) del catálogo? Los que estén usados en algún presupuesto no se van a poder borrar.`)) return
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
  const factorSim = monedaProd === 'USD' && cotizacion > 0 ? cotizacion : 1
  const simPrecioFinal = precioFinalUnidad({ precio_venta: Number(precioLista || 0) * factorSim, aplica_descuento: aplicaDescuento, descuento_pct: simDescuentoPct, descuento_monto: simDescuentoMonto })
  const simGanancia = simPrecioFinal - Number(precioCompra || 0) * factorSim
  const simMargen = simPrecioFinal > 0 ? (simGanancia / simPrecioFinal) * 100 : 0
  const simInversion = Number(precioCompra || 0) * factorSim * Number(stock || 0)
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
        {el.nombre_presupuesto && <small className="prodPres" title="Así aparece en el presupuesto">📄 {el.nombre_presupuesto}</small>}
        {el.tn_variant_id && <small className={`prodWeb ${el.tn_sincronizar === false ? 'pausa' : ''}`} title="Vinculado con la tienda web (Tiendanube)">🛒 {el.tn_sincronizar === false ? 'En la web · sin sincronizar' : 'En la web · se actualiza solo'}</small>}
        {el.codigo && <small className="prodCat">Cód. {el.codigo}</small>}
        <small className="prodCat">{el.categoria || el.descripcion || 'Sin categoría'}{el.proveedor ? ` · ${el.proveedor}` : ''}</small>
        <div className="prodPrecio">
          {tieneDesc ? (<>
            <strong>{mostrar(final)}</strong><s>{mostrar(el.precio_venta)}</s>
            <span className="prodBadgeDesc">{el.descuento_pct > 0 ? `-${el.descuento_pct}%` : `-${mostrar(el.descuento_monto)}`}</span>
          </>) : el.precio_venta > 0 ? <strong>{mostrar(el.precio_venta)}</strong> : <button type="button" className="prodSinPrecio" onClick={() => abrirEdicion(el)}>Sin precio · cargar</button>}
        </div>
        {el.moneda === 'USD' && <small className="prodUsd">US$ {formatoDolar(el.precio_usd ?? 0).replace('$', '').trim()} · compra US$ {formatoDolar(el.costo_usd ?? 0).replace('$', '').trim()} · sigue al dólar</small>}
        {el.iva_pct > 0 && <small className="prodCat">Sin IVA · con IVA {String(el.iva_pct).replace('.', ',')}%: {mostrar(final * (1 + el.iva_pct / 100))}</small>}
        <div className="prodDatos">
          <span>Compra <b className={el.tipo === 'producto' && !(el.costo_unitario > 0) ? 'prodFalta' : ''}>{el.tipo === 'producto' && !(el.costo_unitario > 0) ? 'falta' : mostrar(el.costo_unitario)}</b></span>
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
          {!modoEdicion && <button className="editButton" onClick={() => setMostrarImportar(true)}>⬆ Importar (Excel, CSV, PDF)</button>}
          {!modoEdicion && <button className="newButton" onClick={abrirNuevo}>+ Nuevo</button>}
        </div>
      </div>

      <div className="gestionTabs homeTabs">
        <button className={pestana === 'catalogo' ? 'active' : ''} onClick={() => setPestana('catalogo')}>📦 Catálogo</button>
        <button className={pestana === 'stock' ? 'active' : ''} onClick={() => setPestana('stock')}>📊 Stock y rotación{bajos.length ? ` · ⚠ ${bajos.length}` : ''}</button>
      </div>
      {faltaSqlMoneda && !cargando && <p className="gestionAyuda usFalta">Falta correr el SQL de Productos en Supabase: hasta entonces todo queda en pesos y no se guarda el "nombre en presupuesto".</p>}

      {pestana === 'stock' && !cargando && !error && (
        <StockRotacion
          elementos={elementos}
          ventas={ventas}
          diasVendidos={diasVendidos}
          diasParado={diasParado}
          onDiasVendidos={setDiasVendidos}
          onDiasParado={setDiasParado}
          vendidasEn={vendidasEn}
          estaParado={estaParado}
          diasDesde={diasDesde}
          mostrar={mostrar}
          onEditar={(el) => { setPestana('catalogo'); void abrirEdicion(el) }}
          onMinimo={(el, v) => { actualizarCampoLocal(el.id, 'stock_minimo', v); void persistirCampo(el.id, 'stock_minimo', v) }}
        />
      )}

      {pestana === 'catalogo' && <>
      {!cargando && !error && (
        <div className="prodKpis">
          <div><span>INVERSIÓN EN STOCK</span><strong>{mostrar(inversionStock)}</strong><small>Precio de compra × stock</small></div>
          <div><span>PRODUCTOS ACTIVOS</span><strong>{elementos.filter((e) => e.tipo === 'producto' && e.activo).length}</strong><small>En catálogo</small></div>
          <button type="button" className={`prodKpiBtn ${bajos.length ? 'alertaStock' : ''} ${soloStockBajo ? 'activo' : ''}`} onClick={() => setSoloStockBajo((v) => !v)}>
            <span>STOCK BAJO</span><strong>{bajos.length}</strong><small>{soloStockBajo ? 'Mostrando solo estos ✓' : 'Tocá para filtrar'}</small>
          </button>
          <button type="button" className={`prodKpiBtn ${sinPrecio + sinCosto ? 'alertaStock' : ''} ${fDatos !== 'todos' ? 'activo' : ''}`} onClick={() => setFDatos((v) => (v === 'todos' ? (sinPrecio ? 'sinPrecio' : sinCosto ? 'sinCosto' : 'todos') : v === 'sinPrecio' && sinCosto ? 'sinCosto' : 'todos'))}>
            <span>PARA COMPLETAR</span><strong>{sinPrecio + sinCosto}</strong><small>{fDatos === 'sinPrecio' ? `Mostrando ${sinPrecio} sin precio ✓` : fDatos === 'sinCosto' ? `Mostrando ${sinCosto} sin costo ✓` : `${sinPrecio} sin precio · ${sinCosto} sin costo`}</small>
          </button>
        </div>
      )}

      {!cargando && !error && bajos.length > 0 && (
        <div className="stockAviso stockAvisoCorto">
          <span><strong>⚠ {bajos.length} producto{bajos.length === 1 ? '' : 's'} para reponer:</strong> {bajos.slice(0, 3).map((el) => `${el.nombre} (${el.stock})`).join(' · ')}{bajos.length > 3 ? ` y ${bajos.length - 3} más` : ''}</span>
          <span className="stockAvisoAcc">
            <button type="button" className="caLink" onClick={() => setSoloStockBajo(true)}>Ver cuáles</button>
            <button type="button" className="caLink" onClick={() => setPestana('stock')}>Stock y rotación →</button>
          </span>
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

      {!modoEdicion && (
        <div className="prFiltrosBarra">
          <button type="button" className={`editButton ${verFiltros || filtrosAvanzadosActivos ? 'active' : ''}`} onClick={() => setVerFiltros((v) => !v)}>
            🔎 Filtros avanzados{filtrosAvanzadosActivos ? ` (${filtrosAvanzadosActivos})` : ''}
          </button>
          <label>Ordenar
            <select value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)}>
              <option value="nombre">Nombre (A-Z)</option>
              <option value="precioAsc">Precio: menor a mayor</option>
              <option value="precioDesc">Precio: mayor a menor</option>
              <option value="stock">Menos stock primero</option>
              <option value="vendidos">Más vendidos ({diasVendidos} días)</option>
              <option value="inversion">Más plata invertida</option>
            </select>
          </label>
          <small>{elementosFiltrados.length} de {elementos.length}</small>
          {filtrosAvanzadosActivos > 0 && <button type="button" className="caLink" onClick={limpiarFiltrosAvanzados}>Limpiar filtros ✕</button>}
        </div>
      )}
      {!modoEdicion && verFiltros && (
        <div className="prFiltros">
          <label>Categoría<select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)}><option value="todas">Todas</option>{categorias.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label>Proveedor / marca<select value={fProveedor} onChange={(e) => setFProveedor(e.target.value)}><option value="todos">Todos</option>{proveedoresLista.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label>Moneda<select value={fMoneda} onChange={(e) => setFMoneda(e.target.value as typeof fMoneda)}><option value="todas">Pesos y dólares</option><option value="ARS">Solo en pesos</option><option value="USD">Solo en dólares</option></select></label>
          <label>Stock<select value={fStock} onChange={(e) => setFStock(e.target.value as typeof fStock)}><option value="todos">Todos</option><option value="sin">Sin stock</option><option value="bajo">Stock bajo</option><option value="ok">Stock OK</option></select></label>
          <label>Foto<select value={fFoto} onChange={(e) => setFFoto(e.target.value as typeof fFoto)}><option value="todas">Con y sin foto</option><option value="con">Con foto</option><option value="sin">Sin foto</option></select></label>
          <label>Datos<select value={fDatos} onChange={(e) => setFDatos(e.target.value as typeof fDatos)}><option value="todos">Todos</option><option value="sinPrecio">Sin precio de venta</option><option value="sinCosto">Sin precio de compra</option></select></label>
          <label>Rotación<select value={fRotacion} onChange={(e) => setFRotacion(e.target.value as typeof fRotacion)}><option value="todos">Todos</option><option value="vendidos">Se vendieron en {diasVendidos} días</option><option value="parados">Parados (+{diasParado} días sin salir)</option></select></label>
        </div>
      )}

      {moneda === 'USD' && cotizacion <= 0 && !modoEdicion && (
        <p className="gestionAyuda">Para ver los valores en dólares, cargá primero la cotización con el botón "Cargar cotización".</p>
      )}

      {cargando && <p>Cargando lista...</p>}
      {error && <p className="loginError">{error}</p>}
      {!cargando && !error && elementosFiltrados.length === 0 && (
        <div className="empty"><span>📦</span><h3>Sin resultados</h3><p>Probá con otra búsqueda o filtro.</p></div>
      )}

      {!cargando && !error && !modoEdicion && vista === 'kanban' && chipsCategoria.length > 1 && (
        <div className="prodChips" role="tablist" aria-label="Categorías">
          <button type="button" className={fCategoria === 'todas' ? 'active' : ''} onClick={() => setFCategoria('todas')}>Todas <b>{chipsCategoria.reduce((x, [, n]) => x + n, 0)}</b></button>
          {chipsCategoria.map(([c, n]) => <button type="button" key={c} className={fCategoria === c ? 'active' : ''} onClick={() => setFCategoria(fCategoria === c ? 'todas' : c)}>{c} <b>{n}</b></button>)}
        </div>
      )}
      {!cargando && !error && elementosFiltrados.length > 0 && !modoEdicion && vista === 'kanban' && (
        <div className="prodGrid">
          {elementosFiltrados.map((el) => tarjeta(el))}
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
                    <td>{mostrar(final)}{el.moneda === 'USD' && <><br /><small className="prodUsdMini">US$ {formatoDolar(el.precio_usd ?? 0).replace('$', '').trim()}</small></>}</td>
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
                <th>P. compra</th><th>P. lista</th><th>IVA</th><th>Stock</th><th>Stock mín.</th><th>Activo</th>
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
                  {el.moneda === 'USD' ? <>
                    <td><small className="prodUsdMini">US$</small><input type="number" min="0" step="0.01" value={el.costo_usd ?? 0} onChange={(e) => actualizarCampoLocal(el.id, 'costo_usd', Number(e.target.value))} onBlur={(e) => { const v = Number(e.target.value || 0); actualizarCampoLocal(el.id, 'costo_unitario', dos(v * cotizacion)); void persistirCampos(el.id, { costo_usd: v, costo_unitario: dos(v * cotizacion) }) }} style={{ width: '85px' }} /></td>
                    <td><small className="prodUsdMini">US$</small><input type="number" min="0" step="0.01" value={el.precio_usd ?? 0} onChange={(e) => actualizarCampoLocal(el.id, 'precio_usd', Number(e.target.value))} onBlur={(e) => { const v = Number(e.target.value || 0); actualizarCampoLocal(el.id, 'precio_venta', dos(v * cotizacion)); void persistirCampos(el.id, { precio_usd: v, precio_venta: dos(v * cotizacion) }) }} style={{ width: '85px' }} /></td>
                  </> : <>
                    <td><input type="number" min="0" step="0.01" value={el.costo_unitario} onChange={(e) => actualizarCampoLocal(el.id, 'costo_unitario', Number(e.target.value))} onBlur={(e) => persistirCampo(el.id, 'costo_unitario', Number(e.target.value || 0))} style={{ width: '95px' }} /></td>
                    <td><input type="number" min="0" step="0.01" value={el.precio_venta} onChange={(e) => actualizarCampoLocal(el.id, 'precio_venta', Number(e.target.value))} onBlur={(e) => persistirCampo(el.id, 'precio_venta', Number(e.target.value || 0))} style={{ width: '95px' }} /></td>
                  </>}
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
            Los cambios se guardan solos al salir de cada campo (Tab o clic afuera). Los productos en dólares se editan en US$ y se pasan a pesos con la cotización.
            Foto, descuento y link se editan desde la ficha completa (salí de la edición rápida y tocá "Editar" en el producto).
          </p>
        </div>
      )}

      </>}

      {mostrarImportar && (
        <ImportarCatalogo
          existentes={elementos}
          modoInicial={modoGanancia}
          conMoneda={!faltaSqlMoneda}
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
                <label>Nombre interno *<input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: TP-Link Deco X20 AX1800 (pack x3)" required /></label>
                <label>Cómo aparece en el presupuesto<input value={nombrePresupuesto} onChange={(e) => setNombrePresupuesto(e.target.value)} placeholder="Ej.: Red mesh WiFi 6 · Domótica de iluminación" /><small className="npAyuda">El cliente ve solo esto (sin marca, modelo, foto ni detalle). Si lo dejás vacío, sale el nombre interno.</small></label>
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

                <div className="formFull prMoneda">
                  <span>Precio cargado en:</span>
                  <div className="segTipo">
                    <button type="button" className={monedaProd === 'ARS' ? 'active' : ''} onClick={() => setMonedaProd('ARS')}>$ Pesos</button>
                    <button type="button" className={monedaProd === 'USD' ? 'active' : ''} onClick={() => setMonedaProd('USD')}>US$ Dólares</button>
                  </div>
                  <small>{monedaProd === 'USD'
                    ? cotizacion > 0 ? `Se guarda en dólares y se pasa a pesos con la cotización (USD 1 = $ ${String(cotizacion).replace('.', ',')}). Si la cotización cambia, este precio se actualiza solo.` : 'Primero cargá la cotización con el botón 💲.'
                    : 'Precio fijo en pesos: no cambia con la cotización.'}</small>
                </div>
                <label>Precio de compra{monedaProd === 'USD' ? ' (US$)' : ' ($)'}<input type="number" min="0" step="0.01" value={precioCompra} onChange={(e) => cambiarCompra(e.target.value)} placeholder="0,00" /></label>
                <label>{modoGanancia === 'margen' ? '% de margen (sobre la venta)' : '% de recargo (sobre el costo)'}<input type="number" step="0.1" max={modoGanancia === 'margen' ? 99.9 : undefined} value={gananciaPct} onChange={(e) => cambiarGanancia(e.target.value)} placeholder="Ej.: 50" /></label>
                <label>Precio de lista sin IVA{monedaProd === 'USD' ? ' (US$)' : ' ($)'}<input type="number" min="0" step="0.01" value={precioLista} onChange={(e) => cambiarLista(e.target.value)} placeholder="0,00" />{monedaProd === 'USD' && cotizacion > 0 && Number(precioLista) > 0 && <small className="npAyuda">≈ {formatoDinero(Number(precioLista) * cotizacion)} · compra ≈ {formatoDinero(Number(precioCompra || 0) * cotizacion)}</small>}</label>
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

                {editando && <TiendaWebProducto producto={editando} sincronizar={tnSincronizar} onSincronizar={setTnSincronizar} onCambio={() => void cargarCatalogo()} />}
                <label className="formFull">Detalle interno (no sale en el presupuesto)<textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Modelo, especificaciones, notas de instalación, compatibilidades…" /></label>

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

// Ficha del producto → Tienda web: publicarlo (solo si vos querés), mostrarlo u
// ocultarlo en la tienda y elegir si se sincroniza. Nada se publica solo.
function TiendaWebProducto({ producto, sincronizar, onSincronizar, onCambio }: { producto: ProductoServicio; sincronizar: boolean; onSincronizar: (v: boolean) => void; onCambio: () => void }) {
  const [trabajando, setTrabajando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  async function llamar(cuerpo: Record<string, unknown>, ok: string) {
    setTrabajando(true); setMensaje('')
    const { data, error } = await supabase.functions.invoke('tiendanube', { body: cuerpo })
    setTrabajando(false)
    if (error || data?.error) {
      let msg = data?.error ?? 'No se pudo conectar con la tienda web. Revisá que esté conectada en Configuración → Tienda web.'
      try { const ctx = (error as { context?: Response } | null)?.context; if (ctx) msg = (await ctx.json()).error ?? msg } catch { /* sin detalle */ }
      setMensaje(`⚠ ${msg}`); return
    }
    if (data?.errores?.length) { setMensaje(`⚠ ${data.errores.join(', ')}`); return }
    setMensaje(ok); onCambio()
  }
  return <div className="formFull tnProd">
    <span className="tnProdTit">🛒 Tienda web (movaelectronica.com.ar)</span>
    {producto.tn_variant_id ? <>
      <label className="caCheck"><input type="checkbox" checked={sincronizar} onChange={(e) => onSincronizar(e.target.checked)} /> Sincronizar precio y stock con la web</label>
      <div className="tnProdBtns">
        <button type="button" className="editButton" disabled={trabajando} onClick={() => void llamar({ accion: 'visibilidad', id: producto.id, visible: true }, '✓ Ahora se ve en la tienda.')}>👁 Mostrar en la tienda</button>
        <button type="button" className="editButton" disabled={trabajando} onClick={() => void llamar({ accion: 'visibilidad', id: producto.id, visible: false }, '✓ Oculto en la tienda (sigue vinculado).')}>🙈 Ocultar en la tienda</button>
      </div>
    </> : <>
      <small>No está en la web. Solo se publica si vos lo pedís.</small>
      <div className="tnProdBtns">
        <button type="button" className="newButton" disabled={trabajando} onClick={() => { if (window.confirm(`¿Publicar "${producto.nombre}" en la tienda web, visible para los clientes?`)) void llamar({ accion: 'crear', productos: [producto.id], visible: true }, '✓ Publicado en la tienda web.') }}>🛒 Publicar en la web</button>
        <button type="button" className="editButton" disabled={trabajando} onClick={() => void llamar({ accion: 'crear', productos: [producto.id], visible: false }, '✓ Creado en la tienda, oculto: revisalo en Tiendanube y publicalo cuando quieras.')}>Subirlo oculto para revisar</button>
      </div>
    </>}
    {trabajando && <small>Conectando con la tienda…</small>}
    {mensaje && <small className={mensaje.startsWith('⚠') ? 'tnProdError' : 'tnProdOk'}>{mensaje}</small>}
  </div>
}

export default ProductosServicios

// ───────────────────────── Stock y rotación ─────────────────────────
type Venta = { unidades: number; veces: number; ultima: string | null; fechas: { f: string; c: number }[] }

function StockRotacion({ elementos, ventas, diasVendidos, diasParado, onDiasVendidos, onDiasParado, vendidasEn, estaParado, diasDesde, mostrar, onEditar, onMinimo }: {
  elementos: ProductoServicio[]
  ventas: Record<number, Venta>
  diasVendidos: number
  diasParado: number
  onDiasVendidos: (n: number) => void
  onDiasParado: (n: number) => void
  vendidasEn: (id: number, dias: number) => number
  estaParado: (el: ProductoServicio) => boolean
  diasDesde: (f: string | null) => number | null
  mostrar: (n: number) => string
  onEditar: (el: ProductoServicio) => void
  onMinimo: (el: ProductoServicio, v: number) => void
}) {
  const productos = elementos.filter((e) => e.tipo === 'producto' && e.activo)
  const inversion = productos.reduce((s, e) => s + e.costo_unitario * e.stock, 0)
  const valorVenta = productos.reduce((s, e) => s + e.precio_venta * e.stock, 0)
  const reponer = productos.filter((e) => e.stock <= (e.stock_minimo ?? 0)).sort((a, b) => a.stock - b.stock)
  const masVendidos = productos.map((e) => ({ e, u: vendidasEn(e.id, diasVendidos) })).filter((x) => x.u > 0).sort((a, b) => b.u - a.u).slice(0, 10)
  const parados = productos.filter(estaParado).sort((a, b) => b.costo_unitario * b.stock - a.costo_unitario * a.stock)
  const inmovilizado = parados.reduce((s, e) => s + e.costo_unitario * e.stock, 0)
  const maxVend = masVendidos[0]?.u ?? 1
  const foto = (e: ProductoServicio) => <span className="srFoto">{e.fotoView ? <img src={e.fotoView} alt="" /> : '📦'}</span>

  return <div className="srWrap">
    <div className="cpKpis">
      <div className="srKpi"><span>Inversión en stock</span><strong>{mostrar(inversion)}</strong><small>Costo × stock de {productos.length} productos</small></div>
      <div className="srKpi"><span>Valor de venta del stock</span><strong>{mostrar(valorVenta)}</strong><small>Ganancia potencial {mostrar(valorVenta - inversion)}</small></div>
      <div className="srKpi"><span>Para reponer</span><strong style={{ color: reponer.length ? '#b23b32' : undefined }}>{reponer.length}</strong><small>En o bajo el stock mínimo</small></div>
      <div className="srKpi"><span>Parados</span><strong style={{ color: parados.length ? '#b86608' : undefined }}>{parados.length}</strong><small>{mostrar(inmovilizado)} inmovilizados</small></div>
    </div>

    <section className="srSeccion">
      <div className="srHead"><h4>⚠ Para reponer</h4><small>El stock baja solo cuando un presupuesto pasa a Aceptado. Cambiá el mínimo acá mismo.</small></div>
      {reponer.length === 0 ? <p className="agVacio">Todo con stock por encima del mínimo.</p> : reponer.map((e) => (
        <div key={e.id} className="srFila">
          {foto(e)}
          <button type="button" className="srNombre" onClick={() => onEditar(e)}><strong>{e.nombre}</strong><small>{e.proveedor || 'Sin proveedor'}{e.codigo ? ` · ${e.codigo}` : ''}</small></button>
          <span className={`srStock ${e.stock <= 0 ? 'sin' : 'bajo'}`}>{e.stock <= 0 ? 'Sin stock' : `Quedan ${e.stock}`}</span>
          <label className="srMin">Mínimo<input type="number" min="0" step="1" defaultValue={e.stock_minimo} onBlur={(ev) => { const v = Math.max(0, Number(ev.target.value || 0)); if (v !== e.stock_minimo) onMinimo(e, v) }} /></label>
          {e.link_compra && <a className="editButton" href={e.link_compra} target="_blank" rel="noreferrer">Comprar</a>}
        </div>
      ))}
    </section>

    <section className="srSeccion">
      <div className="srHead"><h4>🔥 Lo que más sale</h4>
        <select value={diasVendidos} onChange={(e) => onDiasVendidos(Number(e.target.value))}><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option><option value={180}>Últimos 6 meses</option><option value={365}>Último año</option></select>
      </div>
      {masVendidos.length === 0 ? <p className="agVacio">Todavía no hay productos del catálogo en presupuestos aceptados en ese período.</p> : masVendidos.map(({ e, u }) => (
        <div key={e.id} className="srFila">
          {foto(e)}
          <button type="button" className="srNombre" onClick={() => onEditar(e)}><strong>{e.nombre}</strong><small>{ventas[e.id]?.veces ?? 0} presupuesto{(ventas[e.id]?.veces ?? 0) === 1 ? '' : 's'} en total · stock {e.stock}</small></button>
          <div className="srBarra"><div className="tabBar"><span style={{ width: `${(u / maxVend) * 100}%`, background: '#e47b00' }} /></div><b>{u.toLocaleString('es-AR')} {e.unidad === 'unidad' ? 'u.' : e.unidad}</b></div>
        </div>
      ))}
    </section>

    <section className="srSeccion">
      <div className="srHead"><h4>💤 Parados (necesitan rotación)</h4>
        <select value={diasParado} onChange={(e) => onDiasParado(Number(e.target.value))}><option value={60}>Sin salir hace +60 días</option><option value={90}>Sin salir hace +90 días</option><option value={180}>Sin salir hace +6 meses</option><option value={365}>Sin salir hace +1 año</option></select>
      </div>
      {parados.length === 0 ? <p className="agVacio">No hay productos con stock parado en ese plazo.</p> : parados.map((e) => {
        const d = diasDesde(ventas[e.id]?.ultima ?? null)
        return (
          <div key={e.id} className="srFila">
            {foto(e)}
            <button type="button" className="srNombre" onClick={() => onEditar(e)}><strong>{e.nombre}</strong><small>{d == null ? 'Nunca salió en un presupuesto aceptado' : `Última salida hace ${d} días`}</small></button>
            <span className="srStock parado">Stock {e.stock}</span>
            <b className="srMonto">{mostrar(e.costo_unitario * e.stock)}</b>
          </div>
        )
      })}
      {parados.length > 0 && <p className="gestionAyuda">Ideas: ofrecerlos en los próximos presupuestos, armar un combo o aplicarles un descuento desde la ficha del producto.</p>}
    </section>
  </div>
}
