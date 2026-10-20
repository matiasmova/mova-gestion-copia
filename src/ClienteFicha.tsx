import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'
import { ESTADOS_TRABAJO, ORDEN_TRABAJO, estadoTrabajo, type EstadoTrabajo } from './estadoTrabajo'
import { PillTrabajo, VidaTrabajo } from './VidaTrabajo'
import { numeroWhatsApp } from './whatsapp'

export type ClienteFichaData = {
  id: number
  nombre: string
  apellido: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  localidad: string | null
  cuit_dni: string | null
  tipo_cliente: string | null
  lat: number | null
  lng: number | null
  activo: boolean
}

type Obra = { id: number; nombre_obra: string; estado: string | null; porcentaje_avance: number | null; activo?: boolean | null; created_at?: string | null }
type Presupuesto = { id: number; titulo: string; estado: string; total: number; total_pagado: number; saldo: number; fecha: string; obra_id: number | null; activo?: boolean | null; created_at?: string | null; enviado_at?: string | null; motivo_rechazo?: string | null }
// Un trabajo: el presupuesto y su obra juntos (o una obra que todavía no tiene presupuesto).
type Trabajo = { clave: string; titulo: string; estado: EstadoTrabajo; extra?: string; monto: number | null; abrir: (() => void) | null; hist: { fecha: string | null; texto: string }[] }
type Pago = { id: number; monto: number; fecha: string; medio_pago: string | null; obra_id: number | null; presupuesto_id: number | null }

type Props = {
  cliente: ClienteFichaData
  onCerrar: () => void
  onEditar: () => void
  onNuevaObra: () => void
  // Presupuesto nuevo para este cliente (si el usuario puede hacer presupuestos).
  onNuevoTrabajo?: () => void
  // Si no se pasan (el usuario no tiene acceso), las filas no son clickeables.
  onAbrirObra?: (id: number) => void
  onAbrirPresupuesto?: (id: number) => void
}

