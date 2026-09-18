import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import { compartirPresupuestoPdf } from './pdfPresupuesto'

export type PresupuestoFichaData = {
  id: number
  cliente_id: number
  obra_id: number | null
  titulo: string
  descripcion: string | null
  fecha: string
  validez_dias: number | null
  estado: string
  subtotal: number
  descuento: number
  total: number
  total_pagado: number
  saldo: number
  items: ItemPresupuesto[]
}

type Pago = { id: number; monto: number; fecha: string; medio_pago: string | null }

const ESTADOS = [
  { v: 'borrador', t: 'Borrador' },
  { v: 'enviado', t: 'Enviado' },
  { v: 'aceptado', t: 'Aceptado' },
  { v: 'rechazado', t: 'Rechazado' },
]

const GRUPOS: Record<string, string> = {
  producto: 'Productos y equipos', servicio: 'Servicios', material: 'Materiales', mano_obra: 'Mano de obra', otro: 'Otros',
}

export type DatosObra = { direccion: string; localidad: string; fecha_inicio: string; fecha_fin_estimada: string }

type Props = {
  presupuesto: PresupuestoFichaData
  cliente: string
  obra: string
  convirtiendo?: boolean
  onCerrar: () => void
  onEditar: () => void
  onPDF: () => void
  onCrearObra: (datos: DatosObra) => void
  onCambiarEstado: (nuevo: string) => void
  onEliminar: () => void
}

