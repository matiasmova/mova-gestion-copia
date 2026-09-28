import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta, hoy } from './gestionFormat'
import {
  antesYAhora,
  etiquetaModificacion,
  ETIQUETA_CAMBIO,
  type CambioTipo,
} from './presupuestoModificaciones'

type Adicional = {
  id: number
  obra_id: number
  tipo: string
  descripcion: string
  motivo: string | null
  importe: number
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'pagado'
  fecha: string
  observaciones: string | null
  medio_pago: string | null
  proveedor: string | null
  comprobante_path: string | null
  costo_id: number | null
  created_at: string
  // Detalle de los cambios al presupuesto (vacío en los adicionales comunes)
  presupuesto_id: number | null
  item_id: number | null
  cambio_tipo: CambioTipo | null
  descripcion_anterior: string | null
  cantidad_anterior: number | null
  precio_anterior: number | null
  cantidad_nueva: number | null
  precio_nuevo: number | null
}

type PresupuestoAceptado = { id: number; titulo: string; total: number }
type ItemPresupuesto = { id: number; presupuesto_id: number; descripcion: string; cantidad: number; precio_unitario: number; descuento_pct: number }
type EstadoItem = { descripcion: string; cantidad: number; precio: number; quitado: boolean; modificado: boolean }

type Props = {
  obraId: number
  /** Solo admin/encargado pueden aprobar o cargar. */
  puedeEditar?: boolean
  /** Avisa al padre que la economía cambió (para refrescar valor actualizado). */
  onCambio?: () => void
}

// Los que se pueden elegir al cargar un adicional nuevo (los cambios de ítems van por su propio formulario).
const TIPOS_SELECCIONABLES: Array<[string, string]> = [
  ['producto', 'Producto extra'],
  ['servicio', 'Servicio extra'],
  ['gasto_extra', 'Gasto extra'],
  ['ajuste', 'Ajuste'],
  ['bonificacion', 'Bonificación'],
]

const MEDIOS_PAGO: Record<string, string> = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  cheque: 'Cheque',
  otro: 'Otro',
}

const formInicial = {
  tipo: 'producto',
  descripcion: '',
  motivo: '',
  importe: '',
  fecha: hoy(),
  observaciones: '',
  medioPago: 'transferencia',
  proveedor: '',
  tieneComprobante: false,
  comprobante: null as File | null,
}

const cambioInicial = {
  presupuestoId: '',
  cambioTipo: 'reemplazo' as CambioTipo,
  itemId: '',
  descripcion: '',
  cantidad: '',
  precio: '',
  motivo: '',
  fecha: hoy(),
  aprobado: 'si',
}

const redondear = (n: number) => Math.round(n * 100) / 100
const numONull = (x: unknown) => (x == null || x === '' ? null : Number(x))
const precioNeto = (it: ItemPresupuesto) => it.precio_unitario * (1 - (Number(it.descuento_pct) || 0) / 100)

function placeholderImporte(tipo: string) {
  if (tipo === 'bonificacion') return 'Monto del descuento (se guarda como negativo solo)'
  if (tipo === 'gasto_extra') return 'Lo que costó el gasto'
  return 'Negativo = resta al valor de la obra'
}

