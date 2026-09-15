import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'

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
type Pago = { id: number; monto: number; fecha: string; medio_pago: string | null }

type Props = {
  cliente: ClienteFichaData
  onCerrar: () => void
  onEditar: () => void
  onNuevaObra: () => void
}

const claseEstadoObra = (e: string | null) =>
  e === 'Finalizada' ? 'fin' : e === 'En ejecución' ? 'ejecucion' : e === 'Pausada' ? 'pausa' : 'pendiente'

export default function ClienteFicha({ cliente, onCerrar, onEditar, onNuevaObra }: Props) {
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
        const pg = await supabase.from('pagos').select('id,monto,fecha,medio_pago').or(filtros.join(','))
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

  const telDigits = (cliente.telefono || '').replace(/\D/g, '')
  const waLink = telDigits ? `https://wa.me/${telDigits.startsWith('54') ? telDigits : '549' + telDigits}` : ''

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
            <div><span>OBRAS</span><strong>{obras.length}</strong></div>
            <div><span>CONTRATADO</span><strong>{moneda(contratado)}</strong></div>
            <div><span>COBRADO</span><strong>{moneda(cobrado)}</strong></div>
            <div className="alerta"><span>SALDO</span><strong>{moneda(saldo)}</strong></div>
          </div>

          {cargando ? <p style={{ color: 'var(--mova-muted)' }}>Cargando información del cliente...</p> : (
            <div className="fichaRelaciones">
              <div className="fichaRel">
                <div className="fichaRelHead"><h3>Obras</h3><span>{obras.length}</span></div>
                {obras.length === 0 ? <p className="fichaVacio">Sin obras.</p> : obras.map((o) => (
                  <div className="fichaRow" key={o.id}>
                    <div><strong>{o.nombre_obra}</strong><small>{Number(o.porcentaje_avance || 0)}% de avance</small></div>
                    <em className={`fichaEstado ${claseEstadoObra(o.estado)}`}>{o.estado || 'Pendiente'}</em>
                  </div>
                ))}
              </div>

              <div className="fichaRel">
                <div className="fichaRelHead"><h3>Presupuestos</h3><span>{presupuestos.length}</span></div>
                {presupuestos.length === 0 ? <p className="fichaVacio">Sin presupuestos.</p> : presupuestos.map((p) => (
                  <div className="fichaRow" key={p.id}>
                    <div><strong>{p.titulo}</strong><small>{fechaCorta(p.fecha)} · saldo {moneda(p.saldo)}</small></div>
                    <em className={`fichaEstado ${p.estado === 'aceptado' ? 'fin' : p.estado === 'rechazado' ? 'pausa' : 'pendiente'}`}>{p.estado}</em>
                  </div>
                ))}
              </div>

              <div className="fichaRel">
                <div className="fichaRelHead"><h3>Cobros</h3><span>{pagos.length}</span></div>
                {pagos.length === 0 ? <p className="fichaVacio">Sin cobros registrados.</p> : pagos.map((pg) => (
                  <div className="fichaRow" key={pg.id}>
                    <div><strong>{moneda(pg.monto)}</strong><small>{fechaCorta(pg.fecha)}{pg.medio_pago ? ` · ${pg.medio_pago}` : ''}</small></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
