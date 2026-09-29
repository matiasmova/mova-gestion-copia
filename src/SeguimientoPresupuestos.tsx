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
  const [abierto, setAbierto] = useState(true)

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

  return (
    <section className="sgWrap">
      <div className="sgKpis">
        <div><span>Tasa de cierre</span><strong>{cierre.pct == null ? '—' : `${cierre.pct}%`}</strong><small>{cierre.aceptados} aceptado{cierre.aceptados === 1 ? '' : 's'} de {cierre.total} enviados (6 meses)</small></div>
        <div><span>Vendido</span><strong>{moneda(cierre.montoAcept)}</strong><small>de {moneda(cierre.montoTotal)} presupuestado</small></div>
        <div><span>En juego</span><strong>{moneda(cierre.enJuego)}</strong><small>{cierre.cantJuego} enviado{cierre.cantJuego === 1 ? '' : 's'} esperando respuesta</small></div>
        <button type="button" className={pendientes.length ? 'alerta' : ''} onClick={() => setAbierto((v) => !v)}>
          <span>Para seguir</span><strong>{pendientes.length}</strong><small>{abierto ? 'Ocultar lista ▲' : 'Ver lista ▼'}</small>
        </button>
      </div>

      {abierto && (
        <div className="sgLista">
          <div className="sgHead">
            <h3>📞 Seguimiento</h3>
            <label>Avisar después de
              <select value={dias} onChange={(e) => cambiarDias(Number(e.target.value))}>
                {[3, 5, 7, 10, 15].map((d) => <option key={d} value={d}>{d} días</option>)}
              </select>
              sin respuesta
            </label>
          </div>
          {pendientes.length === 0
            ? <p className="sgVacio">✓ Todo al día: no hay presupuestos esperando seguimiento.</p>
            : pendientes.map(({ p, m }) => (
              <div className="sgFila" key={p.id}>
                <span className={`sgMotivo ${m.tipo}`}>{m.texto}</span>
                <button type="button" className="sgInfo" onClick={() => onAbrir(p.id)}>
                  <strong>{p.titulo}</strong>
                  <small>{nombreCliente(p.cliente_id)} · {moneda(p.total)}{p.seguimiento_at ? ` · último contacto ${fechaCorta(p.seguimiento_at)}` : ''}</small>
                </button>
                <div className="sgAcciones">
                  {p.estado === 'enviado' && <button type="button" className="sgWa" onClick={() => whatsapp(p, m)} title={telefonoCliente(p.cliente_id) ? 'Escribirle por WhatsApp' : 'El cliente no tiene teléfono: elegís el contacto en WhatsApp'}>💬 WhatsApp</button>}
                  {p.estado === 'enviado' && <button type="button" className="editButton" onClick={() => onSeguido(p.id)} title="Ya lo contacté por otro medio">✓ Ya lo seguí</button>}
                  {m.tipo === 'vencido' && <button type="button" className="deactivateButton" onClick={() => onRechazar(p.id)} title="Pasarlo a Rechazado">✕ No va</button>}
                  {p.estado === 'borrador' && <button type="button" className="editButton" onClick={() => onAbrir(p.id)}>Abrir</button>}
                </div>
              </div>
            ))}
        </div>
      )}
    </section>
  )
}
