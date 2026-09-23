import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta, hoy } from './gestionFormat'
import { calcularPersona } from './personalCalculos'
import { etiquetaObra, claseObra } from './obraEstado'

type Obra = { id: number; cliente_id: number; nombre_obra: string; estado: string | null; porcentaje_avance: number | null; activo: boolean }
type Presupuesto = { id: number; obra_id: number | null; cliente_id: number; titulo: string; total: number; total_pagado: number; saldo: number; estado: string; activo: boolean; fecha: string }
type Cliente = { id: number; nombre: string; apellido: string | null }
type Pago = { monto: number; fecha: string; obra_id: number | null; presupuesto_id: number | null }
type Costo = { monto: number; fecha: string; tipo: string; personal_id: number | null; obra_id: number | null }
type Gasto = { id: number; fecha: string; categoria: string | null; descripcion: string | null; monto: number; recurrente: boolean }
type Prod = { id: number; nombre: string; tipo: string; costo_unitario: number; stock: number; stock_minimo: number; activo: boolean }
type AsigTablero = { obra_id: number; personal_id: number | null; modalidad: string | null; valor_acordado: number | null }
type PersonaTablero = { id: number; nombre: string; apellido: string | null; tipo: string; costo_dia: number | null }
type JornalTablero = { obra_id: number; personal_id: number | null; jornada: number; horas: number | null }
type AdicionalTablero = { obra_id: number; importe: number; estado: string; tipo: string }
type Item = { catalogo_id: number | null; cantidad: number; presupuesto_id: number }