export default function ClienteFicha({ cliente, onCerrar, onEditar, onNuevaObra, onNuevoTrabajo, onAbrirObra, onAbrirPresupuesto }: Props) {
  const refTrabajos = useRef<HTMLDivElement>(null)
  const [historial, setHistorial] = useState<string | null>(null)
  const refCobros = useRef<HTMLDivElement>(null)
  const irA = (r: React.RefObject<HTMLDivElement | null>) => r.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // Un cobro lleva a su obra (ahí están los cobros) o, si no tiene, a su presupuesto.
  const abrirCobro = (pg: Pago) => {
    if (pg.obra_id && onAbrirObra) onAbrirObra(pg.obra_id)
    else if (pg.presupuesto_id && onAbrirPresupuesto) onAbrirPresupuesto(pg.presupuesto_id)
  }
  const cobroAbrible = (pg: Pago) => !!((pg.obra_id && onAbrirObra) || (pg.presupuesto_id && onAbrirPresupuesto))
  const [obras, setObras] = useState<Obra[]>([])
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      const [o, p] = await Promise.all([
        supabase.from('obras').select('id,nombre_obra,estado,porcentaje_avance,activo,created_at').eq('cliente_id', cliente.id).order('created_at', { ascending: false }),
        supabase.from('presupuestos').select('id,titulo,estado,total,total_pagado,saldo,fecha,obra_id,activo,created_at').eq('cliente_id', cliente.id).order('created_at', { ascending: false }),
      ])
      // Fechas de envío y motivo de rechazo (si el SQL de esas fases no se corrió, se sigue sin eso).
      const extra = await supabase.from('presupuestos').select('id,enviado_at,motivo_rechazo').eq('cliente_id', cliente.id)
      const extras = new Map(((extra.error ? [] : extra.data ?? []) as { id: number; enviado_at: string | null; motivo_rechazo: string | null }[]).map((x) => [x.id, x]))
      const obrasData = (o.data ?? []) as Obra[]
      const presData = ((p.data ?? []) as any[]).filter((x) => x.activo !== false).map((x) => ({ ...x, total: Number(x.total), total_pagado: Number(x.total_pagado), saldo: Number(x.saldo), enviado_at: extras.get(x.id)?.enviado_at ?? null, motivo_rechazo: extras.get(x.id)?.motivo_rechazo ?? null })) as Presupuesto[]
      setObras(obrasData)
      setPresupuestos(presData)

      const presIds = presData.map((x) => x.id)
      const obraIds = obrasData.map((x) => x.id)
      const filtros: string[] = []
      if (presIds.length) filtros.push(`presupuesto_id.in.(${presIds.join(',')})`)
      if (obraIds.length) filtros.push(`obra_id.in.(${obraIds.join(',')})`)
      if (filtros.length) {
        const pg = await supabase.from('pagos').select('id,monto,fecha,medio_pago,obra_id,presupuesto_id').or(filtros.join(','))
        setPagos(((pg.data ?? []) as any[]).map((x) => ({ ...x, monto: Number(x.monto) })) as Pago[])
      } else {
        setPagos([])
      }
      setCargando(false)
    }
    cargar()
  }, [cliente.id])

  const aceptados = presupuestos.filter((p) => p.estado === 'aceptado')
  const contratado = aceptados.reduce((s, p) => s + p.total, 0)
  const cobrado = pagos.reduce((s, p) => s + p.monto, 0)
  const saldo = Math.max(0, contratado - cobrado)

  // ---------- Trabajos: presupuesto + obra, con un solo estado ----------
  const trabajos: Trabajo[] = []
  for (const p of presupuestos) {
    const obra = p.obra_id != null ? obras.find((o) => o.id === p.obra_id) ?? null : null
    const suyos = pagos.filter((pg) => pg.presupuesto_id === p.id || (p.estado === 'aceptado' && obra != null && pg.obra_id === obra.id && pg.presupuesto_id == null))
    const cobradoP = suyos.reduce((sum, pg) => sum + pg.monto, 0)
    const est = estadoTrabajo(p.estado, obra, Math.max(0, p.total - cobradoP))
    const hist: Trabajo['hist'] = [{ fecha: p.created_at ?? p.fecha, texto: 'Armaste el presupuesto' }]
    if (p.enviado_at) hist.push({ fecha: p.enviado_at, texto: 'Lo enviaste al cliente' })
    if (p.estado === 'aceptado') hist.push({ fecha: null, texto: obra ? 'El cliente aceptó y se creó la obra' : 'El cliente aceptó (falta crear la obra)' })
    if (p.estado === 'rechazado') hist.push({ fecha: null, texto: `No salió${p.motivo_rechazo ? `: ${p.motivo_rechazo}` : ''}` })
    for (const pg of [...suyos].sort((a, b) => a.fecha.localeCompare(b.fecha))) hist.push({ fecha: pg.fecha, texto: `Cobro de ${moneda(pg.monto)}` })
    if (obra && p.estado === 'aceptado') hist.push({ fecha: null, texto: est === 'obra' ? `Avance ${Math.round(Number(obra.porcentaje_avance || 0))}%` : est === 'cobrado' ? 'Obra terminada y cobrada' : 'Obra terminada · falta cobrar' })
    trabajos.push({
      clave: `p-${p.id}`, titulo: p.titulo, estado: est, monto: p.total, hist,
      extra: est === 'obra' && obra ? `${Math.round(Number(obra.porcentaje_avance || 0))}%` : est === 'terminado' ? 'falta cobrar' : undefined,
      abrir: p.estado === 'aceptado' && obra && onAbrirObra ? () => onAbrirObra(obra.id) : onAbrirPresupuesto ? () => onAbrirPresupuesto(p.id) : null,
    })
  }
  // Obras que todavía no tienen ningún presupuesto: se están armando.
  for (const o of obras) {
    if (o.activo === false || presupuestos.some((p) => p.obra_id === o.id)) continue
    const terminada = o.estado === 'finalizada' || o.estado === 'observacion' || Number(o.porcentaje_avance) >= 100
    trabajos.push({
      clave: `o-${o.id}`, titulo: o.nombre_obra, estado: terminada ? 'terminado' : 'armando', monto: null,
      extra: terminada ? 'sin presupuesto' : 'falta el presupuesto',
      hist: [{ fecha: o.created_at ?? null, texto: 'Creaste la obra' }],
      abrir: onAbrirObra ? () => onAbrirObra(o.id) : null,
    })
  }
  trabajos.sort((a, b) => ORDEN_TRABAJO.indexOf(a.estado) - ORDEN_TRABAJO.indexOf(b.estado))
  const porEstado = ORDEN_TRABAJO.map((e) => [e, trabajos.filter((t) => t.estado === e).length] as const).filter(([, n]) => n > 0)

  const waNumero = numeroWhatsApp(cliente.telefono)
  const waLink = waNumero ? `https://wa.me/${waNumero}` : ''

  return (
    <div className="modalOverlay">
      <div className="modalCard fichaCliente">
        <div className="modalHeader">
          <div>
            <p className="subtitle">{cliente.tipo_cliente || 'Cliente'} · {cliente.activo ? 'Activo' : 'Inactivo'}</p>
            <h2>{cliente.nombre} {cliente.apellido ?? ''}</h2>
          </div>
          <button type="button" className="closeButton" onClick={onCerrar}>×</button>
        </div>

        <div className="fichaBody">
          <div className="fichaContacto">
            <div className="fichaDatos">
              <div><span>Teléfono</span><strong>{cliente.telefono || '—'}</strong></div>
              <div><span>Correo</span><strong>{cliente.email || '—'}</strong></div>
              <div><span>DNI / CUIT</span><strong>{cliente.cuit_dni || '—'}</strong></div>
              <div><span>Dirección</span><strong>{cliente.direccion || '—'}{cliente.localidad ? `, ${cliente.localidad}` : ''}</strong></div>
            </div>
            {cliente.lat != null && cliente.lng != null && (
              <iframe
                className="fichaMapa"
                title="Ubicación"
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${cliente.lng - 0.008}%2C${cliente.lat - 0.008}%2C${cliente.lng + 0.008}%2C${cliente.lat + 0.008}&layer=mapnik&marker=${cliente.lat}%2C${cliente.lng}`}
              />
            )}
          </div>

          <div className="fichaAcciones">
            {onNuevoTrabajo && <button className="newButton" onClick={onNuevoTrabajo} disabled={!cliente.activo}>＋ Nuevo trabajo</button>}
            <button className={onNuevoTrabajo ? 'editButton' : 'newButton'} onClick={onNuevaObra} disabled={!cliente.activo}>+ Nueva obra</button>
            <button className="editButton" onClick={onEditar}>Editar cliente</button>
            {waLink && <a className="editButton" href={waLink} target="_blank" rel="noreferrer">WhatsApp</a>}
            {cliente.email && <a className="editButton" href={`mailto:${cliente.email}`}>Enviar email</a>}
          </div>

          <div className="fichaKpis">
            <button type="button" onClick={() => irA(refTrabajos)}><span>TRABAJOS</span><strong>{trabajos.length}</strong></button>
            <button type="button" onClick={() => irA(refTrabajos)}><span>CONTRATADO</span><strong>{moneda(contratado)}</strong></button>
            <button type="button" onClick={() => irA(refCobros)}><span>COBRADO</span><strong>{moneda(cobrado)}</strong></button>
            <button type="button" className="alerta" onClick={() => irA(refTrabajos)}><span>SALDO</span><strong>{moneda(saldo)}</strong></button>
          </div>

          {cargando ? <p style={{ color: 'var(--mova-muted)' }}>Cargando información del cliente...</p> : (
            <div className="fichaRelaciones">
              <div className="fichaRel fichaTrabajos" ref={refTrabajos}>
                <div className="fichaRelHead"><h3>Trabajos</h3><span>{trabajos.length}</span></div>
                {porEstado.length > 0 && (
                  <div className="fichaTrabResumen">{porEstado.map(([e, n]) => <span key={e} className={`pillTrab ${ESTADOS_TRABAJO[e].clase}`}>{n} {ESTADOS_TRABAJO[e].corto}</span>)}</div>
                )}
                {trabajos.length === 0 ? <p className="fichaVacio">Sin trabajos todavía.</p> : trabajos.map((t) => (
                  <div className="fichaTrab" key={t.clave}>
                    <button type="button" className="fichaTrabCab" disabled={!t.abrir} onClick={() => t.abrir?.()}>
                      <span><strong>{t.titulo}</strong>{t.monto != null && <small>{moneda(t.monto)}</small>}</span>
                      {t.abrir && <b className="fichaIr" aria-hidden>›</b>}
                    </button>
                    <VidaTrabajo estado={t.estado} />
                    <div className="fichaTrabPie">
                      <PillTrabajo estado={t.estado} extra={t.extra} />
                      <button type="button" className="fichaHistBtn" aria-expanded={historial === t.clave} onClick={() => setHistorial((h) => (h === t.clave ? null : t.clave))}>🕑 Historial</button>
                    </div>
                    {historial === t.clave && (
                      <ol className="fichaHist">
                        {t.hist.map((h, i) => <li key={i}><em>{h.fecha ? fechaCorta(h.fecha.slice(0, 10)) : '·'}</em><span>{h.texto}</span></li>)}
                      </ol>
                    )}
                  </div>
                ))}
              </div>

              <div className="fichaRel" ref={refCobros}>
                <div className="fichaRelHead"><h3>Cobros</h3><span>{pagos.length}</span></div>
                {pagos.length === 0 ? <p className="fichaVacio">Sin cobros registrados.</p> : pagos.map((pg) => (
                  <button type="button" className="fichaRow" key={pg.id} disabled={!cobroAbrible(pg)} onClick={() => abrirCobro(pg)}>
                    <div><strong>{moneda(pg.monto)}</strong><small>{fechaCorta(pg.fecha)}{pg.medio_pago ? ` · ${pg.medio_pago}` : ''}{pg.obra_id ? ` · ${obras.find((o) => o.id === pg.obra_id)?.nombre_obra ?? 'obra'}` : ''}</small></div>
                    {cobroAbrible(pg) && <b className="fichaIr" aria-hidden>›</b>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
