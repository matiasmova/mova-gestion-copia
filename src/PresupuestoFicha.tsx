import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import DocumentoPresupuesto from './DocumentoPresupuesto'
import {
  completarDatosDocumento,
  generarPdfPresupuesto,
  nombreArchivoPresupuesto,
  type DatosPdf,
} from './pdfPresupuesto'
import { codigoPresupuesto } from './codigoPresupuesto'

export type PresupuestoFichaData = {
  id: number
  cliente_id: number
  obra_id: number | null
  titulo: string
  descripcion: string | null
  fecha: string
  validez_dias: number | null
  estado: string
  subtotal: number
  descuento: number
  total: number
  total_pagado: number
  saldo: number
  notas?: string | null
  items: ItemPresupuesto[]
}

type Pago = {
  id: number
  monto: number
  fecha: string
  medio_pago: string | null
}

export type DatosObra = {
  direccion: string
  localidad: string
  fecha_inicio: string
  fecha_fin_estimada: string
}

type Props = {
  presupuesto: PresupuestoFichaData
  cliente: string
  obra: string
  convirtiendo?: boolean
  onCerrar: () => void
  onEditar: () => void
  onPDF: () => void
  onCrearObra: (datos: DatosObra) => void
  onCambiarEstado: (nuevo: string) => void
  onEliminar: () => void
  onEliminarObra?: () => void
}

type Preparado = {
  base: DatosPdf
  datos: DatosPdf // con estado de obra, soluciones y contacto
  blob: Blob
  url: string
}

const ESTADOS = [
  { v: 'borrador', t: 'Borrador' },
  { v: 'enviado', t: 'Enviado' },
  { v: 'aceptado', t: 'Aceptado' },
  { v: 'rechazado', t: 'Rechazado' },
]

