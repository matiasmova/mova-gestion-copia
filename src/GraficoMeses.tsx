import { useEffect, useRef, useState } from 'react'

// Gráfico del Inicio, fácil de leer de un vistazo:
//  · Barras grises: lo que vendiste cada mes (presupuestos aceptados).
//  · Línea verde con su sombra: la ganancia final de cada mes.
// Pasando el mouse (o tocando) un mes se ve de dónde sale su ganancia; con clic
// se elige ese mes (y otro clic vuelve a todo el período).

export type Mes = { ym: string; futuro?: boolean; etiqueta?: string; titulo?: string; sub?: string; vendido: number; costoProductos: number; empleados: number; extras: number; gastos: number; impuestos: number; ganancia: number }

const corto = (n: number) => { const a = Math.abs(n); const s = n < 0 ? '− ' : ''; return a >= 1e6 ? `${s}$ ${(a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M` : a >= 1e3 ? `${s}$ ${Math.round(a / 1e3).toLocaleString('es-AR')} k` : `${s}$ ${Math.round(a)}` }
const pesos = (n: number) => `${n < 0 ? '− ' : ''}$ ${Math.round(Math.abs(n)).toLocaleString('es-AR')}`
const mesCorto = (ym: string) => { const t = new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'short' }).replace('.', '').slice(0, 3); return t.charAt(0).toUpperCase() + t.slice(1) }
const mesLargo = (ym: string) => { const t = new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1) }

// Escala "redonda": 4 o 5 marcas con números lindos.
function marcas(min: number, max: number) {
  const rango = max - min || 1
  const paso0 = rango / 4
  const p = Math.pow(10, Math.floor(Math.log10(paso0)))
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= paso0) ?? paso0
  const desde = Math.floor(min / paso) * paso
  const hasta = Math.ceil(max / paso) * paso
  const out: number[] = []
  for (let v = desde; v <= hasta + paso / 2; v += paso) out.push(Math.round(v))
  return out
}

