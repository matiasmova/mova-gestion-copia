import { useEffect, useMemo, useState } from 'react'
import type { Pedido } from './BuscadorGlobal'
import { supabase } from './supabase'
import NuevoPresupuesto, {
  type ClienteOpcion,
  type ItemPresupuesto,
  type ObraOpcion,
  type PresupuestoEditable,
} from './NuevoPresupuesto'
import PresupuestoPDF from './PresupuestoPDF'
import PresupuestoFicha, { type DatosObra } from './PresupuestoFicha'
import VistaToggle, { useVista } from './VistaToggle'
import { moneda, fechaCorta } from './gestionFormat'
import {
  eliminarObraCompleta,
  mensajeEliminacionObra,
  resumenEliminacionObra,
} from './eliminarObra'
import { confirmarEliminacion } from './confirmar'
import SeguimientoPresupuestos from './SeguimientoPresupuestos'
import { etiquetaEtapa, type ObraEtapa } from './VidaEtapas'
import { codigoPresupuesto } from './codigoPresupuesto'

type PresupuestoCompleto = PresupuestoEditable & {
  created_at: string
  subtotal: number
  total: number
  total_pagado: number
  saldo: number
  activo: boolean
  // Suma de cambios y adicionales aprobados durante la obra (0 si no hubo).
  ajustes: number
  // Seguimiento (columnas nuevas: si falta el SQL quedan vacías).
  enviado_at?: string | null
  seguimiento_at?: string | null
  // Etapas (SQL fase 20: si falta, quedan vacías).
  motivo_rechazo?: string | null
  version?: number | null
}

const ESTADOS = [
  { v: 'borrador', t: 'Borrador' },
  { v: 'enviado', t: 'Enviado' },
  { v: 'aceptado', t: 'Aceptado' },
  { v: 'rechazado', t: 'Rechazado' },
]

