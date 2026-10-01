import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { completarDatosDocumento, generarPdfPresupuesto, nombreArchivoPresupuesto, leerModoComprobantes, guardarModoComprobantes, type DatosPdf, type ModoComprobantes } from './pdfPresupuesto'
import { normalizarSoluciones } from './presupuestoSoluciones'
import DocumentoPresupuesto from './DocumentoPresupuesto'
import type { ItemPresupuesto } from './NuevoPresupuesto'

// Estado de la obra: es el mismo documento del presupuesto aceptado,
// con pagos, avances, modificaciones y línea de tiempo.
type Props = { obra: { id: number; nombre_obra: string }; cliente: string; onCerrar: () => void }

export default function EstadoObraPDF({ obra, cliente, onCerrar }: Props) {
  const [listo, setListo] = useState<{ datos: DatosPdf; url: string; blob: Blob } | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [compartiendo, setCompartiendo] = useState(false)
  const [modoComp, setModoComp] = useState<ModoComprobantes>(leerModoComprobantes)
  const [avisoComp, setAvisoComp] = useState('')
  const [hayComprobantes, setHayComprobantes] = useState(false)
  useEffect(() => { if (listo) setHayComprobantes(!!listo.datos.estado?.gastosExtra.some((g) => g.comprobante)) }, [listo])

  useEffect(() => {
    let vigente = true
    let url = ''
    setListo(null); setError('')
    async function cargar() {
      const r = await supabase.from('presupuestos').select('*').eq('obra_id', obra.id).eq('estado', 'aceptado').order('id')
      if (r.error) throw r.error
      const p = r.data?.find((x) => x.activo !== false)
      if (!p) throw new Error('Esta obra no tiene un presupuesto aceptado activo. Vinculá uno para generar el documento.')
      const it = await supabase.from('presupuesto_items').select('*').eq('presupuesto_id', p.id).order('orden')
      if (it.error) throw it.error
      const base: DatosPdf = {
        id: Number(p.id), titulo: p.titulo, descripcion: p.descripcion ?? null, fecha: p.fecha,
        validez_dias: p.validez_dias ?? null, notas: p.notas ?? null, total: Number(p.total), subtotal: Number(p.subtotal), descuento: Number(p.descuento),
        items: (it.data ?? []).map((i) => ({ ...i, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario), costo_unitario: Number(i.costo_unitario || 0), descuento_pct: Number(i.descuento_pct || 0) })) as ItemPresupuesto[],
        cliente, obra: obra.nombre_obra, soluciones: normalizarSoluciones(p.soluciones),
      }
      const datos = await completarDatosDocumento(base)
      setAvisoComp('')
      const blob = await generarPdfPresupuesto(datos, { comprobantes: modoComp, onAviso: setAvisoComp })
      if (!vigente) return
      url = URL.createObjectURL(blob)
      setListo({ datos, url, blob })
    }
    void cargar().catch((e) => { console.error(e); if (vigente) setError(e instanceof Error ? e.message : 'No se pudo cargar el documento completo. Reintentá.') })
    return () => { vigente = false; if (url) URL.revokeObjectURL(url) }
  }, [obra.id, obra.nombre_obra, cliente, revision, modoComp])

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
      if (navigator.canShare?.({ files: [file] }) && navigator.share) await navigator.share({ files: [file], title: `Estado de obra · ${obra.nombre_obra}` })
      else descargar()
    } catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) window.alert('No se pudo compartir. Usá Descargar PDF.') }
    finally { setCompartiendo(false) }
  }

  return <div className="pdfPreview">
    <div className="pdfPreviewBar"><span>Presupuesto y estado de obra · {obra.nombre_obra}</span><div>
      <button className="pdfBtnGhost" onClick={onCerrar}>Cerrar</button>
      <button className="pdfBtnGhost" onClick={() => setRevision((v) => v + 1)}>Actualizar</button>
      {hayComprobantes && (
        <label className="pdfCheck" title={avisoComp || undefined}>📎 <select value={modoComp} onChange={(e) => { const m = e.target.value as ModoComprobantes; setModoComp(m); guardarModoComprobantes(m) }}>
          <option value="boton">Botón de descarga</option>
          <option value="anexo">Adjuntar al final</option>
          <option value="no">Sin comprobantes</option>
        </select></label>
      )}
      <button className="pdfBtnPrimary" disabled={!listo} onClick={descargar}>Descargar PDF</button>
      <button className="pdfBtnPrimary" disabled={!listo || compartiendo} onClick={() => void compartir()}>Compartir</button>
    </div></div>
    <div className="pdfDoc">{error ? <p role="alert">{error}</p> : listo ? <DocumentoPresupuesto datos={listo.datos} embebido /> : <p role="status">Cargando presupuesto, pagos y avances…</p>}</div>
  </div>
}
