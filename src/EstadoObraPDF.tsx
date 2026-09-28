import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { generarPdfPresupuesto, type DatosPdf } from './pdfPresupuesto'
import { cargarResumenModificaciones } from './presupuestoModificaciones'
import { normalizarSoluciones } from './presupuestoSoluciones'
import DocumentoPresupuesto from './DocumentoPresupuesto'
import type { ItemPresupuesto } from './NuevoPresupuesto'

type Props = { obra: { id: number; nombre_obra: string }; cliente: string; onCerrar: () => void }
export default function EstadoObraPDF({ obra, cliente, onCerrar }: Props) {
  const [listo, setListo] = useState<{ datos: DatosPdf; url: string; blob: Blob } | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [compartiendo, setCompartiendo] = useState(false)
  useEffect(() => {
    let vigente = true
    let url = ''
    setListo(null); setError('')
    async function cargar() {
      const r = await supabase.from('presupuestos').select('*').eq('obra_id', obra.id).eq('estado', 'aceptado').order('id')
      if (r.error) throw r.error
      const p = r.data?.find(p => p.activo !== false)
      if (!p) throw new Error('Esta obra no tiene un presupuesto aceptado activo. Vinculá uno para generar el documento.')
      const it = await supabase.from('presupuesto_items').select('*').eq('presupuesto_id', p.id).order('orden')
      if (it.error) throw it.error
      const resumen = await cargarResumenModificaciones(Number(p.id), Number(p.total))
      if (!resumen) throw new Error('El presupuesto cambió de estado. Actualizá y volvé a intentar.')
      const datos: DatosPdf = { ...p, id: Number(p.id), total: Number(p.total), subtotal: Number(p.subtotal), descuento: Number(p.descuento),
        items: (it.data ?? []).map(i => ({ ...i, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario), costo_unitario: Number(i.costo_unitario || 0), descuento_pct: Number(i.descuento_pct || 0) })) as ItemPresupuesto[],
        cliente, obra: obra.nombre_obra, resumen, soluciones: normalizarSoluciones(p.soluciones) }
      const blob = await generarPdfPresupuesto(datos)
      if (!vigente) return
      url = URL.createObjectURL(blob); setListo({ datos, url, blob })
    }
    void cargar().catch(e => { console.error(e); if (vigente) setError(e instanceof Error ? e.message : 'No se pudo cargar el documento completo. Reintentá.') })
    return () => { vigente = false; if (url) URL.revokeObjectURL(url) }
  }, [obra.id, obra.nombre_obra, cliente, revision])
  const nombre = `Estado-obra-${String(obra.id).padStart(4, '0')}.pdf`
  function descargar() {
    if (!listo) return
    const a = document.createElement('a'); a.href = listo.url; a.download = nombre; a.click()
  }
  async function compartir() {
    if (!listo) return
    setCompartiendo(true)
    try {
      const file = new File([listo.blob], nombre, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] }) && navigator.share) await navigator.share({ files: [file], title: `Estado de obra · ${obra.nombre_obra}` })
      else descargar()
    } catch(e) { if (!(e instanceof Error && e.name === 'AbortError')) window.alert('No se pudo compartir. Usá Descargar PDF.') }
    finally { setCompartiendo(false) }
  }
  return <div className="pdfPreview">
    <div className="pdfPreviewBar"><span>Estado de obra · {obra.nombre_obra}</span><div>
      <button className="pdfBtnGhost" onClick={onCerrar}>Cerrar</button>
      <button className="pdfBtnGhost" onClick={() => setRevision(v => v + 1)}>Actualizar</button>
      <button className="pdfBtnPrimary" disabled={!listo} onClick={descargar}>Descargar PDF</button>
      <button className="pdfBtnPrimary" disabled={!listo || compartiendo} onClick={() => void compartir()}>Compartir</button>
    </div></div>
    <div className="pdfDoc">{error ? <p role="alert">{error}</p> : listo ? <DocumentoPresupuesto datos={listo.datos} archivoUrl={listo.url} embebido /> : <p role="status">Cargando presupuesto, pagos y avances…</p>}</div>
  </div>
}
