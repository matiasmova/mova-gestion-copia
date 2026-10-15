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
  leerModoComprobantes,
  guardarModoComprobantes,
  type ModoComprobantes,
} from './pdfPresupuesto'
import { codigoPresupuesto } from './codigoPresupuesto'
import { type ObraEtapa } from './VidaEtapas'
import { estadoTrabajo } from './estadoTrabajo'
import { PillTrabajo, VidaTrabajo } from './VidaTrabajo'
import { textoMedios } from './formasPago'
import { totalAPagarHoy } from './estadoObra'
import { createPortal } from 'react-dom'
import { fechaCorta } from './gestionFormat'
import RecomendacionesUso from './RecomendacionesUso'
import ComoLoVeCliente from './ComoLoVeCliente'
import FormasPagoEditor from './FormasPagoEditor'
import { Cifra } from './Animados'
import { asegurarLinkPago } from './pagoLink'
import CompararMercado, { type ProductoAComparar } from './CompararMercado'
import PresupuestoEnVivo from './PresupuestoEnVivo'
import { importeNeto } from './presupuestoCalculos'

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
  // Después de editar en vivo: recargar el presupuesto.
  onEditadoEnVivo?: () => void
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
  onEditadoEnVivo,
}: Props) {
  const [enVivo, setEnVivo] = useState<false | 'edit' | 'ver'>(false)
  const [pagosSueltos, setPagosSueltos] = useState<Pago[]>([])
  const [obraForm, setObraForm] = useState<DatosObra>({ nombre: '', direccion: '', localidad: '', fecha_inicio: '', fecha_fin_estimada: '' })
  const [modal, setModal] = useState<'aceptar' | 'rechazar' | null>(null)
  // Los comprobantes de los gastos a reintegrar van como anexo del PDF (se puede sacar).
  const [modoComp, setModoComp] = useState<ModoComprobantes>(leerModoComprobantes)
  const [avisoComp, setAvisoComp] = useState('')
  const [motivo, setMotivo] = useState('')
  const [notaRechazo, setNotaRechazo] = useState('')
  const [preparado, setPreparado] = useState<Preparado | null>(null)
  const [mercado, setMercado] = useState<ProductoAComparar[] | null>(null)
  const [linkPago, setLinkPago] = useState<string | null>(null)
  // Todo el presupuesto (productos, materiales, servicios y mano de obra) con el
  // precio por unidad que paga el cliente: con el descuento del ítem y la bonificación general.
  function compararMercado() {
    const neto = presupuesto.items.reduce((t, it) => t + importeNeto(it), 0)
    const factor = neto > 0 ? Number(presupuesto.total) / neto : 1
    setMercado(presupuesto.items.filter((it) => it.descripcion.trim() && Number(it.cantidad) > 0).slice(0, 24).map((it) => ({
      id: it.catalogo_id ? Number(it.catalogo_id) : null, nombre: it.descripcion.split('\n')[0].trim(), tipo: it.tipo,
      cantidad: Number(it.cantidad), costo: Number(it.costo_unitario) || 0,
      precio: Math.round((importeNeto(it) / Number(it.cantidad)) * factor * 100) / 100,
    })))
  }
  const [error, setError] = useState('')
  const [reintento, setReintento] = useState(0)
  const [compartiendo, setCompartiendo] = useState(false)
  const conObra = presupuesto.obra_id != null && presupuesto.estado === 'aceptado'
  // Menú ⋯ y el cuadro abierto de "Preparar el presupuesto".
  const [menuMas, setMenuMas] = useState(false)
  const [seccion, setSeccion] = useState<'pago' | 've' | 'recos' | 'doc' | null>(null)
  function abrirSeccion(s: 'pago' | 've' | 'recos' | 'doc') {
    setSeccion((actual) => (actual === s ? null : s))
    setTimeout(() => document.getElementById('pfSeccion')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }
  // Se recuerda mientras se rearma el PDF (así la casilla no desaparece).
  const [cantComprobantes, setCantComprobantes] = useState(0)
  useEffect(() => { if (preparado) setCantComprobantes(preparado.datos.estado?.gastosExtra.filter((g) => g.comprobante).length ?? 0) }, [preparado])

  // El presupuesto aceptado queda fijo: los cambios se cargan en la obra.
  function editar() {
    if (conObra && !window.confirm('Este presupuesto ya está aceptado y tiene obra.\n\nLos cambios, extras y descuentos se cargan en la obra (➕ Registrar): así queda el historial y el cliente ve qué cambió.\n\n¿Querés editar igual el presupuesto original?')) return
    if (presupuesto.estado === 'enviado' && !window.confirm('El cliente ya tiene este presupuesto.\n\nSi pidió cambios conviene "Nueva versión" (la anterior queda guardada).\n\n¿Editar igual este?')) return
    setEnVivo('edit')
  }

  function abrirAceptar() {
    if (presupuesto.obra_id != null) { onAceptar(null); return }
    setObraForm({ nombre: presupuesto.titulo, direccion: '', localidad: '', fecha_inicio: hoyISO(), fecha_fin_estimada: '' })
    setModal('aceptar')
  }
  // Estado en un toque. Aceptado pide los datos de la obra y Rechazado el motivo.
  function cambiarEstadoRapido(v: string) {
    if (v === presupuesto.estado) return
    if (v === 'aceptado') { abrirAceptar(); return }
    if (v === 'rechazado') { setMotivo(''); setNotaRechazo(''); setModal('rechazar'); return }
    if (presupuesto.estado === 'aceptado' && !window.confirm(`Este presupuesto está aceptado${presupuesto.obra_id != null ? ' y tiene obra' : ''}.\n\n¿Pasarlo a "${ESTADOS.find((e) => e.v === v)?.t}"?`)) return
    onCambiarEstado(v)
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
    const url = linkWhatsApp(telefono, mensajeEnvioPresupuesto({ cliente, titulo: presupuesto.titulo, codigo, validezDias: presupuesto.validez_dias ?? null, linkPago }))
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
  // Para los cuadros: lo último cargado (no parpadea mientras se rearma el PDF).
  const datosDoc = preparado?.datos ?? null
  const estadoObra = listo?.datos.estado ?? null
  const estTrabajo = estadoTrabajo(presupuesto.estado, presupuesto.obra_id != null ? obraEtapa ?? { estado: 'en_proceso', porcentaje_avance: 0 } : null, estadoObra ? Math.max(0, estadoObra.saldoTotal) + estadoObra.gastoExtraPendiente : 0)
  const nombrePdf = nombreArchivoPresupuesto({ id: presupuesto.id, cliente, obra })

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
        setAvisoComp('')
        // Link de pago (seña o lo pendiente): solo en presupuestos que se envían o ya se aceptaron.
        const link = presupuesto.estado === 'rechazado' ? null : await asegurarLinkPago(datos)
        if (cancelado) return
        setLinkPago(link)
        const blob = await generarPdfPresupuesto(datos, { comprobantes: modoComp, onAviso: setAvisoComp, linkPago: link })
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
  }, [base, reintento, modoComp])

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
          <div className="pfCabBotones">
            <button type="button" className="closeButton" onClick={() => setMenuMas((v) => !v)} aria-label="Más opciones" aria-expanded={menuMas}>⋯</button>
            <button type="button" className="closeButton" onClick={onCerrar} aria-label="Cerrar ficha">×</button>
          </div>
          {/* Lo que casi no se usa: estado a mano, duplicar, nueva versión y eliminar. */}
          {menuMas && (
            <div className="pfMas" role="menu">
              <small>CAMBIAR EL ESTADO A MANO</small>
              <div className="pfMasEstados">
                {ESTADOS.map((e) => (
                  <button type="button" key={e.v} className={presupuesto.estado === e.v ? 'activo' : ''} disabled={convirtiendo} onClick={() => { setMenuMas(false); cambiarEstadoRapido(e.v) }}>{e.t}</button>
                ))}
              </div>
              <button type="button" onClick={() => { setMenuMas(false); onDuplicar() }}>📑 Duplicar</button>
              {presupuesto.estado !== 'rechazado' && (
                <button type="button" onClick={() => { setMenuMas(false); if (window.confirm('Se crea la versión nueva para que la edites, y esta queda guardada como historial (rechazada por "nueva versión").\n\n¿Seguimos?')) onNuevaVersion() }}>🆕 Nueva versión</button>
              )}
              {presupuesto.obra_id != null && presupuesto.estado === 'rechazado' && onEliminarObra && (
                <button type="button" className="rojo" onClick={() => { setMenuMas(false); onEliminarObra() }}>🗑 Eliminar obra vinculada</button>
              )}
              <button type="button" className="rojo" onClick={() => { setMenuMas(false); onEliminar() }}>🗑 Eliminar presupuesto</button>
            </div>
          )}
        </div>

        <div className="fichaBody pfBody">
          {/* ---------- Arriba: cliente, estado y montos ---------- */}
          <p className="presuCli">{cliente}{presupuesto.obra_id != null ? ` · ${obra}` : ''}</p>
          <div className="pfEstado">
            <VidaTrabajo estado={estTrabajo} />
            <div className="pfEstadoTxt">
              <PillTrabajo estado={estTrabajo} extra={presupuesto.estado === 'enviado' ? (diasEnviado === 0 ? 'hoy' : `hace ${diasEnviado} día${diasEnviado === 1 ? '' : 's'}`) : presupuesto.estado === 'borrador' ? 'borrador' : estTrabajo === 'obra' ? `${Math.round(Number(obraEtapa?.porcentaje_avance) || 0)}%` : undefined} />
              <span>{presupuesto.estado === 'borrador' ? 'El cliente todavía no lo vio' : presupuesto.estado === 'enviado' ? (venceEn != null ? (venceEn < 0 ? `Venció hace ${-venceEn} día${venceEn === -1 ? '' : 's'}` : venceEn === 0 ? 'Vence hoy' : `Vence en ${venceEn} día${venceEn === 1 ? '' : 's'}`) : 'Esperando respuesta') : presupuesto.estado === 'rechazado' ? (motivoRechazo ?? '') : ''}</span>
            </div>
          </div>

          {estadoObra && conObra ? (
            <div className="fichaKpis">
              <div><span>TOTAL DE LA OBRA</span><strong><Cifra valor={estadoObra.totalActualizado} formato={moneda} /></strong></div>
              <div><span>COBRADO</span><strong><Cifra valor={estadoObra.cobrado} formato={moneda} /></strong></div>
              <div className="alerta"><span>FALTA COBRAR HOY</span><strong><Cifra valor={totalAPagarHoy(estadoObra)} formato={moneda} /></strong>{estadoObra.gastoExtraPendiente > 0.5 && <small className="kpiNota">incluye {moneda(estadoObra.gastoExtraPendiente)} de gastos a reintegrar</small>}</div>
              <div><span>SALDO TOTAL</span><strong>{moneda(Math.max(0, estadoObra.saldoTotal) + estadoObra.gastoExtraPendiente)}</strong>{estadoObra.gastoExtraPendiente > 0.5 && <small className="kpiNota">obra + extras a reintegrar</small>}</div>
            </div>
          ) : (
            <div className="pfMontos">
              <div><small>TOTAL</small><b><Cifra valor={presupuesto.total} formato={moneda} /></b></div>
              {pagos.length
                ? <div><small>COBRADO</small><b>{moneda(pagos.reduce((s, p) => s + p.monto, 0))}</b></div>
                : <div><small>SEÑA 70%</small><b>{moneda(Math.round(Number(presupuesto.total) * 70) / 100)}</b></div>}
            </div>
          )}

          {/* ---------- El siguiente paso, primero y grande ---------- */}
          {presupuesto.estado === 'borrador' && (
            <div className="pfPaso">
              <small>SIGUIENTE PASO</small>
              <b>📤 Enviar por WhatsApp</b>
              <span>Se abre WhatsApp con el mensaje listo y pasa solo a "Enviado".</span>
              <div className="pfPasoAcc"><button type="button" className="pfBlanco" onClick={enviarWhatsApp}>Enviar ahora</button></div>
              <div className="pfPasoMini">
                <button type="button" onClick={compartir} disabled={!listo || compartiendo}>{compartiendo ? 'Compartiendo…' : '📲 Compartir PDF'}</button>
                <button type="button" onClick={descargarPdf} disabled={!listo}>📄 Descargar PDF</button>
              </div>
            </div>
          )}

          {presupuesto.estado === 'enviado' && (
            <div className="pfPaso azul">
              <small>SIGUIENTE PASO</small>
              <b>¿Qué respondió el cliente?</b>
              <div className="pfPasoAcc">
                <button type="button" className="pfBlanco" disabled={convirtiendo} onClick={abrirAceptar}>✅ Aceptó</button>
                <button type="button" className="pfClaro" onClick={() => { setMotivo(''); setNotaRechazo(''); setModal('rechazar') }}>❌ No salió</button>
                <button type="button" className="pfClaro" onClick={seguimientoWhatsApp}>💬 Seguir</button>
              </div>
              <div className="pfPasoMini">
                <button type="button" onClick={() => { if (window.confirm('Se crea la versión nueva para que la edites, y esta queda guardada como historial (rechazada por "nueva versión").\n\n¿Seguimos?')) onNuevaVersion() }}>✏️ Pidió cambios</button>
                <button type="button" onClick={compartir} disabled={!listo || compartiendo}>{compartiendo ? 'Compartiendo…' : '📲 Compartir PDF'}</button>
                <button type="button" onClick={descargarPdf} disabled={!listo}>📄 Descargar PDF</button>
              </div>
            </div>
          )}

          {presupuesto.estado === 'aceptado' && presupuesto.obra_id == null && (
            <button type="button" className="presuPaso" disabled={convirtiendo} onClick={abrirAceptar}>
              <small>Siguiente paso</small><b>{convirtiendo ? 'Creando obra…' : '🏗️ Crear la obra'}</b><span>Dirección y fecha de inicio, y queda vinculada a este presupuesto</span>
            </button>
          )}

          {conObra && <>
            <button type="button" className="presuPaso" onClick={onIrObra} disabled={!onIrObra}>
              <small>Se trabaja en la obra</small><b>🏗️ Ir a la obra {obra} →</b><span>Cobros, pagos, gastos, extras y avances se cargan ahí, con ➕ Registrar</span>
            </button>
            <div className="presuAccBotones">
              <button type="button" className="editButton" onClick={compartir} disabled={!listo || compartiendo}>{compartiendo ? 'Compartiendo...' : '📲 Compartir PDF'}</button>
              <button type="button" className="editButton waButton" onClick={enviarWhatsApp}>💬 WhatsApp</button>
            </div>
            {cantComprobantes > 0 && (
              <label className="fichaEstadoSelect presuComprobantes">
                📎 {cantComprobantes === 1 ? 'Comprobante de gasto' : `${cantComprobantes} comprobantes de gastos`}{!listo ? ' (preparando…)' : ''}
                <select value={modoComp} onChange={(e) => { const m = e.target.value as ModoComprobantes; setModoComp(m); guardarModoComprobantes(m) }}>
                  <option value="boton">Botón "Descargar factura" en el PDF</option>
                  <option value="anexo">Adjuntarlos al final del PDF</option>
                  <option value="no">No incluirlos</option>
                </select>
                {avisoComp && <small className="kpiNota">{avisoComp}</small>}
              </label>
            )}
          </>}

          {presupuesto.estado === 'rechazado' && <>
            <div className="presuAviso rechazo"><span>❌ <b>No salió</b>{motivoRechazo ? ` · ${motivoRechazo}` : ''}</span></div>
            <div className="presuAccBotones">
              <button type="button" className="editButton" onClick={onDuplicar}>📑 Duplicar</button>
              <button type="button" className="editButton" onClick={() => onCambiarEstado('borrador')}>↩️ Volver a borrador</button>
              <button type="button" className="editButton" onClick={descargarPdf} disabled={!listo}>📄 Descargar PDF</button>
            </div>
          </>}

          {error && (
            <div role="alert" style={{ margin: '12px 0' }}>
              <p>{error}</p>
              <button type="button" className="editButton" onClick={() => setReintento((v) => v + 1)}>Reintentar</button>
            </div>
          )}

          {/* ---------- Preparar el presupuesto: cada cosa en su cuadro ---------- */}
          <div className="pfTit">{conObra ? 'PRESUPUESTO ORIGINAL' : 'PREPARAR EL PRESUPUESTO'}</div>
          <div className="pfTiles">
            {presupuesto.estado !== 'rechazado' && (
              <button type="button" className="pfTile ancho" onClick={editar}>
                <span className="pfIco">✏️</span>
                <span className="pfTileTxt"><b>Editar en vivo</b><small>Tocá y cambiá sobre el documento · {presupuesto.items.length} ítem{presupuesto.items.length === 1 ? '' : 's'}{conObra ? ' (original aceptado)' : ''}</small></span>
                <i>›</i>
              </button>
            )}
            <button type="button" className={`pfTile${seccion === 'pago' ? ' activo' : ''}`} onClick={() => abrirSeccion('pago')}>
              <span className="pfIco">💳</span><b>Formas de pago</b>
              <small>{datosDoc?.formasPago ? (textoMedios(datosDoc.formasPago) || 'Sin elegir') : '…'}</small>
            </button>
            <button type="button" className={`pfTile${seccion === 've' ? ' activo' : ''}`} onClick={() => abrirSeccion('ve')}>
              <span className="pfIco">👁️</span><b>Cómo lo ve</b>
              <span className={`pfEst ${datosDoc?.resumenDoc?.modo === 'resumido' ? 'ok' : ''}`}>{datosDoc?.resumenDoc?.modo === 'resumido' ? 'Resumido' : 'Detallado'}</span>
            </button>
            <button type="button" className={`pfTile${seccion === 'recos' ? ' activo' : ''}`} onClick={() => abrirSeccion('recos')}>
              <span className="pfIco">📘</span><b>Recomendaciones</b>
              <span className={`pfEst ${datosDoc?.recomendaciones ? 'ok' : ''}`}>{datosDoc?.recomendaciones ? 'Incluidas' : 'Opcional'}</span>
            </button>
            {presupuesto.items.length > 0 && (
              <button type="button" className="pfTile" onClick={compararMercado}>
                <span className="pfIco">📈</span><b>Comparar precios</b><small>Con el mercado (IA)</small>
              </button>
            )}
            <button type="button" className={`pfTile ancho2${seccion === 'doc' ? ' activo' : ''}`} onClick={() => (conObra ? abrirSeccion('doc') : setEnVivo('ver'))}>
              <span className="pfIco">📄</span><b>Ver documento</b><small>Como lo recibe el cliente</small>
            </button>
          </div>

          {seccion && (
            <section className="pfSeccion" id="pfSeccion">
              <div className="pfSeccionCab">
                <b>{seccion === 'pago' ? '💳 Formas de pago' : seccion === 've' ? '👁️ Cómo lo ve el cliente' : seccion === 'recos' ? '📘 Formas de uso y recomendaciones' : '📄 Documento del cliente'}</b>
                <button type="button" onClick={() => setSeccion(null)} aria-label="Cerrar">✕</button>
              </div>
              {seccion === 'pago' && <FormasPagoEditor presupuestoId={presupuesto.id} onGuardado={() => setReintento((v) => v + 1)} />}
              {seccion === 've' && <ComoLoVeCliente abierto presupuestoId={presupuesto.id} titulo={presupuesto.titulo} items={presupuesto.items} onGuardado={() => setReintento((v) => v + 1)} />}
              {seccion === 'recos' && <RecomendacionesUso abierto presupuestoId={presupuesto.id} titulo={presupuesto.titulo} descripcion={presupuesto.descripcion} items={presupuesto.items} onGuardado={() => setReintento((v) => v + 1)} />}
              {seccion === 'doc' && (listo ? <DocumentoPresupuesto datos={listo.datos} embebido /> : !error && <p role="status" style={{ color: '#64748b', fontSize: '13px' }}>Cargando documento…</p>)}
            </section>
          )}
          {enVivo && (
            <PresupuestoEnVivo
              presupuesto={{ id: presupuesto.id, titulo: presupuesto.titulo, estado: presupuesto.estado, fecha: presupuesto.fecha, validez_dias: presupuesto.validez_dias, descuento: Number(presupuesto.descuento) || 0, items: presupuesto.items }}
              cliente={cliente}
              obra={presupuesto.obra_id != null ? obra : null}
              modoInicial={enVivo === 'ver' ? 'ver' : 'edit'}
              onCerrar={() => { setEnVivo(false); setReintento((v) => v + 1); onEditadoEnVivo?.() }}
              onEditorCompleto={() => { setEnVivo(false); onEditadoEnVivo?.(); onEditar() }}
            />
          )}
          {mercado && <CompararMercado titulo={presupuesto.titulo} productos={mercado} total={Number(presupuesto.total)} onCerrar={() => setMercado(null)} />}


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
