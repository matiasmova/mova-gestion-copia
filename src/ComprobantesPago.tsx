import { useEffect, useState } from 'react'
import { listarComprobantesPago, abrirComprobantePago, descargarComprobantePago, eliminarComprobantePago, guardarComprobanteManual, marcarComprobanteVisto, type ComprobantePago } from './pagoLink'
import { moneda } from './gestionFormat'
import { avisoGuardado } from './Animados'

// Carpeta de comprobantes de pago del trabajo: los que manda el cliente desde la
// página de pago y los que guardás vos (por ejemplo, los que llegan por WhatsApp).
type Props = {
  presupuestoId: number
  obraId: number | null
  cliente: string
  titulo: string
  version: number
  onRegistrarCobro?: () => void
}

export default function ComprobantesPago({ presupuestoId, obraId, cliente, titulo, version, onRegistrarCobro }: Props) {
  const [lista, setLista] = useState<ComprobantePago[]>([])
  const [rev, setRev] = useState(0)
  const [abierta, setAbierta] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void listarComprobantesPago({ presupuestoId }).then((l) => { setLista(l); if (l.some((c) => !c.visto)) setAbierta(true) }) }, [presupuestoId, version, rev])
  const recargar = () => setRev((v) => v + 1)
  const nuevos = lista.filter((c) => !c.visto).length
  const fecha = (f: string) => new Date(f).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  const visto = (c: ComprobantePago) => { if (!c.visto) void marcarComprobanteVisto(c.id).then(recargar) }

  async function subir(archivo: File | undefined) {
    if (!archivo) return
    setSubiendo(true); setError('')
    const err = await guardarComprobanteManual({ presupuestoId, obraId, cliente, titulo }, archivo, '')
    setSubiendo(false)
    if (err) setError(err); else { avisoGuardado('Comprobante guardado'); setAbierta(true); recargar() }
  }

  return (
    <div className={`formasPagoCard compPagoCard ${nuevos ? 'conNuevos' : ''}`}>
      <span className="formasPagoIcono">🗂️</span>
      <div>
        <small>Comprobantes de pago</small>
        <button type="button" className="compPagoCab" onClick={() => setAbierta(!abierta)}>
          <b>{nuevos ? `🔔 ${nuevos} nuevo${nuevos === 1 ? '' : 's'} del cliente para revisar` : lista.length ? `${lista.length} guardado${lista.length === 1 ? '' : 's'}` : 'Todavía no hay comprobantes'}</b>
          {lista.length > 0 && <span>{abierta ? 'Ocultar' : 'Ver todos'}</span>}
        </button>
        {abierta && lista.length > 0 && (
          <div className="compPagoLista">
            {lista.map((c) => (
              <div key={c.id} className={`compPagoFila ${c.visto ? '' : 'nuevo'}`}>
                <div>
                  <b>{c.visto ? '' : '● '}{fecha(c.creado_at)}{c.monto ? ` · a pagar ${moneda(Number(c.monto))}` : ''}</b>
                  <span>{c.origen === 'manual' ? 'Guardado por vos' : 'Enviado por el cliente'}{c.nombre_archivo ? ` · ${c.nombre_archivo}` : ''}</span>
                  {c.nota && <span>“{c.nota}”</span>}
                </div>
                <div className="linkPagoBtns">
                  <button type="button" className="editButton" onClick={() => { void abrirComprobantePago(c); visto(c) }}>👁️ Ver</button>
                  <button type="button" className="editButton" onClick={() => void descargarComprobantePago(c)}>⬇ Descargar</button>
                  {!c.visto && <button type="button" className="editButton" onClick={() => visto(c)}>✓ Revisado</button>}
                  {onRegistrarCobro && <button type="button" className="newButton" onClick={() => { visto(c); onRegistrarCobro() }}>💵 Registrar cobro</button>}
                  <button type="button" className="editButton compPagoBorrar" title="Eliminar" aria-label="Eliminar comprobante" onClick={() => { if (window.confirm('¿Eliminar este comprobante? No se puede deshacer.')) void eliminarComprobantePago(c).then(recargar) }}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <label className="editButton compPagoSubir">
          <input type="file" accept="image/*,application/pdf" disabled={subiendo} onChange={(e) => { void subir(e.target.files?.[0]); e.target.value = '' }} />
          {subiendo ? 'Subiendo…' : '＋ Guardar un comprobante'}
        </label>
        {error && <span className="linkPagoFalta">{error}</span>}
      </div>
    </div>
  )
}
