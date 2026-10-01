import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { pedirAsistente } from './asistenteIA'
import { formatoDinero, leerCotizacion } from './catalogoMoneda'

// Compara precios propios con los del mercado (la IA busca en Google).
// Solo muestra la comparación: nunca cambia un precio.

export type ProductoAComparar = {
  id?: number | null // del catálogo: la búsqueda usa nombre, código y marca
  nombre: string
  precio: number // el que paga el cliente, por unidad
  costo?: number
  cantidad?: number
}

type Oferta = { tienda: string; titulo: string; precio: number; en_dolares: boolean; url: string; equivalente: boolean }
type Resultado = { buscado: string; comentario: string; ofertas: Oferta[]; minimo: number; maximo: number; promedio: number; mediana: number }
type Respuesta = { resultados: Resultado[]; fuentes: { titulo: string; url: string }[]; busquedas: string[] }

const CLAVE_CACHE = 'mova_mercado_v1'
const HORAS_CACHE = 24
const claveDe = (p: ProductoAComparar) => (p.id ? `id:${p.id}` : `t:${p.nombre.trim().toLowerCase()}`)

// Lo ya buscado se guarda un día en este navegador, para no gastar búsquedas.
function leerCache(): Record<string, { r: Resultado; f: number }> {
  try { return JSON.parse(localStorage.getItem(CLAVE_CACHE) || '{}') } catch { return {} }
}
function guardarCache(nuevos: Record<string, Resultado>) {
  try {
    const c = leerCache(), ahora = Date.now()
    for (const k of Object.keys(c)) if (ahora - c[k].f > HORAS_CACHE * 3600_000) delete c[k]
    for (const [k, r] of Object.entries(nuevos)) c[k] = { r, f: ahora }
    localStorage.setItem(CLAVE_CACHE, JSON.stringify(c))
  } catch { /* sin almacenamiento: se vuelve a buscar la próxima vez */ }
}

export type Posicion = { nivel: 'verde' | 'amarillo' | 'rojo' | 'gris'; texto: string; dif: number }

// Semáforo: dónde queda tu precio respecto del precio típico del mercado.
export function posicionPrecio(precio: number, r: Resultado | undefined): Posicion {
  if (!r || !r.ofertas.length || !(r.mediana > 0)) return { nivel: 'gris', texto: 'Sin datos del mercado', dif: 0 }
  if (!(precio > 0)) return { nivel: 'gris', texto: 'Sin precio tuyo para comparar', dif: 0 }
  const ref = r.mediana
  const dif = ((precio - ref) / ref) * 100
  const pct = `${Math.abs(dif).toFixed(0)}%`
  if (dif > 25) return { nivel: 'rojo', texto: `${pct} más caro que el mercado`, dif }
  if (dif > 10) return { nivel: 'amarillo', texto: `${pct} arriba del mercado`, dif }
  if (dif < -15) return { nivel: 'amarillo', texto: `${pct} más barato: podrías cobrar más`, dif }
  return { nivel: 'verde', texto: Math.abs(dif) < 1 ? 'En el precio del mercado' : `En precio (${dif > 0 ? '+' : '−'}${pct})`, dif }
}

const EMOJI = { verde: '🟢', amarillo: '🟡', rojo: '🔴', gris: '⚪' }

