import { useMemo, useState } from 'react'
import { moneda, fechaCorta } from './gestionFormat'
import { codigoPresupuesto } from './codigoPresupuesto'
import { linkWhatsApp, mensajeSeguimientoPresupuesto } from './whatsapp'

// Seguimiento comercial: presupuestos enviados sin respuesta, por vencer o
// vencidos, con WhatsApp listo para escribirle al cliente, y la tasa de cierre.

export type PresupuestoSeguimiento = {
  id: number
  titulo: string
  cliente_id: number
  fecha: string
  validez_dias: number | null
  estado: string
  total: number
  created_at: string
  enviado_at?: string | null
  seguimiento_at?: string | null
}

type Props = {
  presupuestos: PresupuestoSeguimiento[]
  nombreCliente: (id: number) => string
  telefonoCliente: (id: number) => string | null
  onAbrir: (id: number) => void
  onSeguido: (id: number) => void
  onRechazar: (id: number) => void
}

const DIA = 86400000
const CLAVE_DIAS = 'mova_dias_seguimiento'
const leerDias = () => { try { return Number(localStorage.getItem(CLAVE_DIAS)) || 5 } catch { return 5 } }
const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const aFecha = (s: string) => (s.length <= 10 ? new Date(`${s}T00:00:00`) : new Date(s))
const diasEntre = (desde: string, hasta = new Date()) => Math.floor((inicioDia(hasta) - inicioDia(aFecha(desde))) / DIA)

type Motivo = { tipo: 'vencido' | 'vence' | 'sinRespuesta'; texto: string; orden: number }

export function motivoSeguimiento(p: PresupuestoSeguimiento, diasSeguir: number): Motivo | null {
  if (p.estado !== 'enviado' && p.estado !== 'borrador') return null
  const validez = Number(p.validez_dias) || 0
  const venceEn = validez > 0 ? validez - diasEntre(p.fecha) : null
  if (p.estado === 'enviado') {
    // Después de un seguimiento, no vuelve a avisar hasta que pasen los días elegidos.
    if (p.seguimiento_at && diasEntre(p.seguimiento_at) < diasSeguir) return null
    const sinContacto = diasEntre(p.seguimiento_at || p.enviado_at || p.fecha)
    if (venceEn != null && venceEn < 0) return { tipo: 'vencido', texto: `Venció hace ${-venceEn} día${venceEn === -1 ? '' : 's'}`, orden: 0 }
    if (venceEn != null && venceEn <= 3) return { tipo: 'vence', texto: venceEn === 0 ? 'Vence hoy' : `Vence en ${venceEn} día${venceEn === 1 ? '' : 's'}`, orden: 1 }
    if (sinContacto >= diasSeguir) return { tipo: 'sinRespuesta', texto: `${sinContacto} días sin respuesta`, orden: 2 }
    return null
  }
  // Borradores viejos: se armaron pero nunca se mandaron.
  if (diasEntre(p.created_at) >= diasSeguir) return { tipo: 'sinRespuesta', texto: `Borrador sin enviar hace ${diasEntre(p.created_at)} días`, orden: 3 }
  return null
}