// Sin onFoco (semanas de un mes) no se elige nada al tocar: solo se ve el detalle.
export default function GraficoMeses({ serie, foco, onFoco }: { serie: Mes[]; foco: string | null; onFoco?: (ym: string | null) => void }) {
  const caja = useRef<HTMLDivElement>(null)
  const [tam, setTam] = useState({ w: 600, h: 280 })
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = caja.current
    if (!el) return
    const medir = () => setTam({ w: Math.max(260, el.clientWidth), h: Math.max(200, el.clientHeight) })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const maxV = Math.max(1, ...serie.map((m) => Math.max(m.vendido, m.ganancia)))
  const minV = Math.min(0, ...serie.map((m) => m.ganancia))
  const ticks = marcas(minV, maxV)
  const top = ticks[ticks.length - 1], bot = ticks[0]

    const IZQ = 56, DER = 8, ARR = 24
  const W = tam.w, H = tam.h
  const col = (W - IZQ - DER) / serie.length
  // Debajo del nombre de la semana van sus días, si entran.
  const conSub = col >= 64 && serie.some((x) => x.sub)
  const ABA = conSub ? 42 : 26
  const alto = H - ARR - ABA
  const Y = (v: number) => ARR + ((top - v) / (top - bot || 1)) * alto
  const cx = (i: number) => IZQ + col * i + col / 2
  const barra = Math.min(44, col * 0.56)
  const jSel = serie.findIndex((m) => m.ym === foco)
  const resalta = hover ?? jSel
  // Con muchos meses en poco lugar, se escribe un mes sí y otro no.
  const salteo = col < 30

  // Las semanas que todavía no llegaron no llevan punto (la línea termina en hoy).
  const puntos = serie.map((m, i) => [cx(i), Y(m.ganancia)] as const).filter((_, i) => !serie[i].futuro)
  const linea = puntos.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = puntos.length ? `${linea} L${puntos[puntos.length - 1][0].toFixed(1)} ${Y(0).toFixed(1)} L${puntos[0][0].toFixed(1)} ${Y(0).toFixed(1)} Z` : ''
  const m = hover != null ? serie[hover] : null
  const tipIzq = hover != null ? Math.min(W - 236, Math.max(4, cx(hover) + (cx(hover) > W / 2 ? -244 : 18))) : 0

  return <div className="gmCaja" ref={caja} onMouseLeave={() => setHover(null)}>
    <svg width={W} height={H} role="img" aria-label="Vendido y ganancia final de cada mes">
      <defs>
        <linearGradient id="gmArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--is-gan)', stopOpacity: 0.24 }} />
          <stop offset="1" style={{ stopColor: 'var(--is-gan)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {ticks.map((t) => <g key={t}>
        <line x1={IZQ} x2={W - DER} y1={Y(t)} y2={Y(t)} className={t === 0 ? 'gmCero' : 'gmGrilla'} />
        <text x={IZQ - 8} y={Y(t) + 4} textAnchor="end" className="gmEje">{corto(t)}</text>
      </g>)}
      {resalta >= 0 && <rect x={IZQ + col * resalta + 2} y={ARR - 16} width={col - 4} height={alto + 16} rx={10} className="gmFoco" />}
      {serie.map((mm, i) => <rect key={mm.ym} x={cx(i) - barra / 2} y={Y(Math.max(0, mm.vendido))} width={barra} height={Math.max(0, Y(0) - Y(Math.max(0, mm.vendido)))} rx={5} className={`gmVenta${i === resalta ? ' on' : ''}`} />)}
      <path d={area} fill="url(#gmArea)" />
      <path d={linea} fill="none" className="gmLinea" />
      {serie.map((mm, i) => (mm.futuro ? null : [cx(i), Y(mm.ganancia)] as const)).map((pt, i) => pt && <circle key={i} cx={pt[0]} cy={pt[1]} r={i === resalta ? 6.5 : 4} className={`gmPunto${i === resalta ? ' on' : ''}${serie[i].ganancia < 0 ? ' neg' : ''}`} />)}
      {resalta >= 0 && !serie[resalta].futuro && <text x={cx(resalta)} y={Math.max(14, Y(serie[resalta].ganancia) - 13)} textAnchor="middle" className={`gmValor${serie[resalta].ganancia < 0 ? ' neg' : ''}`}>{corto(serie[resalta].ganancia)}</text>}
      {serie.map((mm, i) => <text key={mm.ym} x={cx(i)} y={H - (conSub ? 24 : 8)} textAnchor="middle" className={`gmMes${i === jSel ? ' on' : ''}`}>{salteo && i % 2 && i !== jSel ? '' : mm.etiqueta ?? mesCorto(mm.ym)}</text>)}
      {conSub && serie.map((mm, i) => mm.sub ? <text key={`s${mm.ym}`} x={cx(i)} y={H - 8} textAnchor="middle" className="gmEje">{mm.sub}</text> : null)}
      {/* Zonas para pasar el mouse / tocar: toda la columna de cada mes */}
      {serie.map((mm, i) => <rect key={mm.ym} x={IZQ + col * i} y={0} width={col} height={H} fill="transparent" style={{ cursor: onFoco ? 'pointer' : 'default' }}
        onMouseEnter={() => setHover(i)} onClick={() => { if (!onFoco) { setHover(i); return } onFoco(mm.ym === foco ? null : mm.ym); setHover(null) }}><title>{mm.titulo ?? mesLargo(mm.ym)}</title></rect>)}
    </svg>
    {m && <div className="gmTip" style={{ left: tipIzq, top: 6 }}>
      <b>{m.titulo ?? mesLargo(m.ym)}</b>
      <div><span>Vendido</span><span>{pesos(m.vendido)}</span></div>
      <div><span>Costo de productos</span><span>− {pesos(m.costoProductos)}</span></div>
      <div><span>Empleados y extras</span><span>− {pesos(m.empleados + m.extras)}</span></div>
      <div><span>Gastos e impuestos</span><span>− {pesos(m.gastos + m.impuestos)}</span></div>
      <div className="tot"><span>Te queda</span><span>{pesos(m.ganancia)}</span></div>
      {onFoco && <small>{m.ym === foco ? 'Clic para volver a todo el período' : 'Clic para ver este mes'}</small>}
    </div>}
  </div>
}
