import { useMemo, useState } from 'react'
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
  const [generando, setGenerando] = useState(false)

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

  // Descarga el mismo archivo PDF que la ficha (Descargar / Compartir).
  async function descargar() {
    if (generando) return

    setGenerando(true)

    try {
      const blob = await generarPdfPresupuesto(datos)
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')

      enlace.href = url
      enlace.download = `Presupuesto-${String(presupuesto.id).padStart(4, '0')}.pdf`
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()

      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (error) {
      console.error(error)
      window.alert('No se pudo generar el PDF.')
    } finally {
      setGenerando(false)
    }
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
            disabled={generando}
          >
            {generando ? 'Generando...' : '⬇ Descargar PDF'}
          </button>
        </div>
      </div>

      <div className="pdfDoc">
        <DocumentoPresupuesto datos={datos} embebido />
      </div>
    </div>
  )
}
