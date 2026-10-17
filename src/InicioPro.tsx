import { useMemo, useRef, useState, type ReactNode } from 'react'

// Inicio simplificado: pulso de la plata con curva tocable, tres números,
// "Hoy" (todo lo que hay que hacer, con su botón), lo pendiente de cobrar y
// pagar, a dónde se va la plata, obras en curso y embudo de presupuestos.
// Recibe los datos ya cargados por HomeResumen (mismas reglas de siempre).

type Pago = { monto: number; fecha: string }
type Costo = { monto: number; fecha: string; tipo?: string | null; personal_id: number | null }
type Gasto = { fecha: string; monto: number }
type Compra = { fecha: string; monto: number }
type Pres = { id: number; cliente_id: number; titulo: string; estado: string; total: number; fecha: string | null }
type ObraAct = { id: number; nombre_obra: string; cliente_id: number; porcentaje_avance: number | null }
type Deuda = { obra: ObraAct; saldo: number; faltaAvance: number; extras: number; situacion: 'rojo' | 'naranja' | 'verde' }

export type Tarea = { clave: string; icono: string; tono: 'r' | 'n' | 'a' | 'v'; titulo: string; detalle: string; boton: string; principal?: boolean; accion: () => void }

type Props = {
  nombre: string
  verFinanzas: boolean
  verPresupuestos: boolean
  pagos: Pago[]
  costos: Costo[]
  gastos: Gasto[]
  compras: Compra[]
  presupuestos: Pres[]
  obrasActivas: ObraAct[]
  avancePromedio: number
  deudas: Deuda[]
  porCobrar: number
  borradores: Pres[]
  personal: { debe: number; alDia: number; aPagar: number }
  recurrentes: { cantidad: number; monto: number }
  netoProyectado: number | null // solo mes en curso
  tareas: Tarea[]
  nombreCli: (id: number) => string
  onAbrirObra: (id: number) => void
  onIr: (destino: 'obras' | 'presupuestos' | 'cobranzas' | 'personal' | 'gastos' | 'balance' | 'graficos') => void
  ia?: ReactNode // resumen del día con IA (opcional)
  acciones?: ReactNode // botones de la cabecera
}

type Periodo = 'mes' | 'tri' | 'anio'
type Unidad = { clave: string; etiqueta: string; corta: string; entro: number; salio: number; manoObra: number; materiales: number; fijos: number }

