import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { EstadoPresupuesto } from './estadoObra'

// Resumen de la obra: una sola vista con avance, plata, equipo, accesos y
// la lista de lo que falta. Cada tarjeta lleva a la pestaña correspondiente.

export type TabSeguimiento = 'resumen' | 'timeline' | 'personal' | 'rentabilidad' | 'finanzas' | 'adicionales' | 'accesos'

type UltimoAvance = { fecha: string; titulo: string; porcentaje: number } | null

type Props = {
  obraId: number
  estado: string | null
  avance: number
  ultimoAvance: UltimoAvance
  cantidadAvances: number
  tienePresupuesto: boolean
  cuenta: EstadoPresupuesto | null
  cargandoCuenta: boolean
  dinero: (n: number) => string
  onIr: (tab: TabSeguimiento) => void
}

type Conteos = { personal: number; adicPendientes: number; accesos: number | null; fotos: number }

type Pendiente = { tono: 'alerta' | 'info'; texto: string; tab?: TabSeguimiento }

const diasDesde = (fecha: string) =>
  Math.floor((Date.now() - new Date(`${fecha.slice(0, 10)}T00:00:00`).getTime()) / 86400000)

async function contar(tabla: string, obraId: number, filtro?: [string, string]) {
  let q = supabase.from(tabla).select('*', { count: 'exact', head: true }).eq('obra_id', obraId)
  if (filtro) q = q.eq(filtro[0], filtro[1])
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

export default function ResumenObra({ obraId, estado, avance, ultimoAvance, cantidadAvances, tienePresupuesto, cuenta, cargandoCuenta, dinero, onIr }: Props) {
  const [conteos, setConteos] = useState<Conteos | null>(null)

  useEffect(() => {
    let vigente = true
    setConteos(null)
    void Promise.all([
      contar('obra_asignaciones', obraId).catch(() => 0),
      contar('adicionales', obraId, ['estado', 'pendiente']).catch(() => 0),
      // Si la tabla de accesos todavía no existe, no se muestra el aviso.
      contar('obra_accesos', obraId).catch(() => null),
      contar('obra_imagenes', obraId).catch(() => 0),
    ]).then(([personal, adicPendientes, accesos, fotos]) => {
      if (vigente) setConteos({ personal, adicPendientes, accesos, fotos })
    })
    return () => { vigente = false }
  }, [obraId])

  const terminada = estado === 'finalizada' || estado === 'observacion' || avance >= 100
  const cerca = terminada || avance >= 80

  const pendientes: Pendiente[] = []
  if (!tienePresupuesto) pendientes.push({ tono: 'alerta', texto: 'La obra no tiene un presupuesto aceptado vinculado.' })
  if (cuenta && cuenta.pendienteHoy > 0.5) pendientes.push({ tono: 'alerta', texto: `Falta cobrar ${dinero(cuenta.pendienteHoy)} a hoy.`, tab: 'finanzas' })
  if (cuenta && cuenta.gastoExtraPendiente > 0.5) pendientes.push({ tono: 'alerta', texto: `Reintegros de gastos pendientes: ${dinero(cuenta.gastoExtraPendiente)}.`, tab: 'adicionales' })
  if (conteos && conteos.adicPendientes > 0) pendientes.push({ tono: 'alerta', texto: conteos.adicPendientes === 1 ? '1 cambio o adicional esperando aprobación.' : `${conteos.adicPendientes} cambios o adicionales esperando aprobación.`, tab: 'adicionales' })
  if (conteos && conteos.personal === 0 && !terminada) pendientes.push({ tono: 'alerta', texto: 'No hay personal asignado a la obra.', tab: 'personal' })
  if (cantidadAvances === 0) pendientes.push({ tono: 'alerta', texto: 'Todavía no cargaste ningún avance.', tab: 'timeline' })
  else if (ultimoAvance && !terminada && diasDesde(ultimoAvance.fecha) > 14) pendientes.push({ tono: 'info', texto: `El último avance es de hace ${diasDesde(ultimoAvance.fecha)} días.`, tab: 'timeline' })
  if (conteos && conteos.accesos === 0) pendientes.push({ tono: cerca ? 'alerta' : 'info', texto: cerca ? 'Faltan cargar los accesos y claves para entregar al cliente.' : 'Accesos y claves: se cargan al terminar la instalación.', tab: 'accesos' })

  const cantidadAlertas = pendientes.filter((p) => p.tono === 'alerta').length

  return <section className="obraResumen" aria-label="Resumen de la obra">
    <div className="obraResumenGrid">
      <button type="button" className="obraResumenCard" onClick={() => onIr('timeline')}>
        <span className="obraResumenEtq">🕐 Último avance</span>
        {ultimoAvance ? <>
          <strong>{ultimoAvance.titulo || 'Avance'}</strong>
          <small>{new Date(`${ultimoAvance.fecha.slice(0, 10)}T00:00:00`).toLocaleDateString('es-AR')} · {ultimoAvance.porcentaje}% · {cantidadAvances} {cantidadAvances === 1 ? 'registro' : 'registros'}</small>
        </> : <><strong>Sin avances</strong><small>Cargá el primero</small></>}
      </button>

      <button type="button" className="obraResumenCard" onClick={() => onIr('finanzas')}>
        <span className="obraResumenEtq">💰 Cuenta</span>
        {!tienePresupuesto ? <><strong>Sin presupuesto</strong><small>Vinculá un presupuesto aceptado</small></>
          : cargandoCuenta || !cuenta ? <small>Cargando…</small>
          : <>
            <strong>{dinero(cuenta.cobrado)} <em>de {dinero(cuenta.totalActualizado)}</em></strong>
            <div className="obraResumenBarra"><span style={{ width: `${Math.min(100, cuenta.totalActualizado > 0 ? (cuenta.cobrado / cuenta.totalActualizado) * 100 : 0)}%` }} /></div>
            <small className={cuenta.pendienteHoy > 0.5 ? 'pend' : 'ok'}>
              {cuenta.pendienteHoy > 0.5 ? `Pendiente a hoy ${dinero(cuenta.pendienteHoy)}` : 'Al día'} · Saldo {dinero(Math.max(0, cuenta.saldoTotal))}
            </small>
          </>}
      </button>

      <button type="button" className="obraResumenCard" onClick={() => onIr('personal')}>
        <span className="obraResumenEtq">👷 Equipo</span>
        {conteos ? <>
          <strong>{conteos.personal === 0 ? 'Sin asignar' : `${conteos.personal} ${conteos.personal === 1 ? 'persona' : 'personas'}`}</strong>
          <small>{conteos.fotos} {conteos.fotos === 1 ? 'foto cargada' : 'fotos cargadas'}</small>
        </> : <small>Cargando…</small>}
      </button>

      <button type="button" className="obraResumenCard" onClick={() => onIr('accesos')}>
        <span className="obraResumenEtq">🔐 Accesos</span>
        {conteos ? conteos.accesos === null ? <><strong>—</strong><small>Falta crear la tabla en Supabase</small></> : <>
          <strong>{conteos.accesos === 0 ? 'Sin cargar' : `${conteos.accesos} ${conteos.accesos === 1 ? 'acceso' : 'accesos'}`}</strong>
          <small>{conteos.accesos === 0 ? 'Para el PDF del cliente' : 'Listo para entregar'}</small>
        </> : <small>Cargando…</small>}
      </button>
    </div>

    <div className="obraResumenPend">
      <h4>{!conteos ? 'Revisando…' : cantidadAlertas === 0 ? '✓ Todo al día' : `Qué falta (${cantidadAlertas})`}</h4>
      {conteos && pendientes.length > 0 && <ul>
        {pendientes.map((p, i) => <li key={i} className={p.tono}>
          <span>{p.tono === 'alerta' ? '⚠' : 'ℹ'}</span>
          <p>{p.texto}</p>
          {p.tab && <button type="button" onClick={() => onIr(p.tab!)}>Ver →</button>}
        </li>)}
      </ul>}
    </div>
  </section>
}