function CompararMercado({ productos, titulo, onCerrar }: { productos: ProductoAComparar[]; titulo: string; onCerrar: () => void }) {
  const [resultados, setResultados] = useState<(Resultado | undefined)[]>([])
  const [fuentes, setFuentes] = useState<Respuesta['fuentes']>([])
  const [busquedas, setBusquedas] = useState<string[]>([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<number | null>(productos.length === 1 ? 0 : null)
  const [desdeCache, setDesdeCache] = useState(false)

  async function buscar(forzar: boolean) {
    setError(''); setBuscando(true)
    try {
      const cache = forzar ? {} : leerCache()
      const salida: (Resultado | undefined)[] = productos.map((p) => cache[claveDe(p)]?.r)
      const faltan = productos.map((p, k) => ({ p, k })).filter(({ k }) => !salida[k])
      setDesdeCache(faltan.length < productos.length)
      // De a 8 por pedido (cada pedido hace varias búsquedas en Google).
      const nuevos: Record<string, Resultado> = {}
      const todasFuentes: Respuesta['fuentes'] = [], todasBusquedas: string[] = []
      for (let i = 0; i < faltan.length; i += 8) {
        const tanda = faltan.slice(i, i + 8)
        const r = await pedirAsistente<Respuesta>({
          accion: 'mercado', cotizacion: leerCotizacion(),
          productos: tanda.map(({ p }) => (p.id ? { id: p.id } : { descripcion: p.nombre })),
        })
        tanda.forEach(({ p, k }, j) => { const x = r.resultados[j]; if (x) { salida[k] = x; nuevos[claveDe(p)] = x } })
        todasFuentes.push(...r.fuentes); todasBusquedas.push(...r.busquedas)
        setResultados([...salida])
      }
      guardarCache(nuevos)
      setResultados(salida)
      setFuentes(todasFuentes.filter((f, k, a) => a.findIndex((x) => x.titulo === f.titulo) === k).slice(0, 12))
      setBusquedas(Array.from(new Set(todasBusquedas)).slice(0, 10))
    } catch (e) { setError((e as Error).message) } finally { setBuscando(false) }
  }

  useEffect(() => { void buscar(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Resumen del total (solo de lo que tiene datos del mercado).
  let tuyo = 0, mercado = 0, conDatos = 0
  productos.forEach((p, k) => {
    const r = resultados[k]
    if (r && r.mediana > 0 && p.precio > 0) { const c = p.cantidad ?? 1; tuyo += p.precio * c; mercado += r.mediana * c; conDatos++ }
  })
  const difTotal = mercado > 0 ? ((tuyo - mercado) / mercado) * 100 : 0
  const peso = productos.map((p, k) => ({ p, k, extra: resultados[k] && resultados[k]!.mediana > 0 && p.precio > 0 ? (p.precio - resultados[k]!.mediana) * (p.cantidad ?? 1) : 0 }))
    .filter((x) => x.extra > 0).sort((a, b) => b.extra - a.extra)[0]

  return createPortal(
    <div className="modalOverlay">
      <div className="modalCard catalogoModal mercadoModal">
        <div className="modalHeader">
          <div><p className="subtitle">💲 PRECIOS DEL MERCADO</p><h2>{titulo}</h2></div>
          <button type="button" className="modalClose closeButton" onClick={onCerrar}>×</button>
        </div>

        {buscando && !resultados.some(Boolean) && (
          <div className="mercadoCargando" role="status">
            <span className="mercadoSpinner" />
            <p><strong>Buscando precios en Google…</strong><br /><small>Mercado Libre, tiendas y distribuidores de Argentina. Tarda entre 10 y 40 segundos.</small></p>
          </div>
        )}
        {error && <p className="loginError">{error}</p>}

        {productos.length > 1 && conDatos > 0 && (
          <div className={`mercadoResumen ${difTotal > 25 ? 'rojo' : difTotal > 10 || difTotal < -15 ? 'amarillo' : 'verde'}`}>
            <strong>{difTotal > 25 ? '🔴' : difTotal > 10 || difTotal < -15 ? '🟡' : '🟢'} {Math.abs(difTotal) < 1 ? 'Estás en el precio del mercado' : `Estás ${Math.abs(difTotal).toFixed(0)}% ${difTotal > 0 ? 'arriba' : 'abajo'} del mercado`}</strong>
            <span>En {conDatos} de {productos.length} producto{productos.length === 1 ? '' : 's'}: vos {formatoDinero(tuyo)} · mercado {formatoDinero(mercado)}</span>
            {peso && difTotal > 10 && <span>Lo que más pesa: <b>{peso.p.nombre}</b> (+{formatoDinero(peso.extra)})</span>}
          </div>
        )}

        <div className="mercadoLista">
          {productos.map((p, k) => {
            const r = resultados[k]
            const pos = posicionPrecio(p.precio, r)
            const margen = p.costo && p.costo > 0 && r && r.mediana > 0 ? ((r.mediana - p.costo) / r.mediana) * 100 : null
            const ab = abierto === k
            return (
              <div className={`mercadoItem ${pos.nivel}`} key={k}>
                <button type="button" className="mercadoItemCab" onClick={() => setAbierto(ab ? null : k)}>
                  <span className="mercadoSemaforo">{r ? EMOJI[pos.nivel] : buscando ? '⏳' : '⚪'}</span>
                  <span className="mercadoNombre"><b>{p.nombre}</b><small>{r ? pos.texto : buscando ? 'Buscando…' : 'Sin datos'}</small></span>
                  <span className="mercadoPrecios">
                    <small>Vos</small><b>{p.precio > 0 ? formatoDinero(p.precio) : '—'}</b>
                    {r && r.mediana > 0 && <><small>Mercado</small><b>{formatoDinero(r.mediana)}</b></>}
                  </span>
                  <span className="mercadoFlecha">{ab ? '▲' : '▼'}</span>
                </button>
                {ab && r && (
                  <div className="mercadoDetalle">
                    {r.ofertas.length > 0 ? <>
                      <div className="mercadoRango">
                        <div><small>Más barato</small><b>{formatoDinero(r.minimo)}</b></div>
                        <div><small>Típico</small><b>{formatoDinero(r.mediana)}</b></div>
                        <div><small>Promedio</small><b>{formatoDinero(r.promedio)}</b></div>
                        <div><small>Más caro</small><b>{formatoDinero(r.maximo)}</b></div>
                      </div>
                      {r.maximo > r.minimo && p.precio > 0 && (
                        <div className="mercadoBarra" aria-hidden="true">
                          <span className="mercadoBarraTu" style={{ left: `${Math.min(100, Math.max(0, ((p.precio - r.minimo) / (r.maximo - r.minimo)) * 100))}%` }} title="Tu precio" />
                        </div>
                      )}
                      {margen !== null && <p className="gestionAyuda">Si vendieras al precio típico del mercado, tu margen sobre el costo sería <b>{margen.toFixed(0)}%</b>.</p>}
                      <ul className="mercadoOfertas">
                        {r.ofertas.map((o, j) => (
                          <li key={j}>
                            <span><b>{o.tienda || 'Tienda'}</b><small>{o.titulo}{o.equivalente ? ' · modelo parecido' : ''}{o.en_dolares ? ' · publicado en US$' : ''}</small></span>
                            <span className="mercadoOfertaPrecio">{formatoDinero(o.precio)}{o.url && <a href={o.url} target="_blank" rel="noreferrer noopener">Ver ↗</a>}</span>
                          </li>
                        ))}
                      </ul>
                    </> : <p className="gestionAyuda">No encontré precios publicados para este producto.</p>}
                    {r.buscado && <small className="mercadoBuscado">Busqué: “{r.buscado}”</small>}
                    {r.comentario && <p className="iaNotas">💡 {r.comentario}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {(fuentes.length > 0 || busquedas.length > 0) && (
          <details className="mercadoFuentes">
            <summary>Fuentes y búsquedas de Google</summary>
            {busquedas.length > 0 && <p>{busquedas.map((q) => <a key={q} className="mercadoChip" href={`https://www.google.com/search?q=${encodeURIComponent(q)}`} target="_blank" rel="noreferrer noopener">🔎 {q}</a>)}</p>}
            {fuentes.length > 0 && <p>{fuentes.map((f, j) => <a key={j} className="mercadoChip" href={f.url} target="_blank" rel="noreferrer noopener">{f.titulo || 'Fuente'} ↗</a>)}</p>}
          </details>
        )}

        <p className="gestionAyuda mercadoAviso">
          Precios orientativos al público (con IVA), encontrados por la IA en Google. Revisá los links antes de decidir: a veces compara un modelo parecido.
          {desdeCache && ' Algunos resultados son de una búsqueda de las últimas 24 h.'}
        </p>
        <div className="modalActions formActions">
          <button type="button" className="editButton" disabled={buscando} onClick={() => void buscar(true)}>{buscando ? 'Buscando…' : '↻ Buscar de nuevo'}</button>
          <button type="button" className="newButton" onClick={onCerrar}>Listo</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default CompararMercado
