import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'
import { subirFotoProducto } from './fotosProducto'
import { pedirAsistente } from './asistenteIA'
import { leerCotizacion } from './catalogoMoneda'
import { useNombreClienteIA } from './NombreClienteIA'

// Elegir un producto o servicio del catálogo: se abre una ventana grande con
// buscador, filtros y la foto de cada producto. "Carga manual" sigue disponible.

type Producto = { id: number; nombre: string; nombre_presupuesto?: string | null; unidad: string; precio_venta: number; tipo: string; categoria?: string | null; foto_url?: string | null }

type Props = {
  catalogo: Producto[]
  valor: number | null | undefined
  cargando: boolean
  onElegir: (id: string) => void
  // Producto nuevo cargado desde acá: se suma al catálogo y queda elegido.
  onCreado?: (p: Producto & { costo_unitario: number; descripcion: string | null }) => void
}

const UNIDADES = ['unidad', 'metro', 'hora', 'servicio', 'kit', 'boca', 'circuito']

// Sin tildes ni mayúsculas, para que "camara" encuentre "Cámara".
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const plata = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(n) || 0)
const esHttp = (s: string) => /^https?:\/\//.test(s)
// Dónde queda un precio respecto del típico del mercado.
function posicionMercado(precio: number, tipico: number): { c: string; t: string } {
  const dif = ((precio - tipico) / tipico) * 100
  const pct = `${Math.abs(dif).toFixed(0)}%`
  if (dif > 25) return { c: 'rojo', t: `🔴 Tu precio está ${pct} más caro que el mercado` }
  if (dif > 10) return { c: 'amarillo', t: `🟡 Tu precio está ${pct} arriba del mercado` }
  if (dif < -15) return { c: 'amarillo', t: `🟡 Tu precio está ${pct} abajo: podrías cobrar más` }
  return { c: 'verde', t: '🟢 Tu precio está en el precio del mercado' }
}

// Fotos firmadas: se piden una sola vez por sesión y se reutilizan.
const fotosCache: Record<string, string> = {}
async function firmarFotos(rutas: string[]): Promise<void> {
  const faltan = rutas.filter((r) => !esHttp(r) && !(r in fotosCache))
  for (let i = 0; i < faltan.length; i += 100) {
    const tanda = faltan.slice(i, i + 100)
    const { data } = await supabase.storage.from('productos').createSignedUrls(tanda, 3600)
    for (const f of data ?? []) if (f.path && f.signedUrl) fotosCache[f.path] = f.signedUrl
    for (const r of tanda) if (!(r in fotosCache)) fotosCache[r] = ''
  }
}
const urlFoto = (p: Producto) => (p.foto_url ? (esHttp(p.foto_url) ? p.foto_url : fotosCache[p.foto_url] || '') : '')

