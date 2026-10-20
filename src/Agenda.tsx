import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Pedido } from './BuscadorGlobal'
import { supabase } from './supabase'
import { fechaCorta } from './gestionFormat'
import { linkWhatsApp } from './whatsapp'
import { entenderFrase, isoLocal } from './agendaFrase'
import { estadoPush, activarPush, desactivarPush, type EstadoPush } from './push'
import { confirmarEliminacion } from './confirmar'
import { GRUPOS_PH, TIPOS_PH, claveDeNota, leerOcultas, marcaPH, mostrarDeNuevo, notaSinMarca, ocultarPorHoy, type GrupoPH, type TareaPH, type TipoPH } from './paraHacer'
import AvisosDiarios from './AvisosDiarios'
import NotasPH from './NotasPH'

// Para hacer (antes Agenda): todo lo pendiente en una sola lista (lo que agendás
// vos y lo que el sistema detecta solo: cobros, presupuestos, obras, stock,
// personal, gastos), más la agenda de reuniones, visitas y llamadas.
// La semana a la vista (o el mes), carga rápida dictada o escrita en una frase,
// el día en línea de tiempo con acciones y "Para agendar" (plazos de obra,
// seguros y presupuestos sin respuesta).
// El aviso push lo manda la Edge Function "enviar-recordatorios" cuando llega
// notificar_en (fecha + hora − anticipación, hora de Argentina).

export type Evento = {
  id: number
  titulo: string
  detalle: string | null
  fecha: string
  hora: string | null
  tipo: string | null
  lugar: string | null
  obra_id: number | null
  cliente_id: number | null
  completado: boolean
  aviso_min: number | null
}

type Opcion = { id: number; nombre: string }

export const TIPOS_EVENTO: Record<string, { icono: string; texto: string }> = {
  reunion: { icono: '🤝', texto: 'Reunión' },
  recordatorio: { icono: '🔔', texto: 'Recordatorio' },
  visita: { icono: '🏠', texto: 'Visita de obra' },
  llamada: { icono: '📞', texto: 'Llamada' },
}
const AVISOS: [string, string][] = [
  ['0', 'A la hora del evento'],
  ['15', '15 minutos antes'],
  ['60', '1 hora antes'],
  ['1440', 'El día anterior'],
  ['', 'Sin aviso'],
]
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const pad = (n: number) => String(n).padStart(2, '0')
const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const diaSemana = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
const tipoDe = (t: string | null) => TIPOS_EVENTO[t ?? ''] ?? TIPOS_EVENTO.recordatorio

// Cuándo mandar el aviso: fecha + hora (9:00 si no tiene) − anticipación, en hora de Argentina (UTC−3).
export function momentoAviso(fecha: string, hora: string | null, avisoMin: number | null): string | null {
  if (avisoMin == null) return null
  const base = new Date(`${fecha}T${(hora || '09:00').slice(0, 5)}:00-03:00`)
  return new Date(base.getTime() - avisoMin * 60000).toISOString()
}

const textoAviso = (e: Evento) =>
  e.aviso_min == null ? 'Sin aviso' : AVISOS.find(([v]) => v === String(e.aviso_min))?.[1] ?? `${e.aviso_min} min antes`

// Un renglón de la lista: una tarea automática, una sugerencia para agendar o un evento de la agenda.
type ItemPH = { clave: string; tipo: TipoPH; grupo: GrupoPH; icono: string; titulo: string; detalle: string; explica?: string; monto?: number; tarea?: TareaPH; sugerencia?: Sugerencia; evento?: Evento }

