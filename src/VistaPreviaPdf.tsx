import { useEffect, useRef, useState } from 'react'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Vista previa de un PDF generado en la app, antes de descargarlo o compartirlo.
// Cada página se dibuja como imagen (pdf.js), así se ve igual en la PC y en el
// celular (muchos navegadores de celular no muestran PDFs dentro de la página).

type Props = {
  titulo: string
  /** Genera el PDF. Se llama al abrir y al tocar "Actualizar". */
  generar: () => Promise<{ blob: Blob; nombre: string }>
  onCerrar: () => void
}

export default function VistaPreviaPdf({ titulo, generar, onCerrar }: Props) {
  const [archivo, setArchivo] = useState<{ blob: Blob; nombre: string } | null>(null)
  const [error, setError] = useState('')
  const [compartiendo, setCompartiendo] = useState(false)
  const paginasRef = useRef<HTMLDivElement>(null)

  // 1) Generar el PDF.
  useEffect(() => {
    let vigente = true
    setArchivo(null); setError('')
    generar()
      .then((a) => { if (vigente) setArchivo(a) })
      .catch((e) => { console.error(e); if (vigente) setError('No se pudo generar el PDF. Reintentá.') })
    return () => { vigente = false }
    // Se genera una sola vez al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2) Dibujar sus páginas.
  useEffect(() => {
    if (!archivo || !paginasRef.current) return
    let vigente = true
    const contenedor = paginasRef.current
    contenedor.innerHTML = ''
    ;(async () => {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await archivo.blob.arrayBuffer()), isEvalSupported: false }).promise
      const ancho = Math.min(contenedor.clientWidth || 800, 820)
      const escalaPantalla = window.devicePixelRatio || 1
      for (let n = 1; n <= doc.numPages && vigente; n++) {
        const pagina = await doc.getPage(n)
        const base = pagina.getViewport({ scale: 1 })
        const vista = pagina.getViewport({ scale: (ancho / base.width) * escalaPantalla })
        const canvas = document.createElement('canvas')
        canvas.width = vista.width
        canvas.height = vista.height
        canvas.style.width = `${ancho}px`
        canvas.className = 'vpPagina'
        contenedor.appendChild(canvas)
        await pagina.render({ canvasContext: canvas.getContext('2d')!, viewport: vista }).promise
      }
    })().catch((e) => { console.error(e); if (vigente) setError('El PDF se generó, pero no se pudo mostrar la vista previa. Podés descargarlo igual.') })
    return () => { vigente = false }
  }, [archivo])

  function descargar() {
    if (!archivo) return
    const url = URL.createObjectURL(archivo.blob)
    const a = document.createElement('a'); a.href = url; a.download = archivo.nombre; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  async function compartir() {
    if (!archivo) return
    setCompartiendo(true)
    try {
      const file = new File([archivo.blob], archivo.nombre, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] }) && navigator.share) await navigator.share({ files: [file], title: titulo })
      else descargar()
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) window.alert('No se pudo compartir. Usá Descargar.')
    } finally { setCompartiendo(false) }
  }

  return <div className="pdfPreview" role="dialog" aria-label={`Vista previa: ${titulo}`}>
    <div className="pdfPreviewBar vpBarra">
      <span>{titulo}</span>
      <div>
        <button type="button" className="pdfBtnGhost" onClick={onCerrar}>Cerrar</button>
        <button type="button" className="pdfBtnPrimary" disabled={!archivo} onClick={descargar}>Descargar</button>
        <button type="button" className="pdfBtnPrimary" disabled={!archivo || compartiendo} onClick={() => void compartir()}>Compartir</button>
      </div>
    </div>
    {error && <p className="vpMensaje" role="alert">{error}</p>}
    {!archivo && !error && <p className="vpMensaje" role="status">Generando PDF…</p>}
    <div className="vpPaginas" ref={paginasRef} />
  </div>
}
