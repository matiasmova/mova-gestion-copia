import { useEffect, useState } from 'react'
import { generarPdfPresupuesto, type DatosPdf } from './pdfPresupuesto'

type Props = { datos: DatosPdf; embebido?: boolean; archivoUrl?: string }
export default function DocumentoPresupuesto({ datos, embebido = false, archivoUrl }: Props) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (archivoUrl) return
    let vigente = true
    let creada = ''
    setUrl(''); setError('')
    generarPdfPresupuesto(datos).then(blob => {
      if (!vigente) return
      creada = URL.createObjectURL(blob); setUrl(creada)
    }).catch(e => { console.error(e); if (vigente) setError('No se pudo cargar el documento completo. Volvé a abrirlo para reintentar.') })
    return () => { vigente = false; if (creada) URL.revokeObjectURL(creada) }
  }, [datos, archivoUrl])
  const vista = archivoUrl || url
  return <section style={{ marginTop: embebido ? 0 : 20 }} aria-label="Vista previa del documento">
    {error && <p role="alert">{error}</p>}
    {!vista && !error && <p role="status">Preparando documento completo…</p>}
    {vista && <>
      <p><a href={vista} target="_blank" rel="noreferrer">Abrir documento en pantalla completa</a></p>
      <iframe title="Presupuesto y estado de obra" src={vista} style={{ width: '100%', height: 'min(1000px, 80vh)', minHeight: 500, border: '1px solid #e2e5e9', background: '#fff' }} />
    </>}
  </section>
}
