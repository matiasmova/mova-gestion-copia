import { linkWhatsApp, mensajeEnvioPresupuesto, mensajeSeguimientoPresupuesto } from './whatsapp'
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
import VidaEtapas, { pasosPresupuesto, type ObraEtapa } from './VidaEtapas'
import { totalAPagarHoy } from './estadoObra'
import { createPortal } from 'react-dom'
import { fechaCorta } from './gestionFormat'

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
  enviado_at?: string | null
}

type Pago = {
  id: number
  monto: number
  fecha: string
  medio_pago: string | null
}

export type DatosObra = {
  nombre?: string
  direccion: string
  localidad: string
  fecha_inicio: string
  fecha_fin_estimada: string
}

type Props = {
  presupuesto: PresupuestoFichaData
  cliente: string
  telefono?: string | null
  obra: string
  convirtiendo?: boolean
  onCerrar: () => void
  onEditar: () => void
  onPDF: () => void
  onCambiarEstado: (nuevo: string) => void
  onEliminar: () => void
  onEliminarObra?: () => void
  // Etapas: obra vinculada (estado y avance), motivo de rechazo y acciones del flujo.
  obraEtapa?: ObraEtapa | null
  motivoRechazo?: string | null
  onAceptar: (datos: DatosObra | null) => void
  onRechazar: (motivo: string) => void
  onNuevaVersion: () => void
  onDuplicar: () => void
  onIrObra?: () => void
}