export default function SeguimientoPresupuestos({ presupuestos, nombreCliente, telefonoCliente, onAbrir, onSeguido, onRechazar }: Props) {
  const [dias, setDias] = useState(leerDias)
  const [abierto, setAbierto] = useState(false)

  const pendientes = useMemo(() => presupuestos
    .map((p) => ({ p, m: motivoSeguimiento(p, dias) }))
    .filter((x): x is { p: PresupuestoSeguimiento; m: Motivo } => !!x.m)
    .sort((a, b) => a.m.orden - b.m.orden || b.p.total - a.p.total), [presupuestos, dias])

  // Tasa de cierre de los últimos 6 meses (sin contar borradores).
  const cierre = useMemo(() => {
    const desde = Date.now() - 180 * DIA
    const rec = presupuestos.filter((p) => p.estado !== 'borrador' && aFecha(p.fecha).getTime() >= desde)
    const acept = rec.filter((p) => p.estado === 'aceptado')
    const cerrados = rec.filter((p) => p.estado === 'aceptado' || p.estado === 'rechazado')
    const enJuego = presupuestos.filter((p) => p.estado === 'enviado')
    return {
      total: rec.length, aceptados: acept.length,
      pct: cerrados.length ? Math.round((acept.length / cerrados.length) * 100) : null,
      montoAcept: acept.reduce((s, p) => s + p.total, 0), montoTotal: rec.reduce((s, p) => s + p.total, 0),
      enJuego: enJuego.reduce((s, p) => s + p.total, 0), cantJuego: enJuego.length,
    }
  }, [presupuestos])

  function cambiarDias(v: number) { setDias(v); try { localStorage.setItem(CLAVE_DIAS, String(v)) } catch { /* sin acción */ } }

  function whatsapp(p: PresupuestoSeguimiento, m: Motivo) {
    const texto = mensajeSeguimientoPresupuesto({ cliente: nombreCliente(p.cliente_id), titulo: p.titulo, codigo: codigoPresupuesto(p.id), fecha: fechaCorta(p.enviado_at || p.fecha), vencido: m.tipo === 'vencido' })
    const url = linkWhatsApp(telefonoCliente(p.cliente_id), texto)
    if (url) window.open(url, '_blank', 'noopener')
    onSeguido(p.id)
  }

  const borradores = presupuestos.filter((p) => p.estado === 'borrador').length

  return (
    <section className="sgWrap">
      {/* Una sola línea de resumen; al tocarla se ven los números. */}
      <button type="button" className={`trbResumen${abierto ? ' abierto' : ''}`} aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <span>📊 <b>{cierre.pct == null ? '—' : `${cierre.pct}%`}</b> cerrados · vendido <b>{moneda(cierre.montoAcept)}</b></span>
        <i className="trbFlecha">›</i>
      </button>
      {abierto && (
        <div className="trbNumeros">
          <div><small>TASA DE CIERRE</small><b>{cierre.pct == null ? '—' : `${cierre.pct}%`}</b><span>{cierre.aceptados} de {cierre.total} enviados (6 meses)</span></div>
          <div><small>VENDIDO</small><b>{moneda(cierre.montoAcept)}</b><span>de {moneda(cierre.montoTotal)} presupuestado</span></div>
          <div><small>EN JUEGO</small><b>{moneda(cierre.enJuego)}</b><span>{cierre.cantJuego} esperando respuesta</span></div>
          <div><small>BORRADORES</small><b>{borradores}</b><span>sin enviar</span></div>
          <label className="trbDias">Avisar después de
            <select value={dias} onChange={(e) => cambiarDias(Number(e.target.value))}>
              {[3, 5, 7, 10, 15].map((d) => <option key={d} value={d}>{d} días</option>)}
            </select>
            sin respuesta
          </label>
        </div>
      )}

      {/* Para hacer hoy: lo que necesita una acción, con un botón cada uno. */}
      {pendientes.length > 0 && (
        <div className="trbHacer">
          <h3>🔥 Para hacer hoy <span>{pendientes.length}</span></h3>
          {pendientes.map(({ p, m }) => (
            <div className="trbTarea" key={p.id}>
              <i aria-hidden="true" />
              <button type="button" className="trbTareaInfo" onClick={() => onAbrir(p.id)}>
                <b>{p.titulo}</b>
                <small>{m.texto} · {nombreCliente(p.cliente_id)} · {moneda(p.total)}</small>
              </button>
              {p.estado === 'enviado'
                ? <>
                  <button type="button" className="trbMini wa" onClick={() => whatsapp(p, m)} title={telefonoCliente(p.cliente_id) ? 'Escribirle por WhatsApp' : 'El cliente no tiene teléfono: elegís el contacto en WhatsApp'}>💬 Seguir</button>
                  <button type="button" className="trbMini cl" onClick={() => (m.tipo === 'vencido' ? onRechazar(p.id) : onSeguido(p.id))} title={m.tipo === 'vencido' ? 'Pasarlo a Rechazado' : 'Ya lo contacté por otro medio'}>{m.tipo === 'vencido' ? '✕' : '✓'}</button>
                </>
                : <button type="button" className="trbMini osc" onClick={() => onAbrir(p.id)}>📤 Enviar</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
