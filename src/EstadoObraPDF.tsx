import { useEffect, useState } from 'react'
import { generarPdfPresupuesto, nombreArchivoPresupuesto, leerModoComprobantes, type DatosPdf } from './pdfPresupuesto'
import { cargarDocumentoObra } from './documentoObra'
import { asegurarLinkPago } from './pagoLink'
import DocumentoPresupuesto from './DocumentoPresupuesto'

// Vista del documento del cliente (presupuesto aceptado + estado de obra), tal
// como lo recibe el cliente. Las ediciones y envíos están en la pantalla de la obra.
type Props = { obra: { id: number; nombre_obra: string }; cliente: string; onCerrar: () => void }

export default function EstadoObraPDF({ obra, cliente, onCerrar }: Props) {
  const [listo, setListo] = useState<{ datos: DatosPdf; url: string; blob: Blob } | null>(null)
  const [error, setError] = useState('')
  const [compartiendo, setCompartiendo] = useState(false)

  useEffect(() => {
    let vigente = true
    let url = ''
    setListo(null); setError('')
    async function cargar() {
      const datos = await cargarDocumentoObra(obra, cliente)
      const linkPago = await asegurarLinkPago(datos)
      const blob = await generarPdfPresupuesto(datos, { comprobantes: leerModoComprobantes(), linkPago })
      if (!vigente) return
      url = URL.createObjectURL(blob)
      setListo({ datos, url, blob })
    }
    void cargar().catch((e) => { console.error(e); if (vigente) setError(e instanceof Error ? e.message : 'No se pudo cargar el documento completo. Reintentá.') })
    return () => { vigente = false; if (url) URL.revokeObjectURL(url) }
  }, [obra.id, obra.nombre_obra, cliente])

  const nombre = nombreArchivoPresupuesto({ id: listo?.datos.id ?? obra.id, cliente, obra: obra.nombre_obra })

  function descargar() {
    if (!listo) return
    const a = document.createElement('a'); a.href = listo.url; a.download = nombre; a.click()
  }

  async function compartir() {
    if (!listo) return
    setCompartiendo(true)
    try {
      const file = new File([listo.blob], nombre, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] }) && navigator.share) await navigator.share({ files: [file], title: `Presupuesto y estado de obra · ${obra.nombre_obra}` })
      else descargar()
    } catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) window.alert('No se pudo compartir. Usá Descargar.') }
    finally { setCompartiendo(false) }
  }

  return <div className="pdfPreview">
    <div className="pdfPreviewBar docBarra">
      <button className="pdfBtnGhost" onClick={onCerrar}>← Volver</button>
      <span>{obra.nombre_obra}</span>
      <button className="pdfBtnPrimary docBarraBtn" disabled={!listo || compartiendo} onClick={() => void compartir()}>📲 Compartir</button>
    </div>
    <div className="pdfDoc">
      {error ? <p role="alert">{error}</p> : listo ? <DocumentoPresupuesto datos={listo.datos} embebido /> : <p role="status">Cargando presupuesto, pagos y avances…</p>}
    </div>
  </div>
}
