import { useEffect, useMemo, useState } from 'react'
import DocumentoPresupuesto from './DocumentoPresupuesto'
import {
  generarPdfPresupuesto,
  type DatosPdf,
} from './pdfPresupuesto'
import type { ItemPresupuesto } from './NuevoPresupuesto'

type PresupuestoParaPDF = {
  id: number
  titulo: string
  descripcion?: string | null
  fecha: string
  validez_dias?: number | null
  subtotal: number
  descuento: number
  total: number
  notas?: string | null
  items: ItemPresupuesto[]
}

type Props = {
  presupuesto: PresupuestoParaPDF
  cliente: string
  obra: string
  onCerrar: () => void
}

export default function PresupuestoPDF({
  presupuesto,
  cliente,
  obra,
  onCerrar,
}: Props) {
  const [generando, setGenerando] = useState(true)
  const [archivoUrl, setArchivoUrl] = useState('')
  const [errorPdf, setErrorPdf] = useState('')

  const codigo = `#${presupuesto.id.toString().padStart(4, '0')}`

  const datos = useMemo<DatosPdf>(
    () => ({
      id: presupuesto.id,
      titulo: presupuesto.titulo,
      descripcion: presupuesto.descripcion,
      fecha: presupuesto.fecha,
      validez_dias: presupuesto.validez_dias,
      subtotal: presupuesto.subtotal,
      descuento: presupuesto.descuento,
      total: presupuesto.total,
      notas: presupuesto.notas,
      items: presupuesto.items,
      cliente,
      obra,
    }),
    [presupuesto, cliente, obra],
  )

  useEffect(() => {
    let vigente = true
    let creada = ''
    setGenerando(true); setArchivoUrl(''); setErrorPdf('')
    generarPdfPresupuesto(datos).then(blob => {
      if (!vigente) return
      creada = URL.createObjectURL(blob); setArchivoUrl(creada)
    }).catch(e => { console.error(e); if (vigente) setErrorPdf('No se pudo cargar el documento completo. Volvé a abrirlo para reintentar.') })
      .finally(() => { if (vigente) setGenerando(false) })
    return () => { vigente = false; if (creada) URL.revokeObjectURL(creada) }
  }, [datos])

  function descargar() {
    if (!archivoUrl) return
    const enlace = document.createElement('a')
    enlace.href = archivoUrl
    enlace.download = `Presupuesto-${String(presupuesto.id).padStart(4, '0')}.pdf`
    enlace.click()
  }

  return (
    <div className="pdfPreview">
      <div className="pdfPreviewBar">
        <span>Vista previa del presupuesto {codigo}</span>

        <div>
          <button className="pdfBtnGhost" onClick={onCerrar}>
            Cerrar
          </button>

          <button
            className="pdfBtnPrimary"
            onClick={descargar}
            disabled={generando || !archivoUrl}
          >
            {generando ? 'Generando...' : '⬇ Descargar PDF'}
          </button>
        </div>
      </div>

      <div className="pdfDoc">
        {errorPdf && <p role="alert">{errorPdf}</p>}
        {generando && <p role="status">Preparando documento…</p>}
        {archivoUrl && <DocumentoPresupuesto datos={datos} archivoUrl={archivoUrl} embebido />}
      </div>
    </div>
  )
}