function AdicionalesObra({ obraId, puedeEditar = true, onCambio }: Props) {
  const [adicionales, setAdicionales] = useState<Adicional[]>([])
  const [valorOriginal, setValorOriginal] = useState(0)
  const [presupuestos, setPresupuestos] = useState<PresupuestoAceptado[]>([])
  const [items, setItems] = useState<ItemPresupuesto[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [mostrarForm, setMostrarForm] = useState<'adicional' | 'cambio' | null>(null)
  const [form, setForm] = useState(formInicial)
  const [cambioForm, setCambioForm] = useState(cambioInicial)
  const [guardando, setGuardando] = useState(false)
  const [errorForm, setErrorForm] = useState('')
  const [procesando, setProcesando] = useState<number | null>(null)
  const [comprobanteAbierto, setComprobanteAbierto] = useState<{ id: number; url: string } | null>(null)
  const [abriendoComprobante, setAbriendoComprobante] = useState<number | null>(null)
  const [errorComprobante, setErrorComprobante] = useState('')

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      const [rAdic, rPres] = await Promise.all([
        supabase
          .from('adicionales')
          .select('*')
          .eq('obra_id', obraId)
          .order('fecha', { ascending: false })
          .order('id', { ascending: false }),
        supabase
          .from('presupuestos')
          .select('id, titulo, total, estado, activo')
          .eq('obra_id', obraId),
      ])
      if (!vigente) return
      if (rAdic.error) {
        console.error(rAdic.error)
        setError('No se pudieron cargar los adicionales de la obra.')
        setCargando(false)
        return
      }
      const aceptados = (rPres.data ?? [])
        .filter((p) => p.activo !== false && p.estado === 'aceptado')
        .map((p) => ({ id: p.id, titulo: p.titulo, total: Number(p.total || 0) })) as PresupuestoAceptado[]

      let itemsCargados: ItemPresupuesto[] = []
      if (aceptados.length) {
        const rItems = await supabase
          .from('presupuesto_items')
          .select('id, presupuesto_id, descripcion, cantidad, precio_unitario, descuento_pct')
          .in('presupuesto_id', aceptados.map((p) => p.id))
          .order('orden', { ascending: true })
        if (!vigente) return
        if (rItems.error) console.error(rItems.error)
        itemsCargados = (rItems.data ?? []).map((it) => ({
          ...it, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), descuento_pct: Number(it.descuento_pct ?? 0),
        })) as ItemPresupuesto[]
      }

      setPresupuestos(aceptados)
      setItems(itemsCargados)
      setValorOriginal(aceptados.reduce((s, p) => s + p.total, 0))
      setAdicionales(
        (rAdic.data ?? []).map((a) => ({
          ...a,
          importe: Number(a.importe),
          presupuesto_id: numONull(a.presupuesto_id),
          item_id: numONull(a.item_id),
          cambio_tipo: a.cambio_tipo ?? null,
          descripcion_anterior: a.descripcion_anterior ?? null,
          cantidad_anterior: numONull(a.cantidad_anterior),
          precio_anterior: numONull(a.precio_anterior),
          cantidad_nueva: numONull(a.cantidad_nueva),
          precio_nuevo: numONull(a.precio_nuevo),
        })) as Adicional[],
      )
      setCargando(false)
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [obraId, revision])

  const aprobados = adicionales
    .filter((a) => a.estado === 'aprobado')
    .reduce((s, a) => s + a.importe, 0)
  const pendientes = adicionales
    .filter((a) => a.estado === 'pendiente')
    .reduce((s, a) => s + a.importe, 0)
  const valorActualizado = valorOriginal + aprobados

  // Cómo está HOY cada ítem del presupuesto: el original, o el último cambio cargado (no rechazado).
  function estadoItem(item: ItemPresupuesto): EstadoItem {
    const cambios = adicionales
      .filter((a) => a.tipo === 'cambio' && a.item_id === item.id && a.estado !== 'rechazado')
      .sort((x, y) => (x.fecha ?? '').localeCompare(y.fecha ?? '') || x.id - y.id)
    const ultimo = cambios[cambios.length - 1]
    const base: EstadoItem = { descripcion: item.descripcion, cantidad: item.cantidad, precio: precioNeto(item), quitado: false, modificado: false }
    if (!ultimo) return base
    if (ultimo.cambio_tipo === 'quitado') return { ...base, quitado: true, modificado: true }
    return {
      descripcion: ultimo.descripcion,
      cantidad: ultimo.cantidad_nueva ?? base.cantidad,
      precio: ultimo.precio_nuevo ?? base.precio,
      quitado: false,
      modificado: true,
    }
  }

  const presupuestoCambio = presupuestos.length === 1 ? presupuestos[0].id : Number(cambioForm.presupuestoId) || null
  const itemsDelPresupuesto = items.filter((it) => it.presupuesto_id === presupuestoCambio)
  const itemElegido = itemsDelPresupuesto.find((it) => it.id === Number(cambioForm.itemId))
  const estadoElegido = itemElegido ? estadoItem(itemElegido) : null

  // Diferencia de plata del cambio, calculada sola.
  const cantNueva = Number(cambioForm.cantidad) || 0
  const precioNuevo = cambioForm.cambioTipo === 'cantidad' ? (estadoElegido?.precio ?? 0) : Number(cambioForm.precio) || 0
  const importeAnterior = cambioForm.cambioTipo === 'agregado' || !estadoElegido ? 0 : estadoElegido.cantidad * estadoElegido.precio
  const importeNuevo = cambioForm.cambioTipo === 'quitado' ? 0 : cantNueva * precioNuevo
  const diferencia = redondear(importeNuevo - importeAnterior)

  const cambio = (campo: string, valor: string) =>
    setForm((actual) => ({ ...actual, [campo]: valor }))
  const cambioC = (campo: string, valor: string) =>
    setCambioForm((actual) => ({ ...actual, [campo]: valor }))

  function elegirItem(itemId: string) {
    const it = itemsDelPresupuesto.find((x) => x.id === Number(itemId))
    const est = it ? estadoItem(it) : null
    setCambioForm((actual) => ({
      ...actual,
      itemId,
      descripcion: est?.descripcion ?? '',
      cantidad: est ? String(est.cantidad) : '',
      precio: est ? String(redondear(est.precio)) : '',
    }))
  }

  function elegirTipoCambio(tipo: CambioTipo) {
    setCambioForm((actual) => ({
      ...actual,
      cambioTipo: tipo,
      itemId: tipo === 'agregado' ? '' : actual.itemId,
      descripcion: tipo === 'agregado' ? '' : actual.descripcion,
      cantidad: tipo === 'agregado' ? '1' : actual.cantidad,
      precio: tipo === 'agregado' ? '' : actual.precio,
    }))
  }

  function cambiarTipo(tipo: string) {
    setForm((actual) => ({
      ...actual,
      tipo,
      // Los campos de pago solo aplican a Gasto extra: los limpiamos al salir de ese tipo.
      ...(tipo !== 'gasto_extra'
        ? { medioPago: 'transferencia', proveedor: '', tieneComprobante: false, comprobante: null }
        : {}),
    }))
  }

  function abrirForm(cual: 'adicional' | 'cambio') {
    setErrorForm('')
    if (mostrarForm === cual) { setMostrarForm(null); return }
    setForm(formInicial)
    setCambioForm({ ...cambioInicial, fecha: hoy() })
    setMostrarForm(cual)
  }

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    setErrorForm('')
    const importeIngresado = Number(form.importe)
    if (!form.descripcion.trim()) {
      setErrorForm('Escribí una descripción del adicional.')
      return
    }
    if (!Number.isFinite(importeIngresado) || importeIngresado === 0) {
      setErrorForm('Ingresá un importe distinto de cero.')
      return
    }
    if (form.tipo === 'gasto_extra' && form.tieneComprobante && !form.comprobante) {
      setErrorForm('Adjuntá el comprobante o desmarcá la casilla.')
      return
    }

    setGuardando(true)

    let comprobante_path: string | null = null
    if (form.tipo === 'gasto_extra' && form.tieneComprobante && form.comprobante) {
      const nombreSeguro = form.comprobante.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const ruta = `${obraId}/adicional-${Date.now()}-${nombreSeguro}`
      const subida = await supabase.storage.from('comprobantes').upload(ruta, form.comprobante)
      if (subida.error) {
        console.error(subida.error)
        setErrorForm(`No se pudo subir el comprobante: ${subida.error.message || 'volvé a intentar.'}`)
        setGuardando(false)
        return
      }
      comprobante_path = ruta
    }

    // La bonificación siempre resta del valor de la obra, sin importar el signo que haya tipeado.
    const importe = form.tipo === 'bonificacion' ? -Math.abs(importeIngresado) : importeIngresado

    const { error: fallo } = await supabase.from('adicionales').insert({
      obra_id: obraId,
      tipo: form.tipo,
      descripcion: form.descripcion.trim(),
      motivo: form.motivo.trim() || null,
      importe,
      fecha: form.fecha,
      observaciones: form.observaciones.trim() || null,
      estado: 'pendiente',
      medio_pago: form.tipo === 'gasto_extra' ? form.medioPago : null,
      proveedor: form.tipo === 'gasto_extra' ? form.proveedor.trim() || null : null,
      comprobante_path,
    })
    if (fallo) {
      console.error(fallo)
      setErrorForm(`No se pudo guardar el adicional: ${fallo.message || 'volvé a intentar.'}`)
      setGuardando(false)
      return
    }
    setGuardando(false)
    setForm(formInicial)
    setMostrarForm(null)
    setRevision((v) => v + 1)
    onCambio?.()
  }

  async function guardarCambio(evento: FormEvent) {
    evento.preventDefault()
    setErrorForm('')
    const tipo = cambioForm.cambioTipo
    if (!presupuestoCambio) { setErrorForm('Elegí el presupuesto que se modifica.'); return }
    if (tipo !== 'agregado' && !estadoElegido) { setErrorForm('Elegí el ítem del presupuesto que cambia.'); return }
    if (estadoElegido?.quitado) { setErrorForm('Ese ítem ya fue quitado.'); return }
    if ((tipo === 'reemplazo' || tipo === 'agregado') && !cambioForm.descripcion.trim()) { setErrorForm('Escribí cómo queda el ítem.'); return }
    if (tipo !== 'quitado' && !(cantNueva > 0)) { setErrorForm('Ingresá una cantidad mayor que cero.'); return }
    if ((tipo === 'reemplazo' || tipo === 'agregado') && !(precioNuevo >= 0 && cambioForm.precio !== '')) { setErrorForm('Ingresá el precio unitario.'); return }

    setGuardando(true)
    const { error: fallo } = await supabase.from('adicionales').insert({
      obra_id: obraId,
      tipo: 'cambio',
      descripcion: tipo === 'reemplazo' || tipo === 'agregado' ? cambioForm.descripcion.trim() : estadoElegido!.descripcion,
      motivo: cambioForm.motivo.trim() || null,
      importe: diferencia,
      fecha: cambioForm.fecha,
      observaciones: null,
      estado: cambioForm.aprobado === 'si' ? 'aprobado' : 'pendiente',
      presupuesto_id: presupuestoCambio,
      item_id: tipo === 'agregado' ? null : itemElegido!.id,
      cambio_tipo: tipo,
      descripcion_anterior: tipo === 'agregado' ? null : estadoElegido!.descripcion,
      cantidad_anterior: tipo === 'agregado' ? null : estadoElegido!.cantidad,
      precio_anterior: tipo === 'agregado' ? null : redondear(estadoElegido!.precio),
      cantidad_nueva: tipo === 'quitado' ? null : cantNueva,
      precio_nuevo: tipo === 'quitado' ? null : redondear(precioNuevo),
    })
    if (fallo) {
      console.error(fallo)
      setErrorForm(
        fallo.message?.includes('column')
          ? 'Falta ejecutar supabase-cambios-presupuesto.sql en Supabase (la tabla todavía no tiene las columnas para los cambios).'
          : `No se pudo guardar el cambio: ${fallo.message || 'volvé a intentar.'}`,
      )
      setGuardando(false)
      return
    }
    setGuardando(false)
    setCambioForm(cambioInicial)
    setMostrarForm(null)
    setRevision((v) => v + 1)
    onCambio?.()
  }

  // Al aprobar un Gasto extra, se refleja también como costo de la obra (impacta
  // Movimientos y Rentabilidad); si se desaprueba, el costo asociado se retira para
  // no dejarlo duplicado. El resto de los tipos solo cambia de estado.
  async function cambiarEstado(a: Adicional, estado: Adicional['estado']) {
    setProcesando(a.id)
    try {
      if (estado === 'aprobado' && a.tipo === 'gasto_extra' && !a.costo_id) {
        const { data: costoCreado, error: errorCosto } = await supabase
          .from('costos')
          .insert({
            obra_id: obraId,
            tipo: 'gasto_extra',
            descripcion: a.proveedor ? `${a.descripcion} (${a.proveedor})` : a.descripcion,
            monto: Math.abs(a.importe),
            fecha: a.fecha,
          })
          .select('id')
          .single()
        if (errorCosto) throw errorCosto

        const { error: errorUpd } = await supabase
          .from('adicionales')
          .update({ estado, costo_id: costoCreado?.id ?? null })
          .eq('id', a.id)
        if (errorUpd) throw errorUpd
      } else if (estado !== 'aprobado' && a.costo_id) {
        const { error: errorDel } = await supabase.from('costos').delete().eq('id', a.costo_id)
        if (errorDel) throw errorDel

        const { error: errorUpd } = await supabase
          .from('adicionales')
          .update({ estado, costo_id: null })
          .eq('id', a.id)
        if (errorUpd) throw errorUpd
      } else {
        const { error: errorUpd } = await supabase.from('adicionales').update({ estado }).eq('id', a.id)
        if (errorUpd) throw errorUpd
      }
    } catch (fallo) {
      console.error(fallo)
      const mensaje = fallo instanceof Error ? fallo.message : String(fallo)
      setError(`No se pudo actualizar el estado: ${mensaje}`)
      setProcesando(null)
      return
    }
    setProcesando(null)
    setRevision((v) => v + 1)
    onCambio?.()
  }

  async function verComprobante(a: Adicional) {
    if (!a.comprobante_path || abriendoComprobante !== null) return
    setAbriendoComprobante(a.id)
    setComprobanteAbierto(null)
    setErrorComprobante('')
    try {
      const resultado = await supabase.storage.from('comprobantes').createSignedUrl(a.comprobante_path, 300)
      if (resultado.error || !resultado.data?.signedUrl) {
        throw resultado.error ?? new Error('No se recibió un enlace al comprobante')
      }
      setComprobanteAbierto({ id: a.id, url: resultado.data.signedUrl })
    } catch (fallo) {
      console.error(fallo)
      setErrorComprobante('No se pudo abrir el comprobante. Volvé a intentar.')
    } finally {
      setAbriendoComprobante(null)
    }
  }

  const badge = (estado: Adicional['estado']) =>
    estado === 'aprobado' || estado === 'pagado'
      ? 'adicBadge aprobado'
      : estado === 'rechazado'
        ? 'adicBadge rechazado'
        : 'adicBadge pendiente'

  const hayItems = items.length > 0

  return (
    <section className="obraFotosSeccion" aria-label="Cambios y adicionales de la obra">
      <div className="seguimientoAcciones">
        <div>
          <h3>Cambios y adicionales</h3>
          <p>El presupuesto aceptado no se modifica: acá se registra cada cambio (modelos, cantidades, ítems agregados o quitados) y cada adicional. Los aprobados ajustan el valor de la obra y aparecen al final del presupuesto.</p>
        </div>
        {puedeEditar && (
          <div className="adicAcciones">
            {hayItems && (
              <button type="button" className="newButton" onClick={() => abrirForm('cambio')}>
                {mostrarForm === 'cambio' ? 'Cancelar' : '🔁 Cambio al presupuesto'}
              </button>
            )}
            <button type="button" className={hayItems ? 'editButton' : 'newButton'} onClick={() => abrirForm('adicional')}>
              {mostrarForm === 'adicional' ? 'Cancelar' : '+ Nuevo adicional'}
            </button>
          </div>
        )}
      </div>

      {!cargando && !error && (
        <div className="adicResumen">
          <div>
            <span>Valor original</span>
            <strong>{moneda(valorOriginal)}</strong>
            <small>Presupuestos aceptados</small>
          </div>
          <div>
            <span>Cambios y adicionales</span>
            <strong className={aprobados >= 0 ? 'positivo' : 'negativo'}>
              {aprobados >= 0 ? '+' : ''}{moneda(aprobados)}
            </strong>
            <small>Aprobados</small>
          </div>
          <div className="adicDestacado">
            <span>Valor actualizado</span>
            <strong>{moneda(valorActualizado)}</strong>
            <small>Original + aprobados</small>
          </div>
          <div>
            <span>Pendientes de aprobar</span>
            <strong>{moneda(pendientes)}</strong>
            <small>{adicionales.filter((a) => a.estado === 'pendiente').length} sin resolver</small>
          </div>
        </div>
      )}

      {/* ---- Cambio al presupuesto ---- */}
      {mostrarForm === 'cambio' && puedeEditar && (
        <form className="clienteForm adicForm" onSubmit={guardarCambio}>
          <div className="formGrid">
            {presupuestos.length > 1 && (
              <label className="adicAncho">
                Presupuesto
                <select value={cambioForm.presupuestoId} onChange={(e) => setCambioForm({ ...cambioInicial, presupuestoId: e.target.value, fecha: cambioForm.fecha })}>
                  <option value="">Elegí el presupuesto</option>
                  {presupuestos.map((p) => <option key={p.id} value={p.id}>#{String(p.id).padStart(4, '0')} · {p.titulo}</option>)}
                </select>
              </label>
            )}
            <label>
              Qué cambia
              <select value={cambioForm.cambioTipo} onChange={(e) => elegirTipoCambio(e.target.value as CambioTipo)}>
                {(Object.keys(ETIQUETA_CAMBIO) as CambioTipo[]).map((t) => <option key={t} value={t}>{ETIQUETA_CAMBIO[t]}</option>)}
              </select>
            </label>
            <label>
              Fecha
              <input type="date" value={cambioForm.fecha} onChange={(e) => cambioC('fecha', e.target.value)} />
            </label>

            {cambioForm.cambioTipo !== 'agregado' && (
              <label className="adicAncho">
                Ítem del presupuesto *
                <select value={cambioForm.itemId} onChange={(e) => elegirItem(e.target.value)}>
                  <option value="">Elegí el ítem</option>
                  {itemsDelPresupuesto.map((it) => {
                    const est = estadoItem(it)
                    return (
                      <option key={it.id} value={it.id} disabled={est.quitado}>
                        {est.descripcion} · {est.cantidad} × {moneda(est.precio)}{est.quitado ? ' (quitado)' : est.modificado ? ' (ya modificado)' : ''}
                      </option>
                    )
                  })}
                </select>
              </label>
            )}

            {(cambioForm.cambioTipo === 'reemplazo' || cambioForm.cambioTipo === 'agregado') && (
              <label className="adicAncho">
                {cambioForm.cambioTipo === 'reemplazo' ? 'Nuevo ítem (modelo / descripción) *' : 'Ítem agregado *'}
                <input value={cambioForm.descripcion} onChange={(e) => cambioC('descripcion', e.target.value)} placeholder="Ej.: Módulo Sonoff 4 canales" />
              </label>
            )}

            {cambioForm.cambioTipo !== 'quitado' && (
              <label>
                {cambioForm.cambioTipo === 'cantidad' ? 'Cantidad nueva *' : 'Cantidad *'}
                <input type="number" min="0.001" step="0.001" value={cambioForm.cantidad} onChange={(e) => cambioC('cantidad', e.target.value)} />
              </label>
            )}

            {(cambioForm.cambioTipo === 'reemplazo' || cambioForm.cambioTipo === 'agregado') && (
              <label>
                Precio unitario *
                <input type="number" min="0" step="0.01" value={cambioForm.precio} onChange={(e) => cambioC('precio', e.target.value)} />
              </label>
            )}

            <label className="adicAncho">
              Motivo
              <input value={cambioForm.motivo} onChange={(e) => cambioC('motivo', e.target.value)} placeholder="Ej.: el cliente eligió otro modelo / faltó stock" />
            </label>
            <label>
              ¿Lo aprobó el cliente?
              <select value={cambioForm.aprobado} onChange={(e) => cambioC('aprobado', e.target.value)}>
                <option value="si">Sí, ya está aprobado</option>
                <option value="no">No, queda pendiente</option>
              </select>
            </label>
          </div>

          {(estadoElegido || cambioForm.cambioTipo === 'agregado') && (
            <div style={{ background: '#f6f7f9', borderRadius: 10, padding: '12px 14px', margin: '4px 0 10px', fontSize: 14 }}>
              {estadoElegido && <div>Antes: <strong>{estadoElegido.descripcion}</strong> · {estadoElegido.cantidad} × {moneda(estadoElegido.precio)} = {moneda(importeAnterior)}</div>}
              <div>
                Ahora: {cambioForm.cambioTipo === 'quitado'
                  ? <strong>se quita</strong>
                  : <><strong>{cambioForm.cambioTipo === 'cantidad' ? estadoElegido?.descripcion : cambioForm.descripcion || '—'}</strong> · {cantNueva} × {moneda(precioNuevo)} = {moneda(importeNuevo)}</>}
              </div>
              <div style={{ marginTop: 6 }}>
                Diferencia: <strong style={{ color: diferencia > 0 ? '#b86608' : diferencia < 0 ? '#23764e' : undefined }}>
                  {diferencia > 0 ? '+ ' : diferencia < 0 ? '− ' : ''}{moneda(Math.abs(diferencia))}
                </strong>
                {diferencia !== 0 && <small style={{ color: 'var(--mova-muted)' }}> · {diferencia > 0 ? 'suma' : 'resta'} al valor de la obra</small>}
              </div>
            </div>
          )}

          {errorForm && <p className="loginError">{errorForm}</p>}
          <div className="formActions">
            <button type="button" className="cancelButton" onClick={() => setMostrarForm(null)}>Cancelar</button>
            <button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar cambio'}</button>
          </div>
        </form>
      )}

      {/* ---- Adicional común ---- */}
      {mostrarForm === 'adicional' && puedeEditar && (
        <form className="clienteForm adicForm" onSubmit={guardar}>
          <div className="formGrid">
            <label>
              Tipo
              <select value={form.tipo} onChange={(e) => cambiarTipo(e.target.value)}>
                {TIPOS_SELECCIONABLES.map(([valor, texto]) => (
                  <option key={valor} value={valor}>{texto}</option>
                ))}
              </select>
            </label>
            <label>
              Importe *
              <input
                type="number"
                step="0.01"
                required
                value={form.importe}
                onChange={(e) => cambio('importe', e.target.value)}
                placeholder={placeholderImporte(form.tipo)}
              />
            </label>
            <label>
              Fecha
              <input type="date" value={form.fecha} onChange={(e) => cambio('fecha', e.target.value)} />
            </label>
            <label className="adicAncho">
              Descripción *
              <input
                value={form.descripcion}
                onChange={(e) => cambio('descripcion', e.target.value)}
                placeholder="Ej.: 3 tomas adicionales en cocina"
              />
            </label>
            <label className="adicAncho">
              Motivo
              <input
                value={form.motivo}
                onChange={(e) => cambio('motivo', e.target.value)}
                placeholder="Ej.: pedido del cliente / cambio de plano"
              />
            </label>
            <label className="adicAncho">
              Observaciones
              <input value={form.observaciones} onChange={(e) => cambio('observaciones', e.target.value)} />
            </label>
          </div>

          {form.tipo === 'gasto_extra' && (
            <div className="formGrid" style={{ marginTop: '4px', paddingTop: '14px', borderTop: '1px dashed #e2e5e9' }}>
              <label>
                Cómo se pagó
                <select value={form.medioPago} onChange={(e) => cambio('medioPago', e.target.value)}>
                  {Object.entries(MEDIOS_PAGO).map(([valor, texto]) => (
                    <option key={valor} value={valor}>{texto}</option>
                  ))}
                </select>
              </label>
              <label>
                Dónde (proveedor / lugar)
                <input
                  value={form.proveedor}
                  onChange={(e) => cambio('proveedor', e.target.value)}
                  placeholder="Ej.: Ferretería Pérez"
                />
              </label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={form.tieneComprobante}
                  onChange={(e) =>
                    setForm((actual) => ({
                      ...actual,
                      tieneComprobante: e.target.checked,
                      comprobante: e.target.checked ? actual.comprobante : null,
                    }))
                  }
                  style={{ width: 'auto' }}
                />
                <span>Tengo factura / comprobante</span>
              </label>
              {form.tieneComprobante && (
                <label className="adicAncho">
                  Adjuntar comprobante
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) =>
                      setForm((actual) => ({ ...actual, comprobante: e.target.files?.[0] ?? null }))
                    }
                  />
                </label>
              )}
            </div>
          )}

          {errorForm && <p className="loginError">{errorForm}</p>}
          <div className="formActions">
            <button type="button" className="cancelButton" onClick={() => setMostrarForm(null)}>Cancelar</button>
            <button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar adicional'}</button>
          </div>
        </form>
      )}

      {cargando && <p role="status">Cargando cambios y adicionales...</p>}
      {error && <p className="loginError" role="alert">{error}</p>}
      {errorComprobante && <p className="loginError" role="alert">{errorComprobante}</p>}

      {!cargando && !error && (
        adicionales.length === 0 ? (
          <p className="adicVacio">Todavía no hay cambios ni adicionales cargados en esta obra.</p>
        ) : (
          <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Detalle</th>
                  <th>Pago</th>
                  <th>Importe</th>
                  <th>Estado</th>
                  {puedeEditar && <th>Acción</th>}
                </tr>
              </thead>
              <tbody>
                {adicionales.map((a) => {
                  const { antes, ahora } = antesYAhora(a, moneda)
                  return (
                    <tr key={a.id}>
                      <td>{fechaCorta(a.fecha)}</td>
                      <td>{etiquetaModificacion(a)}</td>
                      <td>
                        <strong>{a.descripcion}</strong>
                        {(antes || ahora) && (
                          <><br /><small>{antes ? `Antes: ${antes}` : ''}{antes && ahora ? ' → ' : ''}{ahora ? `Ahora: ${ahora}` : ''}</small></>
                        )}
                        {(a.motivo || a.observaciones) && (
                          <><br /><small>{[a.motivo, a.observaciones].filter(Boolean).join(' · ')}</small></>
                        )}
                      </td>
                      <td>
                        {a.tipo === 'gasto_extra' ? (
                          <>
                            <small>{[a.medio_pago ? MEDIOS_PAGO[a.medio_pago] ?? a.medio_pago : null, a.proveedor].filter(Boolean).join(' · ') || '—'}</small>
                            {a.comprobante_path ? (
                              <div>
                                <button type="button" className="editButton" disabled={abriendoComprobante !== null} onClick={() => void verComprobante(a)}>
                                  {abriendoComprobante === a.id ? 'Preparando...' : 'Ver comprobante'}
                                </button>
                                {comprobanteAbierto?.id === a.id && (
                                  <div><a href={comprobanteAbierto.url} target="_blank" rel="noopener noreferrer">Abrir archivo (enlace por 5 minutos)</a></div>
                                )}
                              </div>
                            ) : (
                              <div><small>Sin comprobante</small></div>
                            )}
                          </>
                        ) : '—'}
                      </td>
                      <td className={a.importe < 0 ? 'negativo' : ''}>
                        <strong>{a.importe >= 0 ? '' : '−'}{moneda(Math.abs(a.importe))}</strong>
                      </td>
                      <td><span className={badge(a.estado)}>{a.estado}</span></td>
                      {puedeEditar && (
                        <td>
                          {a.estado === 'pendiente' ? (
                            <div className="adicAcciones">
                              <button type="button" className="adicOk" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'aprobado')}>Aprobar</button>
                              <button type="button" className="adicNo" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'rechazado')}>Rechazar</button>
                            </div>
                          ) : a.estado === 'aprobado' && a.tipo === 'gasto_extra' ? (
                            <div className="adicAcciones">
                              <button type="button" className="adicOk" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'pagado')}>✓ Pagado</button>
                              <button type="button" className="editButton" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'pendiente')}>Volver a pendiente</button>
                            </div>
                          ) : a.estado === 'pagado' ? (
                            <button type="button" className="editButton" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'aprobado')}>Deshacer pago</button>
                          ) : (
                            <button type="button" className="editButton" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'pendiente')}>Volver a pendiente</button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  )
}

export default AdicionalesObra
