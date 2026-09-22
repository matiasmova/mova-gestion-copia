import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta, hoy } from './gestionFormat'
import { calcularPersona } from './personalCalculos'

type Obra = { id: number; nombre_obra: string; estado: string | null; porcentaje_avance: number | null; activo: boolean }
type Presupuesto = { id: number; obra_id: number | null; cliente_id: number; titulo: string; total: number; total_pagado: number; saldo: number; estado: string; activo: boolean; fecha: string }
type Cliente = { id: number; nombre: string; apellido: string | null }
type Pago = { monto: number; fecha: string; obra_id: number | null; presupuesto_id: number | null }
type Costo = { monto: number; fecha: string; tipo: string; personal_id: number | null; obra_id: number | null }
type Gasto = { id: number; fecha: string; categoria: string | null; descripcion: string | null; monto: number; recurrente: boolean }
type Material = { cantidad: number; precio_unitario: number; pagado: boolean }
type Prod = { id: number; nombre: string; tipo: string; costo_unitario: number; stock: number; stock_minimo: number; activo: boolean }
type AsigTablero = { obra_id: number; personal_id: number | null; modalidad: string | null; valor_acordado: number | null }
type PersonaTablero = { id: number; nombre: string; apellido: string | null; tipo: string; costo_dia: number | null }
type JornalTablero = { obra_id: number; personal_id: number | null; jornada: number; horas: number | null }
type AdicionalTablero = { obra_id: number; importe: number; estado: string; tipo: string }
type Item = { catalogo_id: number | null; cantidad: number; presupuesto_id: number }

