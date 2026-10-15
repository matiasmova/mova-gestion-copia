import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { EstadoPresupuesto } from './estadoObra'
import { calcularPersona, type AsignacionCalc, type JornalCalc } from './personalCalculos'
import VidaEtapas, { pasosObra } from './VidaEtapas'
import { Cifra } from './Animados'
import { codigoPresupuesto } from './codigoPresupuesto'

// Resumen de la obra: la ficha abre acá. Arriba "Qué falta" y abajo seis
// tarjetas con mini gráficos; cada una abre el detalle completo de su sección.

export type TabSeguimiento = 'resumen' | 'documento' | 'timeline' | 'personal' | 'rentabilidad' | 'finanzas' | 'adicionales' | 'accesos'

export const TITULO_SECCION: Record<Exclude<TabSeguimiento, 'resumen'>, string> = {
  documento: '📄 Presupuesto y documento',
  timeline: '🕐 Avances y estados',
  finanzas: '💰 Cuenta y cobros',
  rentabilidad: '📊 Rentabilidad',
  personal: '👷 Equipo',
  adicionales: '🔁 Cambios y adicionales',
  accesos: '🔐 Accesos y claves',
}

type AvanceResumen = { fecha: string; titulo: string; porcentaje: number }

type Props = {
  obraId: number
  estado: string | null
  avance: number
  avances: AvanceResumen[] // más reciente primero
  cargandoAvances: boolean
  tienePresupuesto: boolean
  cuenta: EstadoPresupuesto | null
  cargandoCuenta: boolean
  dinero: (n: number) => string
  onIr: (tab: TabSeguimiento) => void
  // Sin presupuesto aceptado: seguir el que está en borrador o armar uno nuevo.
  presupuestoSinAceptar?: { texto: string; abrir: () => void } | null
  // Presupuesto aceptado de la obra (tarjeta con totales y accesos al documento).
  presupuesto?: { id: number; titulo: string } | null
  // Botón del cuadro "A pagar hoy".
  onRegistrarCobro?: () => void
  // Obra en vivo: línea de avances tocable (reemplaza a las etapas) y el
  // presupuesto editable (children), debajo de "Qué falta".
  lineaAvances?: ReactNode
  children?: ReactNode
  // Cambia cuando se guarda algo, para recontar pendientes sin rearmar la pantalla.
  revision?: number
  // Obra en vivo: estas secciones se abren ahí mismo (acordeón) en lugar de ir a otra pantalla.
  secciones?: Partial<Record<SeccionVivo, ReactNode>>
}

export type SeccionVivo = 'finanzas' | 'personal' | 'accesos' | 'rentabilidad'

// Una persona del equipo, con los mismos números que la sección Personal.
type MiembroEquipo = { id: number; nombre: string; rol: string | null; pagado: number; falta: number; adelanto: number; faltaValor: boolean }

type Datos = {
  personal: number
  equipo: MiembroEquipo[]
  jornales: number
  fotos: number
  accesos: number | null
  adic: { aprobados: number; pendientes: number; rechazados: number }
  gastado: number // gastos propios de la obra (sin los gastos extra a reintegrar)
  extraNoPagado: number // gastos extra que adelantaste y el cliente todavía no devolvió
}

type Pendiente = { tono: 'alerta' | 'info'; texto: string; tab?: TabSeguimiento; accion?: () => void }

const VERDE = '#1f7a4d'
const NARANJA = '#e47b00'
const GRIS = '#e6e9ee'

const diasDesde = (fecha: string) =>
  Math.floor((Date.now() - new Date(`${fecha.slice(0, 10)}T00:00:00`).getTime()) / 86400000)
const fecha = (f: string) => new Date(`${f.slice(0, 10)}T00:00:00`).toLocaleDateString('es-AR')

async function contar(tabla: string, obraId: number) {
  const { count, error } = await supabase.from(tabla).select('*', { count: 'exact', head: true }).eq('obra_id', obraId)
  if (error) throw error
  return count ?? 0
}