export default function Agenda({ pedido, onPedidoAtendido, tareas = [], cargandoTareas = false, porCobrar = null, onAbrirObra, onAbrirPresupuesto }: { pedido?: Pedido | null; onPedidoAtendido?: () => void; tareas?: TareaPH[]; cargandoTareas?: boolean; porCobrar?: number | null; onAbrirObra?: (id: number) => void; onAbrirPresupuesto?: (id: number) => void } = {}) {
  const hoyStr = isoLocal(new Date())
  const [eventos, setEventos] = useState<Evento[]>([])
  const [obras, setObras] = useState<Opcion[]>([])
  const [clientes, setClientes] = useState<(Opcion & { telefono: string | null })[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [form, setForm] = useState<{ evento?: Evento; fecha?: string } | null>(null)
  const [sel, setSel] = useState(hoyStr)
  const [inicioSem, setInicioSem] = useState(() => lunesDe(hoyStr))
  const [verMes, setVerMes] = useState(false)
  const [frase, setFrase] = useState('')
  const [guardandoFrase, setGuardandoFrase] = useState(false)
  const [aviso, setAviso] = useState('')
  const [filtro, setFiltro] = useState<TipoPH | 'todo'>('todo')
  const [foco, setFoco] = useState<GrupoPH | 'plata' | null>(null)
  const [ocultas, setOcultas] = useState<Set<string>>(() => leerOcultas())
  const [menuDe, setMenuDe] = useState<string | null>(null)
  const [verAvisos, setVerAvisos] = useState(false)
  // Tarjeta abierta (muestra qué es) y el "Deshacer" de lo último que se hizo.
  const [abiertoPH, setAbiertoPH] = useState<string | null>(null)
  const [deshacer, setDeshacer] = useState<{ texto: string; hacer: () => void | Promise<void> } | null>(null)
  useEffect(() => {
    if (!deshacer) return
    const t = window.setTimeout(() => setDeshacer(null), 8000)
    return () => window.clearTimeout(t)
  }, [deshacer])
  useEffect(() => {
    if (!menuDe) return
    const cerrar = () => setMenuDe(null)
    window.addEventListener('click', cerrar)
    return () => window.removeEventListener('click', cerrar)
  }, [menuDe])
  // Pedido del buscador general o del botón "+".
  useEffect(() => {
    if (!pedido) return
    if (pedido.accion === 'nuevo') setForm({ fecha: hoyStr })
    onPedidoAtendido?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido])
  const [push, setPush] = useState<EstadoPush | 'cargando' | 'procesando'>('cargando')
  useEffect(() => { void estadoPush().then(setPush).catch(() => setPush('no-soportado')) }, [])
  async function togglePush() {
    if (push === 'no-soportado') { mostrar('Para recibir avisos instalá la app: en iPhone, Compartir → Agregar a inicio, y abrila desde el ícono.'); return }
    if (push === 'bloqueado') { mostrar('Los avisos están bloqueados: habilitalos en los ajustes del navegador o del teléfono y recargá.'); return }
    if (push === 'activo') { const r = await desactivarPush(); mostrar(r.msg) }
    else { setPush('procesando'); const r = await activarPush(); mostrar(r.msg) }
    setPush(await estadoPush())
  }
  function mostrar(t: string) { setAviso(t); window.setTimeout(() => setAviso((a) => (a === t ? '' : a)), 4000) }

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true); setError('')
      const [rE, rO, rC] = await Promise.all([
        supabase.from('recordatorios').select('*').order('fecha', { ascending: true }).order('hora', { ascending: true, nullsFirst: true }),
        supabase.from('obras').select('id,nombre_obra').eq('activo', true).order('nombre_obra'),
        supabase.from('Clientes').select('id,nombre,apellido,telefono').order('nombre'),
      ])
      if (!vigente) return
      if (rE.error) { console.error(rE.error); setError('No se pudo cargar la agenda.'); setCargando(false); return }
      setEventos(((rE.data ?? []) as Evento[]).map((e) => ({ ...e, aviso_min: e.aviso_min === undefined ? 0 : e.aviso_min })))
      setObras(((rO.data ?? []) as { id: number; nombre_obra: string }[]).map((o) => ({ id: o.id, nombre: o.nombre_obra })))
      setClientes(((rC.data ?? []) as { id: number; nombre: string; apellido: string | null; telefono: string | null }[]).map((c) => ({ id: c.id, nombre: `${c.nombre} ${c.apellido ?? ''}`.trim(), telefono: c.telefono })))
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [tick])

  const nombreObra = (id: number | null) => obras.find((o) => o.id === id)?.nombre ?? null
  const cliente = (id: number | null) => clientes.find((c) => c.id === id) ?? null

  async function completar(e: Evento) {
    const { error: fallo } = await supabase.from('recordatorios').update({ completado: !e.completado }).eq('id', e.id)
    if (fallo) { setError('No se pudo actualizar.'); return }
    setEventos((arr) => arr.map((x) => (x.id === e.id ? { ...x, completado: !x.completado } : x)))
  }
  async function eliminar(e: Evento) {
    if (!confirmarEliminacion(`¿Eliminar "${e.titulo}" del ${fechaCorta(e.fecha)}?`)) return
    const { error: fallo } = await supabase.from('recordatorios').delete().eq('id', e.id)
    if (fallo) { setError('No se pudo eliminar.'); return }
    setEventos((arr) => arr.filter((x) => x.id !== e.id))
  }
  // Pasar a otro día (mañana, o a hoy si estaba atrasado): se reprograma el aviso.
  async function mover(e: Evento, fecha: string) {
    const datos = { fecha, notificado: false, notificar_en: momentoAviso(fecha, e.hora, e.aviso_min) }
    let r = await supabase.from('recordatorios').update(datos).eq('id', e.id)
    if (r.error && /notificar_en/.test(r.error.message)) r = await supabase.from('recordatorios').update({ fecha, notificado: false }).eq('id', e.id)
    if (r.error) { setError('No se pudo mover.'); return }
    setEventos((arr) => arr.map((x) => (x.id === e.id ? { ...x, fecha } : x)))
    mostrar(fecha === hoyStr ? 'Pasado a hoy' : `Pasado al ${diaSemana(fecha)}`)
  }

  // ---------- Carga rápida (dictada o escrita) ----------
  const entendida = useMemo(() => (frase.trim().length > 2 ? entenderFrase(frase, clientes, obras) : null), [frase, clientes, obras])
  const dictado = useDictado((t, final) => { setFrase(t); if (final) setTimeout(() => document.getElementById('agFraseOk')?.focus(), 50) })
  async function guardarFrase(datos: { titulo: string; fecha: string; hora: string | null; tipo: string; cliente_id: number | null; obra_id: number | null; detalle?: string | null }) {
    setGuardandoFrase(true)
    const r = await crearEvento({ ...datos, aviso_min: 60 })
    setGuardandoFrase(false)
    if (r) { setError(r); return false }
    irA(datos.fecha)
    setTick((t) => t + 1)
    mostrar(`Agendado: ${diaSemana(datos.fecha)}${datos.hora ? ` · ${datos.hora}` : ''}`)
    return true
  }

  function irA(f: string) { setSel(f); setInicioSem(lunesDe(f)); setVerMes(false) }

  // ---------- Datos de la pantalla ----------
  const delDia = eventos.filter((e) => e.fecha === sel).sort((a, b) => (a.hora ?? '').localeCompare(b.hora ?? ''))
  const ahora = new Date()
  const horaAhora = `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`
  const sugerencias = useSugerencias(tick)

  const puntos = (f: string) => eventos.filter((e) => e.fecha === f && !e.completado).slice(0, 3)
  const tituloDia = sel === hoyStr ? 'Hoy' : sel === sumarDias(hoyStr, 1) ? 'Mañana' : sel === sumarDias(hoyStr, -1) ? 'Ayer' : capital(diaSemana(sel))
  const pendDia = delDia.filter((e) => !e.completado).length

  // ---------- Lista unificada ----------
  const enSemana = sumarDias(hoyStr, 7)
  // Tareas automáticas que ya pasaste a la agenda (no se repiten mientras sigan pendientes).
  const agendadas = new Set(eventos.filter((e) => !e.completado).map((e) => claveDeNota(e.detalle)).filter((k): k is string => !!k))
  const items: ItemPH[] = [
    ...tareas.map((t): ItemPH => ({ clave: t.clave, tipo: t.tipo, grupo: t.grupo, icono: t.icono ?? TIPOS_PH[t.tipo].icono, titulo: t.titulo, detalle: t.detalle, explica: t.explica, monto: t.monto, tarea: t })),
    ...sugerencias.map((x): ItemPH => ({ clave: `sug-${x.clave}`, tipo: x.clave.startsWith('p') ? 'pres' : x.clave.startsWith('s') ? 'personal' : 'obra', grupo: x.tono === 'r' || x.clave.startsWith('p') ? 'atr' : 'sem', icono: x.icono, titulo: x.titulo, detalle: x.detalle, explica: x.explica, sugerencia: x })),
    ...eventos.filter((e) => !e.completado && e.fecha <= enSemana).map((e): ItemPH => {
      const c = cliente(e.cliente_id)
      const cuando = e.fecha === hoyStr ? (e.hora ? `Hoy ${e.hora.slice(0, 5)}` : 'Hoy') : `${capital(diaSemana(e.fecha))}${e.hora ? ` · ${e.hora.slice(0, 5)}` : ''}`
      return { clave: `ev-${e.id}`, tipo: 'visita', grupo: e.fecha < hoyStr ? 'atr' : e.fecha === hoyStr ? 'hoy' : 'sem', icono: tipoDe(e.tipo).icono, titulo: e.titulo, detalle: [cuando, e.lugar, c?.nombre].filter(Boolean).join(' · '), explica: notaSinMarca(e.detalle) || undefined, evento: e }
    }),
  ].filter((x) => !ocultas.has(x.clave) && !agendadas.has(x.clave))
  const visibles = items.filter((x) => (filtro === 'todo' || x.tipo === filtro) && (!foco || (foco === 'plata' ? x.tipo === 'cobro' : x.grupo === foco)))
  const cuenta = (g: GrupoPH) => items.filter((x) => x.grupo === g).length
  const tiposConItems = (Object.keys(TIPOS_PH) as TipoPH[]).filter((t) => items.some((x) => x.tipo === t))
  const manana = sumarDias(hoyStr, 1)
  const lunesProx = sumarDias(lunesDe(hoyStr), 7)

  function ocultar(x: ItemPH) {
    ocultarPorHoy(x.clave); setOcultas(leerOcultas())
    setDeshacer({ texto: `"${x.titulo}" quedó listo por hoy`, hacer: () => { mostrarDeNuevo(x.clave); setOcultas(leerOcultas()) } })
  }
  const notaDe = (x: ItemPH) => `${x.explica ?? x.detalle}\n${marcaPH(x.clave)}`
  async function agendarTarea(x: ItemPH, fecha: string) {
    const titulo = x.tarea?.agendar ?? x.sugerencia?.agendar ?? x.titulo
    const ok = await guardarFrase({ titulo, fecha, hora: '10:00', tipo: x.sugerencia?.tipo ?? 'recordatorio', cliente_id: null, obra_id: x.tarea?.obra_id ?? x.sugerencia?.obra_id ?? null, detalle: notaDe(x) })
    if (ok) setDeshacer({ texto: `Agendado para ${fecha === hoyStr ? 'hoy' : diaSemana(fecha)}`, hacer: () => volverAPendientes(x.clave) })
  }
  // Borra de la agenda lo que salió de una tarea automática y la tarea vuelve a la lista.
  async function volverAPendientes(clave: string) {
    const ids = eventos.filter((e) => claveDeNota(e.detalle) === clave).map((e) => e.id)
    const { data } = ids.length ? { data: null } : await supabase.from('recordatorios').select('id,detalle').like('detalle', `%${marcaPH(clave)}%`)
    const todos = ids.length ? ids : ((data ?? []) as { id: number }[]).map((e) => e.id)
    if (todos.length) {
      const { error: fallo } = await supabase.from('recordatorios').delete().in('id', todos)
      if (fallo) { setError('No se pudo devolver a pendientes.'); return }
    }
    mostrarDeNuevo(clave); setOcultas(leerOcultas())
    setEventos((arr) => arr.filter((e) => !todos.includes(e.id)))
    setDeshacer(null)
    mostrar('Volvió a la lista de Para hacer')
  }
  // Eventos que salieron de la lista (con la marca, o agendados antes con el texto de una tarea automática).
  const AGENDADOS_VIEJOS = /^(Revisar plazo de |Renovar |Seguimiento presupuesto |Cobrar |Enviar presupuesto |Pagarle a |Mandar informe de avance de |Comprar productos para reponer stock)/
  const claveOrigen = (e: Evento) => claveDeNota(e.detalle) ?? tareas.find((t) => t.agendar === e.titulo)?.clave ?? (AGENDADOS_VIEJOS.test(e.titulo) ? `viejo-${e.id}` : null)
  async function volverEvento(e: Evento) {
    const clave = claveOrigen(e)
    if (!clave) return
    if (!clave.startsWith('viejo-')) { await volverAPendientes(clave); return }
    const { error: fallo } = await supabase.from('recordatorios').delete().eq('id', e.id)
    if (fallo) { setError('No se pudo devolver a pendientes.'); return }
    setEventos((arr) => arr.filter((x) => x.id !== e.id))
    setTick((t) => t + 1) // las sugerencias se vuelven a armar sin este evento
    mostrar('Volvió a la lista de Para hacer')
  }
  // Qué se puede abrir desde una sugerencia (obra o presupuesto).
  const abrirSug = (x: Sugerencia) => {
    const id = Number(x.clave.slice(1))
    if (x.clave.startsWith('o') && onAbrirObra) return { t: 'Ver la obra', f: () => onAbrirObra(id) }
    if (x.clave.startsWith('p') && onAbrirPresupuesto) return { t: 'Ver el presupuesto', f: () => onAbrirPresupuesto(id) }
    return null
  }
  const renglon = (x: ItemPH) => {
    const e = x.evento
    const principal = x.tarea?.boton && x.tarea.accion ? <button type="button" className="phPrim" onClick={x.tarea.accion}>{x.tarea.boton}</button>
      : x.sugerencia ? <button type="button" className="phPrim" onClick={() => void agendarTarea(x, manana)}>Agendar</button>
        : e?.lugar ? <a className="phPrim" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.lugar)}`} target="_blank" rel="noreferrer">Cómo llegar</a>
          : e ? <button type="button" className="phPrim" onClick={() => irA(e.fecha)}>Ver</button> : null
    const abierto = abiertoPH === x.clave
    const origen = e ? claveOrigen(e) : null
    const sug = x.sugerencia ? abrirSug(x.sugerencia) : null
    return <div key={x.clave} className={`phItem t-${x.tipo}${abierto ? ' abierto' : ''}`}>
      <span className="phIco" aria-hidden>{x.icono}</span>
      <button type="button" className="phTxt" aria-expanded={abierto} onClick={() => setAbiertoPH(abierto ? null : x.clave)} title="Tocá para ver qué es">
        <strong>{x.titulo}<span className="phTag">{e ? (origen ? 'AGENDADO DE LA LISTA' : 'AGENDADO') : 'AUTOMÁTICO'}</span></strong><small>{x.detalle}</small>
      </button>
      {abierto && <div className="phDet">
        <b className="phDetTit">{x.titulo}</b>
        <p>{x.explica ?? (e ? 'Lo agendaste en la agenda.' : x.detalle)}</p>
        {e && <ul>
          <li>📅 {capital(diaSemana(e.fecha))}{e.hora ? ` · ${e.hora.slice(0, 5)}` : ''}</li>
          {e.lugar && <li>📍 {e.lugar}</li>}
          {cliente(e.cliente_id) && <li>👤 {cliente(e.cliente_id)!.nombre}</li>}
          {nombreObra(e.obra_id) && <li>🏗️ {nombreObra(e.obra_id)}</li>}
        </ul>}
        <div className="phDetAcc">
          {sug && <button type="button" onClick={sug.f}>{sug.t} →</button>}
          {e && e.obra_id != null && onAbrirObra && <button type="button" onClick={() => onAbrirObra(e.obra_id!)}>Ver la obra →</button>}
          {e && <button type="button" onClick={() => irA(e.fecha)}>Ver en el día</button>}
          {e && <button type="button" onClick={() => setForm({ evento: e })}>✏️ Editar</button>}
          {e && origen && <button type="button" className="volver" onClick={() => void volverEvento(e)}>↩ Volver a pendientes</button>}
        </div>
      </div>}
      <div className="phAcc">
        {principal}
        <span className="phMenuWrap">
          <button type="button" className="phSec" title={e ? 'Pasar a otro día' : 'Agendar para otro día'} aria-label="Pasar a otro día" onClick={(ev) => { ev.stopPropagation(); setMenuDe(menuDe === x.clave ? null : x.clave) }}>📅</button>
          {menuDe === x.clave && <div className="phMenu" onClick={(ev) => ev.stopPropagation()}>
            {(e ? [['Hoy', hoyStr], ['Mañana', manana], ['El lunes que viene', lunesProx]] : [['Mañana', manana], ['El lunes que viene', lunesProx]]).filter(([, f]) => !e || f !== e.fecha).map(([t, f]) => (
              <button key={t} type="button" onClick={() => { setMenuDe(null); if (e) void mover(e, f); else void agendarTarea(x, f) }}>{t}</button>
            ))}
            <button type="button" onClick={() => { setMenuDe(null); if (e) setForm({ evento: e }); else setForm({ evento: { id: 0, titulo: x.tarea?.agendar ?? x.sugerencia?.agendar ?? x.titulo, detalle: notaDe(x), fecha: manana, hora: '10:00', tipo: x.sugerencia?.tipo ?? 'recordatorio', lugar: null, obra_id: x.tarea?.obra_id ?? x.sugerencia?.obra_id ?? null, cliente_id: null, completado: false, aviso_min: 60 } }) }}>Elegir día y hora…</button>
          </div>}
        </span>
        <button type="button" className="phSec ok" title={e ? 'Hecho' : 'Listo por hoy (vuelve mañana si sigue pendiente)'} aria-label="Hecho" onClick={() => { if (e) { void completar(e); setDeshacer({ texto: `"${e.titulo}" marcado como hecho`, hacer: () => void completar({ ...e, completado: true }) }) } else ocultar(x) }}>✓</button>
      </div>
    </div>
  }

  const carta = (e: Evento) => {
    const t = tipoDe(e.tipo)
    const c = cliente(e.cliente_id)
    const obra = nombreObra(e.obra_id)
    const wa = c?.telefono ? linkWhatsApp(c.telefono, `Hola ${c.nombre.split(' ')[0]}, te escribo de MOVA por: ${e.titulo}.`) : null
    const mapa = e.lugar ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.lugar)}` : null
    return <div key={e.id} className={`agEv${e.completado ? ' hecho' : ''}`}>
      <span className="agEvHora">{e.hora ? e.hora.slice(0, 5) : 'Día'}</span>
      <div className={`agCarta tipo-${e.tipo ?? 'recordatorio'}`}>
        <div className="agCartaTop">
          <span aria-hidden>{t.icono}</span>
          <div><b>{e.titulo}</b><small>{t.texto}{e.lugar ? ` · ${e.lugar}` : ''}{e.aviso_min != null && !e.completado ? ` · 🔔 ${textoAviso(e).toLowerCase()}` : ''}</small></div>
        </div>
        {(c || obra) && <div className="agEtiq">{c && <span>👤 {c.nombre}</span>}{obra && <span>🏗️ {obra}</span>}</div>}
        {notaSinMarca(e.detalle) && <p className="agNota">{notaSinMarca(e.detalle)}</p>}
        <div className="agAcc">
          <button type="button" className="ok" onClick={() => void completar(e)}>{e.completado ? '↩️ Deshacer' : '✓ Hecho'}</button>
          {wa && <a href={wa} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
          {mapa && <a href={mapa} target="_blank" rel="noreferrer">📍 Cómo llegar</a>}
          {!e.completado && <button type="button" onClick={() => void mover(e, sumarDias(e.fecha < hoyStr ? hoyStr : e.fecha, 1))}>⏰ Posponer</button>}
          <button type="button" aria-label="Editar" onClick={() => setForm({ evento: e })}>✏️</button>
          {claveOrigen(e) && !e.completado && <button type="button" title="La saca de la agenda y vuelve a la lista de Para hacer" onClick={() => void volverEvento(e)}>↩ Volver a pendientes</button>}
          <button type="button" aria-label="Eliminar" onClick={() => void eliminar(e)}>🗑</button>
        </div>
      </div>
    </div>
  }

  return (
    <div className="gestionPage agenda agNueva">
      <div className="agCab">
        <div><small>{capital(diaSemana(hoyStr))}</small><h2>Para hacer</h2></div>
        <button type="button" className={`agIcono${push === 'activo' ? ' on' : ''}`} onClick={() => setVerAvisos(true)} title="Avisos en el celular">
          {push === 'activo' ? '🔔 Avisos' : '🔕 Avisos'}
        </button>
        <button type="button" className="agIcono nuevo" onClick={() => setForm({ fecha: sel })} aria-label="Nuevo evento">＋</button>
      </div>

      {/* ---- Resumen: tocá uno para filtrar ---- */}
      <div className="phResumen">
        {([['atr', 'Atrasado', cuenta('atr'), 'se pasó la fecha'], ['hoy', 'Hoy', cuenta('hoy'), `${eventos.filter((e) => !e.completado && e.fecha === hoyStr).length} en la agenda`], ['sem', 'Esta semana', cuenta('sem'), 'próximos 7 días']] as const).map(([g, t, n, sub]) => (
          <button key={g} type="button" className={`phNum g-${g}${foco === g ? ' on' : ''}`} onClick={() => setFoco((f) => (f === g ? null : g))}><span>{t}</span><b>{cargandoTareas ? '…' : n}</b><small>{sub}</small></button>
        ))}
        {porCobrar != null && <button type="button" className={`phNum g-plata${foco === 'plata' ? ' on' : ''}`} onClick={() => setFoco((f) => (f === 'plata' ? null : 'plata'))}><span>Te deben</span><b>$ {Math.round(porCobrar).toLocaleString('es-AR')}</b><small>{items.filter((x) => x.tipo === 'cobro').length} para cobrar</small></button>}
      </div>

      {/* ---- Semana / mes ---- */}
      {/* En la PC: calendario y carga a la izquierda, el día a la derecha. En el celular, una sola columna. */}
      <div className="agCols"><div className="agColIzq">
      <section className="agSemana" aria-label="Calendario">
        <div className="agSemCab">
          <b>{capital((verMes ? new Date(`${sel}T12:00:00`) : new Date(`${inicioSem}T12:00:00`)).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }))}</b>
          <div>
            <button type="button" aria-label="Anterior" onClick={() => (verMes ? setSel(sumarMeses(sel, -1)) : setInicioSem(sumarDias(inicioSem, -7)))}>‹</button>
            <button type="button" className="txt" onClick={() => { setVerMes((v) => !v); setInicioSem(lunesDe(sel)) }}>{verMes ? 'Semana' : 'Mes'}</button>
            {(sel !== hoyStr || inicioSem !== lunesDe(hoyStr)) && <button type="button" className="txt" onClick={() => irA(hoyStr)}>Hoy</button>}
            <button type="button" aria-label="Siguiente" onClick={() => (verMes ? setSel(sumarMeses(sel, 1)) : setInicioSem(sumarDias(inicioSem, 7)))}>›</button>
          </div>
        </div>
        {!verMes ? <div className="agDias">
          {Array.from({ length: 7 }, (_, i) => sumarDias(inicioSem, i)).map((f, i) => (
            <button key={f} type="button" className={`agDiaBtn${f === hoyStr ? ' hoy' : ''}${f === sel ? ' sel' : ''}`} onClick={() => setSel(f)} aria-label={diaSemana(f)}>
              <small>{DIAS[i]}</small><b>{Number(f.slice(8))}</b>
              <span className="agPuntos">{puntos(f).map((e) => <i key={e.id} className={`tipo-${e.tipo ?? 'recordatorio'}`} />)}</span>
            </button>
          ))}
        </div> : <div className="agMes">
          {DIAS.map((d) => <span key={d}>{d[0]}</span>)}
          {(() => {
            const primero = `${sel.slice(0, 7)}-01`
            const ini = lunesDe(primero)
            return Array.from({ length: 42 }, (_, i) => sumarDias(ini, i)).filter((f, i) => i < 35 || f.slice(0, 7) === sel.slice(0, 7)).map((f) => (
              <button key={f} type="button" className={`${f.slice(0, 7) !== sel.slice(0, 7) ? 'fuera ' : ''}${f === sel ? 'sel ' : ''}${f === hoyStr ? 'hoy' : ''}`} onClick={() => irA(f)}>
                {Number(f.slice(8))}{puntos(f).length > 0 && <i />}
              </button>
            ))
          })()}
        </div>}
      </section>

      {/* ---- Carga rápida: dictar o escribir ---- */}
      <div className={`agRapida${dictado.escuchando ? ' oyendo' : ''}`}>
        <button type="button" className="agMic" aria-label={dictado.escuchando ? 'Dejar de escuchar' : 'Dictar'} onClick={() => (dictado.escuchando ? dictado.parar() : dictado.empezar())}>🎤</button>
        <input value={frase} onChange={(e) => setFrase(e.target.value)} placeholder="Dictá o escribí: “visita obra el martes 9hs”" aria-label="Carga rápida"
          onKeyDown={(e) => { if (e.key === 'Enter' && entendida) void guardarFrase(entendida).then((ok) => ok && setFrase('')) }} />
      </div>
      {dictado.escuchando && <div className="agEscucha"><span className="agOndas" aria-hidden><i /><i /><i /><i /><i /></span><div><b>Escuchando…</b><small>Hablá normal: “reunión con Aldo el jueves a las 3 de la tarde”</small></div><button type="button" onClick={dictado.parar}>Listo</button></div>}
      {dictado.error && <p className="agAvisoTxt">{dictado.error}</p>}
      {entendida && !dictado.escuchando && <div className="agPrevia">
        <b>{tipoDe(entendida.tipo).icono} {entendida.titulo}</b>
        <div className="agChipsPrev">
          <span>📅 {capital(diaSemana(entendida.fecha))}</span>
          <span>🕑 {entendida.hora ?? 'sin hora'}</span>
          {entendida.cliente_id && <span>👤 {cliente(entendida.cliente_id)?.nombre}</span>}
          {entendida.obra_id && <span>🏗️ {nombreObra(entendida.obra_id)}</span>}
          <span>🔔 1 h antes</span>
        </div>
        <div className="agPreviaAcc">
          <button id="agFraseOk" type="button" className="ok" disabled={guardandoFrase} onClick={() => void guardarFrase(entendida).then((ok) => ok && setFrase(''))}>{guardandoFrase ? 'Guardando…' : '✓ Guardar'}</button>
          <button type="button" onClick={() => setForm({ evento: { id: 0, titulo: entendida.titulo, detalle: null, fecha: entendida.fecha, hora: entendida.hora, tipo: entendida.tipo, lugar: null, obra_id: entendida.obra_id, cliente_id: entendida.cliente_id, completado: false, aviso_min: 60 } })}>✏️ Ajustar</button>
          <button type="button" onClick={() => setFrase('')}>Cancelar</button>
        </div>
      </div>}

      {/* ---- Todo lo pendiente ---- */}
      {tiposConItems.length > 1 && <div className="phChips" role="group" aria-label="Filtrar por tipo">
        <button type="button" className={filtro === 'todo' ? 'on' : ''} onClick={() => setFiltro('todo')}>Todo <em>{items.length}</em></button>
        {tiposConItems.map((t) => <button key={t} type="button" className={filtro === t ? 'on' : ''} onClick={() => setFiltro((f) => (f === t ? 'todo' : t))}>{TIPOS_PH[t].icono} {TIPOS_PH[t].nombre} <em>{items.filter((x) => x.tipo === t).length}</em></button>)}
      </div>}
      {cargando || cargandoTareas ? <p className="phVacio">Juntando lo que tenés para hacer…</p>
        : visibles.length === 0 ? <p className="phVacio">✓ {items.length ? 'Nada con este filtro.' : 'Todo al día. Escribí arriba para agendar algo.'}</p>
          : <div className="phLista">
            {GRUPOS_PH.map(([g, t]) => {
              const del = visibles.filter((x) => x.grupo === g)
              if (!del.length) return null
              return <section key={g} className={`phGrupo g-${g}`}><h3>{t} <span>{del.length}</span></h3>{del.map(renglon)}</section>
            })}
          </div>}
      </div><div className="agColDer">
      {aviso && <p className="agAvisoTxt ok" role="status">{aviso}</p>}
      {deshacer && <div className="phDeshacer" role="status"><span>{deshacer.texto}</span><button type="button" onClick={() => { const d = deshacer; setDeshacer(null); void d.hacer() }}>Deshacer</button></div>}
      {error && <p className="loginError">{error}</p>}
      {cargando ? <p>Cargando agenda…</p> : <>
        {/* ---- El día ---- */}
        <div className="agDiaTit"><b>{tituloDia}</b>{delDia.length > 0 && <span>{pendDia ? `${pendDia} pendiente${pendDia === 1 ? '' : 's'}` : '✓ Todo hecho'}</span>}</div>
        <div className="agLinea">
          {delDia.length === 0
            ? <div className="agLibre">Día libre. <button type="button" onClick={() => setForm({ fecha: sel })}>＋ Agendar algo</button></div>
            : (() => {
              const out: ReactNode[] = []
              let puesta = sel !== hoyStr
              delDia.forEach((e) => {
                if (!puesta && e.hora && e.hora.slice(0, 5) > horaAhora) { puesta = true; out.push(<div key="ahora" className="agAhora"><span>{horaAhora}</span><i /></div>) }
                out.push(carta(e))
              })
              if (!puesta) out.push(<div key="ahora" className="agAhora"><span>{horaAhora}</span><i /></div>)
              return out
            })()}
        </div>

      </>}
      <NotasPH />
      </div></div>

      {form && (
        <FormEvento
          evento={form.evento && form.evento.id ? form.evento : undefined}
          inicial={form.evento && !form.evento.id ? form.evento : undefined}
          fecha={form.fecha}
          obras={obras}
          clientes={clientes}
          onCancelar={() => setForm(null)}
          onGuardado={(f) => { setForm(null); setFrase(''); if (f) irA(f); setTick((t) => t + 1) }}
        />
      )}
      {verAvisos && <AvisosDiarios push={push} onPush={() => void togglePush()} onCerrar={() => setVerAvisos(false)} />}
    </div>
  )
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const lunesDe = (f: string) => { const d = new Date(`${f}T12:00:00`); return sumarDias(f, -((d.getDay() + 6) % 7)) }
const sumarMeses = (f: string, n: number) => { const d = new Date(`${f.slice(0, 7)}-01T12:00:00`); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }

