import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import DocumentoPresupuesto from './DocumentoPresupuesto'
import { cargarResumenModificaciones, type ResumenModificaciones } from './presupuestoModificaciones'
import {
  generarPdfPresupuesto,
  type DatosPdf,
} from './pdfPresupuesto'

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

type PdfListo = {
  datos: DatosPdf
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
  const [pagos, setPagos] = useState<Pago[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorPagos, setErrorPagos] = useState('')

  const [estadoLocal, setEstadoLocal] = useState(presupuesto.estado)
  const [obraForm, setObraForm] = useState<DatosObra>({
    direccion: '',
    localidad: '',
    fecha_inicio: '',
    fecha_fin_estimada: '',
  })

  const [pdfListo, setPdfListo] = useState<PdfListo | null>(null)
  const [errorPdf, setErrorPdf] = useState('')
  const [resumen, setResumen] = useState<ResumenModificaciones | null>(null)
  const [reintento, setReintento] = useState(0)
  const [compartiendo, setCompartiendo] = useState(false)

  const codigo = `#${String(presupuesto.id).padStart(4, '0')}`
  const nombrePdf = `Presupuesto-${String(presupuesto.id).padStart(4, '0')}.pdf`
  const cambioEstado = estadoLocal !== presupuesto.estado

  const datosPdf = useMemo<DatosPdf>(() => ({
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
  }), [
    presupuesto.id,
    presupuesto.estado,
    presupuesto.obra_id,
    presupuesto.titulo,
    presupuesto.descripcion,
    presupuesto.fecha,
    presupuesto.validez_dias,
    presupuesto.subtotal,
    presupuesto.descuento,
    presupuesto.total,
    presupuesto.notas,
    presupuesto.items,
    cliente,
    obra,
  ])

  const pdfActual = pdfListo?.datos === datosPdf ? pdfListo : null

  useEffect(() => {
    setEstadoLocal(presupuesto.estado)
  }, [presupuesto.id, presupuesto.estado])

  useEffect(() => {
    setObraForm({
      direccion: '',
      localidad: '',
      fecha_inicio: '',
      fecha_fin_estimada: '',
    })
  }, [presupuesto.id])

  // Prepara el archivo para Descargar y Compartir.
  useEffect(() => {
    let cancelado = false
    let urlCreada: string | null = null

    setPdfListo(null)
    setErrorPdf('')
    setResumen(null)
    if (presupuesto.estado === 'aceptado' && presupuesto.obra_id != null) { setPagos([]); setCargando(true) }

    async function prepararPdf() {
      try {
        const cuenta = await cargarResumenModificaciones(datosPdf.id, datosPdf.total)
        const blob = await generarPdfPresupuesto({ ...datosPdf, resumen: cuenta })

        if (cancelado) return

        setResumen(cuenta)
        if (cuenta) { setPagos(cuenta.pagos); setCargando(false); setErrorPagos('') }
        urlCreada = URL.createObjectURL(blob)

        setPdfListo({
          datos: datosPdf,
          blob,
          url: urlCreada,
        })
      } catch (error) {
        if (cancelado) return
        console.error(error)
        setErrorPdf('No se pudo cargar el documento completo. No se generó un PDF con datos parciales.')
        setCargando(false)
        setErrorPagos('No se pudieron verificar los pagos del documento.')
      }
    }

    void prepararPdf()

    return () => {
      cancelado = true
      if (urlCreada) URL.revokeObjectURL(urlCreada)
    }
  }, [datosPdf, reintento])

  useEffect(() => {
    let cancelado = false

    if (presupuesto.estado === 'aceptado' && presupuesto.obra_id != null) return

    async function cargar() {
      setCargando(true)
      setErrorPagos('')
      setPagos([])

      try {
        const filtros = [`presupuesto_id.eq.${presupuesto.id}`]

        if (presupuesto.obra_id) {
          filtros.push(`obra_id.eq.${presupuesto.obra_id}`)
        }

        const { data, error } = await supabase
          .from('pagos')
          .select('id,monto,fecha,medio_pago')
          .or(filtros.join(','))

        if (error) throw error
        if (cancelado) return

        setPagos(
          ((data ?? []) as Pago[]).map((pago) => ({
            ...pago,
            monto: Number(pago.monto),
          }))
        )
      } catch (error) {
        if (cancelado) return
        console.error(error)
        setErrorPagos('No se pudieron cargar los cobros.')
      } finally {
        if (!cancelado) setCargando(false)
      }
    }

    void cargar()

    return () => {
      cancelado = true
    }
  }, [presupuesto.id, presupuesto.obra_id, presupuesto.estado])

  function descargarPdf() {
    if (!pdfActual) return

    const enlace = document.createElement('a')
    enlace.href = pdfActual.url
    enlace.download = nombrePdf
    document.body.appendChild(enlace)
    enlace.click()
    enlace.remove()
  }

  async function compartir() {
    if (!pdfActual || compartiendo) return

    setCompartiendo(true)

    try {
      const archivo = new File([pdfActual.blob], nombrePdf, {
        type: 'application/pdf',
      })

      const nav = navigator as Navigator & {
        canShare?: (data?: { files?: File[] }) => boolean
      }

      if (navigator.share && nav.canShare?.({ files: [archivo] })) {
        await navigator.share({
          files: [archivo],
          title: `Presupuesto ${codigo}`,
          text: `${presupuesto.titulo} — ${cliente}`,
        })
      } else {
        descargarPdf()
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }

      console.error(error)
      window.alert(
        'No se pudo compartir el PDF. Podés usar Descargar PDF.'
      )
    } finally {
      setCompartiendo(false)
    }
  }

  return (
    <div className="modalOverlay">
      <div
        className="modalCard fichaCliente"
        style={{
          width: 'min(1100px, 96vw)',
          maxWidth: '1100px',
        }}
      >
        <div className="modalHeader">
          <div>
            <p className="subtitle">PRESUPUESTO {codigo}</p>
            <h2>{presupuesto.titulo}</h2>
          </div>

          <button
            type="button"
            className="closeButton"
            onClick={onCerrar}
            aria-label="Cerrar ficha"
          >
            ×
          </button>
        </div>

        <div className="fichaBody">
          <div className="fichaAcciones">
            <label className="fichaEstadoSelect">
              Estado
              <select
                value={estadoLocal}
                onChange={(e) => setEstadoLocal(e.target.value)}
              >
                {ESTADOS.map((estado) => (
                  <option key={estado.v} value={estado.v}>
                    {estado.t}
                  </option>
                ))}
              </select>
            </label>

            {cambioEstado && (
              <button
                type="button"
                className="newButton"
                onClick={() => onCambiarEstado(estadoLocal)}
              >
                Guardar estado
              </button>
            )}

            {presupuesto.obra_id != null && (
              <span className="obraVinculadaTag">
                ✓ Obra vinculada
              </span>
            )}

            {presupuesto.obra_id != null &&
              presupuesto.estado === 'rechazado' &&
              onEliminarObra && (
                <button
                  type="button"
                  className="deactivateButton"
                  onClick={onEliminarObra}
                >
                  🗑 Eliminar obra vinculada
                </button>
              )}

            <button
              type="button"
              className="editButton"
              onClick={onEditar}
            >
              Editar
            </button>

            <button
              type="button"
              className="editButton"
              onClick={descargarPdf}
              disabled={!pdfActual}
            >
              {presupuesto.estado === 'aceptado' && presupuesto.obra_id ? '📄 Descargar estado de obra' : '📄 Descargar PDF'}
            </button>

            <button
              type="button"
              className="editButton"
              onClick={compartir}
              disabled={!pdfActual || compartiendo}
            >
              {compartiendo ? 'Compartiendo...' : '📲 Compartir PDF'}
            </button>

            <button
              type="button"
              className="deactivateButton"
              onClick={onEliminar}
            >
              Eliminar
            </button>
          </div>

          {errorPdf ? (
            <div role="alert" style={{ margin: '12px 0' }}>
              <p>{errorPdf}</p>
              <button
                type="button"
                className="editButton"
                onClick={() => setReintento((valor) => valor + 1)}
              >
                Reintentar
              </button>
            </div>
          ) : !pdfActual ? (
            <p role="status" style={{ color: '#64748b', fontSize: '13px' }}>
              Preparando archivo para descargar o compartir...
            </p>
          ) : null}

          {presupuesto.estado === 'aceptado' &&
            !presupuesto.obra_id && (
              <div className="fichaObraNueva">
                <h3>✅ Presupuesto aceptado — creá la obra</h3>
                <p>
                  Completá los datos y la obra queda vinculada a este
                  presupuesto (hereda cliente, título y monto).
                </p>

                <div className="formGrid">
                  <label>
                    Dirección
                    <input
                      value={obraForm.direccion}
                      onChange={(e) =>
                        setObraForm((f) => ({
                          ...f,
                          direccion: e.target.value,
                        }))
                      }
                      placeholder="Dirección de la obra"
                    />
                  </label>

                  <label>
                    Localidad
                    <input
                      value={obraForm.localidad}
                      onChange={(e) =>
                        setObraForm((f) => ({
                          ...f,
                          localidad: e.target.value,
                        }))
                      }
                    />
                  </label>

                  <label>
                    Fecha de inicio
                    <input
                      type="date"
                      value={obraForm.fecha_inicio}
                      onChange={(e) =>
                        setObraForm((f) => ({
                          ...f,
                          fecha_inicio: e.target.value,
                        }))
                      }
                    />
                  </label>

                  <label>
                    Fecha fin estimada
                    <input
                      type="date"
                      value={obraForm.fecha_fin_estimada}
                      onChange={(e) =>
                        setObraForm((f) => ({
                          ...f,
                          fecha_fin_estimada: e.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <button
                  type="button"
                  className="newButton"
                  disabled={convirtiendo}
                  onClick={() => onCrearObra(obraForm)}
                >
                  {convirtiendo ? 'Creando obra...' : '🏗️ Crear obra'}
                </button>
              </div>
            )}

          <div className="fichaKpis">
            <div>
              <span>{resumen ? 'TOTAL ACTUALIZADO DE LA OBRA' : 'TOTAL ORIGINAL'}</span>
              <strong>{moneda(resumen?.nuevoTotal ?? presupuesto.total)}</strong>
            </div>
            <div>
              <span>PAGADO</span>
              <strong>{resumen ? moneda(resumen.cobrado) : cargando || errorPagos ? '—' : moneda(pagos.reduce((s, p) => s + p.monto, 0))}</strong>
            </div>
            <div className="alerta">
              <span>{resumen && resumen.saldo < 0 ? 'SALDO A FAVOR' : 'SALDO TOTAL'}</span>
              <strong>{resumen ? moneda(Math.abs(resumen.saldo)) : presupuesto.estado === 'aceptado' && presupuesto.obra_id ? '—' : moneda(presupuesto.saldo)}</strong>
            </div>
            <div>
              <span>ÍTEMS</span>
              <strong>{presupuesto.items.length}</strong>
            </div>
          </div>

          {resumen && <p>Reintegros pendientes incluidos en el saldo: {moneda(resumen.gastoExtraPendiente)}. {resumen.otrosPresupuestos.length > 0 && 'El estado de cuenta comprende todos los presupuestos aceptados de la obra.'}</p>}
          {pdfActual && <DocumentoPresupuesto datos={datosPdf} archivoUrl={pdfActual.url} />}

          <div className="fichaRel">
            <div className="fichaRelHead">
              <h3>Cobros</h3>
              <span>{pagos.length}</span>
            </div>

            {cargando ? (
              <p className="fichaVacio">Cargando...</p>
            ) : errorPagos ? (
              <p className="fichaVacio" role="alert">
                {errorPagos}
              </p>
            ) : pagos.length === 0 ? (
              <p className="fichaVacio">Sin cobros registrados.</p>
            ) : (
              pagos.map((pago) => (
                <div className="fichaRow" key={pago.id}>
                  <div>
                    <strong>{moneda(pago.monto)}</strong>
                    <small>
                      {fechaCorta(pago.fecha)}
                      {pago.medio_pago ? ` · ${pago.medio_pago}` : ''}
                    </small>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