export default function PresupuestoFicha({
  presupuesto,
  cliente,
  obra,
  convirtiendo,
  onCerrar,
  onEditar,
  onCrearObra,
  onCambiarEstado,
  onEliminar,
  onEliminarObra,
}: Props) {
  const [pagosSueltos, setPagosSueltos] = useState<Pago[]>([])
  const [estadoLocal, setEstadoLocal] = useState(presupuesto.estado)
  const [obraForm, setObraForm] = useState<DatosObra>({ direccion: '', localidad: '', fecha_inicio: '', fecha_fin_estimada: '' })
  const [preparado, setPreparado] = useState<Preparado | null>(null)
  const [error, setError] = useState('')
  const [reintento, setReintento] = useState(0)
  const [compartiendo, setCompartiendo] = useState(false)

  const codigo = codigoPresupuesto(presupuesto.id)
  const cambioEstado = estadoLocal !== presupuesto.estado

  const base = useMemo<DatosPdf>(() => ({
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [presupuesto.id, presupuesto.estado, presupuesto.obra_id, presupuesto.titulo, presupuesto.descripcion, presupuesto.fecha, presupuesto.validez_dias, presupuesto.subtotal, presupuesto.descuento, presupuesto.total, presupuesto.notas, presupuesto.items, cliente, obra])

  const listo = preparado?.base === base ? preparado : null
  const estadoObra = listo?.datos.estado ?? null
  const nombrePdf = nombreArchivoPresupuesto({ id: presupuesto.id, cliente, obra })

  useEffect(() => { setEstadoLocal(presupuesto.estado) }, [presupuesto.id, presupuesto.estado])
  useEffect(() => { setObraForm({ direccion: '', localidad: '', fecha_inicio: '', fecha_fin_estimada: '' }) }, [presupuesto.id])

  // Carga el estado completo (obra, pagos, avances) y prepara el PDF para Descargar y Compartir.
  useEffect(() => {
    let cancelado = false
    let urlCreada: string | null = null
    setPreparado(null)
    setError('')

    async function preparar() {
      try {
        const datos = await completarDatosDocumento(base)
        const blob = await generarPdfPresupuesto(datos)
        if (cancelado) return
        urlCreada = URL.createObjectURL(blob)
        setPreparado({ base, datos, blob, url: urlCreada })
      } catch (fallo) {
        if (cancelado) return
        console.error(fallo)
        setError('No se pudo cargar el documento completo. No se generó un PDF con datos parciales.')
      }
    }
    void preparar()

    return () => {
      cancelado = true
      if (urlCreada) URL.revokeObjectURL(urlCreada)
    }
  }, [base, reintento])

  // Cobros de presupuestos que todavía no están aceptados (en aceptados vienen del estado de obra).
  useEffect(() => {
    let cancelado = false
    if (presupuesto.estado === 'aceptado') { setPagosSueltos([]); return }
    async function cargar() {
      const filtros = [`presupuesto_id.eq.${presupuesto.id}`]
      if (presupuesto.obra_id) filtros.push(`obra_id.eq.${presupuesto.obra_id}`)
      const { data, error: fallo } = await supabase.from('pagos').select('id,monto,fecha,medio_pago').or(filtros.join(','))
      if (cancelado) return
      if (fallo) { console.error(fallo); return }
      setPagosSueltos(((data ?? []) as Pago[]).map((p) => ({ ...p, monto: Number(p.monto) })))
    }
    void cargar()
    return () => { cancelado = true }
  }, [presupuesto.id, presupuesto.obra_id, presupuesto.estado])

  const pagos: Pago[] = estadoObra
    ? estadoObra.pagos.map((p) => ({ id: p.id, monto: p.monto, fecha: p.fecha, medio_pago: p.medio }))
    : pagosSueltos

  function descargarPdf() {
    if (!listo) return
    const enlace = document.createElement('a')
    enlace.href = listo.url
    enlace.download = nombrePdf
    document.body.appendChild(enlace)
    enlace.click()
    enlace.remove()
  }

  async function compartir() {
    if (!listo || compartiendo) return
    setCompartiendo(true)
    try {
      const archivo = new File([listo.blob], nombrePdf, { type: 'application/pdf' })
      const nav = navigator as Navigator & { canShare?: (data?: { files?: File[] }) => boolean }
      if (navigator.share && nav.canShare?.({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: `Presupuesto ${codigo}`, text: `${presupuesto.titulo} — ${cliente}` })
      } else {
        descargarPdf()
      }
    } catch (fallo) {
      if (fallo instanceof Error && fallo.name === 'AbortError') return
      console.error(fallo)
      window.alert('No se pudo compartir el PDF. Podés usar Descargar PDF.')
    } finally {
      setCompartiendo(false)
    }
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard fichaCliente" style={{ width: 'min(1100px, 96vw)', maxWidth: '1100px' }}>
        <div className="modalHeader">
          <div>
            <p className="subtitle">PRESUPUESTO {codigo}</p>
            <h2>{presupuesto.titulo}</h2>
          </div>
          <button type="button" className="closeButton" onClick={onCerrar} aria-label="Cerrar ficha">×</button>
        </div>

        <div className="fichaBody">
          <div className="fichaAcciones">
            <label className="fichaEstadoSelect">
              Estado
              <select value={estadoLocal} onChange={(e) => setEstadoLocal(e.target.value)}>
                {ESTADOS.map((estado) => <option key={estado.v} value={estado.v}>{estado.t}</option>)}
              </select>
            </label>

            {cambioEstado && <button type="button" className="newButton" onClick={() => onCambiarEstado(estadoLocal)}>Guardar estado</button>}

            {presupuesto.obra_id != null && <span className="obraVinculadaTag">✓ Obra vinculada</span>}

            {presupuesto.obra_id != null && presupuesto.estado === 'rechazado' && onEliminarObra && (
              <button type="button" className="deactivateButton" onClick={onEliminarObra}>🗑 Eliminar obra vinculada</button>
            )}

            <button type="button" className="editButton" onClick={onEditar}>Editar</button>
            <button type="button" className="editButton" onClick={descargarPdf} disabled={!listo}>
              {estadoObra?.enObra ? '📄 Descargar estado de obra' : '📄 Descargar PDF'}
            </button>
            <button type="button" className="editButton" onClick={compartir} disabled={!listo || compartiendo}>
              {compartiendo ? 'Compartiendo...' : '📲 Compartir PDF'}
            </button>
            <button type="button" className="deactivateButton" onClick={onEliminar}>Eliminar</button>
          </div>

          {error && (
            <div role="alert" style={{ margin: '12px 0' }}>
              <p>{error}</p>
              <button type="button" className="editButton" onClick={() => setReintento((v) => v + 1)}>Reintentar</button>
            </div>
          )}

          {presupuesto.estado === 'aceptado' && !presupuesto.obra_id && (
            <div className="fichaObraNueva">
              <h3>✅ Presupuesto aceptado — creá la obra</h3>
              <p>Completá los datos y la obra queda vinculada a este presupuesto (hereda cliente, título y monto).</p>
              <div className="formGrid">
                <label>Dirección<input value={obraForm.direccion} onChange={(e) => setObraForm((f) => ({ ...f, direccion: e.target.value }))} placeholder="Dirección de la obra" /></label>
                <label>Localidad<input value={obraForm.localidad} onChange={(e) => setObraForm((f) => ({ ...f, localidad: e.target.value }))} /></label>
                <label>Fecha de inicio<input type="date" value={obraForm.fecha_inicio} onChange={(e) => setObraForm((f) => ({ ...f, fecha_inicio: e.target.value }))} /></label>
                <label>Fecha fin estimada<input type="date" value={obraForm.fecha_fin_estimada} onChange={(e) => setObraForm((f) => ({ ...f, fecha_fin_estimada: e.target.value }))} /></label>
              </div>
              <button type="button" className="newButton" disabled={convirtiendo} onClick={() => onCrearObra(obraForm)}>{convirtiendo ? 'Creando obra...' : '🏗️ Crear obra'}</button>
            </div>
          )}

          <div className="fichaKpis">
            <div>
              <span>{estadoObra ? 'TOTAL DE LA OBRA' : 'TOTAL'}</span>
              <strong>{moneda(estadoObra?.totalActualizado ?? presupuesto.total)}</strong>
            </div>
            <div>
              <span>PAGADO</span>
              <strong>{moneda(estadoObra ? estadoObra.cobrado : pagos.reduce((s, p) => s + p.monto, 0))}</strong>
            </div>
            <div className="alerta">
              <span>{estadoObra ? 'PENDIENTE A HOY' : 'SALDO'}</span>
              <strong>{estadoObra ? moneda(estadoObra.pendienteHoy) : moneda(presupuesto.saldo)}</strong>
            </div>
            <div>
              <span>{estadoObra ? 'SALDO PARA TERMINAR' : 'ÍTEMS'}</span>
              <strong>{estadoObra ? moneda(Math.max(0, estadoObra.saldoTotal)) : presupuesto.items.length}</strong>
            </div>
          </div>

          {listo ? <DocumentoPresupuesto datos={listo.datos} /> : !error && <p role="status" style={{ color: '#64748b', fontSize: '13px' }}>Cargando documento…</p>}

        </div>
      </div>
    </div>
  )
}