export default function PresupuestoFicha({ presupuesto, cliente, obra, convirtiendo, onCerrar, onEditar, onPDF, onCrearObra, onCambiarEstado, onEliminar }: Props) {
  const [pagos, setPagos] = useState<Pago[]>([])
  const [cargando, setCargando] = useState(true)
  const [estadoLocal, setEstadoLocal] = useState(presupuesto.estado)
  const [obraForm, setObraForm] = useState<DatosObra>({ direccion: '', localidad: '', fecha_inicio: '', fecha_fin_estimada: '' })
  const codigo = `#${presupuesto.id.toString().padStart(4, '0')}`
  const cambioEstado = estadoLocal !== presupuesto.estado

  const [compartiendo, setCompartiendo] = useState(false)
  async function compartir() {
    setCompartiendo(true)
    try {
      await compartirPresupuestoPdf({
        id: presupuesto.id,
        titulo: presupuesto.titulo,
        descripcion: presupuesto.descripcion,
        fecha: presupuesto.fecha,
        validez_dias: presupuesto.validez_dias,
        subtotal: presupuesto.subtotal,
        descuento: presupuesto.descuento,
        total: presupuesto.total,
        items: presupuesto.items,
        cliente,
        obra,
      })
    } catch (e) {
      console.error(e)
      window.alert('No se pudo generar el PDF para compartir.')
    } finally {
      setCompartiendo(false)
    }
  }

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      const filtros: string[] = [`presupuesto_id.eq.${presupuesto.id}`]
      if (presupuesto.obra_id) filtros.push(`obra_id.eq.${presupuesto.obra_id}`)
      const pg = await supabase.from('pagos').select('id,monto,fecha,medio_pago').or(filtros.join(','))
      setPagos(((pg.data ?? []) as Pago[]).map((x) => ({ ...x, monto: Number(x.monto) })))
      setCargando(false)
    }
    void cargar()
  }, [presupuesto.id, presupuesto.obra_id])

  // Agrupa ítems por tipo
  const grupos: { clave: string; titulo: string; items: ItemPresupuesto[]; subtotal: number }[] = []
  for (const item of presupuesto.items) {
    const clave = item.tipo || 'otro'
    let g = grupos.find((x) => x.clave === clave)
    if (!g) { g = { clave, titulo: GRUPOS[clave] ?? clave, items: [], subtotal: 0 }; grupos.push(g) }
    g.items.push(item)
    g.subtotal += item.cantidad * item.precio_unitario
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard fichaCliente">
        <div className="modalHeader">
          <div>
            <p className="subtitle">PRESUPUESTO {codigo}</p>
            <h2>{presupuesto.titulo}</h2>
          </div>
          <button type="button" className="closeButton" onClick={onCerrar}>×</button>
        </div>

        <div className="fichaBody">
          <div className="fichaAcciones">
            <label className="fichaEstadoSelect">
              Estado
              <select value={estadoLocal} onChange={(e) => setEstadoLocal(e.target.value)}>
                {ESTADOS.map((s) => <option key={s.v} value={s.v}>{s.t}</option>)}
              </select>
            </label>
            {cambioEstado && (
              <button className="newButton" onClick={() => onCambiarEstado(estadoLocal)}>Guardar estado</button>
            )}
            {presupuesto.obra_id && <span className="obraVinculadaTag">✓ Obra vinculada</span>}
            <button className="editButton" onClick={onEditar}>Editar</button>
            <button className="editButton" onClick={onPDF}>📄 PDF</button>
            <button className="editButton" onClick={compartir} disabled={compartiendo}>{compartiendo ? 'Generando PDF...' : '📲 Compartir PDF'}</button>
            <button className="deactivateButton" onClick={onEliminar}>Eliminar</button>
          </div>

          {presupuesto.estado === 'aceptado' && !presupuesto.obra_id && (
            <div className="fichaObraNueva">
              <h3>✅ Presupuesto aceptado — creá la obra</h3>
              <p>Completá los datos y la obra queda vinculada a este presupuesto (hereda cliente, título y monto).</p>
              <div className="formGrid">
                <label>Dirección<input value={obraForm.direccion} onChange={(e) => setObraForm((f) => ({ ...f, direccion: e.target.value }))} placeholder="Dirección de la obra" /></label>
                <label>Localidad<input value={obraForm.localidad} onChange={(e) => setObraForm((f) => ({ ...f, localidad: e.target.value }))} /></label>
                <label>Fecha de inicio<input type="date" value={obraForm.fecha_inicio} onChange={(e) => setObraForm((f) => ({ ...f, fecha_inicio: e.target.value }))} /></label>
                <label>Fecha fin estimada<input type="date" value={obraForm.fecha_fin_estimada} onChange={(e) => setObraForm((f) => ({ ...f, fecha_fin_estimada: e.target.value }))} /></label>
              </div>
              <button className="newButton" disabled={convirtiendo} onClick={() => onCrearObra(obraForm)}>{convirtiendo ? 'Creando obra...' : '🏗️ Crear obra'}</button>
            </div>
          )}

          <div className="fichaKpis">
            <div><span>TOTAL</span><strong>{moneda(presupuesto.total)}</strong></div>
            <div><span>PAGADO</span><strong>{moneda(presupuesto.total_pagado)}</strong></div>
            <div className="alerta"><span>SALDO</span><strong>{moneda(presupuesto.saldo)}</strong></div>
            <div><span>ÍTEMS</span><strong>{presupuesto.items.length}</strong></div>
          </div>

          <div className="fichaContacto">
            <div className="fichaDatos">
              <div><span>Cliente</span><strong>{cliente}</strong></div>
              <div><span>Obra</span><strong>{obra}</strong></div>
              <div><span>Fecha</span><strong>{fechaCorta(presupuesto.fecha)}</strong></div>
              <div><span>Validez</span><strong>{presupuesto.validez_dias ?? 10} días</strong></div>
            </div>
          </div>

          {presupuesto.descripcion && <p className="fichaDescripcion">{presupuesto.descripcion}</p>}

          <div className="fichaRel">
            <div className="fichaRelHead"><h3>Detalle</h3><span>{presupuesto.items.length} ítems</span></div>
            {grupos.length === 0 ? <p className="fichaVacio">Sin ítems.</p> : grupos.map((g) => (
              <div key={g.clave} className="fichaGrupoItems">
                <h4>{g.titulo}</h4>
                {g.items.map((it, i) => (
                  <div className="fichaRow" key={it.id ?? i}>
                    <div><strong>{it.descripcion}</strong><small>{it.cantidad} × {moneda(it.precio_unitario)}</small></div>
                    <b>{moneda(it.cantidad * it.precio_unitario)}</b>
                  </div>
                ))}
              </div>
            ))}
            <div className="fichaTotales">
              <div><span>Subtotal</span><b>{moneda(presupuesto.subtotal)}</b></div>
              {presupuesto.descuento > 0 && <div><span>Bonificación</span><b>− {moneda(presupuesto.descuento)}</b></div>}
              <div><span>Neto gravado</span><b>{moneda(presupuesto.total / 1.21)}</b></div>
              <div><span>IVA (21%) contenido</span><b>{moneda(presupuesto.total - presupuesto.total / 1.21)}</b></div>
              <div className="fichaTotalFinal"><span>Total (IVA incluido)</span><b>{moneda(presupuesto.total)}</b></div>
            </div>
          </div>

          <div className="fichaRel">
            <div className="fichaRelHead"><h3>Cobros</h3><span>{pagos.length}</span></div>
            {cargando ? <p className="fichaVacio">Cargando...</p> : pagos.length === 0 ? <p className="fichaVacio">Sin cobros registrados.</p> : pagos.map((pg) => (
              <div className="fichaRow" key={pg.id}>
                <div><strong>{moneda(pg.monto)}</strong><small>{fechaCorta(pg.fecha)}{pg.medio_pago ? ` · ${pg.medio_pago}` : ''}</small></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
