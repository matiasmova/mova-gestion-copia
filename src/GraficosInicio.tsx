import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'

// Pestaña "Gráficos" de Inicio: ventas y cobros por mes, embudo de
// presupuestos, qué rubros se venden más y plata por cobrar según antigüedad.

type Pres = { id: number; fecha: string; created_at: string; estado: string; total: number; obra_id: number | null }
type Pago = { monto: number; fecha: string; presupuesto_id: number | null; obra_id: number | null }
type Adic = { obra_id: number | null; presupuesto_id?: number | null; importe: number; estado: string; tipo?: string | null }
type Item = { presupuesto_id: number; catalogo_id: number | null; tipo: string; cantidad: number; precio_unitario: number; descuento_pct: number | null }

const C_VENDIDO = '#e47b00'
const C_COBRADO = '#2866a7'
const num = (x: unknown) => Number(x) || 0
const ym = (f: string) => (f ?? '').slice(0, 7)
const mesCorto = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')
const corta = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1e6) return `$${(v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`
  if (a >= 1e3) return `$${Math.round(v / 1e3).toLocaleString('es-AR')}k`
  return `$${Math.round(v)}`
}
function ultimosMeses(n: number) {
  const d = new Date(); const out: string[] = []
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`) }
  return out
}

export default function GraficosInicio({ onIr }: { onIr?: (vista: 'presupuestos') => void }) {
  const [meses, setMeses] = useState(12)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [pres, setPres] = useState<Pres[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [adic, setAdic] = useState<Adic[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [categorias, setCategorias] = useState<Record<number, string>>({})

  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true); setError('')
      const [rP, rPg, rA, rC] = await Promise.all([
        supabase.from('presupuestos').select('id, fecha, created_at, estado, total, obra_id').eq('activo', true),
        supabase.from('pagos').select('monto, fecha, presupuesto_id, obra_id'),
        supabase.from('adicionales').select('*').eq('estado', 'aprobado'),
        supabase.from('productos_servicios').select('id, categoria'),
      ])
      if (rP.error || rPg.error) { if (vivo) { setError('No se pudieron cargar los datos de los gráficos.'); setCargando(false) } return }
      const p = ((rP.data ?? []) as Pres[]).map((x) => ({ ...x, total: num(x.total) }))
      const aceptados = p.filter((x) => x.estado === 'aceptado').map((x) => x.id)
      const its: Item[] = []
      for (let i = 0; i < aceptados.length; i += 200) {
        const r = await supabase.from('presupuesto_items').select('presupuesto_id, catalogo_id, tipo, cantidad, precio_unitario, descuento_pct').in('presupuesto_id', aceptados.slice(i, i + 200))
        its.push(...((r.data ?? []) as Item[]))
      }
      if (!vivo) return
      setPres(p)
      setPagos(((rPg.data ?? []) as Pago[]).map((x) => ({ ...x, monto: num(x.monto) })))
      setAdic(rA.error ? [] : ((rA.data ?? []) as Adic[]).map((x) => ({ ...x, importe: num(x.importe) })))
      setItems(its)
      setCategorias(Object.fromEntries(((rC.data ?? []) as { id: number; categoria: string | null }[]).map((c) => [c.id, c.categoria?.trim() || 'Sin categoría'])))
      setCargando(false)
    }
    void cargar()
    return () => { vivo = false }
  }, [])

  const listaMeses = useMemo(() => ultimosMeses(meses), [meses])
  const desde = listaMeses[0]

  // 1) Vendido (presupuestos aceptados, por fecha del presupuesto) y cobrado, por mes.
  const porMes = useMemo(() => listaMeses.map((m) => ({
    m,
    vendido: pres.filter((p) => p.estado === 'aceptado' && ym(p.fecha) === m).reduce((s, p) => s + p.total, 0),
    cobrado: pagos.filter((p) => ym(p.fecha) === m).reduce((s, p) => s + p.monto, 0),
  })), [listaMeses, pres, pagos])

  // 2) Embudo del período: armados → enviados → aceptados.
  const embudo = useMemo(() => {
    const del = pres.filter((p) => ym(p.fecha) >= desde)
    const env = del.filter((p) => p.estado !== 'borrador')
    const acc = del.filter((p) => p.estado === 'aceptado')
    const rech = del.filter((p) => p.estado === 'rechazado')
    const suma = (l: Pres[]) => l.reduce((s, p) => s + p.total, 0)
    return { pasos: [
      { t: 'Armados', n: del.length, monto: suma(del) },
      { t: 'Enviados', n: env.length, monto: suma(env) },
      { t: 'Aceptados', n: acc.length, monto: suma(acc) },
    ], rechazados: rech.length }
  }, [pres, desde])

  // 3) Qué rubros se venden más (ítems de presupuestos aceptados del período, antes de descuentos generales).
  const rubros = useMemo(() => {
    const ids = new Set(pres.filter((p) => p.estado === 'aceptado' && ym(p.fecha) >= desde).map((p) => p.id))
    const acc: Record<string, number> = {}
    items.filter((it) => ids.has(it.presupuesto_id)).forEach((it) => {
      const cat = it.catalogo_id ? categorias[it.catalogo_id] ?? 'Sin categoría' : it.tipo === 'servicio' ? 'Mano de obra / servicios' : 'Otros ítems'
      acc[cat] = (acc[cat] ?? 0) + num(it.cantidad) * num(it.precio_unitario) * (1 - num(it.descuento_pct) / 100)
    })
    const lista = Object.entries(acc).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    const top = lista.slice(0, 7)
    const resto = lista.slice(7).reduce((s, [, v]) => s + v, 0)
    if (resto > 0) top.push(['Otros rubros', resto])
    return top
  }, [pres, items, categorias, desde])

  // 4) Por cobrar según antigüedad del presupuesto aceptado.
  const antiguedad = useMemo(() => {
    const aceptados = pres.filter((p) => p.estado === 'aceptado')
    const porObra: Record<number, number> = {}
    aceptados.forEach((p) => { if (p.obra_id != null) porObra[p.obra_id] = (porObra[p.obra_id] ?? 0) + 1 })
    const tramos = [
      { t: 'Hasta 30 días', max: 30, monto: 0, n: 0 },
      { t: '31 a 60 días', max: 60, monto: 0, n: 0 },
      { t: '61 a 90 días', max: 90, monto: 0, n: 0 },
      { t: 'Más de 90 días', max: Infinity, monto: 0, n: 0 },
    ]
    aceptados.forEach((p) => {
      const unico = p.obra_id != null && porObra[p.obra_id] === 1
      const corresponde = (f: { presupuesto_id?: number | null; obra_id?: number | null }) =>
        Number(f.presupuesto_id) === p.id || (unico && f.presupuesto_id == null && Number(f.obra_id) === p.obra_id)
      const ajustes = adic.filter(corresponde).reduce((s, a) => s + a.importe, 0)
      const saldo = p.total + ajustes - pagos.filter(corresponde).reduce((s, x) => s + x.monto, 0)
      if (saldo <= 1) return
      const dias = Math.floor((Date.now() - new Date(`${p.fecha.slice(0, 10)}T12:00:00`).getTime()) / 86400000)
      const tramo = tramos.find((t) => dias <= t.max)!
      tramo.monto += saldo; tramo.n += 1
    })
    return tramos
  }, [pres, pagos, adic])

  if (cargando) return <p className="grVacio">Cargando gráficos…</p>
  if (error) return <p className="loginError">{error}</p>

  const totVendido = porMes.reduce((s, x) => s + x.vendido, 0)
  const totCobrado = porMes.reduce((s, x) => s + x.cobrado, 0)
  const totPorCobrar = antiguedad.reduce((s, t) => s + t.monto, 0)

  return <div className="grWrap">
    <div className="grFiltro">
      <span>Período</span>
      {[6, 12].map((n) => <button key={n} type="button" className={meses === n ? 'active' : ''} onClick={() => setMeses(n)}>Últimos {n} meses</button>)}
    </div>

    <section className="grCard grAncha">
      <div className="grHead">
        <div><h3>Ventas y cobros por mes</h3><small>Vendido = presupuestos aceptados (por fecha del presupuesto). Cobrado = cobros cargados.</small></div>
        <div className="grTotales"><span><i style={{ background: C_VENDIDO }} />Vendido <b>{moneda(totVendido)}</b></span><span><i style={{ background: C_COBRADO }} />Cobrado <b>{moneda(totCobrado)}</b></span></div>
      </div>
      <BarrasMes datos={porMes} />
    </section>

    <section className="grCard">
      <div className="grHead"><div><h3>Embudo de presupuestos</h3><small>Del período elegido{embudo.rechazados ? ` · ${embudo.rechazados} rechazado${embudo.rechazados === 1 ? '' : 's'}` : ''}</small></div></div>
      {embudo.pasos[0].n === 0 ? <p className="grVacio">No hay presupuestos en el período.</p> : (
        <div className="grEmbudo">
          {embudo.pasos.map((paso, i) => {
            const pct = embudo.pasos[0].n ? (paso.n / embudo.pasos[0].n) * 100 : 0
            const conv = i > 0 && embudo.pasos[i - 1].n ? Math.round((paso.n / embudo.pasos[i - 1].n) * 100) : null
            return <div key={paso.t} className="grPaso">
              <div className="grPasoTxt"><strong>{paso.t}</strong><span>{paso.n} · {moneda(paso.monto)}</span></div>
              <div className="grPista"><div style={{ width: `${Math.max(2, pct)}%`, background: ['#f6c48a', '#ec9a3d', '#b85f00'][i] }} /></div>
              {conv != null && <small>{conv}% del paso anterior</small>}
            </div>
          })}
          <button type="button" className="caLink" onClick={() => onIr?.('presupuestos')}>Ver seguimiento de presupuestos →</button>
        </div>
      )}
    </section>

    <section className="grCard">
      <div className="grHead"><div><h3>Qué vendés más</h3><small>Por rubro (categoría del producto), en presupuestos aceptados del período</small></div></div>
      {rubros.length === 0 ? <p className="grVacio">Todavía no hay ventas con productos del catálogo en el período.</p> : (
        <div className="grRanking">
          {rubros.map(([t, v]) => (
            <div key={t} className="grFilaRank" title={`${t}: ${moneda(v)}`}>
              <span className="grRankNom">{t}</span>
              <div className="grPista"><div style={{ width: `${Math.max(2, (v / rubros[0][1]) * 100)}%`, background: C_VENDIDO }} /></div>
              <b>{corta(v)}</b>
            </div>
          ))}
        </div>
      )}
    </section>

    <section className="grCard">
      <div className="grHead"><div><h3>Por cobrar según antigüedad</h3><small>Saldo de presupuestos aceptados · total {moneda(totPorCobrar)}</small></div></div>
      {totPorCobrar <= 0 ? <p className="grVacio">✓ No hay saldos pendientes.</p> : (
        <div className="grRanking">
          {antiguedad.map((t, i) => (
            <div key={t.t} className="grFilaRank" title={`${t.t}: ${moneda(t.monto)} en ${t.n} presupuesto(s)`}>
              <span className="grRankNom">{t.t}</span>
              <div className="grPista"><div style={{ width: `${t.monto ? Math.max(2, (t.monto / Math.max(...antiguedad.map((x) => x.monto))) * 100) : 0}%`, background: ['#9fc3e6', '#5b93c9', '#2866a7', '#b23b32'][i] }} /></div>
              <b>{t.monto ? corta(t.monto) : '—'}</b>
            </div>
          ))}
          {antiguedad[3].monto > 0 && <p className="grNota">⚠ {moneda(antiguedad[3].monto)} tienen más de 90 días. Conviene reclamarlos.</p>}
          <button type="button" className="caLink" onClick={() => onIr?.('presupuestos')}>Ver presupuestos con saldo →</button>
        </div>
      )}
    </section>
  </div>
}

// Barras agrupadas por mes (vendido y cobrado) con tooltip al pasar el dedo o el mouse.
function BarrasMes({ datos }: { datos: { m: string; vendido: number; cobrado: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  // El gráfico se dibuja al ancho real de la tarjeta, así el texto no se achica en el celular.
  const caja = useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = useState(720)
  useEffect(() => {
    const el = caja.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const alto = ancho < 500 ? 190 : 220, izq = 44, der = 6, sup = 12, inf = 26
  const util = ancho - izq - der, altoUtil = alto - sup - inf
  const max = Math.max(1, ...datos.flatMap((d) => [d.vendido, d.cobrado]))
  // Escala "linda": 4 líneas guía redondeadas.
  const paso = (() => { const bruto = max / 4; const pot = 10 ** Math.floor(Math.log10(bruto)); return Math.ceil(bruto / pot) * pot })()
  const tope = paso * 4
  const y = (v: number) => sup + altoUtil - (v / tope) * altoUtil
  const grupo = util / datos.length
  const barra = Math.max(4, Math.min(16, grupo / 3.2))
  const d = hover != null ? datos[hover] : null
  const saltear = grupo < 34 // en pantallas chicas se muestra un mes sí y uno no
  return <div className="grBarras" ref={caja} onMouseLeave={() => setHover(null)}>
    <svg viewBox={`0 0 ${ancho} ${alto}`} width="100%" height={alto} role="img" aria-label="Vendido y cobrado por mes">
      {[1, 2, 3, 4].map((k) => <g key={k}>
        <line x1={izq} x2={ancho - der} y1={y(paso * k)} y2={y(paso * k)} stroke="#eef0f3" />
        <text x={izq - 6} y={y(paso * k) + 3} textAnchor="end" fontSize={10} fill="#8a93a0">{corta(paso * k)}</text>
      </g>)}
      <line x1={izq} x2={ancho - der} y1={y(0)} y2={y(0)} stroke="#d8dbe0" />
      {datos.map((p, i) => {
        const cx = izq + grupo * i + grupo / 2
        return <g key={p.m}>
          {hover === i && <rect x={cx - grupo / 2} y={sup} width={grupo} height={altoUtil} fill="#f6f7f9" />}
          {p.vendido > 0 && <path d={barraRedondeada(cx - barra - 1, y(p.vendido), barra, y(0) - y(p.vendido))} fill={C_VENDIDO} />}
          {p.cobrado > 0 && <path d={barraRedondeada(cx + 1, y(p.cobrado), barra, y(0) - y(p.cobrado))} fill={C_COBRADO} />}
          {(!saltear || i % 2 === datos.length % 2 || hover === i) && <text x={cx} y={alto - 8} textAnchor="middle" fontSize={10.5} fill={hover === i ? '#14181e' : '#8a93a0'}>{mesCorto(p.m)}</text>}
          <rect x={cx - grupo / 2} y={0} width={grupo} height={alto} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        </g>
      })}
    </svg>
    {d && hover != null && (
      <div className="grTip" style={{ left: Math.min(ancho - 85, Math.max(85, izq + grupo * hover + grupo / 2)) }}>
        <strong>{new Date(`${d.m}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</strong>
        <span><i style={{ background: C_VENDIDO }} />Vendido <b>{moneda(d.vendido)}</b></span>
        <span><i style={{ background: C_COBRADO }} />Cobrado <b>{moneda(d.cobrado)}</b></span>
      </div>
    )}
  </div>
}

// Barra con las puntas de arriba redondeadas y la base recta sobre el eje.
function barraRedondeada(x: number, yTop: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h)
  return `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yTop + h} Z`
}
