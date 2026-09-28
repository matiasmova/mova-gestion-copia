import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { EstadoPresupuesto } from './estadoObra'

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
}

type Datos = {
  personal: number
  jornales: number
  fotos: number
  accesos: number | null
  adic: { aprobados: number; pendientes: number; rechazados: number }
  gastado: number
}

type Pendiente = { tono: 'alerta' | 'info'; texto: string; tab?: TabSeguimiento }

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

async function cargarDatos(obraId: number): Promise<Datos> {
  const [personal, jornales, fotos, accesos, rAdic, rCostos, rCompras] = await Promise.all([
    contar('obra_asignaciones', obraId).catch(() => 0),
    contar('jornales', obraId).catch(() => 0),
    contar('obra_imagenes', obraId).catch(() => 0),
    // Si la tabla de accesos todavía no existe, se muestra como no disponible.
    contar('obra_accesos', obraId).catch(() => null),
    supabase.from('adicionales').select('estado,tipo').eq('obra_id', obraId),
    supabase.from('costos').select('monto').eq('obra_id', obraId),
    supabase.from('materiales').select('cantidad,precio_unitario').eq('obra_id', obraId),
  ])
  const adic = { aprobados: 0, pendientes: 0, rechazados: 0 }
  for (const a of (rAdic.data ?? []) as { estado: string }[]) {
    if (a.estado === 'pendiente') adic.pendientes++
    else if (a.estado === 'rechazado') adic.rechazados++
    else adic.aprobados++
  }
  const gastado =
    ((rCostos.data ?? []) as { monto: number | string }[]).reduce((s, c) => s + (Number(c.monto) || 0), 0) +
    ((rCompras.data ?? []) as { cantidad: number | string; precio_unitario: number | string }[]).reduce((s, c) => s + (Number(c.cantidad) || 0) * (Number(c.precio_unitario) || 0), 0)
  return { personal, jornales, fotos, accesos, adic, gastado }
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

export default function ResumenObra({ obraId, estado, avance, avances, cargandoAvances, tienePresupuesto, cuenta, cargandoCuenta, dinero, onIr }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null)

  useEffect(() => {
    let vigente = true
    setDatos(null)
    void cargarDatos(obraId).then((d) => { if (vigente) setDatos(d) }).catch((e) => console.error(e))
    return () => { vigente = false }
  }, [obraId])

  const terminada = estado === 'finalizada' || estado === 'observacion' || avance >= 100
  const cerca = terminada || avance >= 80
  const ultimo = avances[0] ?? null

  // ---------- Qué falta ----------
  const pendientes: Pendiente[] = []
  if (!tienePresupuesto) pendientes.push({ tono: 'alerta', texto: 'La obra no tiene un presupuesto aceptado vinculado.' })
  if (cuenta && cuenta.pendienteHoy > 0.5) pendientes.push({ tono: 'alerta', texto: `Falta cobrar ${dinero(cuenta.pendienteHoy)} a hoy.`, tab: 'finanzas' })
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
          <small>{fecha(ultimo.fecha)} · {ultimo.porcentaje}% · {avances.length} {avances.length === 1 ? 'registro' : 'registros'}</small>
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
              { valor: Math.max(0, cuenta.totalActualizado - cuenta.cobrado - cuenta.pendienteHoy), color: GRIS },
            ]} />
            <div className="orLeyenda">
              <span><i style={{ background: VERDE }} />Cobrado</span>
              {cuenta.pendienteHoy > 0.5 && <span className="pend"><i style={{ background: NARANJA }} />Pendiente hoy {dinero(cuenta.pendienteHoy)}</span>}
              <span><i style={{ background: GRIS }} />Saldo {dinero(Math.max(0, cuenta.saldoTotal))}</span>
            </div>
          </>}
      </Tarjeta>

      {/* Rentabilidad: caja de la obra (cobrado vs gastado) */}
      <Tarjeta icono="📊" titulo="Rentabilidad" onClick={() => onIr('rentabilidad')}>
        {!datos || (tienePresupuesto && !cuenta) ? <small>Cargando…</small> : (() => {
          const cobrado = cuenta?.cobrado ?? 0
          const max = Math.max(cobrado, datos.gastado, 1)
          const caja = cobrado - datos.gastado
          return <>
            <strong className="orValor" style={{ color: caja >= 0 ? VERDE : '#b23b32' }}>{caja >= 0 ? '+' : '−'} {dinero(Math.abs(caja))} <em>en caja</em></strong>
            <div className="orComparar">
              <div><span>Cobrado</span><div className="orBarra"><span style={{ width: `${(cobrado / max) * 100}%`, background: VERDE }} /></div><b>{dinero(cobrado)}</b></div>
              <div><span>Gastado</span><div className="orBarra"><span style={{ width: `${(datos.gastado / max) * 100}%`, background: NARANJA }} /></div><b>{dinero(datos.gastado)}</b></div>
            </div>
            <small>Tocá para ver la ganancia proyectada</small>
          </>
        })()}
      </Tarjeta>

      {/* Equipo */}
      <Tarjeta icono="👷" titulo="Equipo" onClick={() => onIr('personal')}>
        {!datos ? <small>Cargando…</small> : <>
          <strong className="orValor">{datos.personal === 0 ? 'Sin asignar' : `${datos.personal} ${datos.personal === 1 ? 'persona' : 'personas'}`}</strong>
          <div className="orChips">
            <span>{datos.jornales} {datos.jornales === 1 ? 'jornal' : 'jornales'}</span>
            <span>{datos.fotos} {datos.fotos === 1 ? 'foto' : 'fotos'}</span>
          </div>
        </>}
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
