import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { EstadoPresupuesto } from './estadoObra'
import { calcularPersona, type AsignacionCalc, type JornalCalc } from './personalCalculos'
import VidaEtapas, { pasosObra } from './VidaEtapas'
import { codigoPresupuesto } from './codigoPresupuesto'

// Resumen de la obra: la ficha abre acá. Arriba "Qué falta" y abajo seis
// tarjetas con mini gráficos; cada una abre el detalle completo de su sección.

export type TabSeguimiento = 'resumen' | 'timeline' | 'personal' | 'rentabilidad' | 'finanzas' | 'adicionales' | 'accesos'

export const TITULO_SECCION: Record<Exclude<TabSeguimiento, 'resumen'>, string> = {
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
  // Presupuesto aceptado de la obra (tarjeta con totales y accesos al documento).
  presupuesto?: { id: number; titulo: string } | null
  onVerDocumento?: () => void
  onEditarPresupuesto?: () => void
}

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

type Pendiente = { tono: 'alerta' | 'info'; texto: string; tab?: TabSeguimiento }

const VERDE = '#1f7a4d'
const NARANJA = '#e47b00'
const GRIS = '#e6e9ee'
const VIOLETA = '#7c5cc4'

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
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={v >= 100 ? VERDE : NARANJA} strokeWidth={grosor} strokeLinecap="round"
      strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.24} fontWeight={800} fill="#111827">{v}%</text>
  </svg>
}

// Barra apilada: segmentos con color y valor.
function Barra({ partes }: { partes: { valor: number; color: string }[] }) {
  const total = partes.reduce((s, p) => s + Math.max(0, p.valor), 0)
  return <div className="orBarra">
    {total > 0 && partes.map((p, i) => p.valor > 0 && <span key={i} style={{ width: `${(p.valor / total) * 100}%`, background: p.color }} />)}
  </div>
}