// Pestañas del tablero. "Resumen" y "Cuentas por pagar" se quitaron: el tablero abre en "Balance de la empresa".
type Pestana = 'pyl' | 'caja' | 'personal' | 'gastos' | 'inventario'
const mesActual = () => new Date().toISOString().slice(0, 7)
const nombreMes = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
const redondear = (n: number) => Math.round(n * 100) / 100
const sumarMeses = (ym: string, n: number) => {
  const [anio, mes] = ym.split('-').map(Number)
  const d = new Date(anio, mes - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const mesesEntre = (desde: string, hasta: string) => {
  const lista: string[] = []
  let ym = desde
  while (ym <= hasta && lista.length < 60) { lista.push(ym); ym = sumarMeses(ym, 1) }
  return lista
}
const nombreMesCorto = (ym: string) =>
  new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' }).replace('.', '')
type Periodo = 'mes' | '3' | '6' | 'anio' | 'custom'
const PERIODOS: [Periodo, string][] = [['mes', 'Este mes'], ['3', 'Últimos 3 meses'], ['6', 'Últimos 6 meses'], ['anio', 'Este año'], ['custom', 'Elegir período']]
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

type TableroProps = {
  onIrA?: (destino: 'gastos' | 'finanzas') => void
  // Abre la ficha de una obra (se usa desde la pestaña Cobranzas).
  onAbrirObra?: (obraId: number) => void
}

function Tablero({ onIrA, onAbrirObra }: TableroProps = {}) {
  const [obras, setObras] = useState<Obra[]>([])
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [costos, setCostos] = useState<Costo[]>([])
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [productos, setProductos] = useState<Prod[]>([])
  const [asigTablero, setAsigTablero] = useState<AsigTablero[]>([])
  const [personasTablero, setPersonasTablero] = useState<PersonaTablero[]>([])
  const [jornalesTablero, setJornalesTablero] = useState<JornalTablero[]>([])
  const [adicionalesTablero, setAdicionalesTablero] = useState<AdicionalTablero[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [pestana, setPestana] = useState<Pestana>('pyl')
  // Período del Balance y de Gastos fijos (compartido): por defecto siempre el mes actual.
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [desdeSel, setDesdeSel] = useState(mesActual())
  const [hastaSel, setHastaSel] = useState(mesActual())
  const [invFiltro, setInvFiltro] = useState<'todos' | 'sin' | 'reponer'>('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [formGasto, setFormGasto] = useState<Gasto | null>(null)
  const [cargandoRecurrentes, setCargandoRecurrentes] = useState(false)

  useEffect(() => {
    async function cargar() {
      setCargando(true); setError('')
      const [rO, rP, rPa, rC, rG, rProd, rA, rItems, rCli, rPer, rJor, rAdic] = await Promise.all([
        supabase.from('obras').select('id,cliente_id,nombre_obra,estado,porcentaje_avance,activo'),
        supabase.from('presupuestos').select('id,obra_id,cliente_id,titulo,total,total_pagado,saldo,estado,activo,fecha').eq('activo', true),
        supabase.from('pagos').select('monto,fecha,obra_id,presupuesto_id'),
        supabase.from('costos').select('monto,fecha,tipo,personal_id,obra_id'),
        supabase.from('gastos_generales').select('id,fecha,categoria,descripcion,monto,recurrente'),
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

  // ---- Balance: período elegido (por defecto, este mes) ----
  const rango = useMemo(() => {
    const hoyYm = mesActual()
    let desde = hoyYm
    let hasta = hoyYm
    if (periodo === '3') desde = sumarMeses(hoyYm, -2)
    else if (periodo === '6') desde = sumarMeses(hoyYm, -5)
    else if (periodo === 'anio') desde = `${hoyYm.slice(0, 4)}-01`
    else if (periodo === 'custom') {
      desde = desdeSel <= hastaSel ? desdeSel : hastaSel
      hasta = desdeSel <= hastaSel ? hastaSel : desdeSel
    }
    return { desde, hasta, meses: mesesEntre(desde, hasta) }
  }, [periodo, desdeSel, hastaSel])

  const balance = useMemo(() => {
    const calc = (ym: string) => {
      const ingresos = pagos.filter((p) => enMes(p.fecha, ym)).reduce((s, p) => s + p.monto, 0)
      const costosDir = costos.filter((c) => enMes(c.fecha, ym)).reduce((s, c) => s + c.monto, 0)
      const fijos = gastos.filter((g) => enMes(g.fecha, ym)).reduce((s, g) => s + g.monto, 0)
      return { ingresos, costosDir, fijos, resultado: ingresos - costosDir - fijos }
    }
    const total = rango.meses.map(calc).reduce(
      (acc, m) => ({ ingresos: acc.ingresos + m.ingresos, costosDir: acc.costosDir + m.costosDir, fijos: acc.fijos + m.fijos, resultado: acc.resultado + m.resultado }),
      { ingresos: 0, costosDir: 0, fijos: 0, resultado: 0 },
    )
    // Un solo mes: el gráfico muestra los 12 meses que terminan en ese mes, como contexto.
    // Un período: el gráfico muestra exactamente los meses elegidos.
    const mesesGrafico = rango.meses.length === 1 ? mesesEntre(sumarMeses(rango.hasta, -11), rango.hasta) : rango.meses
    return { total, grafico: mesesGrafico.map((ym) => ({ ym, ...calc(ym) })) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagos, costos, gastos, rango])

  const etiquetaPeriodo = rango.meses.length === 1
    ? nombreMes(rango.desde)
    : `${nombreMesCorto(rango.desde)} – ${nombreMesCorto(rango.hasta)}`
  const margenNeto = balance.total.ingresos > 0 ? Math.round((balance.total.resultado / balance.total.ingresos) * 100) : null
  const ivaDebito = balance.total.ingresos - balance.total.ingresos / 1.21
  const ivaCredito = balance.total.costosDir - balance.total.costosDir / 1.21

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

  // ---- Cobranzas: semáforo por obra ----
  // Se calcula igual que las tarjetas de Obras:
  //   valor   = presupuestos aceptados + adicionales aprobados de la obra
  //   cobrado = todos los pagos de la obra (cargados en la obra o en su presupuesto)
  //   corresponde cobrar = valor × % de avance (100% si la obra está terminada)
  //  🔴 Terminada con saldo: obra finalizada / en observación y todavía hay saldo.
  //  🟠 Atrasada por avance: en proceso y se cobró menos de lo que corresponde al avance.
  //  🟢 Al día: se cobró lo que corresponde al avance (o más).
  const cobranzas = useMemo(() => {
    type Situacion = 'rojo' | 'naranja' | 'verde'
    type FilaCobranza = {
      obraId: number; obra: string; cliente: string; estado: string | null; avance: number
      valor: number; cobrado: number; saldo: number; faltaAvance: number; situacion: Situacion
    }
    const valorPorObra: Record<number, number> = {}
    const obraDePresupuesto: Record<number, number> = {}
    presupuestos.forEach((p) => {
      if (p.obra_id == null) return
      obraDePresupuesto[p.id] = p.obra_id
      if (p.activo !== false && p.estado === 'aceptado') valorPorObra[p.obra_id] = (valorPorObra[p.obra_id] || 0) + p.total
    })
    const conAceptado = new Set(Object.keys(valorPorObra).map(Number))
    adicionalesTablero.forEach((a) => {
      if (a.estado === 'aprobado' && conAceptado.has(a.obra_id)) valorPorObra[a.obra_id] += a.importe
    })
    const cobradoPorObra: Record<number, number> = {}
    pagos.forEach((pago) => {
      const obraId = pago.obra_id ?? (pago.presupuesto_id != null ? obraDePresupuesto[pago.presupuesto_id] : undefined)
      if (obraId == null) return
      cobradoPorObra[obraId] = (cobradoPorObra[obraId] || 0) + pago.monto
    })

    const filas: FilaCobranza[] = []
    obras.filter((o) => o.activo !== false && conAceptado.has(o.id)).forEach((o) => {
      const valor = redondear(valorPorObra[o.id] || 0)
      const cobrado = redondear(cobradoPorObra[o.id] || 0)
      const saldo = redondear(Math.max(0, valor - cobrado))
      if (saldo <= 0) return
      const terminada = o.estado === 'finalizada' || o.estado === 'observacion'
      const avance = terminada ? 100 : Math.min(100, Math.max(0, Number(o.porcentaje_avance || 0)))
      const corresponde = redondear(valor * avance / 100)
      const faltaAvance = redondear(Math.max(0, corresponde - cobrado))
      const situacion: Situacion = terminada ? 'rojo' : faltaAvance > 0.5 ? 'naranja' : 'verde'
      filas.push({ obraId: o.id, obra: o.nombre_obra, cliente: nombreCli(o.cliente_id), estado: o.estado, avance, valor, cobrado, saldo, faltaAvance, situacion })
    })

    const orden: Record<Situacion, number> = { rojo: 0, naranja: 1, verde: 2 }
    filas.sort((x, y) => orden[x.situacion] - orden[y.situacion] || (y.situacion === 'naranja' ? y.faltaAvance - x.faltaAvance : y.saldo - x.saldo))

    const de = (sit: Situacion) => filas.filter((f) => f.situacion === sit)
    return {
      filas,
      total: filas.reduce((s, f) => s + f.saldo, 0),
      rojo: { n: de('rojo').length, monto: de('rojo').reduce((s, f) => s + f.saldo, 0) },
      naranja: { n: de('naranja').length, monto: de('naranja').reduce((s, f) => s + f.faltaAvance, 0) },
      verde: { n: de('verde').length, monto: de('verde').reduce((s, f) => s + f.saldo, 0) },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presupuestos, adicionalesTablero, pagos, obras, clientes])

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

      // Qué corresponde pagar HOY según el avance de la obra:
      //  · Con total pactado (por obra / etapa / %): total × % de avance (100% si la obra terminó).
      //  · Por día u hora: lo devengado según los jornales cargados (ya viene en calc.diferencia).
      const estadoObra = obras.find((o) => o.id === a.obra_id)?.estado ?? null
      const terminada = estadoObra === 'finalizada' || estadoObra === 'observacion'
      const avance = terminada ? 100 : Math.min(100, Math.max(0, Number(avanceObra || 0)))
      let debe = 0
      let adelantado = 0
      if (calc.totalContrato != null) {
        const corresponde = calc.totalContrato * avance / 100
        debe = Math.max(0, corresponde - calc.pagado)
        adelantado = Math.max(0, calc.pagado - corresponde)
      } else {
        debe = Math.max(0, calc.diferencia)
        adelantado = Math.max(0, -calc.diferencia)
      }
      debe = redondear(debe)
      adelantado = redondear(adelantado)
      const situacion: 'rojo' | 'naranja' | 'verde' = debe > 0.5 ? 'rojo' : adelantado > 0.5 ? 'naranja' : 'verde'

      return {
        obraId: a.obra_id,
        personaId: a.personal_id,
        nombre: persona ? `${persona.nombre} ${persona.apellido ?? ''}`.trim() : 'Persona',
        obra: nombreObra(a.obra_id),
        estadoObra,
        avance,
        modalidad: a.modalidad ?? 'por_obra',
        calc, saldo, debe, adelantado, situacion,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asigTablero, personasTablero, costos, jornalesTablero, presupuestos, adicionalesTablero, obras])

  const totalesPersonal = useMemo(() => personalDetalle.reduce((acc, f) => ({
    pagado: acc.pagado + f.calc.pagado,
    saldo: acc.saldo + f.saldo,
    debe: acc.debe + f.debe,
    nDebe: acc.nDebe + (f.situacion === 'rojo' ? 1 : 0),
    adelantado: acc.adelantado + f.adelantado,
    nAdelantado: acc.nAdelantado + (f.situacion === 'naranja' ? 1 : 0),
  }), { pagado: 0, saldo: 0, debe: 0, nDebe: 0, adelantado: 0, nAdelantado: 0 }), [personalDetalle])

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
  // ---- Gastos fijos del período elegido ----
  const claveGasto = (g: Gasto) => `${(g.categoria || 'Otros').toLowerCase()}|${(g.descripcion || '').trim().toLowerCase()}`
  const gastosFijos = useMemo(() => {
    const mesesSet = new Set(rango.meses)
    const delPeriodo = gastos
      .filter((g) => mesesSet.has((g.fecha ?? '').slice(0, 7)))
      .sort((x, y) => (y.fecha ?? '').localeCompare(x.fecha ?? ''))
    const total = delPeriodo.reduce((s, g) => s + g.monto, 0)

    // Comparación: último mes del período contra el mes anterior.
    const mesRef = rango.hasta
    const mesPrevio = sumarMeses(mesRef, -1)
    const totalDe = (ym: string) => gastos.filter((g) => enMes(g.fecha, ym)).reduce((s, g) => s + g.monto, 0)
    const totalRef = totalDe(mesRef)
    const totalPrevio = totalDe(mesPrevio)
    const diferencia = totalRef - totalPrevio
    const variacion = totalPrevio > 0 ? Math.round((diferencia / totalPrevio) * 100) : null

    // Costo fijo mensual: recurrentes del último mes del período.
    const costoFijoMensual = gastos.filter((g) => g.recurrente && enMes(g.fecha, mesRef)).reduce((s, g) => s + g.monto, 0)

    // Por categoría, con % del total del período.
    const mapa: Record<string, number> = {}
    delPeriodo.forEach((g) => { const k = g.categoria || 'Otros'; mapa[k] = (mapa[k] || 0) + g.monto })
    const porCategoria = Object.entries(mapa).sort((x, y) => y[1] - x[1])

    // Recurrentes del mes pasado que todavía no se cargaron este mes.
    const hoyYm = mesActual()
    const cargadosEsteMes = new Set(gastos.filter((g) => enMes(g.fecha, hoyYm)).map(claveGasto))
    const vistos = new Set<string>()
    const pendientes = gastos
      .filter((g) => g.recurrente && enMes(g.fecha, sumarMeses(hoyYm, -1)))
      .filter((g) => {
        const k = claveGasto(g)
        if (cargadosEsteMes.has(k) || vistos.has(k)) return false
        vistos.add(k)
        return true
      })

    return { delPeriodo, total, mesRef, mesPrevio, totalRef, totalPrevio, diferencia, variacion, costoFijoMensual, porCategoria, pendientes }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gastos, rango])

  async function cargarRecurrentes(lista: Gasto[]) {
    if (lista.length === 0 || cargandoRecurrentes) return
    setCargandoRecurrentes(true)
    const filas = lista.map((g) => ({ fecha: hoy(), categoria: g.categoria, descripcion: g.descripcion, monto: g.monto, recurrente: true }))
    const { error: err } = await supabase.from('gastos_generales').insert(filas)
    setCargandoRecurrentes(false)
    if (err) { console.error(err); window.alert('No se pudieron cargar los gastos recurrentes.'); return }
    void recargarGastos()
  }

  // Selector de período compartido por Balance y Gastos fijos.
  const selectorPeriodo = (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '14px 0 6px' }}>
        {PERIODOS.map(([clave, texto]) => (
          <button
            key={clave}
            type="button"
            className={periodo === clave ? 'newButton' : 'editButton'}
            onClick={() => {
              if (clave === 'custom' && periodo !== 'custom') { setDesdeSel(rango.desde); setHastaSel(rango.hasta) }
              setPeriodo(clave)
            }}
          >
            {texto}
          </button>
        ))}
        {periodo === 'custom' && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--mova-muted)' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Desde
              <input type="month" value={desdeSel} max={mesActual()} onChange={(e) => e.target.value && setDesdeSel(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--mova-border)', borderRadius: 10 }} />
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Hasta
              <input type="month" value={hastaSel} max={mesActual()} onChange={(e) => e.target.value && setHastaSel(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--mova-border)', borderRadius: 10 }} />
            </label>
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--mova-muted)' }}>Período: <strong style={{ color: 'inherit' }}>{etiquetaPeriodo}</strong></p>
    </>
  )

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div><p className="subtitle">DIRECCIÓN</p><h2>Tablero</h2><p className="welcome">Visión 360: balance, cobranzas, personal e inventario</p></div>
      </div>

      {onIrA && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <button type="button" className="editButton" onClick={() => onIrA('finanzas')}>💰 Ver Finanzas →</button>
        </div>
      )}

      <div className="gestionTabs">
        <button className={pestana === 'pyl' ? 'active' : ''} onClick={() => setPestana('pyl')}>Balance de la empresa</button>
        <button className={pestana === 'caja' ? 'active' : ''} onClick={() => setPestana('caja')}>Cobranzas</button>
        <button className={pestana === 'personal' ? 'active' : ''} onClick={() => setPestana('personal')}>Personal</button>
        <button className={pestana === 'gastos' ? 'active' : ''} onClick={() => setPestana('gastos')}>Gastos fijos</button>
        <button className={pestana === 'inventario' ? 'active' : ''} onClick={() => setPestana('inventario')}>Inventario</button>
      </div>

      {cargando && <p>Cargando tablero...</p>}
      {error && <p className="loginError">{error}</p>}

      {!cargando && !error && pestana === 'pyl' && <>
        {selectorPeriodo}

        <div className="gestionKpis">
          <div><span>INGRESOS</span><strong>{moneda(balance.total.ingresos)}</strong><small>Cobrado</small></div>
          <div><span>COSTOS DIRECTOS</span><strong>{moneda(balance.total.costosDir)}</strong><small>Obras</small></div>
          <div><span>GASTOS FIJOS</span><strong>{moneda(balance.total.fijos)}</strong><small>Estructura</small></div>
          <div className="destacado"><span>RESULTADO NETO</span><strong style={{ color: color(balance.total.resultado) }}>{moneda(balance.total.resultado)}</strong><small>{margenNeto != null ? `${margenNeto}% de lo cobrado` : 'Sin ingresos en el período'}</small></div>
        </div>

        <GraficoMensual
          datos={balance.grafico}
          activos={rango.meses.length === 1 ? [rango.hasta] : []}
          onSeleccionar={(ym) => { setDesdeSel(ym); setHastaSel(ym); setPeriodo('custom') }}
        />

        <div className="finBreakdown" style={{ marginTop: 14 }}>
          <span>IVA aprox. del período: <strong>{moneda(ivaDebito - ivaCredito)}</strong></span>
          <span>Ganancia acumulada (histórica): <strong style={{ color: color(historico.ganancia) }}>{moneda(historico.ganancia)}</strong></span>
          <span>Impuestos pagados (histórico): <strong>{moneda(historico.impuestosTotal)}</strong></span>
        </div>
        <p className="gestionAyuda">Resultado neto = cobrado − costos directos de obras − gastos fijos. El IVA es una estimación al 21% (para la liquidación exacta usá los comprobantes con factura).</p>
      </>}

      {!cargando && !error && pestana === 'caja' && <>
        <div className="gestionKpis">
          <div><span>POR COBRAR TOTAL</span><strong>{moneda(cobranzas.total)}</strong><small>Saldo de obras con presupuesto aceptado</small></div>
          <div className="destacado"><span>🔴 TERMINADAS CON SALDO</span><strong style={{ color: cobranzas.rojo.monto > 0 ? '#b23b32' : undefined }}>{moneda(cobranzas.rojo.monto)}</strong><small>{cobranzas.rojo.n} obra{cobranzas.rojo.n === 1 ? '' : 's'} · cobrar ya</small></div>
          <div><span>🟠 ATRASADO POR AVANCE</span><strong style={{ color: cobranzas.naranja.monto > 0 ? '#b86608' : undefined }}>{moneda(cobranzas.naranja.monto)}</strong><small>{cobranzas.naranja.n} obra{cobranzas.naranja.n === 1 ? '' : 's'} · según el % hecho</small></div>
          <div><span>🟢 AL DÍA</span><strong style={{ color: cobranzas.verde.n > 0 ? '#23764e' : undefined }}>{moneda(cobranzas.verde.monto)}</strong><small>{cobranzas.verde.n} obra{cobranzas.verde.n === 1 ? '' : 's'} · se cobra con el avance</small></div>
        </div>
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Obra</th><th>Cliente</th><th>Estado</th><th>Avance</th><th>Valor</th><th>Cobrado</th><th>Saldo</th><th>Situación</th></tr></thead>
            <tbody>
              {cobranzas.filas.length === 0 ? <tr><td colSpan={8}>No hay saldos pendientes de cobro. 👌</td></tr> : cobranzas.filas.map((f) => (
                <tr
                  key={f.obraId}
                  onClick={onAbrirObra ? () => onAbrirObra(f.obraId) : undefined}
                  style={{ cursor: onAbrirObra ? 'pointer' : undefined }}
                  title={onAbrirObra ? 'Abrir la obra para registrar el cobro' : undefined}
                >
                  <td><strong>{f.obra}</strong></td>
                  <td>{f.cliente}</td>
                  <td><span className={`crmBadge est-${claseObra(f.estado)}`}>{etiquetaObra(f.estado)}</span></td>
                  <td>{f.avance}%</td>
                  <td>{moneda(f.valor)}</td>
                  <td>{moneda(f.cobrado)}</td>
                  <td><strong>{moneda(f.saldo)}</strong></td>
                  <td>
                    {f.situacion === 'rojo' && <strong style={{ color: '#b23b32' }}>🔴 Terminada: cobrar {moneda(f.saldo)}</strong>}
                    {f.situacion === 'naranja' && <strong style={{ color: '#b86608' }}>🟠 Falta cobrar {moneda(f.faltaAvance)}</strong>}
                    {f.situacion === 'verde' && <span style={{ color: '#23764e' }}>🟢 Al día</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="gestionAyuda">
          Lo que corresponde cobrar sale del avance de la obra: valor × % de avance. <strong>Falta cobrar</strong> = lo que ya
          debería estar cobrado según lo hecho y todavía no entró. <strong>Al día</strong> = el saldo restante se cobra a medida que avanza la obra.
          {onAbrirObra && ' Tocá una fila para abrir la obra y registrar el cobro.'}
        </p>
      </>}

      {!cargando && !error && pestana === 'personal' && <>
        <div className="gestionKpis">
          <div className="destacado"><span>🔴 LE DEBÉS POR AVANCE</span><strong style={{ color: totalesPersonal.debe > 0 ? '#b23b32' : undefined }}>{moneda(totalesPersonal.debe)}</strong><small>{totalesPersonal.nDebe} asignación{totalesPersonal.nDebe === 1 ? '' : 'es'} · ya corresponde pagar</small></div>
          <div><span>🟠 PAGADO POR ADELANTADO</span><strong style={{ color: totalesPersonal.adelantado > 0 ? '#b86608' : undefined }}>{moneda(totalesPersonal.adelantado)}</strong><small>{totalesPersonal.nAdelantado} asignación{totalesPersonal.nAdelantado === 1 ? '' : 'es'} · por encima del avance</small></div>
          <div><span>SALDO PACTADO PENDIENTE</span><strong>{moneda(totalesPersonal.saldo)}</strong><small>Falta pagar hasta terminar</small></div>
          <div><span>PAGADO A PERSONAL</span><strong>{moneda(totalesPersonal.pagado)}</strong><small>Histórico, todas las obras</small></div>
        </div>
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Persona</th><th>Obra</th><th>Avance</th><th>Modalidad</th><th>Acordado</th><th>Pagado</th><th>Saldo</th><th>Situación</th></tr></thead>
            <tbody>
              {personalDetalle.length === 0 ? <tr><td colSpan={8}>Sin personal asignado.</td></tr> : personalDetalle
                .slice()
                .sort((x, y) => {
                  const orden = { rojo: 0, naranja: 1, verde: 2 }
                  return orden[x.situacion] - orden[y.situacion] || (y.debe + y.adelantado) - (x.debe + x.adelantado) || y.saldo - x.saldo
                })
                .map((f) => (
                  <tr
                    key={`${f.personaId}-${f.obraId}`}
                    onClick={onAbrirObra ? () => onAbrirObra(f.obraId) : undefined}
                    style={{ cursor: onAbrirObra ? 'pointer' : undefined }}
                    title={onAbrirObra ? 'Abrir la obra para registrar el pago' : undefined}
                  >
                    <td><strong>{f.nombre}</strong></td>
                    <td>{f.obra}{f.estadoObra && f.estadoObra !== 'en_proceso' && <> <span className={`crmBadge est-${claseObra(f.estadoObra)}`}>{etiquetaObra(f.estadoObra)}</span></>}</td>
                    <td>{f.avance}%</td>
                    <td>{MODALIDADES[f.modalidad] ?? f.modalidad}</td>
                    <td>{f.calc.totalContrato != null ? moneda(f.calc.totalContrato) : '—'}</td>
                    <td>{moneda(f.calc.pagado)}</td>
                    <td><strong>{moneda(f.saldo)}</strong></td>
                    <td>
                      {f.situacion === 'rojo' && <strong style={{ color: '#b23b32' }}>🔴 Le debés {moneda(f.debe)}</strong>}
                      {f.situacion === 'naranja' && <strong style={{ color: '#b86608' }}>🟠 Adelantado {moneda(f.adelantado)}</strong>}
                      {f.situacion === 'verde' && <span style={{ color: '#23764e' }}>🟢 {f.saldo > 0 ? 'Al día' : 'Pagado completo'}</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="gestionAyuda">
          Lo que corresponde pagar sale del avance de la obra: acordado × % de avance (100% si la obra terminó). Para quienes cobran por día u hora,
          sale de los jornales cargados. <strong>Le debés</strong> = ya corresponde pagarlo. <strong>Adelantado</strong> = pagaste más de lo que corresponde al avance.
          {onAbrirObra && ' Tocá una fila para abrir la obra y registrar el pago.'}
        </p>
      </>}

      {!cargando && !error && pestana === 'gastos' && <>
        <div className="pageHeader" style={{ marginBottom: 0, marginTop: 14 }}>
          <div><h3 style={{ margin: 0 }}>Gastos fijos de la empresa</h3><p className="welcome">Alquiler, sueldos, servicios e impuestos — no atados a una obra</p></div>
          <button className="newButton" onClick={() => setFormGasto({ id: 0, fecha: hoy(), categoria: 'Alquiler', descripcion: '', monto: 0, recurrente: true })}>+ Nuevo gasto</button>
        </div>

        {selectorPeriodo}

        {gastosFijos.pendientes.length > 0 && (
          <div className="stockAviso" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              <strong>⏰ Faltan cargar {gastosFijos.pendientes.length} gasto{gastosFijos.pendientes.length === 1 ? '' : 's'} recurrente{gastosFijos.pendientes.length === 1 ? '' : 's'} de este mes:</strong>{' '}
              {gastosFijos.pendientes.map((g, i) => (
                <span key={g.id}>
                  {i > 0 && ' · '}
                  {g.descripcion || g.categoria || 'Otros'} ({moneda(g.monto)}){' '}
                  <button type="button" className="editButton" style={{ padding: '2px 8px', fontSize: 12 }} disabled={cargandoRecurrentes} onClick={() => void cargarRecurrentes([g])}>Cargar</button>
                </span>
              ))}
            </span>
            {gastosFijos.pendientes.length > 1 && (
              <button type="button" className="newButton" disabled={cargandoRecurrentes} onClick={() => void cargarRecurrentes(gastosFijos.pendientes)}>
                {cargandoRecurrentes ? 'Cargando...' : 'Cargar todos'}
              </button>
            )}
          </div>
        )}

        <div className="gestionKpis">
          <div className="destacado"><span>GASTOS DEL PERÍODO</span><strong>{moneda(gastosFijos.total)}</strong><small>{gastosFijos.delPeriodo.length} registro{gastosFijos.delPeriodo.length === 1 ? '' : 's'}</small></div>
          <div><span>COSTO FIJO MENSUAL</span><strong>{moneda(gastosFijos.costoFijoMensual)}</strong><small>Recurrentes de {nombreMes(gastosFijos.mesRef)}</small></div>
          <div>
            <span>CONTRA EL MES ANTERIOR</span>
            <strong style={{ color: gastosFijos.diferencia > 0 ? '#b23b32' : gastosFijos.diferencia < 0 ? '#23764e' : undefined }}>
              {gastosFijos.diferencia > 0 ? '↑ ' : gastosFijos.diferencia < 0 ? '↓ ' : ''}{moneda(Math.abs(gastosFijos.diferencia))}
            </strong>
            <small>
              {nombreMesCorto(gastosFijos.mesRef)} vs {nombreMesCorto(gastosFijos.mesPrevio)}
              {gastosFijos.variacion != null ? ` · ${gastosFijos.variacion > 0 ? '+' : ''}${gastosFijos.variacion}%` : ''}
            </small>
          </div>
        </div>

        {gastosFijos.porCategoria.length > 0 && (
          <div className="crmListaWrap" style={{ padding: '14px 16px', marginBottom: 14 }}>
            {gastosFijos.porCategoria.map(([cat, monto]) => {
              const pct = gastosFijos.total > 0 ? Math.round((monto / gastosFijos.total) * 100) : 0
              return (
                <div key={cat} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 140px) 1fr auto', gap: 10, alignItems: 'center', padding: '5px 0', fontSize: 13 }}>
                  <strong>{cat}</strong>
                  <div className="tabBar"><span style={{ width: `${pct}%`, background: '#b86608' }} /></div>
                  <span style={{ whiteSpace: 'nowrap' }}>{moneda(monto)} · {pct}%</span>
                </div>
              )
            })}
          </div>
        )}

        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Tipo</th><th>Monto</th><th>Acción</th></tr></thead>
            <tbody>
              {gastosFijos.delPeriodo.length === 0 ? <tr><td colSpan={6}>Sin gastos en este período.</td></tr> : gastosFijos.delPeriodo.map((g) => (
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
        <p className="gestionAyuda">Costo fijo mensual = lo que tu empresa necesita ganar cada mes, como mínimo, para cubrir la estructura. Los recurrentes pendientes se cargan con la fecha de hoy y el mismo monto del mes pasado: si cambió el precio, editalo después.</p>
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

function GraficoMensual({ datos, activos, onSeleccionar }: { datos: PuntoMes[]; activos: string[]; onSeleccionar: (ym: string) => void }) {
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
          const activo = activos.includes(d.ym)
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

  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">{editando ? 'EDITAR GASTO' : 'NUEVO GASTO'}</p><h2>Gasto fijo</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
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
