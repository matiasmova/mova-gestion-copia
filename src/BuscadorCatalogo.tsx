import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'

// Elegir un producto o servicio del catálogo: se abre una ventana grande con
// buscador, filtros y la foto de cada producto. "Carga manual" sigue disponible.

type Producto = { id: number; nombre: string; nombre_presupuesto?: string | null; unidad: string; precio_venta: number; tipo: string; categoria?: string | null; foto_url?: string | null }

type Props = {
  catalogo: Producto[]
  valor: number | null | undefined
  cargando: boolean
  onElegir: (id: string) => void
}

// Sin tildes ni mayúsculas, para que "camara" encuentre "Cámara".
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const plata = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(n) || 0)
const esHttp = (s: string) => /^https?:\/\//.test(s)

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

export default function BuscadorCatalogo({ catalogo, valor, cargando, onElegir }: Props) {
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
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('keydown', tecla)
    return () => { document.body.style.overflow = antes; document.removeEventListener('keydown', tecla) }
  }, [abierto])

  const categorias = useMemo(() => [...new Set(catalogo.map((p) => (p.categoria ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [catalogo])
  const hayServicios = catalogo.some((p) => p.tipo === 'servicio')

  // Todas las palabras tienen que aparecer, en cualquier orden.
  const resultados = useMemo(() => {
    const palabras = normal(texto).split(/\s+/).filter(Boolean)
    return catalogo.filter((p) => {
      if (tipo !== 'todos' && p.tipo !== tipo) return false
      if (categoria && (p.categoria ?? '').trim() !== categoria) return false
      if (!palabras.length) return true
      const t = normal(`${p.nombre} ${p.nombre_presupuesto ?? ''} ${p.categoria ?? ''}`)
      return palabras.every((w) => t.includes(w))
    })
  }, [catalogo, texto, tipo, categoria])

  useEffect(() => { setMarcado(0) }, [texto, tipo, categoria])

  function elegir(id: string) {
    onElegir(id)
    setAbierto(false)
    setTexto('')
  }

  const fotoElegida = elegido ? urlFoto(elegido) : ''

  return (
    <>
      <button type="button" className={`bcBoton${elegido ? '' : ' manual'}`} disabled={cargando} onClick={() => setAbierto(true)}>
        {elegido && <span className="bcMini">{fotoElegida ? <img src={fotoElegida} alt="" /> : elegido.tipo === 'servicio' ? '🛠️' : '📦'}</span>}
        <span className="bcNombre">{cargando ? 'Cargando lista...' : elegido ? (elegido.nombre_presupuesto || elegido.nombre) : 'Carga manual'}</span>
        <i aria-hidden="true">🔍</i>
      </button>
      {abierto && createPortal(
        <div className="bcFondo" onPointerDown={(e) => { if (e.target === e.currentTarget) setAbierto(false) }}>
          <div className="bcVentana" role="dialog" aria-modal="true" aria-label="Elegir producto o servicio">
            <div className="bcCab">
              <h3>Elegir producto o servicio</h3>
              <button type="button" className="bcCerrar" onClick={() => setAbierto(false)} aria-label="Cerrar">✕</button>
            </div>
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
                <span className="bcFoto">✏️</span><span><b>Carga manual</b><small>Escribo yo la descripción y el precio</small></span>
              </button>
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
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
