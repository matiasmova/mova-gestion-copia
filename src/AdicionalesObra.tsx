import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta, hoy } from './gestionFormat'
import { confirmarEliminacion } from './confirmar'
import {
  antesYAhora,
  etiquetaModificacion,
  type CambioTipo,
} from './presupuestoModificaciones'
import CampoNumero from './CampoNumero'

// Cambios y adicionales de la obra.
// · Arriba, el presupuesto aceptado tal como está hoy: cada ítem se modifica o
//   se quita desde su propia fila, y se pueden agregar ítems.
// · Después, un adicional rápido en una línea.
// · Abajo, el historial en tarjetas con aprobar / rechazar / editar / eliminar.

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
type EstadoItem = { descripcion: string; cantidad: number; precio: number; quitado: boolean; modificado: boolean; pendiente: boolean }

type Props = {
  obraId: number
  /** Solo admin/encargado pueden aprobar o cargar. */
  puedeEditar?: boolean
  /** Avisa al padre que la economía cambió (para refrescar valor actualizado). */
  onCambio?: () => void
  /** Abierto desde "Registrar": elige el tipo y lleva al formulario. */
  abrir?: { tipo: string; n: number } | null
}

// Tipos del adicional rápido (los cambios de ítems se hacen desde el presupuesto).
const TIPOS_RAPIDOS: Array<[string, string]> = [
  ['producto', 'Producto extra'],
  ['servicio', 'Servicio extra'],
  ['gasto_extra', 'Gasto extra'],
  ['bonificacion', 'Descuento'],
  ['ajuste', 'Ajuste'],
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
  aprobado: false,
  medioPago: 'transferencia',
  proveedor: '',
  comprobante: null as File | null,
}

// Editor de un ítem del presupuesto (modificar, quitar o agregar).
type EditorItem = {
  modo: 'modificar' | 'quitar' | 'agregar'
  presupuestoId: number
  itemId: number | null
  descripcion: string
  cantidad: string
  precio: string
  motivo: string
  aprobado: boolean
}

// Edición de un registro del historial.
type EdicionRegistro = { id: number; descripcion: string; importe: string; cantidad: string; precio: string; motivo: string; observaciones: string; fecha: string; proveedor: string; medioPago: string }

type Filtro = 'todos' | 'pendiente' | 'aprobado'

const redondear = (n: number) => Math.round(n * 100) / 100
const numONull = (x: unknown) => (x == null || x === '' ? null : Number(x))
const precioNeto = (it: ItemPresupuesto) => it.precio_unitario * (1 - (Number(it.descuento_pct) || 0) / 100)
const conSigno = (n: number) => `${n > 0 ? '+ ' : n < 0 ? '− ' : ''}${moneda(Math.abs(n))}`
const ESTADO_TEXTO: Record<Adicional['estado'], string> = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado', pagado: 'Pagado' }