// Crea un evento (con su aviso programado). Devuelve el error o null.
async function crearEvento(d: { titulo: string; fecha: string; hora: string | null; tipo: string; cliente_id: number | null; obra_id: number | null; aviso_min: number | null; lugar?: string | null; detalle?: string | null }): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser()
  const base = { titulo: d.titulo, fecha: d.fecha, hora: d.hora, tipo: d.tipo, obra_id: d.obra_id, cliente_id: d.cliente_id, detalle: d.detalle ?? null, notificado: false, completado: false, user_id: userData.user?.id ?? null }
  let r = await supabase.from('recordatorios').insert({ ...base, lugar: d.lugar ?? null, aviso_min: d.aviso_min, notificar_en: momentoAviso(d.fecha, d.hora, d.aviso_min) })
  if (r.error && /column|lugar|aviso_min|notificar_en/i.test(r.error.message)) r = await supabase.from('recordatorios').insert(base)
  if (r.error) { console.error(r.error); return 'No se pudo guardar.' }
  return null
}

// Dictado con el micrófono (reconocimiento de voz del navegador, en español).
type Reconocedor = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((ev: { error: string }) => void) | null }
function useDictado(alTexto: (texto: string, final: boolean) => void) {
  const [escuchando, setEscuchando] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<Reconocedor | null>(null)
  function empezar() {
    setError('')
    const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor }
    const Clase = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Clase) { setError('En este navegador no se puede usar el micrófono acá. Tocá el campo y usá el 🎤 del teclado para dictar.'); return }
    const r = new Clase()
    r.lang = 'es-AR'; r.interimResults = true; r.continuous = false
    r.onresult = (ev) => {
      let texto = '', final = false
      for (let i = 0; i < ev.results.length; i++) { texto += ev.results[i][0].transcript; final = ev.results[i].isFinal }
      alTexto(texto.trim(), final)
    }
    r.onerror = (ev) => setError(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'No hay permiso para el micrófono. Habilitalo en los ajustes del navegador, o usá el 🎤 del teclado.' : ev.error === 'no-speech' ? 'No te escuché. Probá de nuevo.' : 'No se pudo usar el micrófono. Usá el 🎤 del teclado.')
    r.onend = () => setEscuchando(false)
    ref.current = r
    try { r.start(); setEscuchando(true) } catch { setError('No se pudo usar el micrófono. Usá el 🎤 del teclado.') }
  }
  function parar() { ref.current?.stop(); setEscuchando(false) }
  useEffect(() => () => ref.current?.stop(), [])
  return { escuchando, error, empezar, parar }
}