function Presupuestos({ presupuestoAbrirId, onPresupuestoAbierto, pedido, onPedidoAtendido, onAbrirObra }: { presupuestoAbrirId?: number | null; onPresupuestoAbierto?: () => void; pedido?: Pedido | null; onPedidoAtendido?: () => void; onAbrirObra?: (obraId: number) => void } = {}) {
  const [presupuestos, setPresupuestos] = useState<PresupuestoCompleto[]>([])
  const [clientes, setClientes] = useState<ClienteOpcion[]>([])
  const [obras, setObras] = useState<ObraOpcion[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('todos')
  const [vista, setVista] = useVista('presupuestos', 'kanban')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [presupuestoEditado, setPresupuestoEditado] = useState<PresupuestoCompleto | null>(null)
  const [pdfPresupuesto, setPdfPresupuesto] = useState<PresupuestoCompleto | null>(null)
  const [ficha, setFicha] = useState<PresupuestoCompleto | null>(null)
  const [convirtiendo, setConvirtiendo] = useState<number | null>(null)
  const [telefonos, setTelefonos] = useState<Record<number, string | null>>({})
  const [faltaSqlSeguimiento, setFaltaSqlSeguimiento] = useState(false)
  const [faltaSqlEtapas, setFaltaSqlEtapas] = useState(false)
  // En el celular se muestra una lista hacia abajo (las columnas no entran).
  const [esMovil, setEsMovil] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 700px)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 700px)')
    if (!mq) return
    const cambio = () => setEsMovil(mq.matches)
    mq.addEventListener?.('change', cambio)
    return () => mq.removeEventListener?.('change', cambio)
  }, [])
  // Estado y avance de cada obra (para la etapa "En obra · 30%").
  const [obrasEtapa, setObrasEtapa] = useState<Record<number, ObraEtapa>>({})

  useEffect(() => { cargarDatos() }, [])

  // Abrir automáticamente un presupuesto cuando se llega desde otro módulo (ej. Obras).
  useEffect(() => {
    if (presupuestoAbrirId == null || presupuestos.length === 0) return
    const p = presupuestos.find((x) => x.id === presupuestoAbrirId)
    if (p) { setFicha(p); onPresupuestoAbierto?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presupuestoAbrirId, presupuestos])

  // Pedido del buscador general o del botón "+".
  useEffect(() => {
    if (!pedido) return
    if (pedido.accion === 'nuevo') { abrirNuevo(); onPedidoAtendido?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido])

  async function cargarDatos(): Promise<PresupuestoCompleto[]> {
    setCargando(true)
    setError('')
    const [rPres, rItems, rClientes, rObras, rPagos, rAdic] = await Promise.all([
      supabase.from('presupuestos').select('id, created_at, cliente_id, obra_id, titulo, descripcion, fecha, validez_dias, estado, etapa_trabajo, subtotal, descuento, total, total_pagado, saldo, notas, activo').eq('activo', true).order('created_at', { ascending: false }),
      supabase.from('presupuesto_items').select('id, presupuesto_id, catalogo_id, tipo, descripcion, cantidad, precio_unitario, costo_unitario, descuento_pct, orden').order('orden', { ascending: true }),
      supabase.from('Clientes').select('id, nombre, apellido, direccion, localidad').order('nombre', { ascending: true }),
      supabase.from('obras').select('id, cliente_id, nombre_obra').order('nombre_obra', { ascending: true }),
      supabase.from('pagos').select('monto, presupuesto_id, obra_id'),
      supabase.from('adicionales').select('*').in('estado', ['aprobado', 'pagado']),
    ])
    // Teléfonos (para WhatsApp) y fechas de envío/seguimiento: si fallan, la pantalla sigue igual.
    const [rTel, rSeg, rEtapas, rObrasEt] = await Promise.all([
      supabase.from('Clientes').select('id, telefono'),
      supabase.from('presupuestos').select('id, enviado_at, seguimiento_at').eq('activo', true),
      supabase.from('presupuestos').select('id, motivo_rechazo, version').eq('activo', true),
      supabase.from('obras').select('id, estado, porcentaje_avance'),
    ])
    setFaltaSqlEtapas(!!rEtapas.error)
    const etapas = new Map(((rEtapas.data ?? []) as { id: number; motivo_rechazo: string | null; version: number | null }[]).map((x) => [x.id, x]))
    setObrasEtapa(Object.fromEntries(((rObrasEt.data ?? []) as { id: number; estado: string | null; porcentaje_avance: number | null }[]).map((o) => [o.id, { estado: o.estado, porcentaje_avance: Number(o.porcentaje_avance) || 0 }])))
    setTelefonos(Object.fromEntries(((rTel.data ?? []) as { id: number; telefono: string | null }[]).map((c) => [c.id, c.telefono])))
    setFaltaSqlSeguimiento(!!rSeg.error)
    const seg = new Map(((rSeg.data ?? []) as { id: number; enviado_at: string | null; seguimiento_at: string | null }[]).map((x) => [x.id, x]))
    if (rPres.error || rItems.error || rClientes.error || rObras.error || rPagos.error || rAdic.error) {
      console.error(rPres.error || rItems.error || rClientes.error || rObras.error)
      setError('No se pudieron cargar los presupuestos.')
      setCargando(false)
      return []
    }
    const items = (rItems.data ?? []) as Array<ItemPresupuesto & { presupuesto_id: number; orden: number }>
    const base = (rPres.data ?? []).map((p) => ({
      ...p,
      subtotal: Number(p.subtotal), descuento: Number(p.descuento), total: Number(p.total),
      total_pagado: Number(p.total_pagado), saldo: Number(p.saldo), ajustes: 0,
      items: items.filter((it) => it.presupuesto_id === p.id).map((it) => ({
        id: it.id, catalogo_id: it.catalogo_id ?? null, tipo: it.tipo, descripcion: it.descripcion,
        cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), costo_unitario: Number(it.costo_unitario),
        descuento_pct: Number(it.descuento_pct ?? 0),
      })),
    })) as PresupuestoCompleto[]

    // Cobrado y saldo reales: cuentan los cobros hechos al presupuesto y también los
    // cargados a su obra (si la obra tiene un solo presupuesto aceptado). El saldo
    // incluye los cambios y adicionales aprobados durante la obra.
    const aceptadosPorObra: Record<number, number> = {}
    base.forEach((p) => { if (p.estado === 'aceptado' && p.obra_id != null) aceptadosPorObra[p.obra_id] = (aceptadosPorObra[p.obra_id] || 0) + 1 })
    const pagos = rPagos.error ? null : (rPagos.data ?? [])
    const adicionales = rAdic.error ? [] : (rAdic.data ?? [])
    const cargados = base.map((p) => {
      const unico = p.estado === 'aceptado' && p.obra_id != null && aceptadosPorObra[p.obra_id] === 1
      const corresponde = (fila: { presupuesto_id?: number | null; obra_id?: number | null }) =>
        Number(fila.presupuesto_id) === p.id || (unico && fila.presupuesto_id == null && Number(fila.obra_id) === p.obra_id)
      const ajustes = p.estado === 'aceptado'
        ? adicionales.filter(a => a.estado === 'aprobado').filter(corresponde).reduce((s, a) => s + (Number(a.importe) || 0), 0)
        : 0
      const pagado = pagos ? pagos.filter(corresponde).reduce((s, x) => s + (Number(x.monto) || 0), 0) : p.total_pagado
      return { ...p, ajustes, total_pagado: pagado, saldo: Math.max(0, p.total + ajustes - pagado), enviado_at: seg.get(p.id)?.enviado_at ?? null, seguimiento_at: seg.get(p.id)?.seguimiento_at ?? null, motivo_rechazo: etapas.get(p.id)?.motivo_rechazo ?? null, version: etapas.get(p.id)?.version ?? 1 }
    })

    setClientes((rClientes.data ?? []) as ClienteOpcion[])
    setObras((rObras.data ?? []) as ObraOpcion[])
    setPresupuestos(cargados)
    setCargando(false)
    // Si hay una ficha abierta, refrescarla con los datos nuevos
    setFicha((actual) => (actual ? cargados.find((p) => p.id === actual.id) ?? null : null))
    return cargados
  }

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    return presupuestos.filter((p) => {
      const cli = clientes.find((c) => c.id === p.cliente_id)
      const ob = obras.find((o) => o.id === p.obra_id)
      const nom = `${cli?.nombre ?? ''} ${cli?.apellido ?? ''}`.toLowerCase()
      const coincide = !texto || p.titulo.toLowerCase().includes(texto) || nom.includes(texto) || (ob?.nombre_obra ?? '').toLowerCase().includes(texto)
      const coincideEstado = estadoFiltro === 'todos' || p.estado === estadoFiltro
      return coincide && coincideEstado
    })
  }, [presupuestos, clientes, obras, busqueda, estadoFiltro])

  const nombreCliente = (id: number) => {
    const c = clientes.find((x) => x.id === id)
    return c ? `${c.nombre} ${c.apellido ?? ''}`.trim() : 'Cliente no encontrado'
  }
  const nombreObra = (id: number | null) => (!id ? 'Sin obra asociada' : obras.find((o) => o.id === id)?.nombre_obra ?? 'Obra no encontrada')

  function abrirNuevo() { setPresupuestoEditado(null); setMostrarFormulario(true) }
  function editar(p: PresupuestoCompleto) { setPresupuestoEditado(p); setMostrarFormulario(true); setFicha(null) }
  function cerrarFormulario() { setMostrarFormulario(false); setPresupuestoEditado(null) }
  async function guardado() { cerrarFormulario(); await cargarDatos() }

  // Pregunta si se elimina también la obra vinculada (con todo lo cargado en ella).
  async function ofrecerEliminarObra(obraId: number, intro: string): Promise<boolean> {
    try {
      const resumen = await resumenEliminacionObra(obraId)
      if (!confirmarEliminacion(mensajeEliminacionObra(nombreObra(obraId), resumen, intro), { escribir: true })) return false
      const resultado = await eliminarObraCompleta(obraId)
      if (!resultado.ok) { window.alert(resultado.mensaje); return false }
      return true
    } catch (err) {
      console.error(err)
      window.alert('No se pudo revisar la obra vinculada. No se borró nada.')
      return false
    }
  }

  async function cambiarEstado(p: PresupuestoCompleto, nuevo: string, ofrecerEliminarObraVinculada = true) {
    const { error: err } = await supabase.from('presupuestos').update({ estado: nuevo }).eq('id', p.id)
    if (err) { console.error(err); window.alert('No se pudo modificar el estado.'); return }
    // Stock: al ACEPTAR se descuenta (venta confirmada); si sale de aceptado se repone.
    const eraAceptado = p.estado === 'aceptado'
    const seraAceptado = nuevo === 'aceptado'
    const itemsStock = p.items.filter((it) => it.catalogo_id && it.tipo === 'producto')
    if (!eraAceptado && seraAceptado) {
      for (const it of itemsStock) await supabase.rpc('descontar_stock', { p_id: it.catalogo_id, p_cant: Number(it.cantidad) })
    } else if (eraAceptado && !seraAceptado) {
      for (const it of itemsStock) await supabase.rpc('descontar_stock', { p_id: it.catalogo_id, p_cant: -Number(it.cantidad) })
    }
    const enviado = nuevo === 'enviado' && p.estado !== 'enviado' ? { enviado_at: new Date().toISOString() } : {}
    setPresupuestos((prev) => prev.map((x) => (x.id === p.id ? { ...x, estado: nuevo, ...enviado } : x)))
    setFicha((f) => (f && f.id === p.id ? { ...f, estado: nuevo, ...enviado } : f))
    // Si se rechaza un presupuesto que ya tenía obra, se ofrece eliminarla.
    if (nuevo === 'rechazado' && p.obra_id != null && ofrecerEliminarObraVinculada) {
      const eliminada = await ofrecerEliminarObra(p.obra_id, 'El presupuesto pasó a Rechazado y tiene una obra vinculada.')
      if (eliminada) await cargarDatos()
    }
  }

  // Anota que se hizo el seguimiento (WhatsApp o "ya lo seguí"): deja de avisar por unos días.
  async function marcarSeguido(id: number) {
    const ahora = new Date().toISOString()
    setPresupuestos((prev) => prev.map((x) => (x.id === id ? { ...x, seguimiento_at: ahora } : x)))
    if (faltaSqlSeguimiento) return
    const { error: err } = await supabase.from('presupuestos').update({ seguimiento_at: ahora }).eq('id', id)
    if (err) console.error(err)
  }

  async function convertirEnObra(p: PresupuestoCompleto, datos?: DatosObra, avisar = true): Promise<number | null> {
    if (convirtiendo) return null
    setConvirtiendo(p.id)
    const { data: obraNueva, error: errObra } = await supabase.from('obras').insert({
      cliente_id: p.cliente_id, nombre_obra: datos?.nombre?.trim() || p.titulo, descripcion: p.descripcion ?? null,
      direccion: datos?.direccion?.trim() || null, localidad: datos?.localidad?.trim() || null,
      fecha_inicio: datos?.fecha_inicio || null, fecha_fin_estimada: datos?.fecha_fin_estimada || null,
      estado: 'en_proceso', porcentaje_avance: 0, activo: true,
    }).select('id').single()
    if (errObra || !obraNueva) { console.error(errObra); window.alert('No se pudo crear la obra.'); setConvirtiendo(null); return null }
    const { error: errVinc } = await supabase.from('presupuestos').update({ obra_id: obraNueva.id }).eq('id', p.id)
    if (errVinc) { console.error(errVinc); window.alert('La obra se creó pero no se pudo vincular el presupuesto.') }
    setConvirtiendo(null)
    await cargarDatos()
    if (avisar) window.alert('Obra creada y vinculada. Ya podés cargarle avances, cambios y cobros desde Obras.')
    return Number(obraNueva.id)
  }

  // ---------- Flujo por etapas ----------
  // "El cliente aceptó": pasa a Aceptado y, si no tenía obra, la crea en el mismo paso.
  async function aceptar(p: PresupuestoCompleto, datos: DatosObra | null) {
    if (p.estado !== 'aceptado') await cambiarEstado(p, 'aceptado')
    if (p.obra_id == null && datos) {
      const obraId = await convertirEnObra({ ...p, estado: 'aceptado' }, datos, false)
      if (obraId && onAbrirObra && window.confirm('✓ Obra creada y vinculada.\n\n¿Querés ir a la obra ahora?')) { setFicha(null); onAbrirObra(obraId) }
    }
  }

  async function rechazar(p: PresupuestoCompleto, motivo: string, ofrecerEliminarObraVinculada = true) {
    await cambiarEstado(p, 'rechazado', ofrecerEliminarObraVinculada)
    if (faltaSqlEtapas) return
    const { error: err } = await supabase.from('presupuestos').update({ motivo_rechazo: motivo }).eq('id', p.id)
    if (err) { console.error(err); return }
    setPresupuestos((prev) => prev.map((x) => (x.id === p.id ? { ...x, motivo_rechazo: motivo } : x)))
    setFicha((f) => (f && f.id === p.id ? { ...f, motivo_rechazo: motivo } : f))
  }

  // Copia un presupuesto como borrador nuevo (con sus ítems). Si es una versión
  // nueva, la anterior queda rechazada con el motivo "Nueva versión".
  async function copiar(p: PresupuestoCompleto, comoVersion: boolean) {
    const version = comoVersion ? (p.version ?? 1) + 1 : 1
    const fila: Record<string, unknown> = {
      cliente_id: p.cliente_id, obra_id: comoVersion ? p.obra_id : null,
      titulo: comoVersion ? p.titulo : `${p.titulo} (copia)`, descripcion: p.descripcion ?? null,
      fecha: new Date().toISOString().slice(0, 10), validez_dias: p.validez_dias, estado: 'borrador',
      subtotal: p.subtotal, descuento: p.descuento, total: p.total, total_pagado: 0, saldo: p.total, notas: p.notas ?? null, activo: true,
    }
    if (!faltaSqlEtapas && comoVersion) { fila.version = version; fila.version_de = p.id }
    const { data: nuevo, error: err } = await supabase.from('presupuestos').insert(fila).select('id').single()
    if (err || !nuevo) { console.error(err); window.alert('No se pudo copiar el presupuesto.'); return }
    if (p.items.length) {
      const { error: errItems } = await supabase.from('presupuesto_items').insert(p.items.map((it, i) => ({
        presupuesto_id: nuevo.id, catalogo_id: it.catalogo_id ?? null, tipo: it.tipo, descripcion: it.descripcion,
        cantidad: it.cantidad, precio_unitario: it.precio_unitario, costo_unitario: it.costo_unitario, descuento_pct: it.descuento_pct ?? 0, orden: i,
      })))
      if (errItems) console.error(errItems)
    }
    // La versión anterior queda como historial (y su obra, si tenía, sigue con la nueva).
    if (comoVersion) await rechazar(p, `Nueva versión: reemplazado por la versión ${version}`, false)
    // Se abre la copia para editarla.
    const lista = await cargarDatos()
    const copia = lista.find((q) => q.id === Number(nuevo.id))
    if (copia) { setFicha(null); editar(copia) }
  }

  async function eliminar(p: PresupuestoCompleto) {
    if (!confirmarEliminacion(`¿Eliminar definitivamente el presupuesto "${p.titulo}"?\n\nEsto borra el presupuesto y sus ítems. Los cobros registrados se conservan pero quedan sin presupuesto asociado. Esta acción no se puede deshacer.`, { escribir: true })) return
    // 0) Si tiene obra vinculada, se ofrece eliminarla (junto con sus cobros).
    if (p.obra_id != null) {
      await ofrecerEliminarObra(p.obra_id, `Al eliminar el presupuesto "${p.titulo}" también podés eliminar su obra vinculada.`)
    }
    // 1) Desvincular pagos (conservar el registro del cobro)
    await supabase.from('pagos').update({ presupuesto_id: null }).eq('presupuesto_id', p.id)
    // 2) Borrar ítems y luego el presupuesto
    await supabase.from('presupuesto_items').delete().eq('presupuesto_id', p.id)
    const { error: err } = await supabase.from('presupuestos').delete().eq('id', p.id)
    if (err) { console.error(err); window.alert('No se pudo eliminar el presupuesto.'); return }
    setFicha(null)
    await cargarDatos()
  }

  const abrirFicha = (p: PresupuestoCompleto) => setFicha(p)

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div>
          <p className="subtitle">GESTIÓN COMERCIAL</p>
          <h2>Presupuestos</h2>
          <p className="welcome">Propuestas, trabajos y seguimiento de pagos</p>
        </div>
        <button className="newButton" onClick={abrirNuevo}>+ Nuevo presupuesto</button>
      </div>

      {!cargando && !error && (
        <SeguimientoPresupuestos
          presupuestos={presupuestos}
          nombreCliente={nombreCliente}
          telefonoCliente={(id) => telefonos[id] ?? null}
          onAbrir={(id) => { const p = presupuestos.find((x) => x.id === id); if (p) abrirFicha(p) }}
          onSeguido={(id) => void marcarSeguido(id)}
          onRechazar={(id) => { const p = presupuestos.find((x) => x.id === id); if (p && window.confirm(`¿Pasar "${p.titulo}" a Rechazado?`)) void cambiarEstado(p, 'rechazado') }}
        />
      )}
      {faltaSqlSeguimiento && !cargando && <p className="gestionAyuda">Para recordar cuándo se envió y cuándo hiciste el último seguimiento, corré el SQL de Seguimiento (fase 17) en Supabase.</p>}

      <div className="crmToolbar">
        <div className="crmFiltros">
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por título, cliente u obra..." />
        </div>
        {!esMovil && <VistaToggle vista={vista} onCambio={setVista} />}
      </div>
      <div className="presuChips" role="tablist" aria-label="Etapas">
        {[['todos', 'Todos'], ['borrador', '📝 Borradores'], ['enviado', '📤 Enviados'], ['aceptado', '✅ Aceptados'], ['rechazado', '❌ Rechazados']].map(([v, t]) => (
          <button type="button" key={v} className={estadoFiltro === v ? 'activo' : ''} onClick={() => setEstadoFiltro(v)}>
            {t} <b>{v === 'todos' ? presupuestos.length : presupuestos.filter((p) => p.estado === v).length}</b>
          </button>
        ))}
      </div>
      {faltaSqlEtapas && !cargando && <p className="gestionAyuda">Para guardar el motivo de rechazo y las versiones, corré el SQL de Etapas (fase 20) en Supabase.</p>}

      {cargando && <div className="presupuestosPanel"><p>Cargando presupuestos...</p></div>}
      {error && <div className="presupuestosPanel"><p className="loginError">{error}</p></div>}

      {!cargando && !error && filtrados.length === 0 && (
        <div className="presupuestosPanel"><div className="empty"><span>📄</span><h3>No hay presupuestos</h3><p>Los presupuestos que agregues aparecerán acá.</p></div></div>
      )}

      {!cargando && !error && filtrados.length > 0 && esMovil && (
        <div className="presuListaMovil">
          {filtrados.map((p) => {
            const et = etiquetaEtapa(p, p.obra_id != null ? obrasEtapa[p.obra_id] : null, p.saldo)
            return (
              <button type="button" className="presuItem" key={p.id} onClick={() => abrirFicha(p)}>
                <div className="presuItemTop"><span>{codigoPresupuesto(p.id)}{(p.version ?? 1) > 1 ? ` · v${p.version}` : ''} · {fechaCorta(p.fecha)}</span><span className={`presuEtapa ${et.clase}`}>{et.texto}</span></div>
                <strong>{p.titulo}</strong>
                {et.avance != null && <div className="presuEtapaBarra"><i style={{ width: `${et.avance}%` }} /></div>}
                <div className="presuItemBot"><span>{nombreCliente(p.cliente_id)}</span><b>{moneda(p.total + p.ajustes)}</b></div>
              </button>
            )
          })}
        </div>
      )}

      {!cargando && !error && filtrados.length > 0 && !esMovil && vista === 'kanban' && (
        <div className="crmKanban">
          {ESTADOS.map((s) => {
            const cols = filtrados.filter((p) => p.estado === s.v)
            return (
              <div className={`crmKanbanCol tope col-${s.v}`} key={s.v}>
                <div className="crmKanbanHead"><h3>{s.t}</h3><span className="cuenta">{cols.length}</span></div>
                <div className="crmKanbanBody">
                  {cols.length === 0 ? <div className="crmKanbanVacio">—</div> : cols.map((p) => (
                    <TarjetaPresupuesto key={p.id} p={p} cliente={nombreCliente(p.cliente_id)} obra={p.obra_id != null ? obrasEtapa[p.obra_id] : undefined} onAbrir={() => abrirFicha(p)} onPDF={() => setPdfPresupuesto(p)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!cargando && !error && filtrados.length > 0 && !esMovil && vista === 'lista' && (
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Código</th><th>Título</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Cobrado</th><th>Saldo</th><th>Estado</th></tr></thead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.id} onClick={() => abrirFicha(p)}>
                  <td>#{p.id.toString().padStart(4, '0')}</td>
                  <td><strong>{p.titulo}</strong></td>
                  <td>{nombreCliente(p.cliente_id)}</td>
                  <td>{fechaCorta(p.fecha)}</td>
                  <td>{moneda(p.total + p.ajustes)}{p.ajustes !== 0 && <><br /><small style={{ color: 'var(--mova-muted)' }}>original {moneda(p.total)}</small></>}</td>
                  <td>{moneda(p.total_pagado)}</td>
                  <td>{moneda(p.saldo)}</td>
                  <td>{(() => { const et = etiquetaEtapa(p, p.obra_id != null ? obrasEtapa[p.obra_id] : null, p.saldo); return <span className={`presuEtapa ${et.clase}`}>{et.texto}</span> })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mostrarFormulario && (
        <NuevoPresupuesto clientes={clientes} obras={obras} presupuesto={presupuestoEditado} onCancelar={cerrarFormulario} onGuardado={guardado} />
      )}
      {pdfPresupuesto && (
        <PresupuestoPDF presupuesto={pdfPresupuesto} cliente={nombreCliente(pdfPresupuesto.cliente_id)} obra={nombreObra(pdfPresupuesto.obra_id)} onCerrar={() => setPdfPresupuesto(null)} />
      )}
      {ficha && (
        <PresupuestoFicha
          presupuesto={ficha}
          cliente={nombreCliente(ficha.cliente_id)}
          telefono={telefonos[ficha.cliente_id] ?? null}
          obra={nombreObra(ficha.obra_id)}
          convirtiendo={convirtiendo === ficha.id}
          onCerrar={() => setFicha(null)}
          onEditar={() => editar(ficha)}
          onPDF={() => setPdfPresupuesto(ficha)}
          obraEtapa={ficha.obra_id != null ? obrasEtapa[ficha.obra_id] ?? null : null}
          motivoRechazo={ficha.motivo_rechazo ?? null}
          onAceptar={(datos) => void aceptar(ficha, datos)}
          onRechazar={(motivo) => void rechazar(ficha, motivo)}
          onNuevaVersion={() => void copiar(ficha, true)}
          onDuplicar={() => void copiar(ficha, false)}
          onIrObra={ficha.obra_id != null && onAbrirObra ? () => { const id = ficha.obra_id!; setFicha(null); onAbrirObra(id) } : undefined}
          onCambiarEstado={(nuevo) => cambiarEstado(ficha, nuevo)}
          onEliminar={() => eliminar(ficha)}
          onEliminarObra={async () => {
            if (ficha.obra_id == null) return
            const eliminada = await ofrecerEliminarObra(ficha.obra_id, 'Vas a eliminar la obra vinculada a este presupuesto.')
            if (eliminada) await cargarDatos()
          }}
        />
      )}
    </div>
  )
}

function TarjetaPresupuesto({ p, cliente, obra, onAbrir, onPDF }: { p: PresupuestoCompleto; cliente: string; obra?: ObraEtapa; onAbrir: () => void; onPDF: () => void }) {
  const et = etiquetaEtapa(p, p.obra_id != null ? obra ?? null : null, p.saldo)
  return (
    <div className="crmCard" onClick={onAbrir}>
      <div className="crmCardTop">
        <div>
          <h3>{p.titulo}</h3>
          <p className="crmCardCli">{cliente}</p>
        </div>
        <span className={`presuEtapa ${et.clase}`}>{et.texto}</span>
      </div>
      {et.avance != null && <div className="presuEtapaBarra"><i style={{ width: `${et.avance}%` }} /></div>}
      <div className="crmCardMeta">
        <span>#{p.id.toString().padStart(4, '0')}{(p.version ?? 1) > 1 ? ` · v${p.version}` : ''}</span>
        <span>{fechaCorta(p.fecha)}</span>
        <span>{p.items.length} ítems</span>
      </div>
      <div className="crmCardEco">
        <div><span>{p.ajustes !== 0 ? 'Total con cambios' : 'Total'}</span><strong>{moneda(p.total + p.ajustes)}</strong></div>
        <div><span>Cobrado</span><strong>{moneda(p.total_pagado)}</strong></div>
        <div><span>Saldo</span><strong className={p.saldo > 0 ? 'pend' : ''}>{moneda(p.saldo)}</strong></div>
      </div>
      <div className="crmCardFoot" onClick={(e) => e.stopPropagation()}>
        <button className="crmFootPrimary" onClick={onAbrir}>Ver ficha</button>
        <button onClick={onPDF}>📄 PDF</button>
      </div>
    </div>
  )
}

export default Presupuestos
