import InicioSimple, { type Tarea, type Balance } from './InicioSimple'
import Agenda from './Agenda'
import type { Pedido } from './BuscadorGlobal'
import type { TareaPH } from './paraHacer'
import QueMirarHoy, { type DestinoHoy } from './QueMirarHoy'
import { useEffect, useMemo, useState } from 'react'
import { listarComprobantesPago, type ComprobantePago } from './pagoLink'
import { supabase } from './supabase'
import { TIPOS_EVENTO } from './Agenda'
import { moneda } from './gestionFormat'
import { calcularPersona } from './personalCalculos'
import { avanceEfectivo, cuentasPorObra } from './cuentaObra'
import { diasDesdeUltimaCopia } from './copiaSeguridad'
import { empleadosDeObra, esPagoEmpleado, type FilaEmpleado } from './gananciaTrabajo'

// Pantalla de Inicio: resumen rápido de la empresa y, en pestañas, el detalle
// que antes estaba en Tablero (balance, cobranzas, personal, gastos, inventario).
// Muestra a cada rol solo lo que puede ver en el resto de la app:
//  · Números de plata (neto, deudas, gastos fijos): admin y contable.
//  · Pagos al personal: admin, contable y encargado.
//  · Presupuestos en borrador: admin y contable.
//  · Obras: todos.

type Rol = 'admin' | 'encargado' | 'auxiliar' | 'contable'
type Destino = 'obras' | 'presupuestos' | 'clientes' | 'agenda' | 'gastos' | 'catalogo' | 'configuracion'

type Obra = { id: number; cliente_id: number; nombre_obra: string; localidad: string | null; estado: string | null; porcentaje_avance: number | null; activo: boolean }
type Cliente = { id: number; nombre: string; apellido: string | null }
type Presupuesto = { id: number; cliente_id: number; obra_id: number | null; titulo: string; estado: string; total: number; activo: boolean; fecha: string | null; pago_empleados_estimado?: number | null }
type Pago = { monto: number; fecha: string; obra_id: number | null; presupuesto_id: number | null }
type Costo = { monto: number; fecha: string; tipo?: string | null; personal_id: number | null; obra_id: number | null }
type Gasto = { id: number; fecha: string; categoria: string | null; descripcion: string | null; monto: number; recurrente: boolean }
type Adicional = { obra_id: number; importe: number; estado: string; tipo: string }
type Asig = { obra_id: number; personal_id: number | null; modalidad: string | null; valor_acordado: number | null }
type Persona = { id: number; nombre: string; apellido: string | null; tipo: string; costo_dia: number | null }
type Jornal = { obra_id: number; personal_id: number | null; jornada: number; horas: number | null }

type Props = {
  nombre: string
  rol: Rol
  rolEtiqueta: string
  onNavegar: (destino: Destino) => void
  onSalir: () => void
  onAbrirObra: (obraId: number) => void
  onAbrirPresupuesto?: (presupuestoId: number) => void
  // 'balance' = Balance general (antes Inicio); 'tareas' = Para hacer (la Agenda con todo lo pendiente).
  modo?: 'balance' | 'tareas'
  pedido?: Pedido | null
  onPedidoAtendido?: () => void
}

