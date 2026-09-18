import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'

type Obra = { id: number; nombre_obra: string; estado: string | null; porcentaje_avance: number | null; activo: boolean }
type Presupuesto = { id: number; obra_id: number | null; cliente_id: number; titulo: string; total: number; total_pagado: number; saldo: number; estado: string; activo: boolean; fecha: string }
type Cliente = { id: number; nombre: string; apellido: string | null }
type Pago = { monto: number; fecha: string; obra_id: number | null; presupuesto_id: number | null }
type Costo = { monto: number; fecha: string; tipo: string }
type GastoFijo = { monto: number; fecha: string; categoria: string | null }
type Material = { cantidad: number; precio_unitario: number; pagado: boolean }
type Prod = { id: number; nombre: string; tipo: string; costo_unitario: number; stock: number; stock_minimo: number; activo: boolean }
type Asig = { valor_acordado: number | null }
type Item = { catalogo_id: number | null; cantidad: number; presupuesto_id: number }

type Pestana = 'resumen' | 'pyl' | 'caja' | 'pagar' | 'inventario'
const mesActual = () => new Date().toISOString().slice(0, 7)
const nombreMes = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })

function Tablero() {
  const [obras, setObras] = useState<Obra[]>([])
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [costos, setCostos] = useState<Costo[]>([])
  const [gastos, setGastos] = useState<GastoFijo[]>([])
  const [materiales, setMateriales] = useState<Material[]>([])
  const [productos, setProductos] = useState<Prod[]>([])
  const [asignaciones, setAsignaciones] = useState<Asig[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [pestana, setPestana] = useState<Pestana>('resumen')
  const [mesSel, setMesSel] = useState(mesActual())
  const [agingSel, setAgingSel] = useState<string | null>(null)
  const [invFiltro, setInvFiltro] = useState<'todos' | 'sin' | 'reponer'>('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function cargar() {
      setCargando(true); setError('')
      const [rO, rP, rPa, rC, rG, rM, rProd, rA, rItems, rCli] = await Promise.all([
        supabase.from('obras').select('id,nombre_obra,estado,porcentaje_avance,activo'),
        supabase.from('presupuestos').select('id,obra_id,cliente_id,titulo,total,total_pagado,saldo,estado,activo,fecha').eq('activo', true),
        supabase.from('pagos').select('monto,fecha,obra_id,presupuesto_id'),
        supabase.from('costos').select('monto,fecha,tipo'),
        supabase.from('gastos_generales').select('monto,fecha,categoria'),
        supabase.from('materiales').select('cantidad,precio_unitario,pagado'),
        supabase.from('productos_servicios').select('id,nombre,tipo,costo_unitario,stock,stock_minimo,activo'),
        supabase.from('obra_asignaciones').select('valor_acordado'),
        supabase.from('presupuesto_items').select('catalogo_id,cantidad,presupuesto_id').eq('tipo', 'producto'),
        supabase.from('Clientes').select('id,nombre,apellido'),
      ])
      if (rO.error || rP.error) { console.error(rO.error || rP.error); setError('No se pudo cargar el tablero.'); setCargando(false); return }
      const num = (x: unknown) => Number(x) || 0
      setObras((rO.data ?? []) as Obra[])
      setPresupuestos((rP.data ?? []).map((p) => ({ ...p, total: num(p.total), total_pagado: num(p.total_pagado), saldo: num(p.saldo) })) as Presupuesto[])
      setPagos(rPa.error ? [] : (rPa.data ?? []).map((p) => ({ ...p, monto: num(p.monto) })) as Pago[])
      setCostos(rC.error ? [] : (rC.data ?? []).map((c) => ({ ...c, monto: num(c.monto) })) as Costo[])
      setGastos(rG.error ? [] : (rG.data ?? []).map((g) => ({ ...g, monto: num(g.monto) })) as GastoFijo[])
      setMateriales(rM.error ? [] : (rM.data ?? []).map((m) => ({ cantidad: num(m.cantidad), precio_unitario: num(m.precio_unitario), pagado: m.pagado !== false })) as Material[])
      setProductos(rProd.error ? [] : (rProd.data ?? []).map((p) => ({ ...p, costo_unitario: num(p.costo_unitario), stock: num(p.stock), stock_minimo: num(p.stock_minimo) })) as Prod[])
      setAsignaciones(rA.error ? [] : (rA.data ?? []).map((a) => ({ valor_acordado: a.valor_acordado == null ? null : num(a.valor_acordado) })) as Asig[])
      setItems(rItems.error ? [] : (rItems.data ?? []).map((i) => ({ catalogo_id: i.catalogo_id, cantidad: num(i.cantidad), presupuesto_id: i.presupuesto_id })) as Item[])
      setClientes(rCli.error ? [] : (rCli.data ?? []) as Cliente[])
      setCargando(false)
    }
    cargar()
  }, [])

  const enMes = (f: string | null | undefined, ym: string) => (f ?? '').slice(0, 7) === ym

  // ---- P&L del mes seleccionado + últimos 6 meses ----
  const pyl = useMemo(() => {
    const calc = (ym: string) => {
      const ingresos = pagos.filter((p) => enMes(p.fecha, ym)).reduce((s, p) => s + p.monto, 0)
      const costosDir = costos.filter((c) => enMes(c.fecha, ym)).reduce((s, c) => s + c.monto, 0)
      const fijos = gastos.filter((g) => enMes(g.fecha, ym)).reduce((s, g) => s + g.monto, 0)
      return { ingresos, costosDir, fijos, resultado: ingresos - costosDir - fijos }
    }
    const meses: { ym: string; ingresos: number; costosDir: number; fijos: number; resultado: number }[] = []
    const base = new Date(`${mesSel}-01T12:00:00`)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      meses.push({ ym, ...calc(ym) })
    }
    return { actual: calc(mesSel), meses }
  }, [pagos, costos, gastos, mesSel])

  const nombreCli = (id: number) => { const c = clientes.find((x) => x.id === id); return c ? `${c.nombre} ${c.apellido ?? ''}`.trim() : 'Cliente' }

  // ---- Aging de cuentas por cobrar (por presupuesto aceptado con saldo) ----
  const aging = useMemo(() => {
    type Fila = { id: number; cliente: string; titulo: string; saldo: number; dias: number }
    const det: Record<string, Fila[]> = { b0: [], b30: [], b60: [], b90: [] }
    const buckets = { b0: 0, b30: 0, b60: 0, b90: 0 }
    const hoy = Date.now()
    presupuestos.filter((p) => p.estado === 'aceptado' && p.saldo > 0).forEach((p) => {
      const dias = Math.floor((hoy - new Date(`${(p.fecha ?? '').slice(0, 10)}T12:00:00`).getTime()) / 86400000)
      const k = dias <= 30 ? 'b0' : dias <= 60 ? 'b30' : dias <= 90 ? 'b60' : 'b90'
      buckets[k as keyof typeof buckets] += p.saldo
      det[k].push({ id: p.id, cliente: nombreCli(p.cliente_id), titulo: p.titulo, saldo: p.saldo, dias })
    })
    const total = buckets.b0 + buckets.b30 + buckets.b60 + buckets.b90
    return { ...buckets, total, det }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presupuestos, clientes])

  // ---- Cuentas por pagar ----
  const porPagar = useMemo(() => {
    const proveedores = materiales.filter((m) => !m.pagado).reduce((s, m) => s + m.cantidad * m.precio_unitario, 0)
    const personalAcordado = asignaciones.reduce((s, a) => s + (Number(a.valor_acordado) || 0), 0)
    const personalPagado = costos.filter((c) => c.tipo === 'mano_obra' || c.tipo === 'terciarizado').reduce((s, c) => s + c.monto, 0)
    const personal = Math.max(0, personalAcordado - personalPagado)
    return { proveedores, personal, total: proveedores + personal }
  }, [materiales, asignaciones, costos])

  // ---- Comercial / operativo / inventario ----
  const kpis = useMemo(() => {
    const aceptados = presupuestos.filter((p) => p.estado === 'aceptado')
    const decididos = presupuestos.filter((p) => ['aceptado', 'rechazado'].includes(p.estado)).length
    const conversion = decididos > 0 ? Math.round((aceptados.length / decididos) * 100) : 0
    const ticket = aceptados.length ? aceptados.reduce((s, p) => s + p.total, 0) / aceptados.length : 0
    const enProceso = obras.filter((o) => o.estado === 'en_proceso' && o.activo).length
    const valorStock = productos.filter((p) => p.tipo === 'producto' && p.activo).reduce((s, p) => s + p.costo_unitario * p.stock, 0)
    const stockBajo = productos.filter((p) => p.tipo === 'producto' && p.activo && p.stock <= (p.stock_minimo || 5)).length
    const porCobrar = presupuestos.filter((p) => p.estado === 'aceptado').reduce((s, p) => s + p.saldo, 0)
    return { conversion, ticket, enProceso, valorStock, stockBajo, porCobrar, aceptados: aceptados.length,
      borrador: presupuestos.filter((p) => p.estado === 'borrador').length,
      enviado: presupuestos.filter((p) => p.estado === 'enviado').length,
      rechazado: presupuestos.filter((p) => p.estado === 'rechazado').length }
  }, [presupuestos, obras, productos])

  // ---- Rotación de inventario ----
  const inventario = useMemo(() => {
    const aceptadosIds = new Set(presupuestos.filter((p) => p.estado === 'aceptado').map((p) => p.id))
    const vendidasPorProd: Record<number, number> = {}
    items.forEach((it) => { if (it.catalogo_id != null && aceptadosIds.has(it.presupuesto_id)) vendidasPorProd[it.catalogo_id] = (vendidasPorProd[it.catalogo_id] || 0) + it.cantidad })
    const filas = productos.filter((p) => p.tipo === 'producto' && p.activo).map((p) => {
      const vendidas = vendidasPorProd[p.id] || 0
      const inmovilizado = p.costo_unitario * p.stock
      const rotacion = p.stock > 0 ? vendidas / p.stock : (vendidas > 0 ? 99 : 0)
      let clase: 'agotado' | 'alta' | 'media' | 'baja' | 'sin'
      if (p.stock <= 0 && vendidas > 0) clase = 'agotado'
      else if (vendidas === 0) clase = 'sin'
      else if (rotacion >= 3) clase = 'alta'
      else if (rotacion >= 1) clase = 'media'
      else clase = 'baja'
      return { ...p, vendidas, inmovilizado, rotacion, clase }
    }).sort((a, b) => b.inmovilizado - a.inmovilizado)
    const valorStock = filas.reduce((s, f) => s + f.inmovilizado, 0)
    const dormido = filas.filter((f) => f.clase === 'sin' || f.clase === 'baja').reduce((s, f) => s + f.inmovilizado, 0)
    const aReponer = filas.filter((f) => f.stock <= (f.stock_minimo || 5))
    const sinMov = filas.filter((f) => f.clase === 'sin').length
    return { filas, valorStock, dormido, aReponer, sinMov }
  }, [productos, items, presupuestos])

  const CLASE_INV: Record<string, { t: string; c: string }> = {
    agotado: { t: 'Agotado', c: 'est-rechazado' }, alta: { t: 'Alta', c: 'est-aceptado' },
    media: { t: 'Media', c: 'est-enviado' }, baja: { t: 'Baja', c: 'est-observacion' }, sin: { t: 'Sin movimiento', c: 'est-borrador' },
  }

  const color = (v: number) => (v > 0 ? '#23764e' : v < 0 ? '#b23b32' : '#4b525c')
  const maxRes = Math.max(1, ...pyl.meses.map((m) => Math.abs(m.resultado)))

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div><p className="subtitle">DIRECCIÓN</p><h2>Tablero</h2><p className="welcome">Visión 360: resultado, caja, cobranzas e inventario</p></div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--mova-muted)' }}>Mes
          <input type="month" value={mesSel} onChange={(e) => setMesSel(e.target.value)} style={{ padding: '9px 12px', border: '1px solid var(--mova-border)', borderRadius: 10 }} />
        </label>
      </div>

      <div className="gestionTabs">
        <button className={pestana === 'resumen' ? 'active' : ''} onClick={() => setPestana('resumen')}>Resumen</button>
        <button className={pestana === 'pyl' ? 'active' : ''} onClick={() => setPestana('pyl')}>Resultado (P&L)</button>
        <button className={pestana === 'caja' ? 'active' : ''} onClick={() => setPestana('caja')}>Caja & Cobranzas</button>
        <button className={pestana === 'pagar' ? 'active' : ''} onClick={() => setPestana('pagar')}>Cuentas por pagar</button>
        <button className={pestana === 'inventario' ? 'active' : ''} onClick={() => setPestana('inventario')}>Inventario</button>
      </div>

      {cargando && <p>Cargando tablero...</p>}
      {error && <p className="loginError">{error}</p>}

      {!cargando && !error && pestana === 'resumen' && <>
        <div className="gestionKpis">
          <div><span>RESULTADO DEL MES</span><strong style={{ color: color(pyl.actual.resultado) }}>{moneda(pyl.actual.resultado)}</strong><small>{nombreMes(mesSel)}</small></div>
          <div><span>INGRESOS (COBRADO)</span><strong>{moneda(pyl.actual.ingresos)}</strong><small>Del mes</small></div>
          <div><span>POR COBRAR</span><strong>{moneda(kpis.porCobrar)}</strong><small>Saldo aceptados</small></div>
          <div className="destacado"><span>POR PAGAR</span><strong>{moneda(porPagar.total)}</strong><small>Proveedores + ayudantes</small></div>
        </div>
        <div className="tabGrid">
          <section className="tabCard">
            <h3>Comercial</h3>
            <div className="tabRow"><span>Tasa de conversión</span><strong>{kpis.conversion}%</strong></div>
            <div className="tabRow"><span>Ticket promedio</span><strong>{moneda(kpis.ticket)}</strong></div>
            <div className="tabRow"><span>Presupuestos aceptados</span><strong>{kpis.aceptados}</strong></div>
            <div className="tabRow"><span>Borrador / Enviado / Rechazado</span><strong>{kpis.borrador} / {kpis.enviado} / {kpis.rechazado}</strong></div>
          </section>
          <section className="tabCard">
            <h3>Operativo</h3>
            <div className="tabRow"><span>Obras en proceso</span><strong>{kpis.enProceso}</strong></div>
            <div className="tabRow"><span>Costos directos del mes</span><strong>{moneda(pyl.actual.costosDir)}</strong></div>
            <div className="tabRow"><span>Gastos fijos del mes</span><strong>{moneda(pyl.actual.fijos)}</strong></div>
          </section>
          <section className="tabCard">
            <h3>Inventario</h3>
            <div className="tabRow"><span>Valor de stock</span><strong>{moneda(kpis.valorStock)}</strong></div>
            <div className="tabRow"><span>Productos con stock bajo</span><strong className={kpis.stockBajo ? 'pend' : ''}>{kpis.stockBajo}</strong></div>
          </section>
        </div>
      </>}

      {!cargando && !error && pestana === 'pyl' && <>
        <div className="gestionKpis">
          <div><span>INGRESOS</span><strong>{moneda(pyl.actual.ingresos)}</strong><small>Cobrado del mes</small></div>
          <div><span>COSTOS DIRECTOS</span><strong>{moneda(pyl.actual.costosDir)}</strong><small>Obras</small></div>
          <div><span>GASTOS FIJOS</span><strong>{moneda(pyl.actual.fijos)}</strong><small>Estructura</small></div>
          <div className="destacado"><span>RESULTADO NETO</span><strong style={{ color: color(pyl.actual.resultado) }}>{moneda(pyl.actual.resultado)}</strong><small>{nombreMes(mesSel)}</small></div>
        </div>
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Mes</th><th>Ingresos</th><th>Costos directos</th><th>Gastos fijos</th><th>Resultado</th><th></th></tr></thead>
            <tbody>{pyl.meses.map((m) => (
              <tr key={m.ym} onClick={() => setMesSel(m.ym)} style={{ cursor: 'pointer', background: m.ym === mesSel ? '#fff9f0' : undefined }} title="Ver este mes">
                <td><strong>{nombreMes(m.ym)}</strong></td>
                <td>{moneda(m.ingresos)}</td><td>{moneda(m.costosDir)}</td><td>{moneda(m.fijos)}</td>
                <td><strong style={{ color: color(m.resultado) }}>{moneda(m.resultado)}</strong></td>
                <td style={{ width: 160 }}><div className="tabBar"><span style={{ width: `${(Math.abs(m.resultado) / maxRes) * 100}%`, background: m.resultado >= 0 ? '#23935b' : '#b23b32' }} /></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="finBreakdown">
          <span>IVA débito (ventas cobradas 21%): <strong>{moneda(pyl.actual.ingresos - pyl.actual.ingresos / 1.21)}</strong></span>
          <span>IVA crédito estimado (costos 21%): <strong>{moneda(pyl.actual.costosDir - pyl.actual.costosDir / 1.21)}</strong></span>
          <span>Posición IVA aprox.: <strong>{moneda((pyl.actual.ingresos - pyl.actual.ingresos / 1.21) - (pyl.actual.costosDir - pyl.actual.costosDir / 1.21))}</strong></span>
        </div>
        <p className="gestionAyuda">Resultado neto = ingresos cobrados − costos directos de obras − gastos fijos de estructura. Es la utilidad real de la empresa en el mes. La posición de IVA es una estimación al 21% (para la liquidación exacta usá los comprobantes con factura).</p>
      </>}

      {!cargando && !error && pestana === 'caja' && <>
        <div className="gestionKpis">
          <div><span>POR COBRAR TOTAL</span><strong>{moneda(aging.total)}</strong><small>Presupuestos aceptados con saldo</small></div>
          <div><span>AL DÍA (0-30)</span><strong>{moneda(aging.b0)}</strong><small>Reciente</small></div>
          <div><span>31-60 / 61-90</span><strong>{moneda(aging.b30 + aging.b60)}</strong><small>Atención</small></div>
          <div className="destacado"><span>VENCIDO +90</span><strong style={{ color: aging.b90 > 0 ? '#b23b32' : undefined }}>{moneda(aging.b90)}</strong><small>Riesgo</small></div>
        </div>
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Antigüedad</th><th>Monto por cobrar</th><th>% del total</th><th></th></tr></thead>
            <tbody>
              {([['b0', '0 a 30 días', aging.b0], ['b30', '31 a 60 días', aging.b30], ['b60', '61 a 90 días', aging.b60], ['b90', 'Más de 90 días', aging.b90]] as const).map(([key, lbl, val]) => (
                <tr key={key} onClick={() => setAgingSel(agingSel === key ? null : key)} style={{ cursor: 'pointer', background: agingSel === key ? '#fff9f0' : undefined }} title="Ver detalle">
                  <td><strong>{lbl}</strong></td><td>{moneda(val)}</td><td>{aging.total ? Math.round((val / aging.total) * 100) : 0}%</td>
                  <td style={{ color: 'var(--mova-orange)', fontWeight: 700 }}>{aging.det[key].length ? (agingSel === key ? 'Ocultar ▲' : `Ver ${aging.det[key].length} ▼`) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {agingSel && aging.det[agingSel].length > 0 && (
          <div className="crmListaWrap" style={{ marginTop: 12 }}>
            <table className="crmLista">
              <thead><tr><th>Cliente</th><th>Presupuesto</th><th>Días</th><th>Saldo</th></tr></thead>
              <tbody>{aging.det[agingSel].sort((a, b) => b.saldo - a.saldo).map((d) => (
                <tr key={d.id}><td><strong>{d.cliente}</strong></td><td>{d.titulo}</td><td>{d.dias} días</td><td><strong>{moneda(d.saldo)}</strong></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="gestionAyuda">Tocá una fila para ver el detalle de qué clientes/presupuestos están en esa antigüedad. Lo vencido +90 es la principal alerta de cobranza.</p>
      </>}

      {!cargando && !error && pestana === 'pagar' && <>
        <div className="gestionKpis">
          <div className="destacado"><span>TOTAL POR PAGAR</span><strong>{moneda(porPagar.total)}</strong><small>Compromisos pendientes</small></div>
          <div><span>PROVEEDORES</span><strong>{moneda(porPagar.proveedores)}</strong><small>Compras impagas</small></div>
          <div><span>AYUDANTES / PERSONAL</span><strong>{moneda(porPagar.personal)}</strong><small>Acordado − pagado</small></div>
        </div>
        <p className="gestionAyuda">Proveedores: compras marcadas como impagas (marcá "pagado" en cada compra). Personal: lo acordado por obra que todavía no se pagó.</p>
      </>}

      {!cargando && !error && pestana === 'inventario' && <>
        <div className="gestionKpis">
          <div><span>VALOR DE STOCK</span><strong>{moneda(inventario.valorStock)}</strong><small>Capital en productos</small></div>
          <div className="destacado"><span>CAPITAL DORMIDO</span><strong>{moneda(inventario.dormido)}</strong><small>Sin/baja rotación</small></div>
          <button type="button" className={`prodKpiBtn ${invFiltro === 'sin' ? 'activo' : ''}`} onClick={() => setInvFiltro(invFiltro === 'sin' ? 'todos' : 'sin')}><span>SIN MOVIMIENTO</span><strong>{inventario.sinMov}</strong><small>{invFiltro === 'sin' ? 'Filtrando ✓' : 'Tocá para filtrar'}</small></button>
          <button type="button" className={`prodKpiBtn ${invFiltro === 'reponer' ? 'activo' : ''}`} onClick={() => setInvFiltro(invFiltro === 'reponer' ? 'todos' : 'reponer')}><span>A REPONER</span><strong>{inventario.aReponer.length}</strong><small>{invFiltro === 'reponer' ? 'Filtrando ✓' : 'Tocá para filtrar'}</small></button>
        </div>
        {inventario.aReponer.length > 0 && (
          <div className="stockAviso"><strong>🛒 Sugerido de reposición:</strong> {inventario.aReponer.map((f) => `${f.nombre} (${f.stock})`).join(' · ')}</div>
        )}
        {invFiltro !== 'todos' && <p className="gestionAyuda">Mostrando solo: <strong>{invFiltro === 'sin' ? 'sin movimiento' : 'a reponer'}</strong>. <button type="button" className="editButton" onClick={() => setInvFiltro('todos')}>Ver todos ✕</button></p>}
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Producto</th><th>Stock</th><th>Vendidas</th><th>Rotación</th><th>Clasificación</th><th>Capital inmovilizado</th></tr></thead>
            <tbody>
              {(() => {
                const filas = inventario.filas.filter((f) => invFiltro === 'todos' || (invFiltro === 'sin' && f.clase === 'sin') || (invFiltro === 'reponer' && f.stock <= (f.stock_minimo || 5)))
                return filas.length === 0 ? <tr><td colSpan={6}>Sin productos.</td></tr> : filas.map((f) => (
                <tr key={f.id}>
                  <td><strong>{f.nombre}</strong></td>
                  <td>{f.stock}</td>
                  <td>{f.vendidas}</td>
                  <td>{f.clase === 'agotado' ? '—' : `${f.rotacion.toFixed(1)}x`}</td>
                  <td><span className={`crmBadge ${CLASE_INV[f.clase].c}`}>{CLASE_INV[f.clase].t}</span></td>
                  <td>{moneda(f.inmovilizado)}</td>
                </tr>
              ))
              })()}
            </tbody>
          </table>
        </div>
        <p className="gestionAyuda">Rotación = unidades vendidas (en presupuestos aceptados, histórico) ÷ stock actual. <strong>Sin movimiento</strong> y <strong>baja</strong> = capital dormido a revisar (liquidar/no reponer). <strong>Agotado</strong> = se vendió todo, evaluá reponer.</p>
      </>}
    </div>
  )
}

export default Tablero