async function cargarDatos(obraId: number, avance: number): Promise<Datos> {
  const [rAsig, rJorn, fotos, accesos, rAdic, rCostos, rCompras, rPres] = await Promise.all([
    supabase.from('obra_asignaciones').select('id,personal_id,rol_en_obra,modalidad,valor_acordado').eq('obra_id', obraId),
    supabase.from('jornales').select('personal_id,jornada,horas').eq('obra_id', obraId),
    contar('obra_imagenes', obraId).catch(() => 0),
    // Si la tabla de accesos todavía no existe, se muestra como no disponible.
    contar('obra_accesos', obraId).catch(() => null),
    supabase.from('adicionales').select('estado,tipo,importe').eq('obra_id', obraId),
    supabase.from('costos').select('monto,tipo,personal_id').eq('obra_id', obraId),
    supabase.from('materiales').select('cantidad,precio_unitario').eq('obra_id', obraId),
    supabase.from('presupuestos').select('total,estado,activo').eq('obra_id', obraId),
  ])
  const adic = { aprobados: 0, pendientes: 0, rechazados: 0 }
  for (const a of (rAdic.data ?? []) as { estado: string }[]) {
    if (a.estado === 'pendiente') adic.pendientes++
    else if (a.estado === 'rechazado') adic.rechazados++
    else adic.aprobados++
  }
  // El gasto extra (costo tipo "gasto_extra") no es gasto tuyo: lo devuelve el
  // cliente. Mientras está pendiente se muestra aparte, en contra.
  const filasCostos = (rCostos.data ?? []) as { monto: number | string; tipo: string }[]
  const extraNoPagado = filasCostos.filter((c) => c.tipo === 'gasto_extra').reduce((s, c) => s + (Number(c.monto) || 0), 0)
  const gastado =
    filasCostos.filter((c) => c.tipo !== 'gasto_extra').reduce((s, c) => s + (Number(c.monto) || 0), 0) +
    ((rCompras.data ?? []) as { cantidad: number | string; precio_unitario: number | string }[]).reduce((s, c) => s + (Number(c.cantidad) || 0) * (Number(c.precio_unitario) || 0), 0)

  // Equipo: igual que la sección Personal (personalCalculos.ts).
  type Asig = AsignacionCalc & { id: number; rol_en_obra: string | null }
  const asignaciones = ((rAsig.data ?? []) as Asig[]).map((a) => ({ ...a, valor_acordado: a.valor_acordado == null ? null : Number(a.valor_acordado) }))
  const jornalesObra = ((rJorn.data ?? []) as JornalCalc[]).map((j) => ({ ...j, jornada: Number(j.jornada), horas: j.horas == null ? null : Number(j.horas) }))
  const pagosPersonal = ((rCostos.data ?? []) as { monto: number | string; tipo: string; personal_id: number | null }[])
    .filter((c) => c.personal_id != null && (c.tipo === 'mano_obra' || c.tipo === 'terciarizado'))
    .map((c) => ({ personal_id: c.personal_id, monto: Number(c.monto) || 0 }))
  const valorObra =
    ((rPres.data ?? []) as { total: number | string; estado: string; activo: boolean }[]).filter((p) => p.activo !== false && p.estado === 'aceptado').reduce((s, p) => s + (Number(p.total) || 0), 0) +
    ((rAdic.data ?? []) as { importe: number | string; estado: string; tipo: string }[]).filter((a) => a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + (Number(a.importe) || 0), 0)
  const ids = asignaciones.map((a) => a.personal_id).filter((id): id is number => id != null)
  const rPers = ids.length
    ? await supabase.from('personal').select('id,nombre,apellido,especialidad,costo_dia').in('id', ids)
    : { data: [], error: null }
  const personas = ((rPers.data ?? []) as { id: number; nombre: string; apellido: string | null; especialidad: string | null; costo_dia: number | string | null }[])
  const equipo: MiembroEquipo[] = asignaciones.map((a) => {
    const per = personas.find((x) => x.id === a.personal_id)
    const c = calcularPersona(a, per ? { id: per.id, costo_dia: per.costo_dia == null ? null : Number(per.costo_dia) } : undefined, pagosPersonal, jornalesObra, valorObra, avance)
    return {
      id: a.id,
      nombre: per ? `${per.nombre} ${per.apellido ?? ''}`.trim() : 'Persona',
      rol: a.rol_en_obra || per?.especialidad || null,
      pagado: c.pagado,
      falta: c.totalContrato != null ? Math.max(c.totalContrato - c.pagado, 0) : Math.max(c.diferencia, 0),
      adelanto: c.totalContrato != null ? Math.max(c.pagado - c.totalContrato, 0) : Math.max(-c.diferencia, 0),
      faltaValor: c.faltaValor,
    }
  })
  const jornales = jornalesObra.reduce((s, j) => s + (j.jornada || 0), 0)
  return { personal: equipo.length, equipo, jornales, fotos, accesos, adic, gastado, extraNoPagado }
}

