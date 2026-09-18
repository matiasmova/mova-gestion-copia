import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { fechaCorta, moneda } from './gestionFormat'
import { estadoPush, activarPush, desactivarPush, type EstadoPush } from './push'

type Obra = { id: number; nombre_obra: string; estado: string | null; fecha_fin_estimada: string | null }
type Presupuesto = { id: number; titulo: string; obra_id: number | null; saldo: number }
type Recordatorio = { id: number; titulo: string; fecha: string; obra_id: number | null }

type Alerta = {
  clave: string
  tipo: 'plazo' | 'cobro' | 'recordatorio'
  icono: string
  titulo: string
  detalle: string
  fecha: string | null
  prioridad: number // 0 = más urgente
}

const HOY = new Date().toISOString().slice(0, 10)
const EN_7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

function Notificaciones() {
  const [obras, setObras] = useState<Obra[]>([])
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [recordatorios, setRecordatorios] = useState<Recordatorio[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [push, setPush] = useState<EstadoPush | 'cargando' | 'procesando'>('cargando')
  const [pushMsg, setPushMsg] = useState('')

  useEffect(() => { estadoPush().then(setPush) }, [])

  async function togglePush() {
    if (push === 'activo') {
      const r = await desactivarPush(); setPushMsg(r.msg)
    } else {
      setPush('procesando'); const r = await activarPush(); setPushMsg(r.msg)
    }
    setPush(await estadoPush())
  }

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      setError('')
      const [o, p, r] = await Promise.all([
        supabase.from('obras').select('id,nombre_obra,estado,fecha_fin_estimada').eq('activo', true).eq('estado', 'en_proceso'),
        supabase.from('presupuestos').select('id,titulo,obra_id,saldo,estado,activo').eq('activo', true).eq('estado', 'aceptado'),
        supabase.from('recordatorios').select('id,titulo,fecha,obra_id,completado').eq('completado', false),
      ])
      if (o.error) { setError('No se pudieron cargar las obras.'); setCargando(false); return }
      setObras((o.data ?? []) as Obra[])
      setPresupuestos(((p.data ?? []) as any[]).map((x) => ({ ...x, saldo: Number(x.saldo) })) as Presupuesto[])
      setRecordatorios((r.data ?? []) as Recordatorio[])
      setCargando(false)
    }
    cargar()
  }, [])

  const alertas = useMemo<Alerta[]>(() => {
    const lista: Alerta[] = []
    const nombreObra = (id: number | null) => obras.find((o) => o.id === id)?.nombre_obra ?? 'Sin obra'

    for (const o of obras) {
      if (!o.fecha_fin_estimada) continue
      if (o.fecha_fin_estimada < HOY) {
        lista.push({ clave: `obra-venc-${o.id}`, tipo: 'plazo', icono: '⏰', titulo: `${o.nombre_obra} — plazo vencido`, detalle: `Fecha estimada de fin: ${fechaCorta(o.fecha_fin_estimada)}`, fecha: o.fecha_fin_estimada, prioridad: 0 })
      } else if (o.fecha_fin_estimada <= EN_7) {
        lista.push({ clave: `obra-prox-${o.id}`, tipo: 'plazo', icono: '⏰', titulo: `${o.nombre_obra} — vence pronto`, detalle: `Fin estimado: ${fechaCorta(o.fecha_fin_estimada)}`, fecha: o.fecha_fin_estimada, prioridad: 1 })
      }
    }

    for (const p of presupuestos) {
      if (p.saldo > 0) {
        lista.push({ clave: `cobro-${p.id}`, tipo: 'cobro', icono: '💰', titulo: `Saldo por cobrar — ${p.titulo}`, detalle: `${nombreObra(p.obra_id)} · ${moneda(p.saldo)} pendiente`, fecha: null, prioridad: 2 })
      }
    }

    for (const r of recordatorios) {
      if (r.fecha <= HOY) {
        lista.push({ clave: `rec-${r.id}`, tipo: 'recordatorio', icono: '🔔', titulo: r.titulo, detalle: r.fecha < HOY ? `Vencido · ${fechaCorta(r.fecha)}` : 'Para hoy', fecha: r.fecha, prioridad: r.fecha < HOY ? 0 : 1 })
      }
    }

    return lista.sort((a, b) => a.prioridad - b.prioridad || (a.fecha ?? '').localeCompare(b.fecha ?? ''))
  }, [obras, presupuestos, recordatorios])

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div><p className="subtitle">SEGUIMIENTO</p><h2>Notificaciones</h2><p className="welcome">Alertas automáticas de plazos, cobros y recordatorios</p></div>
      </div>

      <div className="configGrid" style={{ marginBottom: 18 }}>
        <article>
          <div className="configIcono">🔔</div>
          <span className="configEstado">{push === 'activo' ? 'Activadas' : push === 'bloqueado' ? 'Bloqueadas' : 'Este dispositivo'}</span>
          <h3>Notificaciones en el teléfono</h3>
          <p>Recibí las alertas de recordatorios y plazos como notificación del celular, aunque la app esté cerrada.</p>
          {push === 'no-soportado' ? (
            <p className="gestionAyuda">📱 En iPhone: primero “Compartir → Agregar a inicio”, abrí la app desde el ícono y volvé acá para activarlas.</p>
          ) : push === 'bloqueado' ? (
            <p className="gestionAyuda">El permiso está bloqueado. Habilitalo desde los ajustes del navegador/teléfono y recargá.</p>
          ) : (
            <button className={`configSwitch ${push === 'activo' ? 'on' : ''}`} onClick={togglePush} disabled={push === 'cargando' || push === 'procesando'} aria-label="Activar notificaciones en este dispositivo"><i /></button>
          )}
          {pushMsg && <p className="gestionAyuda">{pushMsg}</p>}
        </article>
      </div>

      {error && <p className="loginError">{error}</p>}
      {cargando && <p>Calculando alertas...</p>}

      {!cargando && !error && (
        <div className="clientesPanel">
          {alertas.length === 0 ? (
            <div className="empty"><span>✓</span><h3>Todo al día</h3><p>No hay plazos vencidos, saldos ni recordatorios pendientes.</p></div>
          ) : (
            alertas.map((a) => (
              <div className="gestionNotificacion" key={a.clave}>
                <div className={`gestionNotifIcono ${a.tipo}`}>{a.icono}</div>
                <div>
                  <strong>{a.titulo}</strong>
                  <p>{a.detalle}</p>
                </div>
                {a.prioridad === 0 && <span className="gestionEstado alerta">Urgente</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default Notificaciones
