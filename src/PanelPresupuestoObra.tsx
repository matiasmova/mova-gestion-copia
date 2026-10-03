import { useEffect, useState } from 'react'
import { generarPdfPresupuesto, nombreArchivoPresupuesto, leerModoComprobantes, guardarModoComprobantes, type DatosPdf, type ModoComprobantes } from './pdfPresupuesto'
import { cargarDocumentoObra, itemsParaMercado } from './documentoObra'
import RecomendacionesUso from './RecomendacionesUso'
import FormasPagoEditor from './FormasPagoEditor'
import CompararMercado, { type ProductoAComparar } from './CompararMercado'
import { linkWhatsApp, mensajeEstadoObra } from './whatsapp'
import { codigoPresupuesto } from './codigoPresupuesto'
import { asegurarLinkPago, estadoLinkPago, activarLinkPago } from './pagoLink'
import { configActual } from './config'
import ComprobantesPago from './ComprobantesPago'

// Todo lo del presupuesto y el documento del cliente, en la pantalla de la obra:
// enviar (PDF / WhatsApp), ver, editar, formas de pago, comprobantes, formas de
// uso y comparar con el mercado. El PDF se arma de antemano para compartir al toque.
type Props = {
  obra: { id: number; nombre_obra: string }
  cliente: string
  version: number
  onVerDocumento: () => void
  onEditarPresupuesto?: (presupuestoId: number) => void
  onRegistrarCobro?: () => void
}