// Gráfico circular de avance (lo usa también el encabezado de la ficha).
export function DonaAvance({ pct, size = 64, grosor = 7 }: { pct: number; size?: number; grosor?: number }) {
  const r = (size - grosor) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, pct))
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Avance ${v}%`}>
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GRIS} strokeWidth={grosor} />
    <circle className="donaVal" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={v >= 100 ? VERDE : NARANJA} strokeWidth={grosor} strokeLinecap="round"
      strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.24} fontWeight={800} fill="#111827">{v}%</text>
  </svg>
}

// Sección "Presupuesto y documento": totales del presupuesto y todas sus acciones.
export function PresupuestoDocumento({ presupuesto, cuenta, dinero, children }: { presupuesto: { id: number; titulo: string }; cuenta: EstadoPresupuesto | null; dinero: (n: number) => string; children?: ReactNode }) {
  return <div className="orPresu">
    <div className="orPresuTit"><span>📄 PRESUPUESTO {codigoPresupuesto(presupuesto.id)}</span><span className="presuEtapa et-aceptado">Aceptado</span></div>
    <strong>{presupuesto.titulo}</strong>
    {cuenta ? <>
      <div className="orPresuFila"><span>Original</span><b>{dinero(cuenta.totalOriginal)}</b></div>
      <div className="orPresuFila"><span>Cambios y extras</span><b>{cuenta.totalCambios === 0 ? dinero(0) : `${cuenta.totalCambios > 0 ? '+' : '−'} ${dinero(Math.abs(cuenta.totalCambios))}`}</b></div>
      <div className="orPresuTotal"><span>TOTAL ACTUALIZADO</span><span>{dinero(cuenta.totalActualizado)}</span></div>
    </> : <small>Cargando…</small>}
    {children}
  </div>
}

// Cuadro de una sección: ícono, nombre y una línea de estado (con punto si hay algo pendiente).
function Cuadro({ icono, titulo, estado, alerta, ancho, onClick }: { icono: string; titulo: string; estado: ReactNode; alerta?: boolean; ancho?: boolean; onClick: () => void }) {
  return <button type="button" className={`orCuadro${alerta ? ' alerta' : ''}${ancho ? ' ancho' : ''}`} onClick={onClick}>
    {alerta && <span className="orCuadroPunto" aria-label="Tiene algo pendiente" />}
    <span className="orCuadroIco" aria-hidden>{icono}</span>
    <span className="orCuadroTxt"><b>{titulo}</b><small>{estado}</small></span>
    {ancho && <span className="orCuadroIr" aria-hidden>›</span>}
  </button>
}

export default function ResumenObra({ obraId, estado, avance, avances, cargandoAvances, tienePresupuesto, cuenta, cargandoCuenta, dinero, onIr, presupuesto, onRegistrarCobro, presupuestoSinAceptar, lineaAvances, children, revision = 0, secciones }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [abiertas, setAbiertas] = useState<string[]>([])
  const alternar = (id: string) => setAbiertas((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))
  // Ir a una sección: si está en vivo se despliega acá mismo; si no, se abre su pantalla.
  function irA(tab: TabSeguimiento) {
    if (secciones?.[tab as SeccionVivo]) {
      setAbiertas((a) => (a.includes(tab) ? a : [...a, tab]))
      setTimeout(() => document.querySelector(`[data-seccion="${tab}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
      return
    }
    onIr(tab)
  }

  useEffect(() => {
    let vigente = true
    void cargarDatos(obraId, avance).then((d) => { if (vigente) setDatos(d) }).catch((e) => console.error(e))
    return () => { vigente = false }
  }, [obraId, avance, revision])
  useEffect(() => { setDatos(null) }, [obraId])

  const terminada = estado === 'finalizada' || estado === 'observacion' || avance >= 100
  const cerca = terminada || avance >= 80
  const ultimo = avances[0] ?? null

  // ---------- Qué falta ----------
  const pendientes: Pendiente[] = []
  if (!tienePresupuesto) pendientes.push({ tono: 'alerta', texto: presupuestoSinAceptar?.texto ?? 'La obra no tiene un presupuesto aceptado vinculado.', accion: presupuestoSinAceptar?.abrir })
  // A hoy: lo de la obra según el avance + los gastos a reintegrar sin devolver.
  const aCobrarHoy = cuenta ? Math.max(0, cuenta.pendienteHoy) + Math.max(0, cuenta.gastoExtraPendiente) : 0
  if (cuenta && aCobrarHoy > 0.5) pendientes.push({ tono: 'alerta', texto: cuenta.gastoExtraPendiente > 0.5 && cuenta.pendienteHoy > 0.5 ? `Falta cobrar ${dinero(aCobrarHoy)} a hoy (obra ${dinero(cuenta.pendienteHoy)} + gastos a reintegrar ${dinero(cuenta.gastoExtraPendiente)}).` : `Falta cobrar ${dinero(aCobrarHoy)} a hoy.`, tab: 'finanzas' })
  if (cuenta && cuenta.gastoExtraPendiente > 0.5) pendientes.push({ tono: 'alerta', texto: `Reintegros de gastos pendientes: ${dinero(cuenta.gastoExtraPendiente)}.`, tab: 'adicionales' })
  if (datos && datos.adic.pendientes > 0) pendientes.push({ tono: 'alerta', texto: datos.adic.pendientes === 1 ? '1 cambio o adicional esperando aprobación.' : `${datos.adic.pendientes} cambios o adicionales esperando aprobación.`, tab: 'adicionales' })
  if (datos && datos.personal === 0 && !terminada) pendientes.push({ tono: 'alerta', texto: 'No hay personal asignado a la obra.', tab: 'personal' })
  if (!cargandoAvances && avances.length === 0) pendientes.push({ tono: 'alerta', texto: 'Todavía no cargaste ningún avance.', tab: 'timeline' })
  else if (ultimo && !terminada && diasDesde(ultimo.fecha) > 14) pendientes.push({ tono: 'info', texto: `El último avance es de hace ${diasDesde(ultimo.fecha)} días.`, tab: 'timeline' })
  if (datos && datos.accesos === 0 && cerca) pendientes.push({ tono: 'alerta', texto: 'Faltan cargar los accesos y claves para entregar al cliente.', tab: 'accesos' })
  const listo = !!datos && !cargandoAvances && !(tienePresupuesto && cargandoCuenta)

  // Cuadro "A pagar hoy": lo pagado, lo de hoy y lo que resta según avance la obra.
  const hoy = cuenta ? Math.max(0, cuenta.pendienteHoy) + cuenta.gastoExtraPendiente : 0
  const resta = cuenta ? Math.max(0, cuenta.totalActualizado - Math.max(cuenta.corresponde, cuenta.cobrado)) : 0
  const totalBarra = cuenta ? Math.max(1, cuenta.cobrado + hoy + resta) : 1
  const pctBarra = (n: number) => `${Math.max(0, Math.min(100, (n / totalBarra) * 100))}%`
  const nAvisos = pendientes.filter((p) => p.tono === 'alerta')
  const avisoDe = (tab: TabSeguimiento) => pendientes.some((p) => p.tono === 'alerta' && p.tab === tab)
  const adic = datos?.adic
  const totalAdic = adic ? adic.aprobados + adic.pendientes + adic.rechazados : 0
  const cajaObra = datos ? (cuenta?.cobrado ?? 0) - datos.gastado - datos.extraNoPagado : 0

  return <section className="orResumen" aria-label="Resumen de la obra">
    {tienePresupuesto && (cargandoCuenta || !cuenta ? <div className="orHoy cargando"><small>A PAGAR HOY</small><strong>…</strong></div> : cuenta.totalActualizado > 0 && (
      <div className={`orHoy${hoy > 0.5 ? '' : ' aldia'}`}>
        <small>{hoy > 0.5 ? 'A PAGAR HOY' : 'CLIENTE AL DÍA'}</small>
        <strong>{hoy > 0.5 ? <Cifra valor={hoy} formato={dinero} /> : '✓ Al día'}</strong>
        {cuenta.gastoExtraPendiente > 0.5 && hoy > 0.5 && <em>Obra {dinero(Math.max(0, cuenta.pendienteHoy))} + gastos a reintegrar {dinero(cuenta.gastoExtraPendiente)}</em>}
        <div className="orHoyBarra" aria-hidden="true">
          <i className="pago" style={{ width: pctBarra(cuenta.cobrado) }} />
          <i className="hoy" style={{ width: pctBarra(hoy) }} />
        </div>
        <div className="orHoyCifras">
          <span>Pagó <b>{dinero(cuenta.cobrado)}</b></span>
          <span>Resta <b>{dinero(resta)}</b></span>
          <span>Total <b>{dinero(cuenta.totalActualizado)}</b></span>
        </div>
        {onRegistrarCobro && <button type="button" className="orHoyBtn" onClick={onRegistrarCobro}>💵 Registrar cobro</button>}
      </div>
    ))}

    {lineaAvances ?? <div className="orVida"><VidaEtapas pasos={pasosObra({ estado, porcentaje_avance: avance }, cuenta ? Math.max(0, cuenta.saldoTotal) + cuenta.gastoExtraPendiente : undefined)} /></div>}

    {listo && (pendientes.length > 0 ? (
      <div className="orFalta">
        <div className="orFaltaCab"><b>Qué falta</b>{nAvisos.length > 0 && <span>{nAvisos.length}</span>}</div>
        {pendientes.map((p, i) => {
          const urgente = p.tab === 'finanzas' && p.tono === 'alerta'
          const contenido = <><i className={urgente ? 'urg' : p.tono} aria-hidden /><span>{p.texto}</span>{(p.tab || p.accion) && <em aria-hidden>›</em>}</>
          return p.accion || p.tab
            ? <button key={i} type="button" className="orFaltaItem" onClick={() => (p.accion ? p.accion() : irA(p.tab!))}>{contenido}</button>
            : <div key={i} className="orFaltaItem">{contenido}</div>
        })}
      </div>
    ) : <p className="orTodoOk">✓ Todo al día en esta obra</p>)}

    {children}

    {secciones ? <>
      <div className="orTit">Más de la obra</div>
      <div className="oeSecciones">
        {([
          ['finanzas', '💰', 'Cobros', !tienePresupuesto ? 'Sin presupuesto' : !cuenta ? 'Cargando…' : `Cobrado ${dinero(cuenta.cobrado)}`, avisoDe('finanzas')],
          ['personal', '👷', 'Equipo', !datos ? 'Cargando…' : datos.equipo.length === 0 ? 'Sin asignar' : `${datos.equipo.length} ${datos.equipo.length === 1 ? 'persona' : 'personas'}${datos.equipo.some((m) => m.falta > 0.5) ? ' · hay pagos pendientes' : ''}`, avisoDe('personal') || !!datos?.equipo.some((m) => m.falta > 0.5)],
          ['accesos', '🔐', 'Accesos y claves', !datos ? 'Cargando…' : datos.accesos === null ? '—' : datos.accesos === 0 ? 'Sin cargar' : `${datos.accesos} cargados`, avisoDe('accesos')],
          ['rentabilidad', '📊', 'Rentabilidad', !datos || (tienePresupuesto && !cuenta) ? 'Cargando…' : `${cajaObra >= 0 ? '+' : '−'} ${dinero(Math.abs(cajaObra))} en caja`, false],
        ] as [SeccionVivo, string, string, string, boolean][]).filter(([id]) => secciones[id]).map(([id, icono, titulo, estadoTxt, alerta]) => {
          const abierta = abiertas.includes(id)
          return <div key={id} className={`oeSeccion${abierta ? ' abierta' : ''}`} data-seccion={id}>
            <button type="button" className="oeSeccionCab" aria-expanded={abierta} onClick={() => alternar(id)}>
              <span className="oeSeccionIco" aria-hidden>{icono}</span>
              <span className="oeSeccionTx"><b>{titulo}</b><small className={alerta ? 'alerta' : ''}>{estadoTxt}</small></span>
              <span className="oeSeccionFlecha" aria-hidden>{abierta ? '−' : '＋'}</span>
            </button>
            {abierta && <div className="oeSeccionCuerpo">{secciones[id]}</div>}
          </div>
        })}
      </div>
    </> : <>
    <div className="orTit">Obra</div>
    <div className="orCuadros">
      {presupuesto && <Cuadro ancho icono="📄" titulo="Presupuesto y documento" estado="Enviar PDF, link de pago, editar, formas de pago" onClick={() => onIr('documento')} />}
      <Cuadro icono="🏗️" titulo="Avances" onClick={() => onIr('timeline')}
        estado={cargandoAvances ? 'Cargando…' : ultimo ? `${ultimo.porcentaje}% · último ${fecha(ultimo.fecha)}` : 'Sin avances'} alerta={!cargandoAvances && avances.length === 0} />
      <Cuadro icono="💰" titulo="Cuenta" onClick={() => onIr('finanzas')}
        estado={!tienePresupuesto ? 'Sin presupuesto' : !cuenta ? 'Cargando…' : `Cobrado ${dinero(cuenta.cobrado)}`} alerta={avisoDe('finanzas')} />
      <Cuadro icono="👷" titulo="Equipo" onClick={() => onIr('personal')}
        estado={!datos ? 'Cargando…' : datos.equipo.length === 0 ? 'Sin asignar' : `${datos.equipo.length} ${datos.equipo.length === 1 ? 'persona' : 'personas'}${datos.equipo.some((m) => m.falta > 0.5) ? ' · hay pagos pendientes' : ''}`}
        alerta={avisoDe('personal') || !!datos?.equipo.some((m) => m.falta > 0.5)} />
      <Cuadro icono="🔁" titulo="Cambios y extras" onClick={() => onIr('adicionales')}
        estado={!adic ? 'Cargando…' : totalAdic === 0 ? 'Sin cambios' : adic.pendientes > 0 ? `${adic.pendientes} por aprobar` : `${totalAdic} ${totalAdic === 1 ? 'cambio' : 'cambios'}`} alerta={avisoDe('adicionales')} />
      <Cuadro icono="🔐" titulo="Accesos" onClick={() => onIr('accesos')}
        estado={!datos ? 'Cargando…' : datos.accesos === null ? '—' : datos.accesos === 0 ? 'Sin cargar' : `${datos.accesos} cargados`} alerta={avisoDe('accesos')} />
      <Cuadro icono="📊" titulo="Rentabilidad" onClick={() => onIr('rentabilidad')}
        estado={!datos || (tienePresupuesto && !cuenta) ? 'Cargando…' : `${cajaObra >= 0 ? '+' : '−'} ${dinero(Math.abs(cajaObra))} en caja`} />
    </div>
    </>}
  </section>
}