export default function BuscadorCatalogo({ catalogo, valor, cargando, onElegir, onCreado }: Props) {
  const [vista, setVista] = useState<'lista' | 'nuevo'>('lista')
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState<'todos' | 'producto' | 'servicio'>('todos')
  const [categoria, setCategoria] = useState('')
  const [marcado, setMarcado] = useState(0)
  const [, setFotosListas] = useState(0)
  const elegido = catalogo.find((p) => p.id === valor) ?? null

  // Al abrir: se firman las fotos (y se vuelve a dibujar cuando llegan).
  useEffect(() => {
    if (!abierto) return
    let vigente = true
    void firmarFotos(catalogo.map((p) => p.foto_url).filter((x): x is string => !!x)).then(() => { if (vigente) setFotosListas((n) => n + 1) })
    return () => { vigente = false }
  }, [abierto, catalogo])

  // Con la ventana abierta, la página de atrás no se mueve; Esc cierra.
  useEffect(() => {
    if (!abierto) return
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    document.addEventListener('keydown', tecla)
    return () => { document.body.style.overflow = antes; document.removeEventListener('keydown', tecla) }
  }, [abierto])

  const categorias = useMemo(() => [...new Set(catalogo.map((p) => (p.categoria ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [catalogo])
  const hayServicios = catalogo.some((p) => p.tipo === 'servicio')

  // Todas las palabras tienen que aparecer, en cualquier orden.
  // Primero se buscan palabras que EMPIECEN así ("toma" → "Tomacorriente", no "Automático");
  // si no aparece nada, se busca en cualquier parte del nombre.
  const resultados = useMemo(() => {
    const palabras = normal(texto).split(/\s+/).filter(Boolean)
    const base = catalogo.filter((p) => (tipo === 'todos' || p.tipo === tipo) && (!categoria || (p.categoria ?? '').trim() === categoria))
    if (!palabras.length) return base
    const textoDe = (p: Producto) => normal(`${p.nombre} ${p.nombre_presupuesto ?? ''} ${p.categoria ?? ''}`)
    const inicios = base.filter((p) => { const ws = textoDe(p).split(/[^a-z0-9ñ]+/); return palabras.every((w) => ws.some((x) => x.startsWith(w))) })
    return inicios.length ? inicios : base.filter((p) => palabras.every((w) => textoDe(p).includes(w)))
  }, [catalogo, texto, tipo, categoria])

  useEffect(() => { setMarcado(0) }, [texto, tipo, categoria])

  function elegir(id: string) {
    onElegir(id)
    setAbierto(false)
    setTexto('')
    setVista('lista')
  }
  function cerrar() { setAbierto(false); setVista('lista') }

  const fotoElegida = elegido ? urlFoto(elegido) : ''

  return (
    <>
      <button type="button" className={`bcBoton${elegido ? '' : ' manual'}`} disabled={cargando} onClick={() => setAbierto(true)}>
        {elegido && <span className="bcMini">{fotoElegida ? <img src={fotoElegida} alt="" /> : elegido.tipo === 'servicio' ? '🛠️' : '📦'}</span>}
        <span className="bcNombre">{cargando ? 'Cargando lista...' : elegido ? (elegido.nombre_presupuesto || elegido.nombre) : 'Carga manual'}</span>
        <i aria-hidden="true">🔍</i>
      </button>
      {abierto && createPortal(
        <div className="bcFondo" onPointerDown={(e) => { if (e.target === e.currentTarget) cerrar() }}>
          <div className="bcVentana" role="dialog" aria-modal="true" aria-label="Elegir producto o servicio">
            <div className="bcCab">
              {vista === 'nuevo' && <button type="button" className="bcCerrar" onClick={() => setVista('lista')} aria-label="Volver a la lista">‹</button>}
              <h3>{vista === 'nuevo' ? 'Nuevo producto o servicio' : 'Elegir producto o servicio'}</h3>
              <button type="button" className="bcCerrar" onClick={cerrar} aria-label="Cerrar">✕</button>
            </div>
            {vista === 'nuevo' ? (
              <NuevoProductoRapido
                nombreInicial={texto.trim()}
                categorias={categorias}
                onCancelar={() => setVista('lista')}
                onCreado={(p) => { onCreado?.(p); setAbierto(false); setTexto(''); setVista('lista') }}
              />
            ) : <>
            <input
              className="bcBuscar"
              type="search"
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="🔍 Buscar: cámara, deco, tecla 2 módulos…"
              aria-label="Buscar en el catálogo"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado((m) => Math.min(m + 1, resultados.length - 1)) }
                if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)) }
                if (e.key === 'Enter') { e.preventDefault(); if (resultados[marcado]) elegir(String(resultados[marcado].id)) }
              }}
            />
            <div className="bcChips">
              {hayServicios && (['todos', 'producto', 'servicio'] as const).map((t) => (
                <button key={t} type="button" className={tipo === t ? 'activo' : ''} onClick={() => setTipo(t)}>{t === 'todos' ? 'Todos' : t === 'producto' ? '📦 Productos' : '🛠️ Servicios'}</button>
              ))}
              {categorias.length > 1 && (
                <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría">
                  <option value="">Todas las categorías</option>
                  {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>
            <div className="bcLista" role="listbox">
              <button type="button" className={`bcManual${!elegido ? ' activo' : ''}`} onClick={() => elegir('')}>
                <span className="bcFoto">✏️</span><span><b>Carga manual</b><small>Solo para este presupuesto</small></span>
              </button>
              {onCreado && (
                <button type="button" className="bcManual bcNuevo" onClick={() => setVista('nuevo')}>
                  <span className="bcFoto">＋</span><span><b>Nuevo producto{texto.trim() ? ` “${texto.trim()}”` : ''}</b><small>Lo guardo en el catálogo y lo uso acá</small></span>
                </button>
              )}
              {resultados.slice(0, 120).map((p, i) => {
                const foto = urlFoto(p)
                return (
                  <button key={p.id} type="button" role="option" aria-selected={p.id === valor} className={`bcOpcion${p.id === valor ? ' activo' : ''}${i === marcado && texto ? ' marcado' : ''}`} onClick={() => elegir(String(p.id))}>
                    <span className="bcFoto">{foto ? <img src={foto} alt="" loading="lazy" /> : p.tipo === 'servicio' ? '🛠️' : '📦'}</span>
                    <span className="bcTexto">
                      <b>{p.nombre}</b>
                      {p.nombre_presupuesto && <small>En el presupuesto: “{p.nombre_presupuesto}”</small>}
                      {p.categoria && <small className="bcCat">{p.categoria}</small>}
                    </span>
                    <span className="bcPrecio">{Number(p.precio_venta) > 0 ? <>{plata(p.precio_venta)}<small>por {p.tipo === 'servicio' ? 'servicio' : p.unidad}</small></> : <em>Sin precio</em>}</span>
                  </button>
                )
              })}
              {resultados.length === 0 && <p className="bcVacio">No hay nada con “{texto}”. Probá con otra palabra o usá Carga manual.</p>}
              {resultados.length > 120 && <p className="bcVacio">Hay {resultados.length - 120} más: escribí algo para achicar la lista.</p>}
            </div>
            <p className="bcPie">{resultados.length} {resultados.length === 1 ? 'resultado' : 'resultados'}</p>
            </>}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

// Alta rápida de un producto o servicio sin salir del presupuesto, con foto y
// comparación con el precio del mercado. Lo demás (stock, proveedor, web…) se
// completa después en Productos y servicios.

type Mercado = { minimo: number; maximo: number; mediana: number; comentario: string; ofertas: { tienda: string; titulo: string; precio: number; url: string }[] }
function NuevoProductoRapido({ nombreInicial, categorias, onCancelar, onCreado }: { nombreInicial: string; categorias: string[]; onCancelar: () => void; onCreado: NonNullable<Props['onCreado']> }) {
  const [tipo, setTipo] = useState<'producto' | 'servicio'>('producto')
  const [nombre, setNombre] = useState(nombreInicial)
  const [paraCliente, setParaCliente] = useState('')
  const [precio, setPrecio] = useState('')
  const [costo, setCosto] = useState('')
  const [unidad, setUnidad] = useState('unidad')
  const [categoria, setCategoria] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [fotoVista, setFotoVista] = useState('')
  const [mercado, setMercado] = useState<Mercado | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [errorMercado, setErrorMercado] = useState('')
  const nombreIA = useNombreClienteIA(nombre, tipo, setParaCliente)
  useEffect(() => () => { if (fotoVista) URL.revokeObjectURL(fotoVista) }, [fotoVista])

  function elegirFoto(f: File | null) {
    setFoto(f)
    setFotoVista(f ? URL.createObjectURL(f) : '')
  }

  async function buscarMercado() {
    if (!nombre.trim()) { setErrorMercado('Escribí primero el nombre del producto.'); return }
    setErrorMercado(''); setBuscando(true); setMercado(null)
    try {
      const r = await pedirAsistente<{ resultados: (Mercado & { ofertas: Mercado['ofertas'] })[] }>({
        accion: 'mercado', cotizacion: leerCotizacion(),
        productos: [{ descripcion: nombre.trim(), ...(tipo === 'servicio' ? { servicio: true } : {}) }],
      })
      const x = r.resultados?.[0]
      if (!x || !x.ofertas?.length || !(x.mediana > 0)) setErrorMercado('No encontré precios publicados. Cargalo a mano.')
      else setMercado(x)
    } catch (e) { setErrorMercado((e as Error).message) } finally { setBuscando(false) }
  }

  async function guardar() {
    setError('')
    if (!nombre.trim()) { setError('Escribí el nombre.'); return }
    setGuardando(true)
    let fotoPath: string | null = null
    if (foto) {
      const subida = await subirFotoProducto(foto)
      if ('error' in subida) { setGuardando(false); setError(subida.error); return }
      fotoPath = subida.path
      if (fotoVista) fotosCache[subida.path] = fotoVista // se ve al toque en el buscador
    }
    const fila: Record<string, unknown> = {
      ...(fotoPath ? { foto_url: fotoPath } : {}),
      tipo, nombre: nombre.trim(), unidad: tipo === 'servicio' && unidad === 'unidad' ? 'servicio' : unidad,
      precio_venta: Number(precio) || 0, costo_unitario: Number(costo) || 0, categoria: categoria.trim() || null,
      stock: 0, stock_minimo: 0, iva_pct: 21, activo: true, nombre_presupuesto: paraCliente.trim() || null,
    }
    const columnas = 'id, tipo, nombre, descripcion, unidad, precio_venta, costo_unitario, categoria, foto_url'
    let r = await supabase.from('productos_servicios').insert(fila).select(columnas).single()
    // Sin el SQL de Productos no existe "nombre para el presupuesto": se guarda sin eso.
    if (r.error && /nombre_presupuesto/.test(r.error.message ?? '')) { delete fila.nombre_presupuesto; r = await supabase.from('productos_servicios').insert(fila).select(columnas).single() }
    setGuardando(false)
    if (r.error || !r.data) { console.error(r.error); setError('No se pudo guardar el producto. Probá de nuevo.'); return }
    const d = r.data as Producto & { costo_unitario: number; descripcion: string | null }
    onCreado({ ...d, precio_venta: Number(d.precio_venta) || 0, costo_unitario: Number(d.costo_unitario) || 0, nombre_presupuesto: (fila.nombre_presupuesto as string | null) ?? null })
  }

  return (
    <form className="bcNuevoForm" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void guardar() }}>
      <div className="bcChips">
        <button type="button" className={tipo === 'producto' ? 'activo' : ''} onClick={() => setTipo('producto')}>📦 Producto</button>
        <button type="button" className={tipo === 'servicio' ? 'activo' : ''} onClick={() => setTipo('servicio')}>🛠️ Servicio</button>
      </div>
      <label>Nombre *<input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Tomacorriente smart doble WiFi" /></label>
      <label>
        <span className="bcNombreCab">Nombre para el cliente (opcional){nombreIA.boton}</span>
        <input value={paraCliente} onChange={(e) => setParaCliente(e.target.value)} placeholder="Ej.: Tomacorriente inteligente" />
        {nombreIA.elegir(paraCliente)}
        {!nombreIA.error && <small>Es lo que va en el presupuesto, corto y sin marca ni modelo.</small>}
      </label>
      <div className="bcNuevoFila">
        <label>Precio de venta<input type="number" inputMode="decimal" min="0" step="any" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0" /></label>
        <label>Costo (opcional)<input type="number" inputMode="decimal" min="0" step="any" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="0" /></label>
      </div>

      {/* Precio de referencia del mercado: comparar, copiar el recomendado o dejar el propio */}
      <div className="bcMercado">
        {!mercado && <button type="button" className="bcMercadoBtn" disabled={buscando} onClick={() => void buscarMercado()}>{buscando ? '⏳ Buscando precios en internet… (10 a 60 s)' : '📈 Ver precio del mercado'}</button>}
        {errorMercado && <small className="bcMercadoError">{errorMercado}</small>}
        {mercado && (() => {
          const pos = Number(precio) > 0 ? posicionMercado(Number(precio), mercado.mediana) : null
          return <>
            <div className="bcMercadoRango">
              <div><small>Más barato</small><b>{plata(mercado.minimo)}</b></div>
              <div className="tipico"><small>Típico</small><b>{plata(mercado.mediana)}</b></div>
              <div><small>Más caro</small><b>{plata(mercado.maximo)}</b></div>
            </div>
            {pos && <small className={`bcMercadoPos ${pos.c}`}>{pos.t}</small>}
            <div className="bcMercadoAcc">
              <button type="button" className="newButton" onClick={() => setPrecio(String(Math.round(mercado.mediana)))}>Usar el típico ({plata(mercado.mediana)})</button>
              <button type="button" className="editButton" onClick={() => { const el = document.querySelector<HTMLInputElement>('.bcNuevoForm input[placeholder="0"]'); el?.focus(); el?.select() }}>✏️ Cargar a mano</button>
              <button type="button" className="editButton" disabled={buscando} onClick={() => void buscarMercado()}>↻</button>
            </div>
            {mercado.ofertas.slice(0, 3).map((o, i) => <small key={i} className="bcMercadoOferta">{o.tienda || 'Tienda'} · {plata(o.precio)}{o.url && <> · <a href={o.url} target="_blank" rel="noreferrer noopener">ver ↗</a></>}</small>)}
            {mercado.comentario && <small className="bcMercadoOferta">💡 {mercado.comentario}</small>}
          </>
        })()}
      </div>

      <label className="bcFotoCarga">
        {fotoVista ? <img src={fotoVista} alt="Foto del producto" /> : <span aria-hidden>📷</span>}
        <span><b>{foto ? 'Cambiar foto' : 'Sumar foto (opcional)'}</b><small>{foto ? foto.name : 'Sacá una foto o elegila de la galería'}</small></span>
        <input type="file" accept="image/*" onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)} />
      </label>
      {foto && <button type="button" className="bcQuitarFoto" onClick={() => elegirFoto(null)}>Quitar foto</button>}
      <div className="bcNuevoFila">
        <label>Unidad<select value={unidad} onChange={(e) => setUnidad(e.target.value)}>{UNIDADES.map((u) => <option key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}</option>)}</select></label>
        <label>Categoría<input list="bcCategorias" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ej.: Domótica" /></label>
        <datalist id="bcCategorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      {error && <p className="loginError" style={{ margin: 0 }}>{error}</p>}
      <p className="bcNuevoNota">El stock y lo demás los completás después en Productos y servicios.</p>
      <div className="bcNuevoAcc">
        <button type="button" className="cancelButton" onClick={onCancelar}>Volver</button>
        <button type="submit" className="newButton" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar y usar'}</button>
      </div>
    </form>
  )
}