const ymDe = (f: string | null | undefined) => (f ?? '').slice(0, 7)
const ymHoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const sumarMeses = (ym: string, n: number) => { const [a, m] = ym.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const mesLargo = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long' })
const mesCorto = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')
const corto = (n: number) => { const a = Math.abs(n); const s = n < 0 ? '− ' : ''; return a >= 1e6 ? `${s}$ ${(a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 2 })} M` : a >= 1e3 ? `${s}$ ${Math.round(a / 1e3).toLocaleString('es-AR')} k` : `${s}$ ${Math.round(a)}` }
const pesos = (n: number) => `${n < 0 ? '− ' : ''}$ ${Math.round(Math.abs(n)).toLocaleString('es-AR')}`
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function InicioPro(p: Props) {
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [sel, setSel] = useState<number | null>(null)
  const [parte, setParte] = useState<number | null>(null)
  const [verTodas, setVerTodas] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  // Plata por mes (misma regla que el neto de siempre).
  const porMes = useMemo(() => {
    const m: Record<string, Omit<Unidad, 'clave' | 'etiqueta' | 'corta'>> = {}
    const de = (ym: string) => (m[ym] ??= { entro: 0, salio: 0, manoObra: 0, materiales: 0, fijos: 0 })
    p.pagos.forEach((x) => { de(ymDe(x.fecha)).entro += x.monto })
    p.costos.forEach((c) => {
      const u = de(ymDe(c.fecha))
      if (c.personal_id != null) { u.manoObra += c.monto; u.salio += c.monto }
      else if (c.tipo !== 'gasto_extra') { u.materiales += c.monto; u.salio += c.monto }
    })
    p.compras.forEach((c) => { const u = de(ymDe(c.fecha)); u.materiales += c.monto; u.salio += c.monto })
    p.gastos.forEach((g) => { const u = de(ymDe(g.fecha)); u.fijos += g.monto; u.salio += g.monto })
    return m
  }, [p.pagos, p.costos, p.compras, p.gastos])

  const unidades: Unidad[] = useMemo(() => {
    const hoy = ymHoy()
    const vacio = { entro: 0, salio: 0, manoObra: 0, materiales: 0, fijos: 0 }
    const mesU = (ym: string): Unidad => ({ clave: ym, etiqueta: capital(mesLargo(ym)), corta: capital(mesCorto(ym)), ...(porMes[ym] ?? vacio) })
    if (periodo === 'tri') {
      return [3, 2, 1, 0].map((k) => {
        const meses = [0, 1, 2].map((i) => sumarMeses(hoy, -(k * 3 + 2 - i)))
        const u = meses.map(mesU)
        const suma = (c: keyof typeof vacio) => u.reduce((s, x) => s + x[c], 0)
        return { clave: meses.join(), etiqueta: `${u[0].corta} a ${u[2].corta}`, corta: u[0].corta, entro: suma('entro'), salio: suma('salio'), manoObra: suma('manoObra'), materiales: suma('materiales'), fijos: suma('fijos') }
      })
    }
    const n = periodo === 'mes' ? 6 : 12
    return Array.from({ length: n }, (_, i) => mesU(sumarMeses(hoy, i - n + 1)))
  }, [porMes, periodo])

  const k = sel == null || sel >= unidades.length ? unidades.length - 1 : sel
  const u = unidades[k]
  const ant = unidades[k - 1]
  const neto = u.entro - u.salio
  const netoAnt = ant ? ant.entro - ant.salio : null
  const delta = netoAnt != null && Math.abs(netoAnt) > 1 ? Math.round(((neto - netoAnt) / Math.abs(netoAnt)) * 100) : null
  const esActual = k === unidades.length - 1

  // Curva
  const W = 360, H = 120, PAD = 10
  const netos = unidades.map((x) => x.entro - x.salio)
  const max = Math.max(1, ...netos) * 1.15
  const min = Math.min(0, ...netos)
  const X = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, unidades.length - 1)
  const Y = (v: number) => H - 8 - ((v - min) / (max - min || 1)) * (H - 24)
  let d = ''
  netos.forEach((v, i) => {
    if (!i) { d += `M${X(i)},${Y(v)}`; return }
    const x0 = X(i - 1), y0 = Y(netos[i - 1]), c = (X(i) - x0) / 2
    d += ` C${x0 + c},${y0} ${X(i) - c},${Y(v)} ${X(i)},${Y(v)}`
  })
  const area = `${d} L${X(netos.length - 1)},${H} L${X(0)},${H} Z`
  function tocar(clientX: number) {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r) return
    setSel(Math.max(0, Math.min(unidades.length - 1, Math.round(((clientX - r.left) / r.width) * (unidades.length - 1)))))
    setParte(null)
  }

  // Dona de salidas del período elegido
  const partes = [
    { t: 'Mano de obra', v: u.manoObra, c: '#e0701a' },
    { t: 'Materiales y compras', v: u.materiales, c: '#2f63b8' },
    { t: 'Gastos fijos', v: u.fijos, c: '#8d99aa' },
  ]
  const totSal = partes.reduce((s, x) => s + x.v, 0)

  // Embudo de presupuestos (ventana según el período)
  const embudo = useMemo(() => {
    const dias = periodo === 'mes' ? 90 : periodo === 'tri' ? 180 : 365
    const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)
    const en = p.presupuestos.filter((x) => (x.fecha ?? '') >= desde)
    const env = en.filter((x) => x.estado !== 'borrador')
    const acep = en.filter((x) => x.estado === 'aceptado')
    const suma = (l: Pres[]) => l.reduce((s, x) => s + x.total, 0)
    return { dias, pasos: [['Armados', en.length, suma(en)], ['Enviados', env.length, suma(env)], ['Aceptados', acep.length, suma(acep)]] as [string, number, number][], cierre: env.length ? Math.round((acep.length / env.length) * 100) : null }
  }, [p.presupuestos, periodo])

  // Pendiente de cobrar (lo que ya corresponde por avance) y de pagar
  const porCobrarHoy = p.deudas.reduce((s, x) => s + Math.max(0, x.faltaAvance) + Math.max(0, x.extras), 0)
  const porPagar = p.personal.debe + p.recurrentes.monto
  const quedaria = porCobrarHoy - porPagar

  const tareas = verTodas ? p.tareas : p.tareas.slice(0, 5)
  const fecha = capital(new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))
  const borradoresMonto = p.borradores.reduce((s, x) => s + x.total, 0)

  return <div className="ip">
    <div className="ipCab">
      <span className="ipAvatar" aria-hidden>{(p.nombre[0] ?? 'M').toUpperCase()}</span>
      <div><small>{fecha}</small><h2>Hola{p.nombre ? `, ${p.nombre}` : ''}</h2></div>
      {p.acciones}
    </div>

    {p.verFinanzas && <>
      <div className="ipPeriodo" role="tablist" aria-label="Período">
        {([['mes', 'Mes'], ['tri', 'Trimestre'], ['anio', 'Año']] as [Periodo, string][]).map(([v, t]) => (
          <button key={v} type="button" role="tab" aria-selected={periodo === v} className={periodo === v ? 'on' : ''} onClick={() => { setPeriodo(v); setSel(null); setParte(null) }}>{t}</button>
        ))}
      </div>

      {/* ---- Pulso: ganancia del período con curva tocable ---- */}
      <section className="ipPulso" aria-label="Ganancia">
        <span className="ipEtq">GANANCIA {periodo === 'tri' ? 'DEL TRIMESTRE' : 'DE'} {u.etiqueta.toUpperCase()}</span>
        <div className="ipFila1">
          <span className="ipNeto">{pesos(neto)}</span>
          {delta != null && <span className={`ipDelta ${delta >= 0 ? 'sube' : 'baja'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs {periodo === 'tri' ? 'trim. anterior' : ant!.corta.toLowerCase()}</span>}
        </div>
        <span className="ipPrev">{esActual && periodo !== 'tri' && p.netoProyectado != null && Math.abs(p.netoProyectado - neto) > 1 ? `Si pagás lo previsto: ${pesos(p.netoProyectado)}` : esActual ? (periodo === 'tri' ? 'Trimestre en curso' : 'Mes en curso') : 'Período cerrado'}</span>
        <div className="ipCurva">
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Ganancia por período. Deslizá para ver cada uno."
            onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); tocar(e.clientX) }}
            onPointerMove={(e) => { if (e.buttons) tocar(e.clientX) }}>
            <defs><linearGradient id="ipGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3fbf7f" stopOpacity=".45" /><stop offset="1" stopColor="#3fbf7f" stopOpacity="0" /></linearGradient></defs>
            {[0.33, 0.66].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,.08)" />)}
            {min < 0 && <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="rgba(255,255,255,.25)" strokeDasharray="2 3" />}
            <path d={area} fill="url(#ipGrad)" />
            <path d={d} fill="none" stroke="#5ad394" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <line x1={X(k)} x2={X(k)} y1="6" y2={H} stroke="rgba(255,255,255,.3)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          </svg>
          {/* El punto va aparte para que no se deforme cuando el gráfico se estira */}
          <span className="ipPunto" style={{ left: `${(X(k) / W) * 100}%`, top: `${(Y(netos[k]) / H) * 100}%` }} aria-hidden />
        </div>
        <div className="ipMeses">{unidades.map((x, i) => <button key={x.clave} type="button" className={i === k ? 'on' : ''} onClick={() => { setSel(i); setParte(null) }}>{x.corta}</button>)}</div>
        <div className="ipMini3">
          <div><small>ENTRÓ</small><b className="v">{corto(u.entro)}</b></div>
          <div><small>SALIÓ</small><b className="r">{corto(u.salio)}</b></div>
          <div><small>MARGEN</small><b>{u.entro > 0 ? `${Math.round((neto / u.entro) * 100)}%` : '—'}</b></div>
        </div>
      </section>
    </>}

    {/* ---- Tres números ---- */}
    <div className="ipKpis">
      {p.verFinanzas && <button type="button" className="ipKpi" onClick={() => p.onIr('cobranzas')}>
        {p.porCobrar > 0.5 && <i className="ipMarca" />}
        <small>Te deben</small><b>{corto(p.porCobrar)}</b><span>{p.deudas.length} obra{p.deudas.length === 1 ? '' : 's'}</span>
      </button>}
      <button type="button" className="ipKpi" onClick={() => p.onIr('obras')}>
        <small>Obras</small><b>{p.obrasActivas.length}</b><span>{p.obrasActivas.length ? `${p.avancePromedio}% de avance` : 'ninguna en curso'}</span>
        <span className="ipBarra"><i style={{ width: `${p.avancePromedio}%` }} /></span>
      </button>
      {p.verPresupuestos && <button type="button" className="ipKpi" onClick={() => p.onIr('presupuestos')}>
        {p.borradores.length > 0 && <i className="ipMarca" />}
        <small>Borradores</small><b>{p.borradores.length}</b><span>{p.borradores.length ? `${corto(borradoresMonto)} sin enviar` : 'todo enviado'}</span>
      </button>}
    </div>
    <div className="ipChips">
      {p.personal.debe > 0.5
        ? <button type="button" className="ipChip av" onClick={() => p.onIr('personal')}>👷 Le debés al personal {corto(p.personal.debe)}</button>
        : p.personal.alDia > 0 && <span className="ipChip ok">✓ Personal al día · {p.personal.alDia}</span>}
      {p.verFinanzas && p.recurrentes.cantidad > 0 && <button type="button" className="ipChip av" onClick={() => p.onIr('gastos')}>⏰ {p.recurrentes.cantidad} gasto{p.recurrentes.cantidad === 1 ? '' : 's'} fijo{p.recurrentes.cantidad === 1 ? '' : 's'} por cargar</button>}
    </div>

    {/* ---- Hoy ---- */}
    <section className="ipCard" aria-label="Hoy">
      <div className="ipTit"><b>Hoy</b><span className={`ipCnt${p.tareas.length ? '' : ' ok'}`}>{p.tareas.length ? `${p.tareas.length} para hacer` : '✓ Todo al día'}</span></div>
      {p.tareas.length > 0 && <div className="ipTareas">
        {tareas.map((t) => (
          <div key={t.clave} className="ipTarea">
            <span className={`ipIco ${t.tono}`} aria-hidden>{t.icono}</span>
            <div><b>{t.titulo}</b><small>{t.detalle}</small></div>
            <button type="button" className={t.principal ? 'prim' : ''} onClick={t.accion}>{t.boton}</button>
          </div>
        ))}
        {p.tareas.length > 5 && <button type="button" className="ipVerMas" onClick={() => setVerTodas((v) => !v)}>{verTodas ? 'Ver menos' : `Ver todo (${p.tareas.length})`}</button>}
      </div>}
      {p.ia}
    </section>

    {p.verFinanzas && <>
      {/* ---- Pendiente de cobrar y pagar ---- */}
      {(porCobrarHoy > 0.5 || porPagar > 0.5) && <section className="ipCard" aria-label="Pendiente">
        <div className="ipTit"><b>Pendiente de cobrar y pagar</b><button type="button" className="ipLink" onClick={() => p.onIr('cobranzas')}>Detalle ›</button></div>
        <div className="ipFlujoBar" aria-hidden><i style={{ flex: Math.max(porCobrarHoy, 0.0001), background: 'var(--ip-verde)' }} /><i style={{ flex: Math.max(porPagar, 0.0001), background: 'var(--ip-rojo)' }} /></div>
        <div className="ipFlujo">
          <div><small>Por cobrar (ya corresponde)</small><b>{pesos(porCobrarHoy)}</b></div>
          <div><small>Por pagar (personal y fijos)</small><b>{pesos(porPagar)}</b></div>
        </div>
        <div className="ipFlujoRes"><span>Si cobrás y pagás todo, te quedaría</span><b className={quedaria >= 0 ? 'v' : 'r'}>{quedaria >= 0 ? '+ ' : ''}{pesos(quedaria)}</b></div>
      </section>}

      {/* ---- A dónde se va la plata ---- */}
      {totSal > 0.5 && <section className="ipCard" aria-label="Salidas">
        <div className="ipTit"><b>¿A dónde se va la plata?</b><button type="button" className="ipLink" onClick={() => p.onIr('balance')}>Balance ›</button></div>
        <div className="ipDona">
          <svg width="124" height="124" viewBox="0 0 124 124" role="img" aria-label="Salidas por tipo">
            {(() => {
              let a = -Math.PI / 2
              return partes.map((x, i) => {
                if (x.v <= 0) return null
                const ang = (x.v / totSal) * Math.PI * 2 - (partes.filter((y) => y.v > 0).length > 1 ? 0.04 : 0)
                const r = 56, ri = 38, c = 62
                const pt = (R: number, A: number) => `${c + R * Math.cos(A)} ${c + R * Math.sin(A)}`
                const big = ang > Math.PI ? 1 : 0
                const dd = ang >= Math.PI * 2 - 0.001
                  ? `M${c} ${c - r} A${r} ${r} 0 1 1 ${c - 0.01} ${c - r} L${c - 0.01} ${c - ri} A${ri} ${ri} 0 1 0 ${c} ${c - ri} Z`
                  : `M${pt(r, a)} A${r} ${r} 0 ${big} 1 ${pt(r, a + ang)} L${pt(ri, a + ang)} A${ri} ${ri} 0 ${big} 0 ${pt(ri, a)} Z`
                a += ang + 0.04
                return <path key={x.t} d={dd} fill={x.c} className={parte != null && parte !== i ? 'apagado' : ''} onClick={() => setParte(parte === i ? null : i)} />
              })
            })()}
            <text x="62" y="58" textAnchor="middle" fontSize="10.5" fill="currentColor" opacity=".6">{parte == null ? 'Salió' : partes[parte].t.split(' ')[0]}</text>
            <text x="62" y="74" textAnchor="middle" fontSize="13.5" fontWeight="800" fill="currentColor">{corto(parte == null ? totSal : partes[parte].v)}</text>
          </svg>
          <ul>
            {partes.map((x, i) => (
              <li key={x.t}><button type="button" className={parte === i ? 'on' : ''} onClick={() => setParte(parte === i ? null : i)}>
                <i style={{ background: x.c }} /><span>{x.t}</span><b>{totSal ? `${Math.round((x.v / totSal) * 100)}%` : '—'}</b>
              </button></li>
            ))}
          </ul>
        </div>
      </section>}
    </>}

    {/* ---- Obras en curso ---- */}
    {p.obrasActivas.length > 0 && <section className="ipCard" aria-label="Obras en curso">
      <div className="ipTit"><b>Obras en curso</b><button type="button" className="ipLink" onClick={() => p.onIr('obras')}>Ver todas ›</button></div>
      <div className="ipObras">
        {p.obrasActivas.map((o) => {
          const pct = Math.max(0, Math.min(100, Number(o.porcentaje_avance) || 0))
          const deuda = p.deudas.find((x) => x.obra.id === o.id)
          const cobrar = deuda ? Math.max(0, deuda.faltaAvance) + Math.max(0, deuda.extras) : 0
          return <button key={o.id} type="button" className="ipObra" onClick={() => p.onAbrirObra(o.id)}>
            <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
              <circle cx="22" cy="22" r="18" fill="none" stroke="var(--ip-linea)" strokeWidth="5" />
              <circle cx="22" cy="22" r="18" fill="none" stroke="#e0701a" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 113.1} 113.1`} transform="rotate(-90 22 22)" />
              <text x="22" y="26" textAnchor="middle" fontSize="11" fontWeight="800" fill="currentColor">{Math.round(pct)}%</text>
            </svg>
            <div><b>{o.nombre_obra}</b><small>{p.nombreCli(o.cliente_id)}</small>
              {p.verFinanzas && <em className={cobrar > 0.5 ? '' : 'ok'}>{cobrar > 0.5 ? `Cobrar ${corto(cobrar)}` : 'Al día'}</em>}</div>
          </button>
        })}
      </div>
    </section>}

    {/* ---- Embudo de presupuestos ---- */}
    {p.verPresupuestos && embudo.pasos[0][1] > 0 && <section className="ipCard" aria-label="Presupuestos">
      <div className="ipTit"><b>Presupuestos · últimos {embudo.dias} días</b>{embudo.cierre != null && <span className="ipConv">Cierre <b>{embudo.cierre}%</b></span>}</div>
      <div className="ipEmbudo">
        {embudo.pasos.map(([t, n, monto]) => (
          <div key={t} className="ipPaso"><span>{t}</span><div className="ipPasoBar"><i style={{ width: `${(n / Math.max(1, embudo.pasos[0][1])) * 100}%` }} /><em>{n}</em></div><b>{corto(monto)}</b></div>
        ))}
      </div>
      <button type="button" className="ipLink" onClick={() => p.onIr('graficos')}>Más gráficos ›</button>
    </section>}
  </div>
}

