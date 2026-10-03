import { useEffect, useState } from 'react'
import { listarComprobantesPago, abrirComprobantePago, marcarComprobanteVisto, type ComprobantePago } from './pagoLink'
import { moneda } from './gestionFormat'

// Comprobantes que el cliente adjuntó desde la página de pago.
export default function ComprobantesPago({ presupuestoId, version, onRegistrarCobro }: { presupuestoId: number; version: number; onRegistrarCobro?: () => void }) {
  const [lista, setLista] = useState<ComprobantePago[]>([])
  const [rev, setRev] = useState(0)
  useEffect(() => { void listarComprobantesPago({ presupuestoId }).then(setLista) }, [presupuestoId, version, rev])
  if (!lista.length) return null
  const nuevos = lista.filter((c) => !c.visto).length
  const fecha = (f: string) => new Date(f).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="formasPagoCard compPagoCard">
      <span className="formasPagoIcono">🧾</span>
      <div>
        <small>Comprobantes que envió el cliente</small>
        <b>{nuevos ? `${nuevos} nuevo${nuevos === 1 ? '' : 's'} para revisar` : `${lista.length} recibido${lista.length === 1 ? '' : 's'}`}</b>
        <div className="compPagoLista">
          {lista.map((c) => (
            <div key={c.id} className={`compPagoFila ${c.visto ? '' : 'nuevo'}`}>
              <div>
                <b>{c.visto ? '' : '● '}{fecha(c.creado_at)}{c.monto ? ` · a pagar ${moneda(Number(c.monto))}` : ''}</b>
                {c.nota && <span>“{c.nota}”</span>}
              </div>
              <div className="linkPagoBtns">
                <button type="button" className="editButton" onClick={() => { void abrirComprobantePago(c); if (!c.visto) void marcarComprobanteVisto(c.id).then(() => setRev((v) => v + 1)) }}>👁️ Ver</button>
                {!c.visto && <button type="button" className="editButton" onClick={() => void marcarComprobanteVisto(c.id).then(() => setRev((v) => v + 1))}>✓ Revisado</button>}
                {onRegistrarCobro && <button type="button" className="newButton" onClick={() => { if (!c.visto) void marcarComprobanteVisto(c.id).then(() => setRev((v) => v + 1)); onRegistrarCobro() }}>💵 Registrar cobro</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