function AdicionalesObra({ obraId, puedeEditar = true, onCambio, abrir }: Props) {
  const [adicionales, setAdicionales] = useState<Adicional[]>([])
  const [valorOriginal, setValorOriginal] = useState(0)
  const [presupuestos, setPresupuestos] = useState<PresupuestoAceptado[]>([])
  const [items, setItems] = useState<ItemPresupuesto[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [form, setForm] = useState(formInicial)
  const [masDetalles, setMasDetalles] = useState(false)
  const [editor, setEditor] = useState<EditorItem | null>(null)
  const [edicion, setEdicion] = useState<EdicionRegistro | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [guardando, setGuardando] = useState<'adicional' | 'item' | 'edicion' | null>(null)
  const [errorForm, setErrorForm] = useState('')
  const [errorEditor, setErrorEditor] = useState('')
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

  useEffect(() => {
    if (!abrir || cargando || Date.now() - abrir.n > 15000) return
    setForm((f) => ({ ...f, tipo: abrir.tipo }))
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>('[data-registrar]')
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el?.querySelector<HTMLInputElement>('.caDescInput')?.focus({ preventScroll: true })
    }, 150)
  }, [abrir?.n, cargando]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const base: EstadoItem = { descripcion: item.descripcion, cantidad: item.cantidad, precio: precioNeto(item), quitado: false, modificado: false, pendiente: false }
    if (!ultimo) return base
    const pendiente = ultimo.estado === 'pendiente'
    if (ultimo.cambio_tipo === 'quitado') return { ...base, quitado: true, modificado: true, pendiente }
    return {
      descripcion: ultimo.descripcion,
      cantidad: ultimo.cantidad_nueva ?? base.cantidad,
      precio: ultimo.precio_nuevo ?? base.precio,
      quitado: false,
      modificado: true,
      pendiente,
    }
  }

  function terminar() {
    setRevision((v) => v + 1)
    onCambio?.()
  }

  // ---------- Presupuesto: modificar, quitar o agregar ítems ----------

  function abrirEditor(modo: EditorItem['modo'], presupuestoId: number, item?: ItemPresupuesto) {
    setErrorEditor('')
    const est = item ? estadoItem(item) : null
    setEditor({
      modo,
      presupuestoId,
      itemId: item?.id ?? null,
      descripcion: est?.descripcion ?? '',
      cantidad: est ? String(est.cantidad) : '1',
      precio: est ? String(redondear(est.precio)) : '',
      motivo: '',
      aprobado: true,
    })
  }

  const itemEditado = editor?.itemId != null ? items.find((it) => it.id === editor.itemId) ?? null : null
  const estadoEditado = itemEditado ? estadoItem(itemEditado) : null
  const cantEditor = Number(editor?.cantidad) || 0
  const precioEditor = Number(editor?.precio) || 0
  const antesEditor = estadoEditado ? estadoEditado.cantidad * estadoEditado.precio : 0
  const ahoraEditor = editor?.modo === 'quitar' ? 0 : cantEditor * precioEditor
  const diferenciaEditor = redondear(ahoraEditor - antesEditor)

  async function guardarItem(evento: FormEvent) {
    evento.preventDefault()
    if (!editor) return
    setErrorEditor('')
    const { modo } = editor
    if (modo !== 'agregar' && !estadoEditado) { setErrorEditor('No se encontró el ítem.'); return }
    if (modo !== 'quitar') {
      if (!editor.descripcion.trim()) { setErrorEditor('Escribí la descripción del ítem.'); return }
      if (!(cantEditor > 0)) { setErrorEditor('Ingresá una cantidad mayor que cero.'); return }
      if (editor.precio === '' || !(precioEditor >= 0)) { setErrorEditor('Ingresá el precio unitario.'); return }
    }
    // Qué tipo de cambio es, según lo que se tocó.
    let cambioTipo: CambioTipo = 'agregado'
    if (modo === 'quitar') cambioTipo = 'quitado'
    else if (modo === 'modificar') {
      const cambioDescripcion = editor.descripcion.trim() !== estadoEditado!.descripcion.trim()
      const cambioPrecio = Math.abs(precioEditor - estadoEditado!.precio) > 0.005
      const cambioCantidad = Math.abs(cantEditor - estadoEditado!.cantidad) > 0.0005
      if (!cambioDescripcion && !cambioPrecio && !cambioCantidad) { setErrorEditor('No cambiaste nada del ítem.'); return }
      cambioTipo = cambioDescripcion || cambioPrecio ? 'reemplazo' : 'cantidad'
    }

    setGuardando('item')
    const { error: fallo } = await supabase.from('adicionales').insert({
      obra_id: obraId,
      tipo: 'cambio',
      descripcion: modo === 'quitar' ? estadoEditado!.descripcion : editor.descripcion.trim(),
      motivo: editor.motivo.trim() || null,
      importe: diferenciaEditor,
      fecha: hoy(),
      observaciones: null,
      estado: editor.aprobado ? 'aprobado' : 'pendiente',
      presupuesto_id: editor.presupuestoId,
      item_id: modo === 'agregar' ? null : editor.itemId,
      cambio_tipo: cambioTipo,
      descripcion_anterior: modo === 'agregar' ? null : estadoEditado!.descripcion,
      cantidad_anterior: modo === 'agregar' ? null : estadoEditado!.cantidad,
      precio_anterior: modo === 'agregar' ? null : redondear(estadoEditado!.precio),
      cantidad_nueva: modo === 'quitar' ? null : cantEditor,
      precio_nuevo: modo === 'quitar' ? null : redondear(precioEditor),
    })
    setGuardando(null)
    if (fallo) {
      console.error(fallo)
      setErrorEditor(
        fallo.message?.includes('column')
          ? 'Falta ejecutar supabase-cambios-presupuesto.sql en Supabase (la tabla todavía no tiene las columnas para los cambios).'
          : `No se pudo guardar el cambio: ${fallo.message || 'volvé a intentar.'}`,
      )
      return
    }
    setEditor(null)
    terminar()
  }

  // ---------- Adicional rápido ----------

  async function guardarAdicional(evento: FormEvent) {
    evento.preventDefault()
    setErrorForm('')
    const importeIngresado = Number(form.importe)
    if (!form.descripcion.trim()) { setErrorForm('Escribí una descripción.'); return }
    if (!Number.isFinite(importeIngresado) || importeIngresado === 0) { setErrorForm('Ingresá un importe distinto de cero.'); return }

    setGuardando('adicional')
    let comprobante_path: string | null = null
    if (form.tipo === 'gasto_extra' && form.comprobante) {
      const nombreSeguro = form.comprobante.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const ruta = `${obraId}/adicional-${Date.now()}-${nombreSeguro}`
      const subida = await supabase.storage.from('comprobantes').upload(ruta, form.comprobante)
      if (subida.error) {
        console.error(subida.error)
        setErrorForm(`No se pudo subir el comprobante: ${subida.error.message || 'volvé a intentar.'}`)
        setGuardando(null)
        return
      }
      comprobante_path = ruta
    }

    // Descuento: siempre resta. Gasto extra: siempre positivo (es un reintegro).
    const importe = form.tipo === 'bonificacion' ? -Math.abs(importeIngresado) : form.tipo === 'gasto_extra' ? Math.abs(importeIngresado) : importeIngresado
    // El Gasto extra se carga pendiente: al aprobarlo se genera su costo en la obra.
    const aprobado = form.aprobado && form.tipo !== 'gasto_extra'

    const { error: fallo } = await supabase.from('adicionales').insert({
      obra_id: obraId,
      tipo: form.tipo,
      descripcion: form.descripcion.trim(),
      motivo: form.motivo.trim() || null,
      importe,
      fecha: form.fecha || hoy(),
      observaciones: form.observaciones.trim() || null,
      estado: aprobado ? 'aprobado' : 'pendiente',
      medio_pago: form.tipo === 'gasto_extra' ? form.medioPago : null,
      proveedor: form.tipo === 'gasto_extra' ? form.proveedor.trim() || null : null,
      comprobante_path,
    })
    setGuardando(null)
    if (fallo) {
      console.error(fallo)
      if (comprobante_path) await supabase.storage.from('comprobantes').remove([comprobante_path])
      setErrorForm(`No se pudo guardar: ${fallo.message || 'volvé a intentar.'}`)
      return
    }
    setForm({ ...formInicial, tipo: form.tipo, fecha: hoy() })
    setMasDetalles(false)
    terminar()
  }

  // ---------- Historial: estados, edición y borrado ----------

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
    terminar()
  }

  function abrirEdicion(a: Adicional) {
    setErrorEditor('')
    setEdicion({
      id: a.id,
      descripcion: a.descripcion,
      importe: String(a.tipo === 'bonificacion' ? Math.abs(a.importe) : a.importe),
      cantidad: a.cantidad_nueva != null ? String(a.cantidad_nueva) : '',
      precio: a.precio_nuevo != null ? String(a.precio_nuevo) : '',
      motivo: a.motivo ?? '',
      observaciones: a.observaciones ?? '',
      fecha: a.fecha?.slice(0, 10) || hoy(),
      proveedor: a.proveedor ?? '',
      medioPago: a.medio_pago ?? 'transferencia',
    })
  }

  async function guardarEdicion(a: Adicional) {
    if (!edicion) return
    setErrorEditor('')
    let cambios: Record<string, unknown>
    if (a.tipo === 'cambio') {
      const anterior = a.cambio_tipo === 'agregado' ? 0 : (a.cantidad_anterior ?? 0) * (a.precio_anterior ?? 0)
      if (a.cambio_tipo === 'quitado') {
        cambios = { motivo: edicion.motivo.trim() || null, fecha: edicion.fecha }
      } else {
        const cantidad = Number(edicion.cantidad) || 0
        const precio = a.cambio_tipo === 'cantidad' ? a.precio_nuevo ?? a.precio_anterior ?? 0 : Number(edicion.precio)
        if (!(cantidad > 0)) { setErrorEditor('Ingresá una cantidad mayor que cero.'); return }
        if (!(precio >= 0) || (a.cambio_tipo !== 'cantidad' && edicion.precio === '')) { setErrorEditor('Ingresá el precio unitario.'); return }
        if (a.cambio_tipo !== 'cantidad' && !edicion.descripcion.trim()) { setErrorEditor('Escribí la descripción.'); return }
        cambios = {
          descripcion: a.cambio_tipo === 'cantidad' ? a.descripcion : edicion.descripcion.trim(),
          cantidad_nueva: cantidad,
          precio_nuevo: redondear(precio),
          importe: redondear(cantidad * precio - anterior),
          motivo: edicion.motivo.trim() || null,
          fecha: edicion.fecha,
        }
      }
    } else {
      const valor = Number(edicion.importe)
      if (!edicion.descripcion.trim()) { setErrorEditor('Escribí una descripción.'); return }
      if (!Number.isFinite(valor) || valor === 0) { setErrorEditor('Ingresá un importe distinto de cero.'); return }
      cambios = {
        descripcion: edicion.descripcion.trim(),
        importe: a.tipo === 'bonificacion' ? -Math.abs(valor) : a.tipo === 'gasto_extra' ? Math.abs(valor) : valor,
        motivo: edicion.motivo.trim() || null,
        observaciones: edicion.observaciones.trim() || null,
        fecha: edicion.fecha,
        ...(a.tipo === 'gasto_extra' ? { proveedor: edicion.proveedor.trim() || null, medio_pago: edicion.medioPago } : {}),
      }
    }
    setGuardando('edicion')
    const { error: fallo } = await supabase.from('adicionales').update(cambios).eq('id', a.id)
    // Si el gasto ya estaba aprobado, el costo de la obra que generó se corrige igual.
    if (!fallo && a.tipo === 'gasto_extra' && a.costo_id) {
      const desc = String(cambios.descripcion ?? a.descripcion)
      const prov = a.tipo === 'gasto_extra' ? edicion.proveedor.trim() : ''
      const { error: errCosto } = await supabase.from('costos').update({ monto: Math.abs(Number(cambios.importe) || 0), descripcion: prov ? `${desc} (${prov})` : desc, fecha: edicion.fecha }).eq('id', a.costo_id)
      if (errCosto) console.error(errCosto)
    }
    setGuardando(null)
    if (fallo) { console.error(fallo); setErrorEditor(`No se pudo guardar: ${fallo.message || 'volvé a intentar.'}`); return }
    setEdicion(null)
    terminar()
  }

  async function eliminar(a: Adicional) {
    if (!confirmarEliminacion(`¿Eliminar "${a.descripcion}" (${conSigno(a.importe)})?`)) return
    setProcesando(a.id)
    const { error: fallo } = await supabase.from('adicionales').delete().eq('id', a.id)
    if (fallo) {
      console.error(fallo)
      setProcesando(null)
      setError(`No se pudo eliminar: ${fallo.message || 'volvé a intentar.'}`)
      return
    }
    if (a.comprobante_path) await supabase.storage.from('comprobantes').remove([a.comprobante_path])
    setProcesando(null)
    terminar()
  }

  // Comprobante que llegó tarde o que hay que reemplazar.
  async function cambiarComprobante(a: Adicional, archivo: File | null) {
    setProcesando(a.id); setError('')
    let ruta: string | null = null
    if (archivo) {
      const nombreSeguro = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      ruta = `${obraId}/${Date.now()}-${nombreSeguro}`
      const subida = await supabase.storage.from('comprobantes').upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (subida.error) { console.error(subida.error); setError(`No se pudo subir el comprobante: ${subida.error.message || 'volvé a intentar.'}`); setProcesando(null); return }
    } else if (!window.confirm('¿Quitar el comprobante de este gasto?')) { setProcesando(null); return }
    const { error: fallo } = await supabase.from('adicionales').update({ comprobante_path: ruta }).eq('id', a.id)
    if (fallo) {
      console.error(fallo)
      if (ruta) await supabase.storage.from('comprobantes').remove([ruta])
      setError(`No se pudo guardar el comprobante: ${fallo.message || 'volvé a intentar.'}`); setProcesando(null); return
    }
    if (a.comprobante_path) await supabase.storage.from('comprobantes').remove([a.comprobante_path])
    setProcesando(null)
    terminar()
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

  const visibles = adicionales.filter((a) =>
    filtro === 'todos' ? true : filtro === 'pendiente' ? a.estado === 'pendiente' : a.estado === 'aprobado' || a.estado === 'pagado')
  const cantPendientes = adicionales.filter((a) => a.estado === 'pendiente').length

  // Formulario en línea para modificar / quitar / agregar un ítem.
  const editorFila = (clave: string) => editor && (
    <form key={clave} className="caEditor" onSubmit={guardarItem}>
      {editor.modo === 'quitar' ? (
        <p className="caEditorTitulo">Quitar <strong>{estadoEditado?.descripcion}</strong> del presupuesto</p>
      ) : (
        <div className="caEditorCampos">
          <label className="caDesc">{editor.modo === 'agregar' ? 'Ítem nuevo' : 'Descripción / modelo'}
            <input autoFocus value={editor.descripcion} onChange={(e) => setEditor({ ...editor, descripcion: e.target.value })} placeholder="Ej.: Módulo Sonoff 4 canales" />
          </label>
          <label>Cantidad
            <div className="caStepper">
              <button type="button" aria-label="Restar uno" onClick={() => setEditor({ ...editor, cantidad: String(Math.max(0, redondear((Number(editor.cantidad) || 0) - 1))) })}>−</button>
              <CampoNumero min="0.001" value={editor.cantidad} onChange={(e) => setEditor({ ...editor, cantidad: e.target.value })} />
              <button type="button" aria-label="Sumar uno" onClick={() => setEditor({ ...editor, cantidad: String(redondear((Number(editor.cantidad) || 0) + 1)) })}>+</button>
            </div>
          </label>
          <label>Precio unitario
            <CampoNumero min="0" value={editor.precio} onChange={(e) => setEditor({ ...editor, precio: e.target.value })} />
          </label>
        </div>
      )}
      <div className="caEditorCampos">
        <label className="caDesc">Motivo (opcional)
          <input value={editor.motivo} onChange={(e) => setEditor({ ...editor, motivo: e.target.value })} placeholder="Ej.: el cliente eligió otro modelo" />
        </label>
        <label className="caCheck"><input type="checkbox" checked={editor.aprobado} onChange={(e) => setEditor({ ...editor, aprobado: e.target.checked })} /> Ya lo aprobó el cliente</label>
      </div>
      <div className="caEditorPie">
        <span>
          {estadoEditado && <>Antes {moneda(antesEditor)} · </>}Ahora {moneda(ahoraEditor)} ·{' '}
          <strong className={diferenciaEditor > 0 ? 'suma' : diferenciaEditor < 0 ? 'resta' : ''}>{conSigno(diferenciaEditor)}</strong>
        </span>
        <div>
          <button type="button" className="cancelButton" onClick={() => setEditor(null)}>Cancelar</button>
          <button className={editor.modo === 'quitar' ? 'adicNo caBtnGrande' : 'newButton'} disabled={guardando === 'item'}>
            {guardando === 'item' ? 'Guardando...' : editor.modo === 'quitar' ? 'Quitar ítem' : editor.modo === 'agregar' ? 'Agregar ítem' : 'Guardar cambio'}
          </button>
        </div>
      </div>
      {errorEditor && <p className="loginError">{errorEditor}</p>}
    </form>
  )

  return (
    <section className="obraFotosSeccion" aria-label="Cambios y adicionales de la obra">
      {!cargando && !error && (
        <div className="adicResumen">
          <div>
            <span>Valor original</span>
            <strong>{moneda(valorOriginal)}</strong>
            <small>Presupuestos aceptados</small>
          </div>
          <div>
            <span>Cambios aprobados</span>
            <strong className={aprobados >= 0 ? 'positivo' : 'negativo'}>{conSigno(aprobados)}</strong>
            <small>Suman o restan al valor</small>
          </div>
          <div className="adicDestacado">
            <span>Valor actualizado</span>
            <strong>{moneda(valorActualizado)}</strong>
            <small>Original + aprobados</small>
          </div>
          <div>
            <span>Pendientes de aprobar</span>
            <strong>{conSigno(pendientes)}</strong>
            <small>{cantPendientes} sin resolver</small>
          </div>
        </div>
      )}

      {cargando && <p role="status">Cargando cambios y adicionales...</p>}
      {error && <p className="loginError" role="alert">{error}</p>}

      {!cargando && !error && <>
        {/* ---------- Presupuesto con acciones por ítem ---------- */}
        {presupuestos.length > 0 && (
          <div className="caBloque">
            <div className="caBloqueHead">
              <h4>Presupuesto aceptado</h4>
              <p>Tocá un ítem para cambiarle el modelo, la cantidad o el precio, o quitarlo.</p>
            </div>
            {presupuestos.map((p) => {
              const itemsP = items.filter((it) => it.presupuesto_id === p.id)
              const agregados = adicionales.filter((a) => a.tipo === 'cambio' && a.cambio_tipo === 'agregado' && a.presupuesto_id === p.id && a.estado !== 'rechazado')
              return (
                <div key={p.id} className="caPresupuesto">
                  {presupuestos.length > 1 && <p className="caPresTitulo">#{String(p.id).padStart(4, '0')} · {p.titulo}</p>}
                  <ul className="caItems">
                    {itemsP.map((it) => {
                      const est = estadoItem(it)
                      const abierto = editor?.itemId === it.id
                      return (
                        <li key={it.id} className={`${est.quitado ? 'quitado' : ''} ${abierto ? 'abierto' : ''}`}>
                          <div className="caItem">
                            <div className="caItemInfo">
                              <strong>{est.descripcion}</strong>
                              <small>
                                {est.quitado ? 'Quitado' : `${est.cantidad} × ${moneda(est.precio)} = ${moneda(est.cantidad * est.precio)}`}
                                {est.modificado && <span className={`caMarca ${est.pendiente ? 'pend' : ''}`}>{est.pendiente ? 'cambio pendiente' : 'modificado'}</span>}
                              </small>
                            </div>
                            {puedeEditar && !est.quitado && !abierto && (
                              <div className="caItemAcciones">
                                <button type="button" className="editButton" onClick={() => abrirEditor('modificar', p.id, it)}>✏️ Cambiar</button>
                                <button type="button" className="adicNo" onClick={() => abrirEditor('quitar', p.id, it)} aria-label={`Quitar ${est.descripcion}`}>🗑</button>
                              </div>
                            )}
                          </div>
                          {abierto && editorFila(`ed-${it.id}`)}
                        </li>
                      )
                    })}
                    {agregados.map((a) => (
                      <li key={`ag-${a.id}`} className="agregado">
                        <div className="caItem">
                          <div className="caItemInfo">
                            <strong>{a.descripcion}</strong>
                            <small>{a.cantidad_nueva} × {moneda(a.precio_nuevo ?? 0)} = {moneda(a.importe)}<span className={`caMarca ${a.estado === 'pendiente' ? 'pend' : ''}`}>{a.estado === 'pendiente' ? 'agregado · pendiente' : 'agregado'}</span></small>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {puedeEditar && (editor?.modo === 'agregar' && editor.presupuestoId === p.id
                    ? editorFila(`ag-${p.id}`)
                    : <button type="button" className="caAgregar" onClick={() => abrirEditor('agregar', p.id)}>+ Agregar ítem al presupuesto</button>)}
                </div>
              )
            })}
          </div>
        )}

        {/* ---------- Adicional rápido ---------- */}
        {puedeEditar && (
          <form className="caBloque caRapido" data-registrar onSubmit={guardarAdicional}>
            <div className="caBloqueHead"><h4>Adicional rápido</h4><p>Algo que no estaba en el presupuesto: un extra, un gasto o un descuento.</p></div>
            <div className="caChips" role="radiogroup" aria-label="Tipo">
              {TIPOS_RAPIDOS.map(([valor, texto]) => (
                <button key={valor} type="button" role="radio" aria-checked={form.tipo === valor} className={form.tipo === valor ? 'activo' : ''} onClick={() => setForm({ ...form, tipo: valor })}>{texto}</button>
              ))}
            </div>
            <div className="caLinea">
              <input className="caDescInput" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                placeholder={form.tipo === 'gasto_extra' ? 'Ej.: Caño corrugado comprado en obra' : form.tipo === 'bonificacion' ? 'Ej.: Descuento por pago contado' : 'Ej.: 3 tomas adicionales en cocina'} />
              <CampoNumero className="caImporte" value={form.importe} onChange={(e) => setForm({ ...form, importe: e.target.value })}
                placeholder={form.tipo === 'bonificacion' ? 'Monto a descontar' : form.tipo === 'ajuste' ? 'Importe (− resta)' : 'Importe'} />
              <button className="newButton" disabled={guardando === 'adicional'}>{guardando === 'adicional' ? 'Guardando...' : 'Agregar'}</button>
            </div>
            {form.tipo === 'gasto_extra' && (
              <div className="caLinea caExtra">
                <select value={form.medioPago} onChange={(e) => setForm({ ...form, medioPago: e.target.value })} aria-label="Cómo se pagó">
                  {Object.entries(MEDIOS_PAGO).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                </select>
                <input value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} placeholder="Dónde (proveedor / lugar)" />
                <label className="caArchivo">📎 {form.comprobante ? form.comprobante.name : 'Adjuntar comprobante'}
                  <input type="file" accept="image/*,application/pdf" onChange={(e) => setForm({ ...form, comprobante: e.target.files?.[0] ?? null })} />
                </label>
              </div>
            )}
            <div className="caOpciones">
              {form.tipo !== 'gasto_extra'
                ? <label className="caCheck"><input type="checkbox" checked={form.aprobado} onChange={(e) => setForm({ ...form, aprobado: e.target.checked })} /> Ya lo aprobó el cliente</label>
                : <small>El gasto extra queda pendiente: al aprobarlo se suma como costo de la obra.</small>}
              <button type="button" className="caLink" onClick={() => setMasDetalles((v) => !v)}>{masDetalles ? '− menos detalles' : '+ más detalles'}</button>
            </div>
            {masDetalles && (
              <div className="caLinea caExtra">
                <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} aria-label="Fecha" />
                <input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="Motivo (ej.: pedido del cliente)" />
                <input value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} placeholder="Observaciones" />
              </div>
            )}
            {errorForm && <p className="loginError">{errorForm}</p>}
          </form>
        )}

        {/* ---------- Historial ---------- */}
        <div className="caBloque">
          <div className="caBloqueHead caHistHead">
            <h4>Historial</h4>
            <div className="caChips">
              {([['todos', `Todos (${adicionales.length})`], ['pendiente', `Pendientes (${cantPendientes})`], ['aprobado', 'Aprobados']] as [Filtro, string][]).map(([v, t]) => (
                <button key={v} type="button" className={filtro === v ? 'activo' : ''} onClick={() => setFiltro(v)}>{t}</button>
              ))}
            </div>
          </div>
          {errorComprobante && <p className="loginError" role="alert">{errorComprobante}</p>}
          {visibles.length === 0 ? (
            <p className="adicVacio">{adicionales.length === 0 ? 'Todavía no hay cambios ni adicionales cargados en esta obra.' : 'No hay registros con este filtro.'}</p>
          ) : (
            <div className="caHist">
              {visibles.map((a) => {
                const { antes, ahora } = antesYAhora(a, moneda)
                // Se puede corregir siempre (también aprobado o pagado); borrar, solo si no se aprobó.
                const editable = puedeEditar
                const borrable = puedeEditar && (a.estado === 'pendiente' || a.estado === 'rechazado')
                const editando = edicion?.id === a.id
                const esCambio = a.tipo === 'cambio'
                return (
                  <article key={a.id} className={`caCard est-${a.estado}`}>
                    <div className="caCardTop">
                      <span className="caTipo">{etiquetaModificacion(a)} · {fechaCorta(a.fecha)}</span>
                      <span className={badge(a.estado)}>{ESTADO_TEXTO[a.estado] ?? a.estado}</span>
                    </div>

                    {editando && edicion ? (
                      <div className="caEditor">
                        <div className="caEditorCampos">
                          {(!esCambio || a.cambio_tipo === 'reemplazo' || a.cambio_tipo === 'agregado') && (
                            <label className="caDesc">Descripción<input value={edicion.descripcion} onChange={(e) => setEdicion({ ...edicion, descripcion: e.target.value })} /></label>
                          )}
                          {!esCambio && (
                            <label>{a.tipo === 'bonificacion' ? 'Monto a descontar' : 'Importe'}<CampoNumero value={edicion.importe} onChange={(e) => setEdicion({ ...edicion, importe: e.target.value })} /></label>
                          )}
                          {esCambio && a.cambio_tipo !== 'quitado' && (
                            <label>Cantidad<CampoNumero min="0.001" value={edicion.cantidad} onChange={(e) => setEdicion({ ...edicion, cantidad: e.target.value })} /></label>
                          )}
                          {esCambio && (a.cambio_tipo === 'reemplazo' || a.cambio_tipo === 'agregado') && (
                            <label>Precio unitario<CampoNumero min="0" value={edicion.precio} onChange={(e) => setEdicion({ ...edicion, precio: e.target.value })} /></label>
                          )}
                          <label>Fecha<input type="date" value={edicion.fecha} onChange={(e) => setEdicion({ ...edicion, fecha: e.target.value })} /></label>
                          <label className="caDesc">Motivo<input value={edicion.motivo} onChange={(e) => setEdicion({ ...edicion, motivo: e.target.value })} /></label>
                          {!esCambio && <label className="caDesc">Observaciones<input value={edicion.observaciones} onChange={(e) => setEdicion({ ...edicion, observaciones: e.target.value })} /></label>}
                          {a.tipo === 'gasto_extra' && <>
                            <label>Proveedor / lugar<input value={edicion.proveedor} onChange={(e) => setEdicion({ ...edicion, proveedor: e.target.value })} /></label>
                            <label>Cómo se pagó<select value={edicion.medioPago} onChange={(e) => setEdicion({ ...edicion, medioPago: e.target.value })}>
                              {Object.entries(MEDIOS_PAGO).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                            </select></label>
                          </>}
                        </div>
                        {errorEditor && <p className="loginError">{errorEditor}</p>}
                        <div className="caEditorPie">
                          <span />
                          <div>
                            <button type="button" className="cancelButton" onClick={() => setEdicion(null)}>Cancelar</button>
                            <button type="button" className="newButton" disabled={guardando === 'edicion'} onClick={() => void guardarEdicion(a)}>{guardando === 'edicion' ? 'Guardando...' : 'Guardar'}</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="caCardCuerpo">
                        <div>
                          <strong>{a.descripcion}</strong>
                          {(antes || ahora) && <small>{antes ? `Antes: ${antes}` : ''}{antes && ahora ? ' → ' : ''}{ahora ? `Ahora: ${ahora}` : ''}</small>}
                          {(a.motivo || a.observaciones) && <small>{[a.motivo, a.observaciones].filter(Boolean).join(' · ')}</small>}
                          {a.tipo === 'gasto_extra' && (
                            <small>
                              {[a.medio_pago ? MEDIOS_PAGO[a.medio_pago] ?? a.medio_pago : null, a.proveedor].filter(Boolean).join(' · ') || 'Sin datos de pago'}
                              {' · '}
                              {a.comprobante_path ? (
                                <button type="button" className="caLink" disabled={abriendoComprobante !== null} onClick={() => void verComprobante(a)}>
                                  {abriendoComprobante === a.id ? 'Preparando...' : 'Ver comprobante'}
                                </button>
                              ) : 'Sin comprobante'}
                              {comprobanteAbierto?.id === a.id && <> · <a href={comprobanteAbierto.url} target="_blank" rel="noopener noreferrer">Abrir archivo</a></>}
                            </small>
                          )}
                        </div>
                        <strong className={`caImporteTxt ${a.importe < 0 ? 'resta' : ''}`}>{conSigno(a.importe)}</strong>
                      </div>
                    )}

                    {puedeEditar && !editando && (
                      <div className="caCardAcciones">
                        {a.estado === 'pendiente' && <>
                          <button type="button" className="adicOk caBtnGrande" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'aprobado')}>✓ Aprobar</button>
                          <button type="button" className="adicNo caBtnGrande" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'rechazado')}>✕ Rechazar</button>
                        </>}
                        {a.estado === 'aprobado' && a.tipo === 'gasto_extra' && (
                          <button type="button" className="adicOk" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'pagado')}>✓ Pagado</button>
                        )}
                        {a.estado === 'pagado' && (
                          <button type="button" className="editButton" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'aprobado')}>Deshacer pago</button>
                        )}
                        {(a.estado === 'aprobado' || a.estado === 'rechazado') && (
                          <button type="button" className="editButton" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'pendiente')}>Volver a pendiente</button>
                        )}
                        {editable && <span className="caSep" />}
                        {editable && <button type="button" className="editButton" onClick={() => abrirEdicion(a)}>✏️ Editar</button>}
                        {a.tipo === 'gasto_extra' && (
                          <label className={`editButton caArchivoBtn ${procesando === a.id ? 'deshabilitado' : ''}`}>
                            📎 {a.comprobante_path ? 'Cambiar comprobante' : 'Adjuntar comprobante'}
                            <input type="file" accept="image/*,application/pdf" disabled={procesando === a.id} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void cambiarComprobante(a, f) }} />
                          </label>
                        )}
                        {a.tipo === 'gasto_extra' && a.comprobante_path && <button type="button" className="caLink" disabled={procesando === a.id} onClick={() => void cambiarComprobante(a, null)}>Quitar comprobante</button>}
                        {borrable && <button type="button" className="adicNo" disabled={procesando === a.id} onClick={() => void eliminar(a)}>🗑 Eliminar</button>}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </>}
    </section>
  )
}

export default AdicionalesObra