type Pestana = 'resumen' | 'pyl' | 'caja' | 'personal' | 'gastos' | 'pagar' | 'inventario'
const mesActual = () => new Date().toISOString().slice(0, 7)
const nombreMes = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
const redondear = (n: number) => Math.round(n * 100) / 100
const monedaCorta = (v: number) => {
  const signo = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${signo}$${(abs / 1_000_000).toFixed(1).replace('.0', '')}M`
  if (abs >= 1_000) return `${signo}$${Math.round(abs / 1000)}k`
  return `${signo}${moneda(abs)}`
}
const MODALIDADES: Record<string, string> = {
  por_dia: 'Por día', por_hora: 'Por hora', por_obra: 'Por obra', porcentaje: 'Por porcentaje', por_etapa: 'Por etapa',
}
const CATEGORIAS_GASTO = ['Alquiler', 'Sueldos fijos', 'Servicios', 'Impuestos', 'Contador', 'Combustible', 'Herramientas', 'Marketing', 'Otros']

type TableroProps = { onIrA?: (destino: 'gastos' | 'finanzas') => void }

function Tablero({ onIrA }: TableroProps = {}) {
  const [obras, setObras] = useState<Obra[]>([])
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [costos, setCostos] = useState<Costo[]>([])
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [materiales, setMateriales] = useState<Material[]>([])
  const [productos, setProductos] = useState<Prod[]>([])
  const [asigTablero, setAsigTablero] = useState<AsigTablero[]>([])
  const [personasTablero, setPersonasTablero] = useState<PersonaTablero[]>([])
  const [jornalesTablero, setJornalesTablero] = useState<JornalTablero[]>([])
  const [adicionalesTablero, setAdicionalesTablero] = useState<AdicionalTablero[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [pestana, setPestana] = useState<Pestana>('resumen')
  const [mesSel, setMesSel] = useState(mesActual())
  const [agingSel, setAgingSel] = useState<string | null>(null)
  const [invFiltro, setInvFiltro] = useState<'todos' | 'sin' | 'reponer'>('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [formGasto, setFormGasto] = useState<Gasto | null>(null)

  useEffect(() => {
    async function cargar() {
      setCargando(true); setError('')
      const [rO, rP, rPa, rC, rG, rM, rProd, rA, rItems, rCli, rPer, rJor, rAdic] = await Promise.all([
        supabase.from('obras').select('id,nombre_obra,estado,porcentaje_avance,activo'),
        supabase.from('presupuestos').select('id,obra_id,cliente_id,titulo,total,total_pagado,saldo,estado,activo,fecha').eq('activo', true),
        supabase.from('pagos').select('monto,fecha,obra_id,presupuesto_id'),
        supabase.from('costos').select('monto,fecha,tipo,personal_id,obra_id'),
        supabase.from('gastos_generales').select('id,fecha,categoria,descripcion,monto,recurrente'),
        supabase.from('materiales').select('cantidad,precio_unitario,pagado'),
        supabase.from('productos_servicios').select('id,nombre,tipo,costo_unitario,stock,stock_minimo,activo'),
        supabase.from('obra_asignaciones').select('obra_id,personal_id,modalidad,valor_acordado'),
        supabase.from('presupuesto_items').select('catalogo_id,cantidad,presupuesto_id').eq('tipo', 'producto'),
        supabase.from('Clientes').select('id,nombre,apellido'),
        supabase.from('personal').select('id,nombre,apellido,tipo,costo_dia'),
        supabase.from('jornales').select('obra_id,personal_id,jornada,horas'),
        supabase.from('adicionales').select('obra_id,importe,estado,tipo'),
      ])
      if (rO.error || rP.error) { console.error(rO.error || rP.error); setError('No se pudo cargar el tablero.'); setCargando(false); return }
      const num = (x: unknown) => Number(x) || 0
      setObras((rO.data ?? []) as Obra[])
      setPresupuestos((rP.data ?? []).map((p) => ({ ...p, total: num(p.total), total_pagado: num(p.total_pagado), saldo: num(p.saldo) })) as Presupuesto[])
      setPagos(rPa.error ? [] : (rPa.data ?? []).map((p) => ({ ...p, monto: num(p.monto) })) as Pago[])
      setCostos(rC.error ? [] : (rC.data ?? []).map((c) => ({ ...c, monto: num(c.monto) })) as Costo[])
      setGastos(rG.error ? [] : (rG.data ?? []).map((g) => ({ ...g, monto: num(g.monto) })) as Gasto[])
      setMateriales(rM.error ? [] : (rM.data ?? []).map((m) => ({ cantidad: num(m.cantidad), precio_unitario: num(m.precio_unitario), pagado: m.pagado !== false })) as Material[])
      setProductos(rProd.error ? [] : (rProd.data ?? []).map((p) => ({ ...p, costo_unitario: num(p.costo_unitario), stock: num(p.stock), stock_minimo: num(p.stock_minimo) })) as Prod[])
      setAsigTablero(rA.error ? [] : (rA.data ?? []).map((a) => ({ ...a, valor_acordado: a.valor_acordado == null ? null : num(a.valor_acordado) })) as AsigTablero[])
      setItems(rItems.error ? [] : (rItems.data ?? []).map((i) => ({ catalogo_id: i.catalogo_id, cantidad: num(i.cantidad), presupuesto_id: i.presupuesto_id })) as Item[])
      setClientes(rCli.error ? [] : (rCli.data ?? []) as Cliente[])
      setPersonasTablero(rPer.error ? [] : (rPer.data ?? []).map((p) => ({ ...p, costo_dia: p.costo_dia == null ? null : num(p.costo_dia) })) as PersonaTablero[])
      setJornalesTablero(rJor.error ? [] : (rJor.data ?? []).map((j) => ({ ...j, jornada: num(j.jornada), horas: j.horas == null ? null : num(j.horas) })) as JornalTablero[])
      setAdicionalesTablero(rAdic.error ? [] : (rAdic.data ?? []).map((a) => ({ ...a, importe: num(a.importe) })) as AdicionalTablero[])
      setCargando(false)
    }
    cargar()
  }, [])

  async function recargarGastos() {
    const { data, error: err } = await supabase.from('gastos_generales').select('id,fecha,categoria,descripcion,monto,recurrente').order('fecha', { ascending: false })
    if (err) { console.error(err); return }
    setGastos((data ?? []).map((g) => ({ ...g, monto: Number(g.monto) })) as Gasto[])
  }

  async function eliminarGasto(g: Gasto) {
    if (!window.confirm(`¿Eliminar el gasto "${g.descripcion || g.categoria}"?`)) return
    const { error: err } = await supabase.from('gastos_generales').delete().eq('id', g.id)
    if (err) { console.error(err); window.alert('No se pudo eliminar.'); return }
    void recargarGastos()
  }

  const enMes = (f: string | null | undefined, ym: string) => (f ?? '').slice(0, 7) === ym

  // ---- P&L del mes seleccionado + últimos 12 meses (alimenta el gráfico) ----
  const pyl = useMemo(() => {
    const calc = (ym: string) => {
      const ingresos = pagos.filter((p) => enMes(p.fecha, ym)).reduce((s, p) => s + p.monto, 0)
      const costosDir = costos.filter((c) => enMes(c.fecha, ym)).reduce((s, c) => s + c.monto, 0)
      const fijos = gastos.filter((g) => enMes(g.fecha, ym)).reduce((s, g) => s + g.monto, 0)
      return { ingresos, costosDir, fijos, resultado: ingresos - costosDir - fijos }
    }
    const meses: { ym: string; ingresos: number; costosDir: number; fijos: number; resultado: number }[] = []
    const base = new Date(`${mesSel}-01T12:00:00`)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      meses.push({ ym, ...calc(ym) })
    }
    return { actual: calc(mesSel), meses }
  }, [pagos, costos, gastos, mesSel])

  // ---- Histórico de toda la empresa: lo invertido, lo ganado y los impuestos ----
  const historico = useMemo(() => {
    const pagosTotal = redondear(pagos.reduce((s, p) => s + p.monto, 0))
    const costosTotal = redondear(costos.reduce((s, c) => s + c.monto, 0))
    const gastosTotal = redondear(gastos.reduce((s, g) => s + g.monto, 0))
    const impuestosTotal = redondear(gastos.filter((g) => (g.categoria || '').toLowerCase() === 'impuestos').reduce((s, g) => s + g.monto, 0))
    return { pagosTotal, costosTotal, gastosTotal, impuestosTotal, invertido: costosTotal, ganancia: redondear(pagosTotal - costosTotal - gastosTotal) }
  }, [pagos, costos, gastos])

  const nombreCli = (id: number) => { const c = clientes.find((x) => x.id === id); return c ? `${c.nombre} ${c.apellido ?? ''}`.trim() : 'Cliente' }
  const nombreObra = (id: number | null) => (id != null ? obras.find((o) => o.id === id)?.nombre_obra ?? `Obra #${id}` : '—')

  // ---- Aging de cuentas por cobrar (por presupuesto aceptado con saldo), con la obra de cada uno ----
  const aging = useMemo(() => {
    type Fila = { id: number; cliente: string; titulo: string; obra: string; saldo: number; dias: number }
    const det: Record<string, Fila[]> = { b0: [], b30: [], b60: [], b90: [] }
    const buckets = { b0: 0, b30: 0, b60: 0, b90: 0 }
    const hoyMs = Date.now()
    presupuestos.filter((p) => p.estado === 'aceptado' && p.saldo > 0).forEach((p) => {
      const dias = Math.floor((hoyMs - new Date(`${(p.fecha ?? '').slice(0, 10)}T12:00:00`).getTime()) / 86400000)
      const k = dias <= 30 ? 'b0' : dias <= 60 ? 'b30' : dias <= 90 ? 'b60' : 'b90'
      buckets[k as keyof typeof buckets] += p.saldo
      det[k].push({ id: p.id, cliente: nombreCli(p.cliente_id), titulo: p.titulo, obra: nombreObra(p.obra_id), saldo: p.saldo, dias })
    })
    const total = buckets.b0 + buckets.b30 + buckets.b60 + buckets.b90
    return { ...buckets, total, det }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presupuestos, clientes, obras])

  // ---- Personal: lo pactado, pagado y el saldo con cada persona en cada obra ----
  const personalDetalle = useMemo(() => {
    const valorObraDe = (obraId: number) =>
      presupuestos.filter((p) => p.obra_id === obraId && p.activo !== false && p.estado === 'aceptado').reduce((s, p) => s + p.total, 0) +
      adicionalesTablero.filter((a) => a.obra_id === obraId && a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + a.importe, 0)
    return asigTablero.map((a) => {
      const persona = personasTablero.find((p) => p.id === a.personal_id)
      const pagosPersona = costos.filter((c) => c.personal_id === a.personal_id && c.obra_id === a.obra_id).map((c) => ({ personal_id: c.personal_id, monto: c.monto }))
      const jornalesObra = jornalesTablero.filter((j) => j.obra_id === a.obra_id)
      const valorObra = valorObraDe(a.obra_id)
      const avanceObra = obras.find((o) => o.id === a.obra_id)?.porcentaje_avance ?? 0
      const calc = calcularPersona(a, persona, pagosPersona, jornalesObra, valorObra, avanceObra)
      const saldo = calc.totalContrato != null ? Math.max(calc.totalContrato - calc.pagado, 0) : Math.max(calc.diferencia, 0)
      return {
        obraId: a.obra_id,
        personaId: a.personal_id,
        nombre: persona ? `${persona.nombre} ${persona.apellido ?? ''}`.trim() : 'Persona',
        obra: nombreObra(a.obra_id),
        modalidad: a.modalidad ?? 'por_obra',
        calc, saldo,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asigTablero, personasTablero, costos, jornalesTablero, presupuestos, adicionalesTablero, obras])

  const totalesPersonal = useMemo(() => personalDetalle.reduce((acc, f) => ({
    pagado: acc.pagado + f.calc.pagado,
    saldo: acc.saldo + f.saldo,
  }), { pagado: 0, saldo: 0 }), [personalDetalle])

  // ---- Cuentas por pagar: proveedores (compras impagas) + saldo con el personal ----
  const porPagar = useMemo(() => {
    const proveedores = materiales.filter((m) => !m.pagado).reduce((s, m) => s + m.cantidad * m.precio_unitario, 0)
    return { proveedores, personal: totalesPersonal.saldo, total: proveedores + totalesPersonal.saldo }
  }, [materiales, totalesPersonal])

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
  const delMes = useMemo(() => gastos.filter((g) => enMes(g.fecha, mesSel)), [gastos, mesSel])
  const totalGastosMes = delMes.reduce((s, g) => s + g.monto, 0)
  const recurrentesMes = delMes.filter((g) => g.recurrente).reduce((s, g) => s + g.monto, 0)
  const porCategoria = useMemo(() => {
    const m: Record<string, number> = {}
    delMes.forEach((g) => { const k = g.categoria || 'Otros'; m[k] = (m[k] || 0) + g.monto })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [delMes])

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div><p className="subtitle">DIRECCIÓN</p><h2>Tablero</h2><p className="welcome">Visión 360: resultado, caja, cobranzas e inventario</p></div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--mova-muted)' }}>Mes
          <input type="month" value={mesSel} onChange={(e) => setMesSel(e.target.value)} style={{ padding: '9px 12px', border: '1px solid var(--mova-border)', borderRadius: 10 }} />
        </label>
      </div>

      {onIrA && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <button type="button" className="editButton" onClick={() => onIrA('gastos')}>💸 Ver Gastos fijos completo →</button>
          <button type="button" className="editButton" onClick={() => onIrA('finanzas')}>💰 Ver Finanzas →</button>
        </div>
      )}

      <div className="gestionTabs">
        <button className={pestana === 'resumen' ? 'active' : ''} onClick={() => setPestana('resumen')}>Resumen</button>
        <button className={pestana === 'pyl' ? 'active' : ''} onClick={() => setPestana('pyl')}>Resultado (P&L)</button>
        <button className={pestana === 'caja' ? 'active' : ''} onClick={() => setPestana('caja')}>Caja & Cobranzas</button>
        <button className={pestana === 'personal' ? 'active' : ''} onClick={() => setPestana('personal')}>Personal</button>
        <button className={pestana === 'gastos' ? 'active' : ''} onClick={() => setPestana('gastos')}>Gastos</button>
        <button className={pestana === 'pagar' ? 'active' : ''} onClick={() => setPestana('pagar')}>Cuentas por pagar</button>
        <button className={pestana === 'inventario' ? 'active' : ''} onClick={() => setPestana('inventario')}>Inventario</button>
      </div>

      {cargando && <p>Cargando tablero...</p>}
      {error && <p className="loginError">{error}</p>}

      {!cargando && !error && pestana === 'resumen' && <>
        <div className="gestionKpis">
          <div><span>RESULTADO DEL MES</span><strong style={{ color: color(pyl.actual.resultado) }}>{moneda(pyl.actual.resultado)}</strong><small>{nombreMes(mesSel)}</small></div>
          <div><span>POR COBRAR</span><strong>{moneda(kpis.porCobrar)}</strong><small>Saldo aceptados</small></div>
          <div><span>POR PAGAR</span><strong>{moneda(porPagar.total)}</strong><small>Proveedores + ayudantes</small></div>
          <div className="destacado"><span>GANANCIA ACUMULADA</span><strong style={{ color: color(historico.ganancia) }}>{moneda(historico.ganancia)}</strong><small>Histórico, ya restados costos e impuestos</small></div>
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
            <div className="tabRow"><span>Total invertido (histórico)</span><strong>{moneda(historico.invertido)}</strong></div>
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

        <GraficoMensual datos={pyl.meses} mesSel={mesSel} onSeleccionar={setMesSel} />

        <div className="crmListaWrap" style={{ marginTop: 16 }}>
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

        <h4 style={{ marginTop: 24 }}>Histórico de la empresa</h4>
        <div className="gestionKpis">
          <div><span>COBRADO (HISTÓRICO)</span><strong>{moneda(historico.pagosTotal)}</strong><small>Todos los pagos</small></div>
          <div><span>COSTOS + GASTOS (HISTÓRICO)</span><strong>{moneda(historico.costosTotal + historico.gastosTotal)}</strong><small>Obras + estructura</small></div>
          <div><span>IMPUESTOS PAGADOS (HISTÓRICO)</span><strong>{moneda(historico.impuestosTotal)}</strong><small>Categoría "Impuestos" en Gastos</small></div>
          <div className="destacado"><span>GANANCIA ACUMULADA</span><strong style={{ color: color(historico.ganancia) }}>{moneda(historico.ganancia)}</strong><small>Cobrado − costos − gastos (incluye impuestos)</small></div>
        </div>
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
              <thead><tr><th>Cliente</th><th>Obra</th><th>Presupuesto</th><th>Días</th><th>Saldo</th></tr></thead>
              <tbody>{aging.det[agingSel].sort((a, b) => b.saldo - a.saldo).map((d) => (
                <tr key={d.id}><td><strong>{d.cliente}</strong></td><td>{d.obra}</td><td>{d.titulo}</td><td>{d.dias} días</td><td><strong>{moneda(d.saldo)}</strong></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="gestionAyuda">Tocá una fila para ver el detalle de qué clientes/obras están en esa antigüedad. Lo vencido +90 es la principal alerta de cobranza.</p>
      </>}

      {!cargando && !error && pestana === 'personal' && <>
        <div className="gestionKpis">
          <div><span>PAGADO A PERSONAL (HISTÓRICO)</span><strong>{moneda(totalesPersonal.pagado)}</strong><small>Todas las obras</small></div>
          <div className="destacado"><span>SALDO PENDIENTE</span><strong style={{ color: totalesPersonal.saldo > 0 ? '#b86608' : '#23764e' }}>{moneda(totalesPersonal.saldo)}</strong><small>Sobre lo pactado con cada persona</small></div>
          <div><span>ASIGNACIONES</span><strong>{personalDetalle.length}</strong><small>Persona × obra</small></div>
        </div>
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Persona</th><th>Obra</th><th>Modalidad</th><th>Acordado</th><th>Pagado</th><th>Saldo</th></tr></thead>
            <tbody>
              {personalDetalle.length === 0 ? <tr><td colSpan={6}>Sin personal asignado.</td></tr> : personalDetalle
                .slice()
                .sort((a, b) => b.saldo - a.saldo)
                .map((f) => (
                  <tr key={`${f.personaId}-${f.obraId}`}>
                    <td><strong>{f.nombre}</strong></td>
                    <td>{f.obra}</td>
                    <td>{MODALIDADES[f.modalidad] ?? f.modalidad}</td>
                    <td>{f.calc.totalContrato != null ? moneda(f.calc.totalContrato) : '—'}</td>
                    <td>{moneda(f.calc.pagado)}</td>
                    <td><strong style={{ color: f.saldo > 0 ? '#b86608' : '#23764e' }}>{moneda(f.saldo)}</strong></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="gestionAyuda">Acordado y saldo son sobre el total pactado (por obra, por etapa o por %). Para quienes cobran por día u hora no hay un total fijo: el saldo sale de lo devengado según los jornales cargados menos lo pagado.</p>
      </>}

      {!cargando && !error && pestana === 'gastos' && <>
        <div className="pageHeader" style={{ marginBottom: 12 }}>
          <div><h3 style={{ margin: 0 }}>Gastos de la empresa</h3><p className="welcome">Alquiler, sueldos, servicios e impuestos — no atados a una obra</p></div>
          <button className="newButton" onClick={() => setFormGasto({ id: 0, fecha: hoy(), categoria: 'Alquiler', descripcion: '', monto: 0, recurrente: true })}>+ Nuevo gasto</button>
        </div>
        <div className="gestionKpis">
          <div><span>GASTOS DEL MES</span><strong>{moneda(totalGastosMes)}</strong><small>{delMes.length} registros</small></div>
          <div><span>RECURRENTES</span><strong>{moneda(recurrentesMes)}</strong><small>Fijos mensuales</small></div>
          <div><span>PROMEDIO / REGISTRO</span><strong>{moneda(delMes.length ? totalGastosMes / delMes.length : 0)}</strong><small>Del mes</small></div>
        </div>
        {porCategoria.length > 0 && (
          <div className="finBreakdown">
            {porCategoria.map(([cat, monto]) => <span key={cat}>{cat}: <strong>{moneda(monto)}</strong></span>)}
          </div>
        )}
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Tipo</th><th>Monto</th><th>Acción</th></tr></thead>
            <tbody>
              {delMes.length === 0 ? <tr><td colSpan={6}>Sin gastos en este mes.</td></tr> : delMes.map((g) => (
                <tr key={g.id}>
                  <td>{fechaCorta(g.fecha)}</td>
                  <td><strong>{g.categoria || 'Otros'}</strong></td>
                  <td>{g.descripcion || '—'}</td>
                  <td>{g.recurrente ? <span className="crmBadge est-enviado">Recurrente</span> : <span className="crmBadge est-borrador">Puntual</span>}</td>
                  <td><strong>{moneda(g.monto)}</strong></td>
                  <td><div className="adicAcciones"><button className="editButton" onClick={() => setFormGasto(g)}>Editar</button><button className="adicNo" onClick={() => eliminarGasto(g)}>Eliminar</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {onIrA && <p className="gestionAyuda">¿Necesitás ver otros meses o el historial completo? <button type="button" className="editButton" onClick={() => onIrA('gastos')}>Abrir Gastos fijos completo</button></p>}
      </>}

      {!cargando && !error && pestana === 'pagar' && <>
        <div className="gestionKpis">
          <div className="destacado"><span>TOTAL POR PAGAR</span><strong>{moneda(porPagar.total)}</strong><small>Compromisos pendientes</small></div>
          <div><span>PROVEEDORES</span><strong>{moneda(porPagar.proveedores)}</strong><small>Compras impagas</small></div>
          <div><span>AYUDANTES / PERSONAL</span><strong>{moneda(porPagar.personal)}</strong><small>Pactado − pagado</small></div>
        </div>
        <p className="gestionAyuda">Proveedores: compras marcadas como impagas (marcá "pagado" en cada compra). Personal: el detalle de quién y de qué obra está en la pestaña <strong>Personal</strong>.</p>
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

      {formGasto && <FormularioGasto gasto={formGasto} onCancelar={() => setFormGasto(null)} onGuardado={() => { setFormGasto(null); void recargarGastos() }} />}
    </div>
  )
}

// ---- Gráfico mensual: barras de Ingresos / Costos directos / Gastos fijos + línea de Resultado ----
type PuntoMes = { ym: string; ingresos: number; costosDir: number; fijos: number; resultado: number }

function GraficoMensual({ datos, mesSel, onSeleccionar }: { datos: PuntoMes[]; mesSel: string; onSeleccionar: (ym: string) => void }) {
  const ancho = 760
  const alto = 220
  const margenIzq = 54
  const margenDer = 12
  const margenSup = 16
  const margenInf = 30
  const anchoUtil = ancho - margenIzq - margenDer
  const altoUtil = alto - margenSup - margenInf

  const valores = datos.flatMap((d) => [d.ingresos, d.costosDir, d.fijos, d.resultado])
  const maxV = Math.max(1, ...valores)
  const minV = Math.min(0, ...valores)
  const rango = maxV - minV || 1
  const y = (v: number) => margenSup + altoUtil - ((v - minV) / rango) * altoUtil
  const y0 = y(0)

  const grupoAncho = datos.length ? anchoUtil / datos.length : anchoUtil
  const barraAncho = Math.min(12, grupoAncho / 5)

  const etiquetaMes = (ym: string, i: number) => {
    const d = new Date(`${ym}-01T12:00:00`)
    const mes = d.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')
    return (i === 0 || d.getMonth() === 0) ? `${mes} '${String(d.getFullYear()).slice(2)}` : mes
  }

  const lineaPuntos = datos.map((d, i) => `${margenIzq + grupoAncho * i + grupoAncho / 2},${y(d.resultado)}`).join(' ')

  return (
    <div style={{ marginTop: 8 }}>
      <svg viewBox={`0 0 ${ancho} ${alto}`} width="100%" height={alto} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evolución mensual de ingresos, costos directos, gastos fijos y resultado">
        <line x1={margenIzq} y1={y0} x2={ancho - margenDer} y2={y0} stroke="#d8dbe0" strokeWidth={1} />
        {datos.map((d, i) => {
          const cx = margenIzq + grupoAncho * i
          const activo = d.ym === mesSel
          return (
            <g key={d.ym} onClick={() => onSeleccionar(d.ym)} style={{ cursor: 'pointer' }}>
              {activo && <rect x={cx} y={margenSup} width={grupoAncho} height={altoUtil} fill="#fff3e0" />}
              <rect x={cx + grupoAncho / 2 - barraAncho * 1.6} y={Math.min(y(d.ingresos), y0)} width={barraAncho} height={Math.max(1, Math.abs(y(d.ingresos) - y0))} rx={2} fill="#23935b">
                <title>{`Ingresos ${d.ym}: ${moneda(d.ingresos)}`}</title>
              </rect>
              <rect x={cx + grupoAncho / 2 - barraAncho * 0.5} y={Math.min(y(d.costosDir), y0)} width={barraAncho} height={Math.max(1, Math.abs(y(d.costosDir) - y0))} rx={2} fill="#b23b32">
                <title>{`Costos directos ${d.ym}: ${moneda(d.costosDir)}`}</title>
              </rect>
              <rect x={cx + grupoAncho / 2 + barraAncho * 0.6} y={Math.min(y(d.fijos), y0)} width={barraAncho} height={Math.max(1, Math.abs(y(d.fijos) - y0))} rx={2} fill="#b86608">
                <title>{`Gastos fijos ${d.ym}: ${moneda(d.fijos)}`}</title>
              </rect>
              <text x={cx + grupoAncho / 2} y={alto - 10} textAnchor="middle" fontSize={10} fill="#6b7280">{etiquetaMes(d.ym, i)}</text>
            </g>
          )
        })}
        <polyline points={lineaPuntos} fill="none" stroke="#1f2937" strokeWidth={2} />
        {datos.map((d, i) => (
          <circle key={`p-${d.ym}`} cx={margenIzq + grupoAncho * i + grupoAncho / 2} cy={y(d.resultado)} r={3.5} fill={d.resultado >= 0 ? '#23935b' : '#b23b32'} stroke="#fff" strokeWidth={1}>
            <title>{`Resultado ${d.ym}: ${moneda(d.resultado)}`}</title>
          </circle>
        ))}
        <text x={4} y={y(maxV) + 4} fontSize={10} fill="#9aa0a6">{monedaCorta(maxV)}</text>
        <text x={4} y={y0 + 4} fontSize={10} fill="#9aa0a6">$0</text>
        {minV < 0 && <text x={4} y={y(minV) + 4} fontSize={10} fill="#9aa0a6">{monedaCorta(minV)}</text>}
      </svg>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--mova-muted)', marginTop: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: '#23935b', display: 'inline-block' }} />Ingresos</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: '#b23b32', display: 'inline-block' }} />Costos directos</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: '#b86608', display: 'inline-block' }} />Gastos fijos</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: '#1f2937', display: 'inline-block' }} />Resultado</span>
        <span>Tocá un mes para verlo en detalle.</span>
      </div>
    </div>
  )
}

function FormularioGasto({ gasto, onCancelar, onGuardado }: { gasto: Gasto; onCancelar: () => void; onGuardado: () => void }) {
  const editando = gasto.id > 0
  const [f, setF] = useState({ fecha: gasto.fecha?.slice(0, 10) || hoy(), categoria: gasto.categoria || 'Alquiler', descripcion: gasto.descripcion || '', monto: gasto.monto ? String(gasto.monto) : '', recurrente: gasto.recurrente })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string | boolean) => setF((a) => ({ ...a, [k]: v }))

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!(Number(f.monto) > 0)) { setError('Ingresá un monto mayor que cero.'); return }
    setGuardando(true)
    const datos = { fecha: f.fecha, categoria: f.categoria, descripcion: f.descripcion.trim() || null, monto: Number(f.monto), recurrente: f.recurrente }
    const { error: err } = editando
      ? await supabase.from('gastos_generales').update(datos).eq('id', gasto.id)
      : await supabase.from('gastos_generales').insert(datos)
    if (err) { console.error(err); setError('No se pudo guardar.'); setGuardando(false); return }
    onGuardado()
  }

  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">{editando ? 'EDITAR GASTO' : 'NUEVO GASTO'}</p><h2>Gasto de estructura</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}><div className="formGrid">
      <label>Fecha *<input type="date" required value={f.fecha} onChange={(e) => set('fecha', e.target.value)} /></label>
      <label>Categoría<select value={f.categoria} onChange={(e) => set('categoria', e.target.value)}>{CATEGORIAS_GASTO.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>Monto *<input type="number" min="0.01" step="0.01" required value={f.monto} onChange={(e) => set('monto', e.target.value)} /></label>
      <label>Recurrente (mensual)<select value={f.recurrente ? 'si' : 'no'} onChange={(e) => set('recurrente', e.target.value === 'si')}><option value="si">Sí, gasto fijo mensual</option><option value="no">No, puntual</option></select></label>
      <label className="formFull">Descripción<input value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} placeholder="Ej.: Alquiler local septiembre" /></label>
    </div>{error && <p className="loginError">{error}</p>}<div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button></div></form>
  </div></div>
}

export default Tablero