export default function PanelPresupuestoObra({ obra, cliente, version, onVerDocumento, onEditarPresupuesto, onRegistrarCobro }: Props) {
  const [linkPago, setLinkPago] = useState<string | null>(null)
  const [linkInfo, setLinkInfo] = useState<{ token: string; activo: boolean } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [datos, setDatos] = useState<DatosPdf | null>(null)
  const [pdf, setPdf] = useState<{ blob: Blob; url: string } | null>(null)
  const [revision, setRevision] = useState(0)
  const [modoComp, setModoComp] = useState<ModoComprobantes>(leerModoComprobantes)
  const [avisoComp, setAvisoComp] = useState('')
  const [compartiendo, setCompartiendo] = useState(false)
  const [mercado, setMercado] = useState<ProductoAComparar[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    let url = ''
    setPdf(null); setError('')
    async function preparar() {
      const d = await cargarDocumentoObra(obra, cliente)
      if (!vigente) return
      setDatos(d)
      setAvisoComp('')
      const link = await asegurarLinkPago(d)
      if (!vigente) return
      setLinkPago(link)
      setLinkInfo(await estadoLinkPago(d.id))
      const blob = await generarPdfPresupuesto(d, { comprobantes: modoComp, onAviso: setAvisoComp, linkPago: link })
      if (!vigente) return
      url = URL.createObjectURL(blob)
      setPdf({ blob, url })
    }
    void preparar().catch((e) => { console.error(e); if (vigente) setError(e instanceof Error ? e.message : 'No se pudo preparar el documento.') })
    return () => { vigente = false; if (url) URL.revokeObjectURL(url) }
  }, [obra.id, obra.nombre_obra, cliente, version, revision, modoComp]) // eslint-disable-line react-hooks/exhaustive-deps

  const nombre = nombreArchivoPresupuesto({ id: datos?.id ?? obra.id, cliente, obra: obra.nombre_obra })
  function descargar() {
    if (!pdf) return
    const a = document.createElement('a'); a.href = pdf.url; a.download = nombre; a.click()
  }
  async function compartir() {
    if (!pdf) return
    setCompartiendo(true)
    try {
      const file = new File([pdf.blob], nombre, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] }) && navigator.share) await navigator.share({ files: [file], title: `Presupuesto y estado de obra · ${obra.nombre_obra}` })
      else descargar()
    } catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) window.alert('No se pudo compartir. Usá Descargar.') }
    finally { setCompartiendo(false) }
  }

  if (error) return <p className="loginError" style={{ margin: '8px 0 0' }}>{error}</p>
  const linkWa = datos ? linkWhatsApp(datos.contacto?.telefono ?? null, mensajeEstadoObra({ cliente, obra: obra.nombre_obra, codigo: codigoPresupuesto(datos.id), linkPago })) : null
  const hayComprobantes = !!datos?.estado?.gastosExtra.some((g) => g.comprobante)
  const refrescar = () => setRevision((v) => v + 1)

  return (
    <div className="panelPresu">
      <div className="docAcciones">
        <button type="button" className="newButton" disabled={!pdf || compartiendo} onClick={() => void compartir()}>{!pdf ? 'Preparando PDF…' : compartiendo ? 'Compartiendo…' : '📲 Compartir PDF'}</button>
        {linkWa ? <a className="newButton docWa" href={linkWa} target="_blank" rel="noreferrer">💬 WhatsApp</a> : <button type="button" className="newButton docWa" disabled title="El cliente no tiene teléfono cargado">💬 WhatsApp</button>}
        <button type="button" className="editButton" onClick={onVerDocumento}>👁️ Ver documento</button>
        <button type="button" className="editButton" disabled={!pdf} onClick={descargar}>⬇ Descargar</button>
      </div>
      <small className="docAyuda">WhatsApp abre el chat del cliente con el mensaje listo{linkPago ? ' y el link para pagar' : ''}; el PDF lo adjuntás con Compartir PDF.</small>

      {/* Link de pago para el cliente (transferencia / efectivo, sin comisiones) */}
      <div className="formasPagoCard linkPagoCard">
        <span className="formasPagoIcono">💳</span>
        <div>
          <small>Link de pago para el cliente</small>
          {linkPago ? <b>Activo · también va como botón "Pagar" en el PDF{!(configActual().empresa.alias || configActual().empresa.cbu) && <span className="linkPagoFalta">Falta tu alias o CBU (Configuración → Empresa): sin eso el cliente no ve los datos para transferir.</span>}</b>
            : linkInfo && !linkInfo.activo ? <b>Desactivado</b>
            : <span>{!(configActual().empresa.alias || configActual().empresa.cbu) ? 'Cargá tu alias o CBU en Configuración → Empresa para activarlo.' : 'Corré en Supabase el SQL "supabase-pago-links-fase-23.sql" para activarlo.'}</span>}
          <div className="linkPagoBtns">
            {linkPago && <button type="button" className="editButton" onClick={() => { const ok = () => { setCopiado(true); window.setTimeout(() => setCopiado(false), 1600) }; if (navigator.clipboard) void navigator.clipboard.writeText(linkPago).then(ok, ok); else ok() }}>{copiado ? '✓ Copiado' : '🔗 Copiar link'}</button>}
            {linkPago && <a className="editButton" href={linkPago} target="_blank" rel="noreferrer">👁️ Ver</a>}
            {linkInfo && datos && <button type="button" className="editButton" onClick={() => void activarLinkPago(datos.id, !linkInfo.activo).then(refrescar)}>{linkInfo.activo ? '⏸ Desactivar' : '▶ Activar'}</button>}
            {onRegistrarCobro && <button type="button" className="newButton" onClick={onRegistrarCobro}>💵 Registrar cobro</button>}
          </div>
        </div>
      </div>

      {datos && <ComprobantesPago presupuestoId={datos.id} version={version + revision} onRegistrarCobro={onRegistrarCobro} />}

      {datos && onEditarPresupuesto && (
        <button type="button" className="presuMercadoBtn docEditar" onClick={() => onEditarPresupuesto(datos.id)}>
          <span>✏️</span><span><b>Editar presupuesto</b><small>Ítems, precios, descuentos y textos</small></span><b>›</b>
        </button>
      )}
      {datos && <FormasPagoEditor presupuestoId={datos.id} onGuardado={refrescar} />}
      {hayComprobantes && (
        <label className="formasPagoCard docComprobantes" title={avisoComp || undefined}>
          <span className="formasPagoIcono">📎</span>
          <div><small>Comprobantes de gastos en el PDF</small><select value={modoComp} onChange={(e) => { const m = e.target.value as ModoComprobantes; setModoComp(m); guardarModoComprobantes(m) }}>
            <option value="boton">Botón "Descargar factura"</option>
            <option value="anexo">Adjuntarlos al final</option>
            <option value="no">No incluirlos</option>
          </select>{avisoComp && <span>{avisoComp}</span>}</div>
        </label>
      )}
      {datos && <RecomendacionesUso presupuestoId={datos.id} titulo={datos.titulo} descripcion={datos.descripcion ?? null} items={datos.items} onGuardado={refrescar} />}
      {datos && datos.items.length > 0 && (
        <button type="button" className="presuMercadoBtn" onClick={() => setMercado(itemsParaMercado(datos))}>
          <span>💲</span><span><b>¿Cómo estoy en el mercado?</b><small>Solo para vos: la IA compara productos y mano de obra con el mercado</small></span><b>›</b>
        </button>
      )}
      {mercado && datos && <CompararMercado titulo={datos.titulo} productos={mercado} total={Number(datos.total)} onCerrar={() => setMercado(null)} />}
    </div>
  )
}