function Tarjeta({ icono, titulo, onClick, children }: { icono: string; titulo: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="orCard" onClick={onClick}>
    <div className="orCardHead"><span>{icono} {titulo}</span><span className="orVer">Ver ›</span></div>
    {children}
  </button>
}

export default function ResumenObra({ obraId, estado, avance, avances, cargandoAvances, tienePresupuesto, cuenta, cargandoCuenta, dinero, onIr, presupuesto, onVerDocumento, onEditarPresupuesto }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null)

  useEffect(() => {
    let vigente = true
    setDatos(null)
    void cargarDatos(obraId, avance).then((d) => { if (vigente) setDatos(d) }).catch((e) => console.error(e))
    return () => { vigente = false }
  }, [obraId, avance])

  const terminada = estado === 'finalizada' || estado === 'observacion' || avance >= 100
  const cerca = terminada || avance >= 80
  const ultimo = avances[0] ?? null

  // ---------- Qué falta ----------
  const pendientes: Pendiente[] = []
  if (!tienePresupuesto) pendientes.push({ tono: 'alerta', texto: 'La obra no tiene un presupuesto aceptado vinculado.' })
  // A hoy: lo de la obra según el avance + los gastos a reintegrar sin devolver.
  const aCobrarHoy = cuenta ? Math.max(0, cuenta.pendienteHoy) + Math.max(0, cuenta.gastoExtraPendiente) : 0
  if (cuenta && aCobrarHoy > 0.5) pendientes.push({ tono: 'alerta', texto: cuenta.gastoExtraPendiente > 0.5 && cuenta.pendienteHoy > 0.5 ? `Falta cobrar ${dinero(aCobrarHoy)} a hoy (obra ${dinero(cuenta.pendienteHoy)} + gastos a reintegrar ${dinero(cuenta.gastoExtraPendiente)}).` : `Falta cobrar ${dinero(aCobrarHoy)} a hoy.`, tab: 'finanzas' })
  if (cuenta && cuenta.gastoExtraPendiente > 0.5) pendientes.push({ tono: 'alerta', texto: `Reintegros de gastos pendientes: ${dinero(cuenta.gastoExtraPendiente)}.`, tab: 'adicionales' })
  if (datos && datos.adic.pendientes > 0) pendientes.push({ tono: 'alerta', texto: datos.adic.pendientes === 1 ? '1 cambio o adicional esperando aprobación.' : `${datos.adic.pendientes} cambios o adicionales esperando aprobación.`, tab: 'adicionales' })
  if (datos && datos.personal === 0 && !terminada) pendientes.push({ tono: 'alerta', texto: 'No hay personal asignado a la obra.', tab: 'personal' })
  if (!cargandoAvances && avances.length === 0) pendientes.push({ tono: 'alerta', texto: 'Todavía no cargaste ningún avance.', tab: 'timeline' })
  else if (ultimo && !terminada && diasDesde(ultimo.fecha) > 14) pendientes.push({ tono: 'info', texto: `El último avance es de hace ${diasDesde(ultimo.fecha)} días.`, tab: 'timeline' })
  if (datos && datos.accesos === 0 && cerca) pendientes.push({ tono: 'alerta', texto: 'Faltan cargar los accesos y claves para entregar al cliente.', tab: 'accesos' })
  const alertas = pendientes.filter((p) => p.tono === 'alerta').length
  const listo = !!datos && !cargandoAvances && !(tienePresupuesto && cargandoCuenta)

  // Avances en orden cronológico para el gráfico (últimos 8).
  const serie = [...avances].reverse().slice(-8)

  return <section className="orResumen" aria-label="Resumen de la obra">
    <div className="orVida"><VidaEtapas pasos={pasosObra({ estado, porcentaje_avance: avance }, cuenta ? Math.max(0, cuenta.saldoTotal) + cuenta.gastoExtraPendiente : undefined)} /></div>

    {presupuesto && <div className="orPresu">
      <div className="orPresuTit"><span>📄 PRESUPUESTO {codigoPresupuesto(presupuesto.id)}</span><span className="presuEtapa et-aceptado">Aceptado</span></div>
      <strong>{presupuesto.titulo}</strong>
      {cuenta ? <>
        <div className="orPresuFila"><span>Original</span><b>{dinero(cuenta.totalOriginal)}</b></div>
        <div className="orPresuFila"><span>Cambios y extras</span><b>{cuenta.totalCambios === 0 ? dinero(0) : `${cuenta.totalCambios > 0 ? '+' : '−'} ${dinero(Math.abs(cuenta.totalCambios))}`}</b></div>
        <div className="orPresuTotal"><span>TOTAL ACTUALIZADO</span><span>{dinero(cuenta.totalActualizado)}</span></div>
      </> : <small>Cargando…</small>}
      <div className="orPresuBtns">
        {onVerDocumento && <button type="button" className="editButton" onClick={onVerDocumento}>📄 Documento del cliente</button>}
        {onEditarPresupuesto && <button type="button" className="editButton" onClick={onEditarPresupuesto}>✏️ Editar presupuesto</button>}
      </div>
    </div>}
    <div className={`orPend ${listo && alertas === 0 ? 'ok' : ''}`}>
      <h4>{!listo ? 'Revisando la obra…' : alertas === 0 ? '✓ Todo al día' : `Qué falta (${alertas})`}</h4>
      {listo && pendientes.length > 0 && <ul>
        {pendientes.map((p, i) => <li key={i} className={p.tono}>
          <span aria-hidden>{p.tono === 'alerta' ? '⚠' : 'ℹ'}</span>
          <p>{p.texto}</p>
          {p.tab && <button type="button" onClick={() => onIr(p.tab!)}>Ver ›</button>}
        </li>)}
      </ul>}
    </div>

    <div className="orGrid">
      {/* Avances */}
      <Tarjeta icono="🕐" titulo="Avances" onClick={() => onIr('timeline')}>
        {cargandoAvances ? <small>Cargando…</small> : ultimo ? <>
          <strong className="orValor">{ultimo.titulo || 'Avance'}</strong>
          <div className="orSpark" aria-hidden>
            {serie.map((a, i) => <span key={i} title={`${fecha(a.fecha)} · ${a.porcentaje}%`}><i style={{ height: `${Math.max(4, Math.min(100, a.porcentaje))}%` }} /></span>)}
          </div>
          <small>{fecha(ultimo.fecha)} · {ultimo.porcentaje}% · {avances.length} {avances.length === 1 ? 'registro' : 'registros'}{datos ? ` · ${datos.fotos} ${datos.fotos === 1 ? 'foto' : 'fotos'}` : ''}</small>
        </> : <><strong className="orValor">Sin avances</strong><small>Tocá para cargar el primero</small></>}
      </Tarjeta>

      {/* Cuenta */}
      <Tarjeta icono="💰" titulo="Cuenta" onClick={() => onIr('finanzas')}>
        {!tienePresupuesto ? <><strong className="orValor">Sin presupuesto</strong><small>Vinculá un presupuesto aceptado</small></>
          : cargandoCuenta || !cuenta ? <small>Cargando…</small> : <>
            <strong className="orValor">{dinero(cuenta.cobrado)} <em>de {dinero(cuenta.totalActualizado)}</em></strong>
            <Barra partes={[
              { valor: cuenta.cobrado, color: VERDE },
              { valor: cuenta.pendienteHoy, color: NARANJA },
              { valor: Math.max(0, cuenta.gastoExtraPendiente), color: VIOLETA },
              { valor: Math.max(0, cuenta.totalActualizado - cuenta.cobrado - cuenta.pendienteHoy), color: GRIS },
            ]} />
            <div className="orLeyenda">
              <span><i style={{ background: VERDE }} />Cobrado</span>
              {cuenta.pendienteHoy > 0.5 && <span className="pend"><i style={{ background: NARANJA }} />Obra hoy {dinero(cuenta.pendienteHoy)}</span>}
              {cuenta.gastoExtraPendiente > 0.5 && <span className="pend"><i style={{ background: VIOLETA }} />Gastos a reintegrar {dinero(cuenta.gastoExtraPendiente)}</span>}
              <span><i style={{ background: GRIS }} />Saldo {dinero(Math.max(0, cuenta.saldoTotal))}</span>
            </div>
            {aCobrarHoy > 0.5 && <small className="orTotalHoy">A cobrar hoy: <b>{dinero(aCobrarHoy)}</b>{cuenta.gastoExtraPendiente > 0.5 && cuenta.pendienteHoy > 0.5 ? ' (obra + gastos)' : ''}</small>}
          </>}
      </Tarjeta>

      {/* Rentabilidad: caja de la obra (cobrado vs gastado) */}
      <Tarjeta icono="📊" titulo="Rentabilidad" onClick={() => onIr('rentabilidad')}>
        {!datos || (tienePresupuesto && !cuenta) ? <small>Cargando…</small> : (() => {
          const cobrado = cuenta?.cobrado ?? 0
          const extra = datos.extraNoPagado
          const max = Math.max(cobrado, datos.gastado, extra, 1)
          const caja = cobrado - datos.gastado - extra
          return <>
            <strong className="orValor" style={{ color: caja >= 0 ? VERDE : '#b23b32' }}>{caja >= 0 ? '+' : '−'} {dinero(Math.abs(caja))} <em>en caja</em></strong>
            <div className={`orComparar${extra > 0.5 ? ' conExtra' : ''}`}>
              <div><span>Cobrado</span><div className="orBarra"><span style={{ width: `${(cobrado / max) * 100}%`, background: VERDE }} /></div><b>{dinero(cobrado)}</b></div>
              <div><span>Gastado</span><div className="orBarra"><span style={{ width: `${(datos.gastado / max) * 100}%`, background: NARANJA }} /></div><b>{dinero(datos.gastado)}</b></div>
              {extra > 0.5 && <div className="orExtra"><span>Extra no pagado</span><div className="orBarra"><span style={{ width: `${(extra / max) * 100}%`, background: VIOLETA }} /></div><b>− {dinero(extra)}</b></div>}
            </div>
            {extra > 0.5 && <small className="orExtraNota">El extra no pagado es un gasto extra que adelantaste y el cliente todavía no te devolvió. Resta en la caja mientras está pendiente, pero no es gasto tuyo: no cuenta en la ganancia ni en la rentabilidad del negocio.</small>}
            <small>Tocá para ver la ganancia proyectada</small>
          </>
        })()}
      </Tarjeta>

      {/* Equipo: cada persona con lo pagado y lo que falta */}
      <Tarjeta icono="👷" titulo="Equipo" onClick={() => onIr('personal')}>
        {!datos ? <small>Cargando…</small> : datos.equipo.length === 0 ? <><strong className="orValor">Sin asignar</strong><small>Tocá para asignar personal</small></> : (() => {
          const pagado = datos.equipo.reduce((s, m) => s + m.pagado, 0)
          const falta = datos.equipo.reduce((s, m) => s + m.falta, 0)
          const visibles = datos.equipo.slice(0, 4)
          return <>
            <strong className="orValor">{dinero(pagado)} <em>pagado · {datos.equipo.length} {datos.equipo.length === 1 ? 'persona' : 'personas'}</em></strong>
            <Barra partes={[{ valor: pagado, color: VERDE }, { valor: falta, color: NARANJA }]} />
            <ul className="orEquipo">
              {visibles.map((m) => <li key={m.id}>
                <span className="orEquipoNom">{m.nombre}{m.rol && <em>{m.rol}</em>}</span>
                <span className={`orEquipoSaldo ${m.falta > 0.5 ? 'pend' : 'ok'}`}>
                  {m.faltaValor ? 'Falta cargar valor' : m.falta > 0.5 ? `Falta ${dinero(m.falta)}` : m.adelanto > 0.5 ? `Adelantado ${dinero(m.adelanto)}` : 'Al día'}
                </span>
              </li>)}
            </ul>
            <small>
              {datos.equipo.length > visibles.length ? `y ${datos.equipo.length - visibles.length} más · ` : ''}
              {datos.jornales.toLocaleString('es-AR')} {datos.jornales === 1 ? 'jornal cargado' : 'jornales cargados'}
            </small>
          </>
        })()}
      </Tarjeta>

      {/* Cambios y adicionales */}
      <Tarjeta icono="🔁" titulo="Cambios y adicionales" onClick={() => onIr('adicionales')}>
        {!datos ? <small>Cargando…</small> : (() => {
          const { aprobados, pendientes: pend, rechazados } = datos.adic
          const total = aprobados + pend + rechazados
          return total === 0 ? <><strong className="orValor">Sin cambios</strong><small>El presupuesto sigue como se aceptó</small></> : <>
            <strong className="orValor">{pend > 0 ? `${pend} por aprobar` : `${total} ${total === 1 ? 'cambio' : 'cambios'}`}</strong>
            <Barra partes={[{ valor: aprobados, color: VERDE }, { valor: pend, color: NARANJA }, { valor: rechazados, color: '#cbd2da' }]} />
            <div className="orLeyenda">
              <span><i style={{ background: VERDE }} />{aprobados} {aprobados === 1 ? 'aprobado' : 'aprobados'}</span>
              {pend > 0 && <span className="pend"><i style={{ background: NARANJA }} />{pend} {pend === 1 ? 'pendiente' : 'pendientes'}</span>}
              {rechazados > 0 && <span><i style={{ background: '#cbd2da' }} />{rechazados} {rechazados === 1 ? 'rechazado' : 'rechazados'}</span>}
            </div>
          </>
        })()}
      </Tarjeta>

      {/* Accesos */}
      <Tarjeta icono="🔐" titulo="Accesos y claves" onClick={() => onIr('accesos')}>
        {!datos ? <small>Cargando…</small> : datos.accesos === null ? <><strong className="orValor">—</strong><small>Falta crear la tabla en Supabase</small></> : <>
          <strong className="orValor">{datos.accesos === 0 ? 'Sin cargar' : `${datos.accesos} ${datos.accesos === 1 ? 'acceso' : 'accesos'}`}</strong>
          <small>{datos.accesos === 0 ? (cerca ? 'Cargalos para entregar el PDF al cliente' : 'Se cargan al terminar la instalación') : '✓ Listo para entregar en PDF'}</small>
        </>}
      </Tarjeta>
    </div>
  </section>
}
