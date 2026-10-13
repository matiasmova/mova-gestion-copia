import { useEffect, useMemo, useRef, useState } from 'react'

// Elegir un producto o servicio del catálogo escribiendo para buscar
// (reemplaza la lista desplegable larga). "Carga manual" sigue disponible.

type Producto = { id: number; nombre: string; nombre_presupuesto?: string | null; unidad: string; precio_venta: number; tipo: string }

type Props = {
  catalogo: Producto[]
  valor: number | null | undefined
  cargando: boolean
  onElegir: (id: string) => void
}

// Sin tildes ni mayúsculas, para que "camara" encuentre "Cámara".
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const plata = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(n) || 0)

export default function BuscadorCatalogo({ catalogo, valor, cargando, onElegir }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [marcado, setMarcado] = useState(0)
  const caja = useRef<HTMLDivElement>(null)
  const elegido = catalogo.find((p) => p.id === valor) ?? null

  // Todas las palabras tienen que aparecer, en cualquier orden.
  const resultados = useMemo(() => {
    const palabras = normal(texto).split(/\s+/).filter(Boolean)
    if (!palabras.length) return catalogo
    return catalogo.filter((p) => {
      const t = normal(`${p.nombre} ${p.nombre_presupuesto ?? ''}`)
      return palabras.every((w) => t.includes(w))
    })
  }, [catalogo, texto])

  useEffect(() => { setMarcado(0) }, [texto])

  // Tocar afuera cierra la lista.
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [abierto])

  function elegir(id: string) {
    onElegir(id)
    setAbierto(false)
    setTexto('')
  }

  return (
    <div className="bcWrap" ref={caja}>
      <button type="button" className={`bcBoton${elegido ? '' : ' manual'}`} disabled={cargando} aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <span>{cargando ? 'Cargando lista...' : elegido ? (elegido.nombre_presupuesto || elegido.nombre) : 'Carga manual'}</span>
        <i aria-hidden="true">🔍</i>
      </button>
      {abierto && (
        <div className="bcPanel">
          <input
            type="search"
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar: cámara, deco, tecla 2 módulos…"
            aria-label="Buscar en el catálogo"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado((m) => Math.min(m + 1, resultados.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)) }
              if (e.key === 'Enter') { e.preventDefault(); if (resultados[marcado]) elegir(String(resultados[marcado].id)) }
              if (e.key === 'Escape') setAbierto(false)
            }}
          />
          <ul className="bcLista" role="listbox">
            <li><button type="button" className={`bcOpcion bcManual${!elegido ? ' activo' : ''}`} onClick={() => elegir('')}>✏️ Carga manual (escribo yo la descripción)</button></li>
            {resultados.slice(0, 80).map((p, i) => (
              <li key={p.id}>
                <button type="button" role="option" aria-selected={p.id === valor} className={`bcOpcion${p.id === valor ? ' activo' : ''}${i === marcado && texto ? ' marcado' : ''}`} onClick={() => elegir(String(p.id))}>
                  <span><b>{p.nombre}</b>{p.nombre_presupuesto && <small>En el presupuesto: “{p.nombre_presupuesto}”</small>}</span>
                  <em>{plata(p.precio_venta)}<small>{p.tipo === 'servicio' ? 'servicio' : p.unidad}</small></em>
                </button>
              </li>
            ))}
            {resultados.length === 0 && <li className="bcVacio">No hay nada con “{texto}”. Probá con otra palabra o usá Carga manual.</li>}
            {resultados.length > 80 && <li className="bcVacio">Hay {resultados.length - 80} más: escribí algo para achicar la lista.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