const MOTIVOS = ['💲 Precio', '⏱️ Tiempos', '🏃 Eligió a otro', '⏸️ Lo postergó', 'Otro']
const hoyISO = () => new Date().toISOString().slice(0, 10)

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
  telefono,
  obra,
  convirtiendo,
  onCerrar,
  onEditar,
  onCambiarEstado,
  onEliminar,
  onEliminarObra,
  obraEtapa,
  motivoRechazo,
  onAceptar,
  onRechazar,
  onNuevaVersion,
  onDuplicar,
  onIrObra,
}: Props) {
  const [pagosSueltos, setPagosSueltos] = useState<Pago[]>([])
  const [estadoLocal, setEstadoLocal] = useState(presupuesto.estado)
  const [obraForm, setObraForm] = useState<DatosObra>({ nombre: '', direccion: '', localidad: '', fecha_inicio: '', fecha_fin_estimada: '' })
  const [modal, setModal] = useState<'aceptar' | 'rechazar' | null>(null)
  // Los comprobantes de los gastos a reintegrar van como anexo del PDF (se puede sacar).
  const [incluirComprobantes, setIncluirComprobantes] = useState(true)
  const [motivo, setMotivo] = useState('')
  const [notaRechazo, setNotaRechazo] = useState('')
  const [preparado, setPreparado] = useState<Preparado | null>(null)
  const [error, setError] = useState('')
  const [reintento, setReintento] = useState(0)
  const [compartiendo, setCompartiendo] = useState(false)
  const conObra = presupuesto.obra_id != null && presupuesto.estado === 'aceptado'
  // Se recuerda mientras se rearma el PDF (así la casilla no desaparece).
  const [cantComprobantes, setCantComprobantes] = useState(0)
  useEffect(() => { if (preparado) setCantComprobantes(preparado.datos.estado?.gastosExtra.filter((g) => g.comprobante).length ?? 0) }, [preparado])

  // El presupuesto aceptado queda fijo: los cambios se cargan en la obra.
  function editar() {
    if (conObra && !window.confirm('Este presupuesto ya está aceptado y tiene obra.\n\nLos cambios, extras y descuentos se cargan en la obra (➕ Registrar): así queda el historial y el cliente ve qué cambió.\n\n¿Querés editar igual el presupuesto original?')) return
    if (presupuesto.estado === 'enviado' && !window.confirm('El cliente ya tiene este presupuesto.\n\nSi pidió cambios conviene "Nueva versión" (la anterior queda guardada).\n\n¿Editar igual este?')) return
    onEditar()
  }

  function abrirAceptar() {
    if (presupuesto.obra_id != null) { onAceptar(null); return }
    setObraForm({ nombre: presupuesto.titulo, direccion: '', localidad: '', fecha_inicio: hoyISO(), fecha_fin_estimada: '' })
    setModal('aceptar')
  }
  function confirmarRechazo() {
    // Se guarda sin el emoji: "Precio", "Tiempos"…
    const m = (motivo || 'Otro').replace(/^[^A-Za-zÁ-úñÑ]+/, '')
    onRechazar(notaRechazo.trim() ? `${m}: ${notaRechazo.trim()}` : m)
    setModal(null)
  }

  const codigo = codigoPresupuesto(presupuesto.id)

  // Abre WhatsApp con el mensaje listo y, si era borrador, pasa solo a Enviado.
  // El PDF se adjunta con "Compartir PDF".
  function enviarWhatsApp() {
    const url = linkWhatsApp(telefono, mensajeEnvioPresupuesto({ cliente, titulo: presupuesto.titulo, codigo, validezDias: presupuesto.validez_dias ?? null }))
    if (url) window.open(url, '_blank', 'noopener')
    if (presupuesto.estado === 'borrador') onCambiarEstado('enviado')
  }
  function seguimientoWhatsApp() {
    const vencido = !!presupuesto.validez_dias && diasEnviado != null && diasEnviado > presupuesto.validez_dias
    const url = linkWhatsApp(telefono, mensajeSeguimientoPresupuesto({ cliente, titulo: presupuesto.titulo, codigo, fecha: fechaCorta(presupuesto.enviado_at || presupuesto.fecha), vencido }))
    if (url) window.open(url, '_blank', 'noopener')
  }
  const diasEnviado = presupuesto.estado === 'enviado'
    ? Math.max(0, Math.floor((Date.now() - new Date((presupuesto.enviado_at || presupuesto.fecha).slice(0, 10) + 'T12:00:00').getTime()) / 86400000))
    : null
  const venceEn = diasEnviado != null && presupuesto.validez_dias ? presupuesto.validez_dias - diasEnviado : null
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
        const blob = await generarPdfPresupuesto(datos, { comprobantes: incluirComprobantes })
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
  }, [base, reintento, incluirComprobantes])

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
          <p className="presuCli">{cliente}{presupuesto.obra_id != null ? ` · ${obra}` : ''}</p>
          <VidaEtapas pasos={pasosPresupuesto(presupuesto.estado, presupuesto.obra_id != null ? obraEtapa ?? { estado: 'en_proceso', porcentaje_avance: 0 } : null, estadoObra ? estadoObra.saldoTotal : undefined)} />

          {/* ---------- Siguiente paso, según la etapa ---------- */}
          {presupuesto.estado === 'borrador' && <>
            <button type="button" className="presuPaso wa" onClick={enviarWhatsApp}>
              <small>Siguiente paso</small><b>📤 Enviar por WhatsApp</b><span>Se abre WhatsApp con el mensaje listo y pasa solo a "Enviado". El PDF lo mandás con Compartir PDF.</span>
            </button>
            <div className="presuAccBotones">
              <button type="button" className="editButton" onClick={editar}>✏️ Editar</button>
              <button type="button" className="editButton" onClick={compartir} disabled={!listo || compartiendo}>{compartiendo ? 'Compartiendo...' : '📲 Compartir PDF'}</button>
            </div>
            <p className="presuNota">📝 <b>Borrador:</b> lo estás armando. Podés cambiar todo; el cliente todavía no lo vio.</p>
          </>}

          {presupuesto.estado === 'enviado' && <>
            <h3 className="presuPregunta">¿Qué respondió el cliente?</h3>
            <div className="presuAccBotones">
              <button type="button" className="presuBtnOk" disabled={convirtiendo} onClick={abrirAceptar}>✅ Aceptó</button>
              <button type="button" className="presuBtnNo" onClick={() => { setMotivo(''); setNotaRechazo(''); setModal('rechazar') }}>❌ Rechazó</button>
            </div>
            <button type="button" className="editButton presuAncho" onClick={() => { if (window.confirm('Se crea la versión nueva para que la edites, y esta queda guardada como historial (rechazada por "nueva versión").\n\n¿Seguimos?')) onNuevaVersion() }}>✏️ Pidió cambios → hacer nueva versión</button>
            <div className="presuAviso">
              <span>⏰ Enviado {diasEnviado === 0 ? 'hoy' : `hace ${diasEnviado} día${diasEnviado === 1 ? '' : 's'}`}{venceEn != null ? (venceEn < 0 ? ` · venció hace ${-venceEn} día${venceEn === -1 ? '' : 's'}` : venceEn === 0 ? ' · vence hoy' : ` · vence en ${venceEn} día${venceEn === 1 ? '' : 's'}`) : ''}</span>
              <button type="button" className="caLink" onClick={seguimientoWhatsApp}>💬 Escribirle por WhatsApp</button>
            </div>
            <div className="presuAccBotones">
              <button type="button" className="editButton" onClick={compartir} disabled={!listo || compartiendo}>{compartiendo ? 'Compartiendo...' : '📲 Compartir PDF'}</button>
              <button type="button" className="editButton" onClick={descargarPdf} disabled={!listo}>📄 Descargar PDF</button>
            </div>
          </>}

          {presupuesto.estado === 'aceptado' && presupuesto.obra_id == null && <>
            <button type="button" className="presuPaso" disabled={convirtiendo} onClick={abrirAceptar}>
              <small>Siguiente paso</small><b>{convirtiendo ? 'Creando obra…' : '🏗️ Crear la obra'}</b><span>Dirección y fecha de inicio, y queda vinculada a este presupuesto</span>
            </button>
          </>}

          {conObra && <>
            <button type="button" className="presuPaso" onClick={onIrObra} disabled={!onIrObra}>
              <small>Se trabaja en la obra</small><b>🏗️ Ir a la obra {obra} →</b><span>Cobros, pagos, gastos, extras y avances se cargan ahí, con ➕ Registrar</span>
            </button>
            <p className="presuNota">🔒 <b>Aceptado:</b> el presupuesto queda fijo como lo aceptó el cliente. Los cambios se cargan en la obra y aparecen solos en el documento.</p>
            <div className="presuAccBotones">
              <button type="button" className="editButton" onClick={compartir} disabled={!listo || compartiendo}>{compartiendo ? 'Compartiendo...' : '📲 Compartir PDF'}</button>
              <button type="button" className="editButton waButton" onClick={enviarWhatsApp}>💬 WhatsApp</button>
            </div>
            {cantComprobantes > 0 && (
              <label className="caCheck presuComprobantes">
                <input type="checkbox" checked={incluirComprobantes} onChange={(e) => setIncluirComprobantes(e.target.checked)} />
                <span>📎 Incluir {cantComprobantes === 1 ? 'el comprobante' : `los ${cantComprobantes} comprobantes`} de gastos al final del PDF{!listo ? ' (preparando…)' : ''}</span>
              </label>
            )}
          </>}

          {presupuesto.estado === 'rechazado' && <>
            <div className="presuAviso rechazo"><span>❌ <b>Rechazado</b>{motivoRechazo ? ` · ${motivoRechazo}` : ''}</span></div>
            <div className="presuAccBotones">
              <button type="button" className="editButton" onClick={onDuplicar}>📑 Duplicar</button>
              <button type="button" className="editButton" onClick={() => onCambiarEstado('borrador')}>↩️ Volver a borrador</button>
            </div>
          </>}

          {error && (
            <div role="alert" style={{ margin: '12px 0' }}>
              <p>{error}</p>
              <button type="button" className="editButton" onClick={() => setReintento((v) => v + 1)}>Reintentar</button>
            </div>
          )}

          {estadoObra && conObra ? (
            <div className="fichaKpis">
              <div><span>TOTAL DE LA OBRA</span><strong>{moneda(estadoObra.totalActualizado)}</strong></div>
              <div><span>COBRADO</span><strong>{moneda(estadoObra.cobrado)}</strong></div>
              <div className="alerta"><span>FALTA COBRAR HOY</span><strong>{moneda(totalAPagarHoy(estadoObra))}</strong>{estadoObra.gastoExtraPendiente > 0.5 && <small className="kpiNota">incluye {moneda(estadoObra.gastoExtraPendiente)} de gastos a reintegrar</small>}</div>
              <div><span>SALDO PARA TERMINAR</span><strong>{moneda(Math.max(0, estadoObra.saldoTotal))}</strong></div>
            </div>
          ) : (
            <div className="fichaKpis">
              <div><span>TOTAL</span><strong>{moneda(presupuesto.total)}</strong></div>
              <div><span>{pagos.length ? 'COBRADO' : 'ÍTEMS'}</span><strong>{pagos.length ? moneda(pagos.reduce((s, p) => s + p.monto, 0)) : presupuesto.items.length}</strong></div>
            </div>
          )}

          {listo ? <DocumentoPresupuesto datos={listo.datos} /> : !error && <p role="status" style={{ color: '#64748b', fontSize: '13px' }}>Cargando documento…</p>}

          {/* ---------- Más opciones (lo que se usa poco) ---------- */}
          <details className="presuMas">
            <summary>⋯ Más opciones</summary>
            <div className="presuMasCuerpo">
              {presupuesto.estado !== 'borrador' && <button type="button" className="editButton" onClick={editar}>✏️ {conObra ? 'Editar el presupuesto original' : 'Editar'}</button>}
              <button type="button" className="editButton" onClick={descargarPdf} disabled={!listo}>{estadoObra?.enObra ? '📄 Descargar estado de obra' : '📄 Descargar PDF'}</button>
              {presupuesto.estado !== 'rechazado' && <button type="button" className="editButton" onClick={onDuplicar}>📑 Duplicar</button>}
              <div className="presuEstadoManual">
                <label className="fichaEstadoSelect">Cambiar el estado a mano
                  <select value={estadoLocal} onChange={(e) => setEstadoLocal(e.target.value)}>
                    {ESTADOS.map((estado) => <option key={estado.v} value={estado.v}>{estado.t}</option>)}
                  </select>
                </label>
                {cambioEstado && <button type="button" className="newButton" onClick={() => onCambiarEstado(estadoLocal)}>Guardar</button>}
              </div>
              {presupuesto.obra_id != null && presupuesto.estado === 'rechazado' && onEliminarObra && (
                <button type="button" className="deactivateButton" onClick={onEliminarObra}>🗑 Eliminar obra vinculada</button>
              )}
              <button type="button" className="deactivateButton" onClick={onEliminar}>🗑 Eliminar presupuesto</button>
            </div>
          </details>
        </div>

        {modal === 'aceptar' && createPortal(
          <div className="modalOverlay">
            <div className="modalCard registrarModal">
              <div className="modalHeader">
                <div><p className="subtitle">✅ EL CLIENTE ACEPTÓ</p><h2>Creamos la obra</h2></div>
                <button type="button" className="modalClose closeButton" onClick={() => setModal(null)}>×</button>
              </div>
              <div className="catalogoForm">
                <p className="gestionAyuda" style={{ marginTop: 0 }}>Completá estos datos y la obra queda creada y vinculada a este presupuesto.</p>
                <div className="formGrid">
                  <label className="formFull">Nombre de la obra<input value={obraForm.nombre ?? ''} onChange={(e) => setObraForm((f) => ({ ...f, nombre: e.target.value }))} /></label>
                  <label className="formFull">Dirección<input value={obraForm.direccion} onChange={(e) => setObraForm((f) => ({ ...f, direccion: e.target.value }))} placeholder="Calle y número" /></label>
                  <label>Localidad<input value={obraForm.localidad} onChange={(e) => setObraForm((f) => ({ ...f, localidad: e.target.value }))} /></label>
                  <label>Fecha de inicio<input type="date" value={obraForm.fecha_inicio} onChange={(e) => setObraForm((f) => ({ ...f, fecha_inicio: e.target.value }))} /></label>
                </div>
                <div className="modalActions formActions">
                  <button type="button" className="cancelButton" onClick={() => setModal(null)}>Cancelar</button>
                  <button type="button" className="newButton" disabled={convirtiendo} onClick={() => { onAceptar(obraForm); setModal(null) }}>🏗️ Crear obra y empezar</button>
                </div>
              </div>
            </div>
          </div>, document.body)}

        {modal === 'rechazar' && createPortal(
          <div className="modalOverlay">
            <div className="modalCard registrarModal">
              <div className="modalHeader">
                <div><p className="subtitle">❌ EL CLIENTE RECHAZÓ</p><h2>¿Por qué no avanzó?</h2></div>
                <button type="button" className="modalClose closeButton" onClick={() => setModal(null)}>×</button>
              </div>
              <div className="catalogoForm">
                <p className="gestionAyuda" style={{ marginTop: 0 }}>Te sirve para ver después por qué se pierden presupuestos.</p>
                <div className="caChips presuMotivos">
                  {MOTIVOS.map((m) => <button type="button" key={m} className={motivo === m ? 'activo' : ''} onClick={() => setMotivo(m)}>{m}</button>)}
                </div>
                <label>Nota (opcional)<input value={notaRechazo} onChange={(e) => setNotaRechazo(e.target.value)} placeholder="Ej.: le pareció caro el tablero" /></label>
                <div className="modalActions formActions">
                  <button type="button" className="cancelButton" onClick={() => setModal(null)}>Cancelar</button>
                  <button type="button" className="newButton" onClick={confirmarRechazo}>Guardar como rechazado</button>
                </div>
              </div>
            </div>
          </div>, document.body)}
      </div>
    </div>
  )
}
