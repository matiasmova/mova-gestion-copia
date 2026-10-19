import { useEffect, useRef, useState } from 'react'

// Barras por mes, fáciles de leer de un vistazo:
//  · Arriba del cero, lo que ganaste: productos + servicios (apilados).
//  · Abajo del cero, lo que salió: gastos de la empresa + impuestos.
//  · El punto verde (y su línea) es la ganancia final de cada mes.
// Pasando el mouse (o tocando) un mes se ve todo su detalle; con clic se elige.

export type Mes = { ym: string; vendido: number; productos: number; servicios: number; gastos: number; impuestos: number; ganancia: number }
type Clave = 'productos' | 'servicios' | 'gastos' | 'impuestos' | 'ganancia'

const corto = (n: number) => { const a = Math.abs(n); const s = n < 0 ? '− ' : ''; return a >= 1e6 ? `${s}$ ${(a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M` : a >= 1e3 ? `${s}$ ${Math.round(a / 1e3).toLocaleString('es-AR')} k` : `${s}$ ${Math.round(a)}` }
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

export default function GraficoMeses({ serie, sel, onSel, ocultas, colores }: { serie: Mes[]; sel: string; onSel: (ym: string) => void; ocultas: Set<string>; colores: Record<Clave, string> }) {
  const caja = useRef<HTMLDivElement>(null)
  const [tam, setTam] = useState({ w: 600, h: 260 })
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = caja.current
    if (!el) return
    const medir = () => setTam({ w: Math.max(280, el.clientWidth), h: Math.max(200, el.clientHeight) })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ver = (k: Clave) => !ocultas.has(k)
  const arriba = (m: Mes) => (ver('productos') ? Math.max(0, m.productos) : 0) + (ver('servicios') ? Math.max(0, m.servicios) : 0)
  const abajo = (m: Mes) => (ver('gastos') ? m.gastos : 0) + (ver('impuestos') ? m.impuestos : 0) + (ver('productos') ? Math.max(0, -m.productos) : 0) + (ver('servicios') ? Math.max(0, -m.servicios) : 0)
  const maxV = Math.max(1, ...serie.map((m) => Math.max(arriba(m), ver('ganancia') ? m.ganancia : 0)))
  const minV = Math.min(0, ...serie.map((m) => Math.min(-abajo(m), ver('ganancia') ? m.ganancia : 0)))
  const ticks = marcas(minV, maxV)
  const top = ticks[ticks.length - 1], bot = ticks[0]

  const IZQ = 58, DER = 10, ARR = 26, ABA = 26
  const W = tam.w, H = tam.h
  const ancho = W - IZQ - DER, alto = H - ARR - ABA
  const col = ancho / serie.length
  const Y = (v: number) => ARR + ((top - v) / (top - bot || 1)) * alto
  const cx = (i: number) => IZQ + col * i + col / 2
  const barra = Math.min(46, col * 0.56)
  const jSel = serie.findIndex((m) => m.ym === sel)
  const foco = hover ?? jSel

  // Segmentos apilados con 2px de separación entre sí.
  const segmentos = (m: Mes, i: number) => {
    const out: { k: Clave; y: number; h: number }[] = []
    let base = 0
    for (const k of ['productos', 'servicios'] as const) {
      const v = ver(k) ? Math.max(0, m[k]) : 0
      if (v > 0) { out.push({ k, y: Y(base + v), h: Y(base) - Y(base + v) }); base += v }
    }
    base = 0
    for (const k of ['productos', 'servicios', 'gastos', 'impuestos'] as const) {
      const v = !ver(k) ? 0 : k === 'gastos' || k === 'impuestos' ? m[k] : Math.max(0, -m[k])
      if (v > 0) { out.push({ k, y: Y(base), h: Y(base - v) - Y(base) }); base -= v }
    }
    return out.map((s, q) => <rect key={`${i}-${q}`} x={cx(i) - barra / 2} y={s.y + 1} width={barra} height={Math.max(1, s.h - 2)} rx={3} style={{ fill: colores[s.k] }} />)
  }

  const puntos = serie.map((m, i) => [cx(i), Y(m.ganancia)] as const)
  const m = foco >= 0 ? serie[foco] : null
  const tipIzq = foco >= 0 ? Math.min(W - 210, Math.max(8, cx(foco) + (cx(foco) > W / 2 ? -222 : 22))) : 0

  return <div className="gmCaja" ref={caja} onMouseLeave={() => setHover(null)}>
    <svg width={W} height={H} role="img" aria-label="Ganancia por mes: barras de lo que ganaste y lo que salió, y la ganancia final">
      {ticks.map((t) => <g key={t}>
        <line x1={IZQ} x2={W - DER} y1={Y(t)} y2={Y(t)} className={t === 0 ? 'gmCero' : 'gmGrilla'} />
        <text x={IZQ - 8} y={Y(t) + 4} textAnchor="end" className="gmEje">{corto(t)}</text>
      </g>)}
      {foco >= 0 && <rect x={IZQ + col * foco + 2} y={ARR - 18} width={col - 4} height={alto + 18} rx={10} className="gmFoco" />}
      {serie.map((mm, i) => <g key={mm.ym}>{segmentos(mm, i)}</g>)}
      {ver('ganancia') && <>
        <polyline points={puntos.map((p) => p.join(',')).join(' ')} fill="none" style={{ stroke: colores.ganancia }} strokeWidth={2} strokeLinejoin="round" />
        {puntos.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === foco ? 7 : 5} style={{ fill: colores.ganancia }} className="gmPunto" />)}
        {foco >= 0 && <text x={cx(foco)} y={Math.max(14, Y(serie[foco].ganancia) - 12)} textAnchor="middle" className="gmValor">{corto(serie[foco].ganancia)}</text>}
      </>}
      {serie.map((mm, i) => <text key={mm.ym} x={cx(i)} y={H - 8} textAnchor="middle" className={`gmMes${i === jSel ? ' on' : ''}`} style={{ fontSize: col < 34 ? 10 : undefined }}>{mesCorto(mm.ym)}</text>)}
      {/* Zonas para pasar el mouse / tocar: toda la columna de cada mes */}
      {serie.map((mm, i) => <rect key={mm.ym} x={IZQ + col * i} y={0} width={col} height={H} fill="transparent" style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHover(i)} onClick={() => { onSel(mm.ym); setHover(null) }}><title>{mesLargo(mm.ym)}</title></rect>)}
    </svg>
    {m && hover != null && <div className="gmTip" style={{ left: tipIzq, top: 8 }}>
      <b>{mesLargo(m.ym)}</b>
      <div><span>Aceptados</span><span>{corto(m.vendido)}</span></div>
      {ver('productos') && <div><span><i style={{ background: colores.productos }} />Ganancia productos</span><span>{corto(m.productos)}</span></div>}
      {ver('servicios') && <div><span><i style={{ background: colores.servicios }} />Ganancia servicios</span><span>{corto(m.servicios)}</span></div>}
      {ver('gastos') && <div><span><i style={{ background: colores.gastos }} />Gastos empresa</span><span>{corto(-m.gastos)}</span></div>}
      {ver('impuestos') && <div><span><i style={{ background: colores.impuestos }} />Impuestos</span><span>{corto(-m.impuestos)}</span></div>}
      <div className="tot"><span><i style={{ background: colores.ganancia }} />Ganancia final</span><span>{corto(m.ganancia)}</span></div>
      <small>Clic para ver el detalle</small>
    </div>}
  </div>
}
