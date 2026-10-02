import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { completarDatosDocumento, generarPdfPresupuesto, nombreArchivoPresupuesto, leerModoComprobantes, guardarModoComprobantes, type DatosPdf, type ModoComprobantes } from './pdfPresupuesto'
import { normalizarSoluciones } from './presupuestoSoluciones'
import DocumentoPresupuesto from './DocumentoPresupuesto'
import RecomendacionesUso from './RecomendacionesUso'
import FormasPagoEditor from './FormasPagoEditor'
import CompararMercado, { type ProductoAComparar } from './CompararMercado'
import { importeNeto } from './presupuestoCalculos'
import { linkWhatsApp, mensajeEstadoObra } from './whatsapp'
import { codigoPresupuesto } from './codigoPresupuesto'
import type { ItemPresupuesto } from './NuevoPresupuesto'

// Estado de la obra: es el mismo documento del presupuesto aceptado,
// con pagos, avances, modificaciones y línea de tiempo.
type Props = { obra: { id: number; nombre_obra: string }; cliente: string; onCerrar: () => void; onEditarPresupuesto?: (presupuestoId: number) => void }

export default function EstadoObraPDF({ obra, cliente, onCerrar, onEditarPresupuesto }: Props) {
  const [listo, setListo] = useState<{ datos: DatosPdf; url: string; blob: Blob } | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [compartiendo, setCompartiendo] = useState(false)
  const [modoComp, setModoComp] = useState<ModoComprobantes>(leerModoComprobantes)
  const [avisoComp, setAvisoComp] = useState('')
  const [hayComprobantes, setHayComprobantes] = useState(false)
  const [mercado, setMercado] = useState<ProductoAComparar[] | null>(null)
  function compararMercado() {
    if (!listo) return
    const d = listo.datos
    const neto = d.items.reduce((t, it) => t + importeNeto(it), 0)
    const factor = neto > 0 ? Number(d.total) / neto : 1
    setMercado(d.items.filter((it) => it.descripcion.trim() && Number(it.cantidad) > 0).slice(0, 24).map((it) => ({
      id: it.catalogo_id ? Number(it.catalogo_id) : null, nombre: it.descripcion.split('\n')[0].trim(), tipo: it.tipo,
      cantidad: Number(it.cantidad), costo: Number(it.costo_unitario) || 0,
      precio: Math.round((importeNeto(it) / Number(it.cantidad)) * factor * 100) / 100,
    })))
  }
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

  const linkWa = listo ? linkWhatsApp(listo.datos.contacto?.telefono ?? null, mensajeEstadoObra({ cliente, obra: obra.nombre_obra, codigo: codigoPresupuesto(listo.datos.id) })) : null

  return <div className="pdfPreview">
    <div className="pdfPreviewBar docBarra">
      <button className="pdfBtnGhost" onClick={onCerrar}>← Volver</button>
      <span>📄 Documento del cliente · {obra.nombre_obra}</span>
    </div>
    {mercado && listo && <CompararMercado titulo={listo.datos.titulo} productos={mercado} total={Number(listo.datos.total)} onCerrar={() => setMercado(null)} />}
    <div className="pdfDoc">
      {listo && (
        <div className="pdfRecos docPanel">
          {/* Enviar el documento */}
          <div className="docAcciones">
            <button type="button" className="newButton" disabled={compartiendo} onClick={() => void compartir()}>{compartiendo ? 'Compartiendo…' : '📲 Compartir PDF'}</button>
            {linkWa && <a className="newButton docWa" href={linkWa} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
            <button type="button" className="editButton" onClick={descargar}>⬇ Descargar</button>
            <button type="button" className="editButton" onClick={() => setRevision((v) => v + 1)}>↻ Actualizar</button>
          </div>
          {linkWa && <small className="docAyuda">WhatsApp abre el chat con el mensaje listo; el PDF lo adjuntás con Compartir PDF.</small>}

          {/* Lo que ve el cliente */}
          <div className="docGrupo">Lo que ve el cliente</div>
          {onEditarPresupuesto && (
            <button type="button" className="presuMercadoBtn docEditar" onClick={() => onEditarPresupuesto(listo.datos.id)}>
              <span>✏️</span><span><b>Editar presupuesto</b><small>Ítems, precios, descuentos y textos</small></span><b>›</b>
            </button>
          )}
          <FormasPagoEditor presupuestoId={listo.datos.id} onGuardado={() => setRevision((v) => v + 1)} />
          {hayComprobantes && (
            <label className="formasPagoCard docComprobantes" title={avisoComp || undefined}>
              <span className="formasPagoIcono">📎</span>
              <div><small>Comprobantes de gastos</small><select value={modoComp} onChange={(e) => { const m = e.target.value as ModoComprobantes; setModoComp(m); guardarModoComprobantes(m) }}>
                <option value="boton">Botón "Descargar factura" en el PDF</option>
                <option value="anexo">Adjuntarlos al final del PDF</option>
                <option value="no">No incluirlos</option>
              </select>{avisoComp && <span>{avisoComp}</span>}</div>
            </label>
          )}
          <RecomendacionesUso presupuestoId={listo.datos.id} titulo={listo.datos.titulo} descripcion={listo.datos.descripcion ?? null} items={listo.datos.items} onGuardado={() => setRevision((v) => v + 1)} />

          {/* Solo para vos */}
          {listo.datos.items.length > 0 && <>
            <div className="docGrupo">Solo para vos</div>
            <button type="button" className="presuMercadoBtn" onClick={compararMercado}>
              <span>💲</span><span><b>¿Cómo estoy en el mercado?</b><small>La IA busca precios de productos y mano de obra, y analiza todo el presupuesto</small></span><b>›</b>
            </button>
          </>}
        </div>
      )}
      {error ? <p role="alert">{error}</p> : listo ? <DocumentoPresupuesto datos={listo.datos} embebido /> : <p role="status">Cargando presupuesto, pagos y avances…</p>}
    </div>
  </div>
}