const mesActual = () => new Date().toISOString().slice(0, 7)
const sumarMeses = (ym: string, n: number) => {
  const [anio, mes] = ym.split('-').map(Number)
  const d = new Date(anio, mes - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const enMes = (f: string | null | undefined, ym: string) => (f ?? '').slice(0, 7) === ym
const diasDesde = (f: string | null) => f ? Math.max(0, Math.floor((Date.now() - new Date(`${f.slice(0, 10)}T12:00:00`).getTime()) / 86400000)) : null
const num = (x: unknown) => Number(x) || 0
const redondear = (n: number) => Math.round(n * 100) / 100


export default function HomeResumen({ nombre, rol, onNavegar, onSalir, onAbrirObra, onAbrirPresupuesto, modo = 'balance', pedido, onPedidoAtendido }: Props) {
  const verFinanzas = rol === 'admin' || rol === 'contable'
  const verPersonal = verFinanzas || rol === 'encargado'
  const verPresupuestos = verFinanzas

  // Lo que hay hoy en la Agenda (pendiente), para mostrarlo arriba en "Para mirar".
  const [agendaHoy, setAgendaHoy] = useState<{ id: number; titulo: string; hora: string | null; tipo: string | null }[]>([])
  useEffect(() => {
    const d = new Date()
    const hoyLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    void supabase.from('recordatorios').select('id,titulo,hora,tipo').eq('fecha', hoyLocal).eq('completado', false).order('hora', { ascending: true, nullsFirst: true })
      .then(({ data }) => setAgendaHoy((data ?? []) as typeof agendaHoy))
  }, [])
  // Comprobantes de pago que mandaron los clientes y todavía no revisaste.
  const [compNuevos, setCompNuevos] = useState<ComprobantePago[]>([])
  useEffect(() => { if (verFinanzas) void listarComprobantesPago({ soloNuevos: true }).then(setCompNuevos) }, [verFinanzas])
  const [mesSel] = useState(mesActual())
  const [cargando, setCargando] = useState(true)
  const [obras, setObras] = useState<Obra[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [costos, setCostos] = useState<Costo[]>([])
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [adicionales, setAdicionales] = useState<Adicional[]>([])
  const [asignaciones, setAsignaciones] = useState<Asig[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  // Compras a proveedores ya pagadas (salen de la caja como los demás costos).
  const [compras, setCompras] = useState<{ fecha: string; monto: number }[]>([])
  const [jornales, setJornales] = useState<Jornal[]>([])
  const [comprasSinPagar, setComprasSinPagar] = useState(0)
  // Para "Para hacer": stock bajo, productos sin costo y último avance de cada obra.
  const [productos, setProductos] = useState<{ id: number; nombre: string; stock: number; stock_minimo: number; costo: number }[]>([])
  const [ultimoAvance, setUltimoAvance] = useState<Record<number, string>>({})

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      const [rO, rC, rP, rPa, rCo, rG, rAd, rAs, rPe, rJ, rM] = await Promise.all([
        supabase.from('obras').select('id,cliente_id,nombre_obra,localidad,estado,porcentaje_avance,activo').eq('activo', true).order('created_at', { ascending: false }),
        supabase.from('Clientes').select('id,nombre,apellido'),
        // Con el pago estimado a empleados (fase 33); si falta la columna, sin él.
        supabase.from('presupuestos').select('id,cliente_id,obra_id,titulo,estado,total,activo,fecha,pago_empleados_estimado').eq('activo', true)
          .then(async (r) => (r.error ? await supabase.from('presupuestos').select('id,cliente_id,obra_id,titulo,estado,total,activo,fecha').eq('activo', true) : r)),
        supabase.from('pagos').select('monto,fecha,obra_id,presupuesto_id'),
        supabase.from('costos').select('monto,fecha,tipo,personal_id,obra_id'),
        supabase.from('gastos_generales').select('id,fecha,categoria,descripcion,monto,recurrente'),
        supabase.from('adicionales').select('obra_id,importe,estado,tipo'),
        supabase.from('obra_asignaciones').select('obra_id,personal_id,modalidad,valor_acordado'),
        supabase.from('personal').select('id,nombre,apellido,tipo,costo_dia'),
        supabase.from('jornales').select('obra_id,personal_id,jornada,horas'),
        supabase.from('materiales').select('cantidad,precio_unitario,fecha,pagado'),
      ])
      const [rPr, rAv] = await Promise.all([
        supabase.from('productos_servicios').select('id,nombre,tipo,activo,stock,stock_minimo,costo_unitario').eq('tipo', 'producto').eq('activo', true),
        supabase.from('obra_avances').select('obra_id,fecha').order('fecha', { ascending: false }).limit(2000),
      ])
      if (!vigente) return
      setObras(rO.error ? [] : (rO.data ?? []) as Obra[])
      setClientes(rC.error ? [] : (rC.data ?? []) as Cliente[])
      setPresupuestos(rP.error ? [] : ((rP.data ?? []) as Record<string, unknown>[]).map((p) => ({ ...p, total: num(p.total), pago_empleados_estimado: num(p.pago_empleados_estimado) })) as unknown as Presupuesto[])
      setPagos(rPa.error ? [] : (rPa.data ?? []).map((p) => ({ ...p, monto: num(p.monto) })) as Pago[])
      setCostos(rCo.error ? [] : (rCo.data ?? []).map((c) => ({ ...c, monto: num(c.monto) })) as Costo[])
      setGastos(rG.error ? [] : (rG.data ?? []).map((g) => ({ ...g, monto: num(g.monto) })) as Gasto[])
      setAdicionales(rAd.error ? [] : (rAd.data ?? []).map((a) => ({ ...a, importe: num(a.importe) })) as Adicional[])
      setAsignaciones(rAs.error ? [] : (rAs.data ?? []).map((a) => ({ ...a, valor_acordado: a.valor_acordado == null ? null : num(a.valor_acordado) })) as Asig[])
      setPersonas(rPe.error ? [] : (rPe.data ?? []).map((p) => ({ ...p, costo_dia: p.costo_dia == null ? null : num(p.costo_dia) })) as Persona[])
      setJornales(rJ.error ? [] : (rJ.data ?? []).map((j) => ({ ...j, jornada: num(j.jornada), horas: j.horas == null ? null : num(j.horas) })) as Jornal[])
      setCompras(rM.error ? [] : ((rM.data ?? []) as { cantidad: unknown; precio_unitario: unknown; fecha: string; pagado: boolean | null }[]).filter((m) => m.pagado !== false).map((m) => ({ fecha: m.fecha, monto: num(m.cantidad) * num(m.precio_unitario) })))
      setComprasSinPagar(rM.error ? 0 : ((rM.data ?? []) as { cantidad: unknown; precio_unitario: unknown; pagado: boolean | null }[]).filter((m) => m.pagado === false).reduce((s, m) => s + num(m.cantidad) * num(m.precio_unitario), 0))
      setProductos(rPr.error ? [] : ((rPr.data ?? []) as Record<string, unknown>[]).map((x) => ({ id: Number(x.id), nombre: String(x.nombre ?? ''), stock: num(x.stock), stock_minimo: num(x.stock_minimo), costo: num(x.costo_unitario) })))
      const ult: Record<number, string> = {}
      for (const a of (rAv.error ? [] : rAv.data ?? []) as { obra_id: number; fecha: string | null }[]) if (a.fecha && !ult[a.obra_id]) ult[a.obra_id] = a.fecha
      setUltimoAvance(ult)
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [])

  const nombreCli = (id: number) => { const c = clientes.find((x) => x.id === id); return c ? `${c.nombre} ${c.apellido ?? ''}`.trim() : 'Cliente' }

  // ---- Obras: valor, cobrado y situación (misma regla que el documento del cliente) ----
  const obrasInfo = useMemo(() => {
    const cuentas = cuentasPorObra(obras, presupuestos, adicionales, pagos)
    // Solo cuentan las obras con presupuesto aceptado (misma regla que la pantalla Obras).
    const vigentes = obras.filter((o) => cuentas[o.id])
    const activas = vigentes.filter((o) => (o.estado ?? 'en_proceso') === 'en_proceso' && num(o.porcentaje_avance) < 100)
    const enObservacion = vigentes.filter((o) => o.estado === 'observacion')

    const deudas = vigentes.map((o) => {
      const c = cuentas[o.id]
      // saldo = lo que falta de la obra + extras sin devolver; faltaAvance = lo que corresponde cobrar hoy.
      const situacion: 'rojo' | 'naranja' | 'verde' = c.terminada ? 'rojo' : c.pendienteHoy > 0.5 ? 'naranja' : 'verde'
      return { obra: o, saldo: c.saldo, faltaAvance: c.pendienteHoy, extras: c.extras, situacion }
    }).filter((d) => d.saldo > 0.5)
    const orden = { rojo: 0, naranja: 1, verde: 2 }
    deudas.sort((a, b) => orden[a.situacion] - orden[b.situacion] || b.saldo - a.saldo)

    const avancePromedio = activas.length ? Math.round(activas.reduce((s, o) => s + num(o.porcentaje_avance), 0) / activas.length) : 0
    return {
      activas, enObservacion, deudas, avancePromedio,
      porCobrar: deudas.reduce((s, d) => s + d.saldo, 0),
      terminadasConSaldo: deudas.filter((d) => d.situacion === 'rojo'),
    }
  }, [obras, presupuestos, adicionales, pagos])

  const borradores = useMemo(
    () => presupuestos.filter((p) => p.estado === 'borrador').sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '')),
    [presupuestos],
  )

  // ---- Personal: le debés / adelantado / al día (igual que Tablero → Personal) ----
  const personal = useMemo(() => {
    const valorObra = (obraId: number) =>
      presupuestos.filter((p) => p.obra_id === obraId && p.estado === 'aceptado').reduce((s, p) => s + p.total, 0) +
      adicionales.filter((a) => a.obra_id === obraId && a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + a.importe, 0)
    const filas = asignaciones.map((a) => {
      const persona = personas.find((p) => p.id === a.personal_id)
      const obra = obras.find((o) => o.id === a.obra_id)
      const pagosPersona = costos.filter((c) => c.personal_id === a.personal_id && c.obra_id === a.obra_id).map((c) => ({ personal_id: c.personal_id, monto: c.monto }))
      const avance = avanceEfectivo(obra?.estado, obra?.porcentaje_avance)
      const calc = calcularPersona(a, persona, pagosPersona, jornales.filter((j) => j.obra_id === a.obra_id), valorObra(a.obra_id), avance)
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
      return {
        clave: `${a.personal_id}-${a.obra_id}`,
        obraId: a.obra_id,
        nombre: persona ? `${persona.nombre} ${persona.apellido ?? ''}`.trim() : 'Persona',
        obra: obra?.nombre_obra ?? `Obra #${a.obra_id}`,
        debe: redondear(debe),
        adelantado: redondear(adelantado),
      }
    })
    const conMovimiento = filas.filter((f) => f.debe > 0.5 || f.adelantado > 0.5).sort((x, y) => y.debe - x.debe || y.adelantado - x.adelantado)
    return {
      filas: conMovimiento,
      alDia: filas.length - conMovimiento.length,
      debe: filas.reduce((s, f) => s + f.debe, 0),
      adelantado: filas.reduce((s, f) => s + f.adelantado, 0),
    }
  }, [asignaciones, personas, obras, costos, jornales, presupuestos, adicionales])

  // ---- Lo acordado con el personal de cada obra (para la ganancia del Inicio) ----
  const empleadosObra = useMemo(() => {
    const m: Record<number, FilaEmpleado[]> = {}
    const valorObra = (obraId: number) =>
      presupuestos.filter((p) => p.obra_id === obraId && p.estado === 'aceptado').reduce((s, p) => s + p.total, 0) +
      adicionales.filter((a) => a.obra_id === obraId && a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + a.importe, 0)
    const obrasCon = Array.from(new Set([...asignaciones.map((a) => a.obra_id), ...costos.filter((c) => c.obra_id != null && esPagoEmpleado(c)).map((c) => c.obra_id as number)]))
    obrasCon.forEach((obraId) => {
      m[obraId] = empleadosDeObra(
        asignaciones.filter((a) => a.obra_id === obraId), personas,
        costos.filter((c) => c.obra_id === obraId && esPagoEmpleado(c)), jornales.filter((j) => j.obra_id === obraId), valorObra(obraId),
      )
    })
    return m
  }, [asignaciones, personas, costos, jornales, presupuestos, adicionales])

  // ---- Plata del mes: neto real y neto si pagás lo pendiente ----
  const mes = useMemo(() => {
    const cobrado = pagos.filter((p) => enMes(p.fecha, mesSel)).reduce((s, p) => s + p.monto, 0)
    const manoObra = costos.filter((c) => enMes(c.fecha, mesSel) && c.personal_id != null).reduce((s, c) => s + c.monto, 0)
    // Los gastos extra que el cliente devuelve no son costo tuyo: van aparte.
    const otrosCostos = costos.filter((c) => enMes(c.fecha, mesSel) && c.personal_id == null && c.tipo !== 'gasto_extra').reduce((s, c) => s + c.monto, 0)
      + compras.filter((c) => enMes(c.fecha, mesSel)).reduce((s, c) => s + c.monto, 0)
    const extraPorReintegrar = costos.filter((c) => c.tipo === 'gasto_extra').reduce((s, c) => s + c.monto, 0)
    const gastosMes = gastos.filter((g) => enMes(g.fecha, mesSel))
    const fijos = gastosMes.reduce((s, g) => s + g.monto, 0)
    const neto = cobrado - manoObra - otrosCostos - fijos

    // Previstos (solo para el mes en curso): recurrentes del mes pasado sin cargar + lo que se le debe al personal por avance.
    const esMesActual = mesSel === mesActual()
    const clave = (g: Gasto) => `${(g.categoria || 'Otros').toLowerCase()}|${(g.descripcion || '').trim().toLowerCase()}`
    const cargados = new Set(gastosMes.map(clave))
    const vistos = new Set<string>()
    const recurrentesPendientes = esMesActual
      ? gastos.filter((g) => g.recurrente && enMes(g.fecha, sumarMeses(mesSel, -1))).filter((g) => {
          const k = clave(g)
          if (cargados.has(k) || vistos.has(k)) return false
          vistos.add(k)
          return true
        })
      : []
    const recurrentesMonto = recurrentesPendientes.reduce((s, g) => s + g.monto, 0)
    const personalPendiente = esMesActual ? personal.debe : 0
    const netoProyectado = neto - recurrentesMonto - personalPendiente

    const categorias: Record<string, number> = {}
    gastosMes.forEach((g) => { const k = g.categoria || 'Otros'; categorias[k] = (categorias[k] || 0) + g.monto })
    return {
      cobrado, manoObra, otrosCostos, fijos, neto, esMesActual, extraPorReintegrar,
      recurrentesPendientes, recurrentesMonto, personalPendiente, netoProyectado,
      recurrentesMes: gastosMes.filter((g) => g.recurrente).reduce((s, g) => s + g.monto, 0),
      porCategoria: Object.entries(categorias).sort((a, b) => b[1] - a[1]),
    }
  }, [pagos, costos, compras, gastos, mesSel, personal.debe])

  // Datos del día para "Qué mirar hoy" (la IA elige lo más importante).
  const hechosHoy = useMemo(() => {
    if (cargando) return []
    const h: string[] = []
    agendaHoy.forEach((e) => h.push(`Agenda de hoy${e.hora ? ` a las ${e.hora.slice(0, 5)}` : ''}: ${e.titulo}`))
    obrasInfo.terminadasConSaldo.forEach((d) => h.push(`Obra TERMINADA con saldo sin cobrar: ${d.obra.nombre_obra} de ${nombreCli(d.obra.cliente_id)}, debe ${moneda(d.saldo)}`))
    obrasInfo.deudas.filter((d) => d.situacion === 'naranja').slice(0, 6).forEach((d) => h.push(`Cobro atrasado según el avance: ${d.obra.nombre_obra} de ${nombreCli(d.obra.cliente_id)} (${Math.round(num(d.obra.porcentaje_avance))}% de avance), correspondería cobrar ${moneda(d.faltaAvance)} más`))
    obrasInfo.enObservacion.forEach((o) => h.push(`Obra en observación para revisar: ${o.nombre_obra} de ${nombreCli(o.cliente_id)}`))
    borradores.slice(0, 6).forEach((p) => { const d = diasDesde(p.fecha); h.push(`Presupuesto en borrador sin enviar: "${p.titulo}" de ${nombreCli(p.cliente_id)} por ${moneda(p.total)}${d != null ? `, hace ${d} días` : ''}`) })
    personal.filas.filter((f) => f.debe > 0.5).slice(0, 5).forEach((f) => h.push(`Le debés al personal: ${f.nombre} (${f.obra}) ${moneda(f.debe)}`))
    if (mes.esMesActual && mes.recurrentesPendientes.length) h.push(`Gastos fijos del mes sin cargar: ${mes.recurrentesPendientes.map((g) => g.descripcion || g.categoria).join(', ')} (${moneda(mes.recurrentesMonto)})`)
    if (mes.esMesActual) h.push(`Neto del mes hasta hoy: ${moneda(mes.neto)}${mes.recurrentesMonto > 0 || mes.personalPendiente > 0 ? `; si pagás lo previsto quedaría ${moneda(mes.netoProyectado)}` : ''}`)
    h.push(`Obras activas: ${obrasInfo.activas.length}, avance promedio ${obrasInfo.avancePromedio}%`)
    return h
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando, agendaHoy, obrasInfo, borradores, personal, mes])

  const irDesdeHoy = (d: DestinoHoy) => {
    if (d === 'cobranzas' || d === 'personal') onNavegar('obras')
    else onNavegar(d)
  }

  // ---- "Hoy": todo lo que hay que hacer, cada cosa con su botón ----
  // Copia de seguridad en la compu: se recuerda si pasó más de una semana (solo admin).
  const diasCopia = diasDesdeUltimaCopia()
  const tareas: Tarea[] = [
    ...(rol === 'admin' && (diasCopia == null || diasCopia > 7) ? [{ clave: 'copia', icono: '💾', tono: 'a' as const, titulo: 'Descargar la copia de seguridad', detalle: diasCopia == null ? 'Todavía no guardaste ninguna copia en esta computadora' : `La última copia es de hace ${diasCopia} días`, boton: 'Ir', accion: () => onNavegar('configuracion') }] : []),
    ...compNuevos.map((c): Tarea => ({ clave: `cp-${c.id}`, icono: '🧾', tono: 'v', titulo: 'Revisar comprobante de pago', detalle: `${c.cliente ?? 'Cliente'}${c.titulo ? ` · ${c.titulo}` : ''}`, boton: 'Ver', accion: () => (c.obra_id ? onAbrirObra(c.obra_id) : onNavegar('presupuestos')) })),
    ...agendaHoy.map((e): Tarea => ({ clave: `ag-${e.id}`, icono: (TIPOS_EVENTO[e.tipo ?? ''] ?? TIPOS_EVENTO.recordatorio).icono, tono: 'a', titulo: e.titulo, detalle: `Hoy en la agenda${e.hora ? ` · ${e.hora.slice(0, 5)}` : ''}`, boton: 'Ver', accion: () => onNavegar('agenda') })),
    ...(verFinanzas ? obrasInfo.deudas.filter((dd) => dd.situacion === 'rojo' || dd.faltaAvance + dd.extras > 0.5).map((dd): Tarea => ({
      clave: `co-${dd.obra.id}`, icono: '💵', tono: 'r', principal: true,
      titulo: `Cobrar ${dd.obra.nombre_obra}`,
      detalle: `${nombreCli(dd.obra.cliente_id)} · ${dd.situacion === 'rojo' ? `terminada, debe ${moneda(dd.saldo)}` : `corresponde ${moneda(dd.faltaAvance + dd.extras)}`}`,
      boton: 'Cobrar', accion: () => onAbrirObra(dd.obra.id),
    })) : []),
    ...(verPresupuestos ? borradores.map((pr): Tarea => {
      const dias = diasDesde(pr.fecha)
      return { clave: `b-${pr.id}`, icono: '📤', tono: 'n', titulo: `Enviar ${pr.titulo}`, detalle: `${nombreCli(pr.cliente_id)} · ${moneda(pr.total)}${dias != null ? ` · hace ${dias} día${dias === 1 ? '' : 's'}` : ''}`, boton: 'Enviar', accion: () => (onAbrirPresupuesto ? onAbrirPresupuesto(pr.id) : onNavegar('presupuestos')) }
    }) : []),
    ...(verPersonal ? personal.filas.filter((f) => f.debe > 0.5).map((f): Tarea => ({ clave: `pe-${f.clave}`, icono: '👷', tono: 'n', titulo: `Pagarle a ${f.nombre}`, detalle: `${f.obra} · le debés ${moneda(f.debe)}`, boton: 'Pagar', accion: () => onAbrirObra(f.obraId) })) : []),
    ...(verFinanzas && mes.esMesActual ? mes.recurrentesPendientes.map((g, i): Tarea => ({ clave: `gf-${i}`, icono: '🧾', tono: 'a', titulo: `Cargar ${g.descripcion || g.categoria || 'gasto fijo'}`, detalle: `Gasto fijo del mes pasado · ${moneda(g.monto)}`, boton: 'Cargar', accion: () => onNavegar('gastos') })) : []),
    ...obrasInfo.enObservacion.map((o): Tarea => ({ clave: `ob-${o.id}`, icono: '🟠', tono: 'n', titulo: `Revisar ${o.nombre_obra}`, detalle: `En observación · ${nombreCli(o.cliente_id)}`, boton: 'Revisar', accion: () => onAbrirObra(o.id) })),
  ]
  const [verIA, setVerIA] = useState(false)

  // ---- "Para hacer": lo mismo, con tipo y grupo (atrasado / hoy / esta semana / cuando puedas) ----
  const tareasPH: TareaPH[] = cargando ? [] : [
    ...compNuevos.map((c): TareaPH => ({ clave: `cp-${c.id}`, tipo: 'cobro', grupo: 'hoy', icono: '🧾', titulo: 'Revisar comprobante de pago', detalle: `${c.cliente ?? 'Cliente'}${c.titulo ? ` · ${c.titulo}` : ''}`, explica: 'El cliente mandó un comprobante de pago desde su link. Revisalo y confirmalo para que el cobro quede registrado.', boton: 'Ver', accion: () => (c.obra_id ? onAbrirObra(c.obra_id) : onNavegar('presupuestos')) })),
    ...(verFinanzas ? obrasInfo.deudas.filter((dd) => dd.situacion === 'rojo' || dd.faltaAvance + dd.extras > 0.5).map((dd): TareaPH => ({
      clave: `co-${dd.obra.id}`, tipo: 'cobro', grupo: dd.situacion === 'rojo' ? 'atr' : 'hoy',
      titulo: `Cobrar ${dd.obra.nombre_obra}`, monto: dd.situacion === 'rojo' ? dd.saldo : dd.faltaAvance + dd.extras,
      detalle: `${nombreCli(dd.obra.cliente_id)} · ${dd.situacion === 'rojo' ? `terminada, debe ${moneda(dd.saldo)}` : `corresponde ${moneda(dd.faltaAvance + dd.extras)}`}`,
      explica: dd.situacion === 'rojo' ? `La obra está terminada y todavía te deben ${moneda(dd.saldo)}. Cobrá el saldo.` : `La obra va ${Math.round(num(dd.obra.porcentaje_avance))}% de avance y, según eso, corresponde cobrar ${moneda(dd.faltaAvance + dd.extras)} más de lo que ya te pagaron${dd.extras > 0.5 ? ` (incluye ${moneda(dd.extras)} de gastos extra para reintegrar)` : ''}. En total te deben ${moneda(dd.saldo)}.`,
      boton: 'Cobrar', accion: () => onAbrirObra(dd.obra.id), agendar: `Cobrar ${dd.obra.nombre_obra}`, obra_id: dd.obra.id,
    })) : []),
    ...(verPresupuestos ? presupuestos.filter((pr) => pr.estado === 'aceptado' && pr.obra_id == null && (diasDesde(pr.fecha) ?? 999) <= 60).map((pr): TareaPH => ({ clave: `sin-obra-${pr.id}`, tipo: 'pres', grupo: 'hoy', titulo: `Crear la obra de ${pr.titulo}`, detalle: `${nombreCli(pr.cliente_id)} · presupuesto aceptado`, explica: 'El cliente aceptó el presupuesto, pero todavía no creaste la obra. Creala para cargar avances, personal y cobros.', boton: 'Abrir', accion: () => (onAbrirPresupuesto ? onAbrirPresupuesto(pr.id) : onNavegar('presupuestos')) })) : []),
    ...(verPresupuestos ? borradores.map((pr): TareaPH => {
      const dias = diasDesde(pr.fecha)
      return { clave: `b-${pr.id}`, tipo: 'pres', grupo: dias != null && dias >= 3 ? 'atr' : 'hoy', titulo: `Enviar ${pr.titulo}`, detalle: `${nombreCli(pr.cliente_id)} · ${moneda(pr.total)}${dias != null ? ` · armado hace ${dias} día${dias === 1 ? '' : 's'}` : ''}`, explica: `El presupuesto para ${nombreCli(pr.cliente_id)} (${moneda(pr.total)}) está armado pero todavía no se lo mandaste.${pr.total <= 0 ? ' Ojo: está en $ 0, revisá si le faltan ítems.' : ''}`, boton: 'Enviar', accion: () => (onAbrirPresupuesto ? onAbrirPresupuesto(pr.id) : onNavegar('presupuestos')), agendar: `Enviar presupuesto ${pr.titulo}` }
    }) : []),
    ...(verPersonal ? personal.filas.filter((f) => f.debe > 0.5).map((f): TareaPH => ({ clave: `pe-${f.clave}`, tipo: 'personal', grupo: 'hoy', titulo: `Pagarle a ${f.nombre}`, detalle: `${f.obra} · le debés ${moneda(f.debe)}`, explica: `Según lo que acordaste con ${f.nombre} y el avance de ${f.obra}, le corresponde ${moneda(f.debe)} más de lo que ya le pagaste.`, monto: f.debe, boton: 'Pagar', accion: () => onAbrirObra(f.obraId), agendar: `Pagarle a ${f.nombre}`, obra_id: f.obraId })) : []),
    ...obrasInfo.enObservacion.map((o): TareaPH => ({ clave: `ob-${o.id}`, tipo: 'obra', grupo: 'hoy', icono: '🟠', titulo: `Revisar ${o.nombre_obra}`, detalle: `En observación · ${nombreCli(o.cliente_id)}`, explica: 'La obra quedó en observación (falta algo para darla por terminada). Revisá qué quedó pendiente.', boton: 'Revisar', accion: () => onAbrirObra(o.id), obra_id: o.id })),
    // Obras en curso sin un avance cargado en la última semana: mandarle novedades al cliente.
    ...obrasInfo.activas.filter((o) => { const u = ultimoAvance[o.id]; return !u || (diasDesde(u) ?? 0) >= 7 }).map((o): TareaPH => {
      const u = ultimoAvance[o.id]
      return { clave: `inf-${o.id}`, tipo: 'obra', grupo: 'sem', titulo: `Mandar avance a ${nombreCli(o.cliente_id)}`, detalle: `${o.nombre_obra} · ${u ? `último avance hace ${diasDesde(u)} días` : 'todavía sin avances cargados'}`, explica: `Hace ${u ? `${diasDesde(u)} días` : 'mucho'} que no cargás un avance en ${o.nombre_obra}. Cargá fotos y mandale el informe al cliente (en la obra está "✨ Informe con IA").`, boton: 'Redactar', accion: () => onAbrirObra(o.id), agendar: `Mandar informe de avance de ${o.nombre_obra}`, obra_id: o.id }
    }),
    ...(verFinanzas && mes.esMesActual ? mes.recurrentesPendientes.map((g, i): TareaPH => ({ clave: `gf-${i}`, tipo: 'gasto', grupo: 'sem', titulo: `Cargar ${g.descripcion || g.categoria || 'gasto fijo'}`, detalle: `Gasto fijo del mes pasado · ${moneda(g.monto)}`, explica: `El mes pasado cargaste "${g.descripcion || g.categoria}" por ${moneda(g.monto)} como gasto fijo y este mes todavía no.`, boton: 'Cargar', accion: () => onNavegar('gastos') })) : []),
    ...(() => {
      const bajos = productos.filter((x) => x.stock_minimo > 0 && x.stock <= x.stock_minimo).sort((a, b) => a.stock - b.stock)
      if (!bajos.length) return []
      return [{ clave: 'stock-bajo', tipo: 'stock' as const, grupo: 'sem' as const, titulo: bajos.length === 1 ? `Reponer ${bajos[0].nombre}` : `Reponer ${bajos.length} productos`, detalle: bajos.slice(0, 3).map((x) => `${x.nombre} (${x.stock})`).join(' · ') + (bajos.length > 3 ? ` y ${bajos.length - 3} más` : ''), explica: `Llegaron al stock mínimo: ${bajos.map((x) => `${x.nombre} (quedan ${x.stock}, mínimo ${x.stock_minimo})`).join(', ')}.`, boton: 'Ver', accion: () => onNavegar('catalogo'), agendar: 'Comprar productos para reponer stock' }]
    })(),
    ...(verFinanzas && productos.some((x) => !(x.costo > 0)) ? [{ clave: 'sin-costo', tipo: 'stock' as const, grupo: 'luego' as const, titulo: `Cargar el costo de ${productos.filter((x) => !(x.costo > 0)).length} producto${productos.filter((x) => !(x.costo > 0)).length === 1 ? '' : 's'}`, detalle: 'Sin costo la ganancia aparece de más', explica: `Sin costo cargado, la ganancia de esos productos se cuenta completa y aparece de más: ${productos.filter((x) => !(x.costo > 0)).slice(0, 8).map((x) => x.nombre).join(', ')}${productos.filter((x) => !(x.costo > 0)).length > 8 ? '…' : ''}.`, boton: 'Ver', accion: () => onNavegar('catalogo') }] : []),
    ...(rol === 'admin' && (diasCopia == null || diasCopia > 7) ? [{ clave: 'copia', tipo: 'otro' as const, grupo: 'luego' as const, icono: '💾', titulo: 'Descargar la copia de seguridad', detalle: diasCopia == null ? 'Todavía no guardaste ninguna copia en esta computadora' : `La última copia es de hace ${diasCopia} días`, explica: 'Bajá una copia de los datos en Configuración → Copia de seguridad, por si algo falla.', boton: 'Ir', accion: () => onNavegar('configuracion') }] : []),
  ]

  // ---- Balance general: caja de los últimos 6 meses, lo que debés y cuánto tardás en cobrar ----
  const balance: Balance = useMemo(() => {
    const ym0 = mesActual()
    const caja = Array.from({ length: 6 }, (_, i) => sumarMeses(ym0, i - 5)).map((ym) => ({
      ym,
      entro: pagos.filter((x) => enMes(x.fecha, ym)).reduce((s, x) => s + x.monto, 0),
      salio: costos.filter((c) => enMes(c.fecha, ym) && c.tipo !== 'gasto_extra').reduce((s, c) => s + c.monto, 0)
        + compras.filter((c) => enMes(c.fecha, ym)).reduce((s, c) => s + c.monto, 0)
        + gastos.filter((g) => enMes(g.fecha, ym)).reduce((s, g) => s + g.monto, 0),
    }))
    // Días desde que te aceptan el presupuesto hasta que te pagan (promedio por monto, últimos 6 meses).
    const aceptadaObra: Record<number, string> = {}
    presupuestos.filter((x) => x.estado === 'aceptado' && x.obra_id != null && x.fecha).forEach((x) => { const o = x.obra_id as number; if (!aceptadaObra[o] || x.fecha! < aceptadaObra[o]) aceptadaObra[o] = x.fecha! })
    const desde6 = `${sumarMeses(ym0, -5)}-01`
    let peso = 0, sumaDias = 0
    pagos.filter((x) => x.fecha >= desde6 && x.obra_id != null && aceptadaObra[x.obra_id]).forEach((x) => {
      const d = Math.max(0, (Date.parse(x.fecha.slice(0, 10)) - Date.parse(aceptadaObra[x.obra_id as number].slice(0, 10))) / 86400000)
      sumaDias += d * x.monto; peso += x.monto
    })
    return {
      caja, debePersonal: personal.debe, comprasSinPagar,
      fijosMes: mes.recurrentesMes + mes.recurrentesMonto,
      diasCobro: peso > 0 ? Math.round(sumaDias / peso) : null,
    }
  }, [pagos, costos, compras, gastos, presupuestos, personal.debe, comprasSinPagar, mes.recurrentesMes, mes.recurrentesMonto])

  if (modo === 'tareas') return <Agenda pedido={pedido} onPedidoAtendido={onPedidoAtendido} tareas={tareasPH} cargandoTareas={cargando} porCobrar={verFinanzas ? obrasInfo.porCobrar : null} onAbrirObra={onAbrirObra} onAbrirPresupuesto={onAbrirPresupuesto} />

  return <div className="fase2Dashboard homeCompacto">
    {cargando ? <p>Cargando inicio…</p> : <InicioSimple
      nombre={nombre}
      verFinanzas={verFinanzas}
      presupuestos={presupuestos}
      costos={costos}
      gastos={gastos}
      adicionales={adicionales}
      empleadosObra={empleadosObra}
      deudas={verFinanzas ? obrasInfo.deudas : []}
      porCobrar={obrasInfo.porCobrar}
      obrasActivas={obrasInfo.activas}
      debePersonal={verPersonal ? personal.filas.filter((f) => f.debe > 0.5) : []}
      tareas={tareas}
      tareasPH={tareasPH}
      balance={balance}
      onParaHacer={() => onNavegar('agenda')}
      agendaHoy={agendaHoy.length}
      nombreCli={nombreCli}
      onAbrirObra={onAbrirObra}
      onAbrirPresupuesto={onAbrirPresupuesto}
      onIr={(dd) => onNavegar(dd)}
      acciones={<div className="ipAcc">
        <button type="button" className="ipIcono" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={onSalir}>
          {/* Ícono dibujado: el símbolo ⏻ no existe en todas las fuentes de Windows */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v9" /><path d="M6.4 6.4a8 8 0 1 0 11.2 0" /></svg>
        </button>
      </div>}
      ia={verFinanzas ? (verIA
        ? <QueMirarHoy hechos={hechosHoy} nombreCli={nombreCli} onIr={irDesdeHoy} />
        : <button type="button" className="ipIA" onClick={() => setVerIA(true)}>✨ Resumen del día con IA</button>) : undefined}
    />}
  </div>
}