// "Para agendar": se arman solas con plazos de obra, seguros del personal y presupuestos sin respuesta.
type Sugerencia = { clave: string; icono: string; tono: 'r' | 'n' | 'a'; titulo: string; detalle: string; agendar: string; tipo: string; obra_id?: number; explica?: string }
function useSugerencias(tick: number): Sugerencia[] {
  const [lista, setLista] = useState<Sugerencia[]>([])
  useEffect(() => {
    let vigente = true
    void (async () => {
      const hoyStr = isoLocal(new Date())
      const [o, p, s, r] = await Promise.all([
        supabase.from('obras').select('id,nombre_obra,fecha_fin_estimada').eq('activo', true).eq('estado', 'en_proceso'),
        supabase.from('presupuestos').select('id,titulo,enviado_at,fecha').eq('activo', true).eq('estado', 'enviado'),
        supabase.from('personal').select('id,nombre,apellido,seguro,seguro_vencimiento').eq('activo', true).not('seguro_vencimiento', 'is', null),
        supabase.from('recordatorios').select('titulo').eq('completado', false).gte('fecha', hoyStr),
      ])
      if (!vigente) return
      const yaAgendado = new Set(((r.data ?? []) as { titulo: string }[]).map((x) => x.titulo))
      const out: Sugerencia[] = []
      for (const ob of (o.data ?? []) as { id: number; nombre_obra: string; fecha_fin_estimada: string | null }[]) {
        if (!ob.fecha_fin_estimada || ob.fecha_fin_estimada > sumarDias(hoyStr, 7)) continue
        const vencido = ob.fecha_fin_estimada < hoyStr
        out.push({ clave: `o${ob.id}`, icono: '⏰', tono: vencido ? 'r' : 'n', titulo: `${ob.nombre_obra} · ${vencido ? 'plazo vencido' : 'vence pronto'}`, detalle: `Fin estimado ${fechaCorta(ob.fecha_fin_estimada)}`, agendar: `Revisar plazo de ${ob.nombre_obra}`, tipo: 'recordatorio', obra_id: ob.id, explica: vencido ? `La obra tenía que terminar el ${fechaCorta(ob.fecha_fin_estimada)} y sigue en proceso. Actualizá el avance, cambiá la fecha estimada o marcala terminada.` : `La obra tiene fin estimado el ${fechaCorta(ob.fecha_fin_estimada)}. Revisá si llegás o avisale al cliente.` })
      }
      if (!s.error) for (const pe of (s.data ?? []) as { id: number; nombre: string; apellido: string | null; seguro: string | null; seguro_vencimiento: string | null }[]) {
        if (!pe.seguro_vencimiento || pe.seguro_vencimiento > sumarDias(hoyStr, 15)) continue
        const nom = `${pe.nombre} ${pe.apellido ?? ''}`.trim()
        out.push({ clave: `s${pe.id}`, icono: '🦺', tono: pe.seguro_vencimiento < hoyStr ? 'r' : 'n', titulo: `${pe.seguro || 'Seguro / ART'} de ${nom} ${pe.seguro_vencimiento < hoyStr ? 'vencido' : 'por vencer'}`, detalle: `Vence ${fechaCorta(pe.seguro_vencimiento)}`, agendar: `Renovar ${pe.seguro || 'seguro / ART'} de ${nom}`, tipo: 'recordatorio', explica: `El ${pe.seguro || 'seguro / ART'} de ${nom} ${pe.seguro_vencimiento < hoyStr ? 'venció' : 'vence'} el ${fechaCorta(pe.seguro_vencimiento)}. Sin cobertura no conviene que trabaje en obra.` })
      }
      for (const pr of (p.data ?? []) as { id: number; titulo: string; enviado_at?: string | null; fecha: string | null }[]) {
        const desde = (pr.enviado_at ?? pr.fecha ?? '').slice(0, 10)
        if (!desde || desde > sumarDias(hoyStr, -5)) continue
        const dias = Math.round((Date.parse(hoyStr) - Date.parse(desde)) / 86400000)
        out.push({ clave: `p${pr.id}`, icono: '💬', tono: 'a', titulo: `Seguir presupuesto ${pr.titulo}`, detalle: `Enviado hace ${dias} días · sin respuesta`, agendar: `Seguimiento presupuesto ${pr.titulo}`, tipo: 'llamada', explica: `Le mandaste el presupuesto hace ${dias} días y el cliente no respondió. Conviene escribirle para saber si tiene dudas o quiere ajustar algo.` })
      }
      setLista(out.filter((x) => !yaAgendado.has(x.agendar)).slice(0, 6))
    })()
    return () => { vigente = false }
  }, [tick])
  return lista
}

