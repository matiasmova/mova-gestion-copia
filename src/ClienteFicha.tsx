import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'
import { etiquetaObra } from './obraEstado'
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

type Obra = { id: number; nombre_obra: string; estado: string | null; porcentaje_avance: number | null }
type Presupuesto = { id: number; titulo: string; estado: string; total: number; total_pagado: number; saldo: number; fecha: string }
type Pago = { id: number; monto: number; fecha: string; medio_pago: string | null; obra_id: number | null; presupuesto_id: number | null }

type Props = {
  cliente: ClienteFichaData
  onCerrar: () => void
  onEditar: () => void
  onNuevaObra: () => void
  // Si no se pasan (el usuario no tiene acceso), las filas no son clickeables.
  onAbrirObra?: (id: number) => void
  onAbrirPresupuesto?: (id: number) => void
}

const claseEstadoObra = (e: string | null) =>
  e === 'finalizada' ? 'fin' : e === 'observacion' ? 'pausa' : 'ejecucion'

export default function ClienteFicha({ cliente, onCerrar, onEditar, onNuevaObra, onAbrirObra, onAbrirPresupuesto }: Props) {
  const refObras = useRef<HTMLDivElement>(null)
  const refPres = useRef<HTMLDivElement>(null)
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
        supabase.from('obras').select('id,nombre_obra,estado,porcentaje_avance').eq('cliente_id', cliente.id).order('created_at', { ascending: false }),
        supabase.from('presupuestos').select('id,titulo,estado,total,total_pagado,saldo,fecha').eq('cliente_id', cliente.id).order('created_at', { ascending: false }),
      ])
      const obrasData = (o.data ?? []) as Obra[]
      const presData = ((p.data ?? []) as any[]).map((x) => ({ ...x, total: Number(x.total), total_pagado: Number(x.total_pagado), saldo: Number(x.saldo) })) as Presupuesto[]
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
            <button className="newButton" onClick={onNuevaObra} disabled={!cliente.activo}>+ Nueva obra</button>
            <button className="editButton" onClick={onEditar}>Editar cliente</button>
            {waLink && <a className="editButton" href={waLink} target="_blank" rel="noreferrer">WhatsApp</a>}
            {cliente.email && <a className="editButton" href={`mailto:${cliente.email}`}>Enviar email</a>}
          </div>

          <div className="fichaKpis">
            <button type="button" onClick={() => irA(refObras)}><span>OBRAS</span><strong>{obras.length}</strong></button>
            <button type="button" onClick={() => irA(refPres)}><span>CONTRATADO</span><strong>{moneda(contratado)}</strong></button>
            <button type="button" onClick={() => irA(refCobros)}><span>COBRADO</span><strong>{moneda(cobrado)}</strong></button>
            <button type="button" className="alerta" onClick={() => irA(refPres)}><span>SALDO</span><strong>{moneda(saldo)}</strong></button>
          </div>

          {cargando ? <p style={{ color: 'var(--mova-muted)' }}>Cargando información del cliente...</p> : (
            <div className="fichaRelaciones">
              <div className="fichaRel" ref={refObras}>
                <div className="fichaRelHead"><h3>Obras</h3><span>{obras.length}</span></div>
                {obras.length === 0 ? <p className="fichaVacio">Sin obras.</p> : obras.map((o) => (
                  <button type="button" className="fichaRow" key={o.id} disabled={!onAbrirObra} onClick={() => onAbrirObra?.(o.id)}>
                    <div><strong>{o.nombre_obra}</strong><small>{Number(o.porcentaje_avance || 0)}% de avance</small></div>
                    <em className={`fichaEstado ${claseEstadoObra(o.estado)}`}>{etiquetaObra(o.estado)}</em>
                    {onAbrirObra && <b className="fichaIr" aria-hidden>›</b>}
                  </button>
                ))}
              </div>

              <div className="fichaRel" ref={refPres}>
                <div className="fichaRelHead"><h3>Presupuestos</h3><span>{presupuestos.length}</span></div>
                {presupuestos.length === 0 ? <p className="fichaVacio">Sin presupuestos.</p> : presupuestos.map((p) => (
                  <button type="button" className="fichaRow" key={p.id} disabled={!onAbrirPresupuesto} onClick={() => onAbrirPresupuesto?.(p.id)}>
                    <div><strong>{p.titulo}</strong><small>{fechaCorta(p.fecha)} · saldo {moneda(p.saldo)}</small></div>
                    <em className={`fichaEstado ${p.estado === 'aceptado' ? 'fin' : p.estado === 'rechazado' ? 'pausa' : 'pendiente'}`}>{p.estado}</em>
                    {onAbrirPresupuesto && <b className="fichaIr" aria-hidden>›</b>}
                  </button>
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