function FormEvento({ evento: editado, inicial, fecha, obras, clientes, onCancelar, onGuardado }: {
  evento?: Evento; inicial?: Evento; fecha?: string; obras: Opcion[]; clientes: Opcion[]; onCancelar: () => void; onGuardado: (fecha?: string) => void
}) {
  const editando = !!editado
  // "inicial": lo que entendió la carga rápida, para ajustarlo antes de guardar.
  const evento = editado ?? inicial
  const [f, setF] = useState({
    tipo: evento?.tipo && TIPOS_EVENTO[evento.tipo] ? evento.tipo : 'reunion',
    titulo: evento?.titulo ?? '',
    fecha: evento?.fecha ?? fecha ?? isoLocal(new Date()),
    hora: evento?.hora ? evento.hora.slice(0, 5) : '',
    lugar: evento?.lugar ?? '',
    obra_id: evento?.obra_id ? String(evento.obra_id) : '',
    cliente_id: evento?.cliente_id ? String(evento.cliente_id) : '',
    detalle: evento?.detalle ?? '',
    aviso: evento ? (evento.aviso_min == null ? '' : String(evento.aviso_min)) : '60',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (campo: string, valor: string) => setF((a) => ({ ...a, [campo]: valor }))

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!f.titulo.trim()) { setError('Ingresá un título.'); return }
    setGuardando(true)
    const avisoMin = f.aviso === '' ? null : Number(f.aviso)
    const base = {
      titulo: f.titulo.trim(), fecha: f.fecha, hora: f.hora || null, tipo: f.tipo,
      obra_id: f.obra_id ? Number(f.obra_id) : null, cliente_id: f.cliente_id ? Number(f.cliente_id) : null,
      detalle: f.detalle.trim() || null,
      // Al crear o editar se vuelve a programar el aviso.
      notificado: false,
    }
    const nuevos = { lugar: f.lugar.trim() || null, aviso_min: avisoMin, notificar_en: momentoAviso(f.fecha, f.hora || null, avisoMin) }
    const { data: userData } = await supabase.auth.getUser()
    const guardarCon = (datos: Record<string, unknown>) => editando
      ? supabase.from('recordatorios').update(datos).eq('id', evento!.id)
      : supabase.from('recordatorios').insert({ ...datos, completado: false, user_id: userData.user?.id ?? null })
    let r = await guardarCon({ ...base, ...nuevos })
    if (r.error && /column|lugar|aviso_min|notificar_en/i.test(r.error.message)) {
      // Todavía no se corrió el SQL de la Agenda: se guarda sin los campos nuevos.
      r = await guardarCon(base)
      if (!r.error) window.alert('Se guardó, pero falta correr el SQL de la Agenda en Supabase para guardar el lugar y el horario del aviso.')
    }
    if (r.error) { console.error(r.error); setError('No se pudo guardar.'); setGuardando(false); return }
    onGuardado(f.fecha)
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard">
        <div className="modalHeader">
          <div><p className="subtitle">AGENDA</p><h2>{editando ? 'Editar' : 'Nuevo evento'}</h2></div>
          <button type="button" className="closeButton" onClick={onCancelar}>×</button>
        </div>
        <form className="clienteForm" onSubmit={guardar}>
          <div className="caChips agTipos" role="radiogroup" aria-label="Tipo">
            {Object.entries(TIPOS_EVENTO).map(([v, t]) => (
              <button key={v} type="button" role="radio" aria-checked={f.tipo === v} className={f.tipo === v ? 'activo' : ''} onClick={() => set('tipo', v)}>{t.icono} {t.texto}</button>
            ))}
          </div>
          <div className="formGrid">
            <label className="formFull">Título *<input value={f.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder={f.tipo === 'reunion' ? 'Ej.: Reunión con Candela por la domótica' : f.tipo === 'llamada' ? 'Ej.: Llamar a proveedor de cámaras' : f.tipo === 'visita' ? 'Ej.: Visita de relevamiento' : 'Ej.: Comprar materiales'} required /></label>
            <label>Fecha *<input type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} required /></label>
            <label>Hora<input type="time" value={f.hora} onChange={(e) => set('hora', e.target.value)} /></label>
            <label className="formFull">Lugar<input value={f.lugar} onChange={(e) => set('lugar', e.target.value)} placeholder="Dirección, oficina, videollamada…" /></label>
            <label>Cliente (opcional)<select value={f.cliente_id} onChange={(e) => set('cliente_id', e.target.value)}><option value="">Sin cliente</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
            <label>Obra (opcional)<select value={f.obra_id} onChange={(e) => set('obra_id', e.target.value)}><option value="">Sin obra</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></label>
            <label className="formFull">Avisarme al celular<select value={f.aviso} onChange={(e) => set('aviso', e.target.value)}>{AVISOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
            <label className="formFull">Notas<textarea value={f.detalle} onChange={(e) => set('detalle', e.target.value)} placeholder="Temas a tratar, qué llevar…" /></label>
          </div>
          {!f.hora && f.aviso !== '' && <p className="gestionAyuda">Sin hora, el aviso se calcula desde las 9:00 de ese día.</p>}
          {error && <p className="loginError">{error}</p>}
          <div className="formActions">
            <button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button>
            <button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Agregar a la agenda'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
