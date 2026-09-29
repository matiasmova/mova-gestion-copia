import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from './supabase'
import { fechaCorta, hoy, moneda } from './gestionFormat'
import { estadoPush, activarPush, desactivarPush, type EstadoPush } from './push'
import { confirmarEliminacion } from './confirmar'

// Agenda: reuniones, recordatorios, visitas y llamadas, con aviso al celular.
// Vistas: Próximos (lista por día), Calendario (mes) y Alertas automáticas
// (plazos de obra y saldos por cobrar, que antes estaban en Notificaciones).
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
type Vista = 'proximos' | 'calendario' | 'alertas'

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
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
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

export default function Agenda() {
  const [vista, setVista] = useState<Vista>('proximos')
  const [eventos, setEventos] = useState<Evento[]>([])
  const [obras, setObras] = useState<Opcion[]>([])
  const [clientes, setClientes] = useState<Opcion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [form, setForm] = useState<{ evento?: Evento; fecha?: string } | null>(null)
  const [verHechos, setVerHechos] = useState(false)
  const [push, setPush] = useState<EstadoPush | 'cargando' | 'procesando'>('cargando')
  const [pushMsg, setPushMsg] = useState('')

  useEffect(() => { void estadoPush().then(setPush).catch(() => setPush('no-soportado')) }, [])

  async function togglePush() {
    if (push === 'activo') {
      const r = await desactivarPush(); setPushMsg(r.msg)
    } else {
      setPush('procesando'); const r = await activarPush(); setPushMsg(r.msg)
    }
    setPush(await estadoPush())
  }

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true); setError('')
      const [rE, rO, rC] = await Promise.all([
        supabase.from('recordatorios').select('*').order('fecha', { ascending: true }).order('hora', { ascending: true, nullsFirst: true }),
        supabase.from('obras').select('id,nombre_obra').eq('activo', true).order('nombre_obra'),
        supabase.from('Clientes').select('id,nombre,apellido').order('nombre'),
      ])
      if (!vigente) return
      if (rE.error) { console.error(rE.error); setError('No se pudo cargar la agenda.'); setCargando(false); return }
      setEventos(((rE.data ?? []) as Evento[]).map((e) => ({ ...e, aviso_min: e.aviso_min === undefined ? 0 : e.aviso_min })))
      setObras(((rO.data ?? []) as { id: number; nombre_obra: string }[]).map((o) => ({ id: o.id, nombre: o.nombre_obra })))
      setClientes(((rC.data ?? []) as { id: number; nombre: string; apellido: string | null }[]).map((c) => ({ id: c.id, nombre: `${c.nombre} ${c.apellido ?? ''}`.trim() })))
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [tick])

  const nombreObra = (id: number | null) => obras.find((o) => o.id === id)?.nombre ?? null
  const nombreCliente = (id: number | null) => clientes.find((c) => c.id === id)?.nombre ?? null

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

  const tarjeta = (e: Evento) => {
    const t = tipoDe(e.tipo)
    const extra = [e.lugar ? `📍 ${e.lugar}` : null, nombreObra(e.obra_id) ? `🏗 ${nombreObra(e.obra_id)}` : null, nombreCliente(e.cliente_id) ? `👤 ${nombreCliente(e.cliente_id)}` : null].filter(Boolean)
    return (
      <article key={e.id} className={`agEvento tipo-${e.tipo ?? 'recordatorio'} ${e.completado ? 'hecho' : ''}`}>
        <div className="agHora">{e.hora ? e.hora.slice(0, 5) : 'Todo el día'}</div>
        <div className="agCuerpo">
          <strong>{t.icono} {e.titulo}</strong>
          {extra.length > 0 && <small>{extra.join(' · ')}</small>}
          {e.detalle && <small className="agDetalle">{e.detalle}</small>}
          <small className="agAviso">{e.aviso_min == null ? '🔕 Sin aviso' : `🔔 ${textoAviso(e)}`}</small>
        </div>
        <div className="agAcciones">
          <button type="button" className={`agBtn ${e.completado ? 'ok' : ''}`} title={e.completado ? 'Marcar pendiente' : 'Marcar hecho'} onClick={() => void completar(e)}>✓</button>
          <button type="button" className="agBtn" title="Editar" onClick={() => setForm({ evento: e })}>✏️</button>
          <button type="button" className="agBtn peligro" title="Eliminar" onClick={() => void eliminar(e)}>🗑</button>
        </div>
      </article>
    )
  }

  // ---------- Próximos, agrupados ----------
  const hoyStr = hoy()
  const manana = sumarDias(hoyStr, 1)
  const enSemana = sumarDias(hoyStr, 7)
  const grupos = useMemo(() => {
    const visibles = eventos.filter((e) => verHechos || !e.completado)
    const g: { clave: string; titulo: string; items: Evento[] }[] = [
      { clave: 'atrasados', titulo: '⚠ Atrasados', items: visibles.filter((e) => !e.completado && e.fecha < hoyStr) },
      { clave: 'hoy', titulo: 'Hoy', items: visibles.filter((e) => e.fecha === hoyStr) },
      { clave: 'manana', titulo: 'Mañana', items: visibles.filter((e) => e.fecha === manana) },
      { clave: 'semana', titulo: 'Esta semana', items: visibles.filter((e) => e.fecha > manana && e.fecha <= enSemana) },
      { clave: 'despues', titulo: 'Más adelante', items: visibles.filter((e) => e.fecha > enSemana) },
    ]
    return g.filter((x) => x.items.length > 0 || x.clave === 'hoy')
  }, [eventos, verHechos, hoyStr, manana, enSemana])

  return (
    <div className="gestionPage agenda">
      <div className="pageHeader agHead">
        <div><p className="subtitle">ORGANIZACIÓN</p><h2>Agenda</h2><p className="welcome">Reuniones, recordatorios, visitas y llamadas</p></div>
        <button className="newButton" onClick={() => setForm({ fecha: hoyStr })}>+ Nuevo</button>
      </div>

      <div className={`agPush ${push === 'activo' ? 'on' : ''}`}>
        <span>{push === 'activo' ? '🔔 Avisos activados en este dispositivo' : push === 'bloqueado' ? '🔕 Avisos bloqueados en este dispositivo' : push === 'no-soportado' ? '📱 Para recibir avisos, instalá la app en el celular' : '🔕 Avisos desactivados en este dispositivo'}</span>
        {push === 'no-soportado' ? <small>En iPhone: Compartir → Agregar a inicio, abrila desde el ícono y volvé acá.</small>
          : push === 'bloqueado' ? <small>Habilitá las notificaciones en los ajustes del navegador o del teléfono y recargá.</small>
          : <button type="button" className={`configSwitch ${push === 'activo' ? 'on' : ''}`} onClick={() => void togglePush()} disabled={push === 'cargando' || push === 'procesando'} aria-label="Activar avisos en este dispositivo"><i /></button>}
        {pushMsg && <small className="agPushMsg">{pushMsg}</small>}
      </div>

      <div className="gestionTabs homeTabs">
        <button className={vista === 'proximos' ? 'active' : ''} onClick={() => setVista('proximos')}>Próximos</button>
        <button className={vista === 'calendario' ? 'active' : ''} onClick={() => setVista('calendario')}>📅 Calendario</button>
        <button className={vista === 'alertas' ? 'active' : ''} onClick={() => setVista('alertas')}>⚠ Alertas</button>
      </div>

      {error && <p className="loginError">{error}</p>}
      {cargando && vista !== 'alertas' && <p>Cargando agenda...</p>}

      {!cargando && vista === 'proximos' && <>
        {grupos.map((g) => (
          <section key={g.clave} className={`agGrupo ${g.clave}`}>
            <h3>{g.titulo}{g.clave === 'hoy' && <span> · {diaSemana(hoyStr)}</span>}</h3>
            {g.items.length === 0 ? <p className="agVacio">Nada para hoy. <button type="button" className="caLink" onClick={() => setForm({ fecha: hoyStr })}>+ Agregar</button></p>
              : g.clave === 'hoy' || g.clave === 'manana'
                ? g.items.map(tarjeta)
                : Object.entries(g.items.reduce<Record<string, Evento[]>>((acc, e) => { (acc[e.fecha] ??= []).push(e); return acc }, {})).map(([f, lista]) => (
                  <div key={f} className="agDia"><p className="agDiaTit">{diaSemana(f)}</p>{lista.map(tarjeta)}</div>
                ))}
          </section>
        ))}
        <label className="agVerHechos"><input type="checkbox" checked={verHechos} onChange={(e) => setVerHechos(e.target.checked)} /> Mostrar también lo ya hecho</label>
      </>}

      {!cargando && vista === 'calendario' && (
        <CalendarioMes eventos={eventos} onDia={(f) => setForm({ fecha: f })} tarjeta={tarjeta} />
      )}

      {vista === 'alertas' && <AlertasAutomaticas />}

      {form && (
        <FormEvento
          evento={form.evento}
          fecha={form.fecha}
          obras={obras}
          clientes={clientes}
          onCancelar={() => setForm(null)}
          onGuardado={() => { setForm(null); setTick((t) => t + 1) }}
        />
      )}
    </div>
  )
}

// ---------- Calendario del mes ----------
function CalendarioMes({ eventos, onDia, tarjeta }: { eventos: Evento[]; onDia: (fecha: string) => void; tarjeta: (e: Evento) => ReactNode }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { anio: d.getFullYear(), mes: d.getMonth() } })
  const [sel, setSel] = useState(hoy())
  const { anio, mes } = cursor
  const celdas = useMemo(() => {
    const offset = (new Date(anio, mes, 1).getDay() + 6) % 7
    const dias = new Date(anio, mes + 1, 0).getDate()
    const arr: (number | null)[] = []
    for (let i = 0; i < offset; i++) arr.push(null)
    for (let d = 1; d <= dias; d++) arr.push(d)
    return arr
  }, [anio, mes])
  const mover = (delta: number) => setCursor((c) => { const nm = c.mes + delta; return { anio: c.anio + Math.floor(nm / 12), mes: ((nm % 12) + 12) % 12 } })
  const hoyStr = hoy()
  const delSel = eventos.filter((e) => e.fecha === sel)

  return (
    <div className="calWrap">
      <div className="calMain">
        <div className="calHead">
          <button onClick={() => mover(-1)} aria-label="Mes anterior">‹</button>
          <h3>{MESES[mes]} {anio}</h3>
          <button onClick={() => mover(1)} aria-label="Mes siguiente">›</button>
          <button className="calHoy" onClick={() => { const d = new Date(); setCursor({ anio: d.getFullYear(), mes: d.getMonth() }); setSel(hoyStr) }}>Hoy</button>
        </div>
        <div className="calSemana">{DIAS.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="calGrid">
          {celdas.map((dia, i) => {
            if (dia === null) return <div className="calCell vacia" key={`v${i}`} />
            const f = `${anio}-${pad(mes + 1)}-${pad(dia)}`
            const delDia = eventos.filter((e) => e.fecha === f)
            return (
              <div className={`calCell ${f === hoyStr ? 'hoy' : ''} ${f === sel ? 'sel' : ''}`} key={f} onClick={() => setSel(f)}>
                <span className="calNum">{dia}</span>
                {delDia.slice(0, 3).map((e) => (
                  <span className={`calChip tipo-${e.tipo ?? 'recordatorio'} ${e.completado ? 'ok' : ''}`} key={e.id} title={e.titulo}>{e.hora ? `${e.hora.slice(0, 5)} ` : ''}{e.titulo}</span>
                ))}
                {delDia.length > 0 && <span className="calPuntos" aria-hidden>{delDia.slice(0, 4).map((e) => <i key={e.id} className={`tipo-${e.tipo ?? 'recordatorio'}`} />)}</span>}
                {delDia.length > 3 && <span className="calMas">+{delDia.length - 3}</span>}
              </div>
            )
          })}
        </div>
      </div>
      <div className="calLateral">
        <div className="calLateralTitulo">{diaSemana(sel)}</div>
        {delSel.length === 0 ? <p className="agVacio">Nada cargado este día.</p> : delSel.map(tarjeta)}
        <button type="button" className="newButton agAgregarDia" onClick={() => onDia(sel)}>+ Agregar en este día</button>
      </div>
    </div>
  )
}

// ---------- Formulario de evento (nuevo / editar) ----------
function FormEvento({ evento, fecha, obras, clientes, onCancelar, onGuardado }: {
  evento?: Evento; fecha?: string; obras: Opcion[]; clientes: Opcion[]; onCancelar: () => void; onGuardado: () => void
}) {
  const editando = !!evento
  const [f, setF] = useState({
    tipo: evento?.tipo && TIPOS_EVENTO[evento.tipo] ? evento.tipo : 'reunion',
    titulo: evento?.titulo ?? '',
    fecha: evento?.fecha ?? fecha ?? hoy(),
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
    onGuardado()
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

// ---------- Alertas automáticas (antes: Notificaciones) ----------
type ObraAlerta = { id: number; nombre_obra: string; fecha_fin_estimada: string | null }
type PresupuestoAlerta = { id: number; titulo: string; obra_id: number | null; saldo: number }

function AlertasAutomaticas() {
  const [obras, setObras] = useState<ObraAlerta[]>([])
  const [presupuestos, setPresupuestos] = useState<PresupuestoAlerta[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    async function cargar() {
      const [o, p] = await Promise.all([
        supabase.from('obras').select('id,nombre_obra,fecha_fin_estimada').eq('activo', true).eq('estado', 'en_proceso'),
        supabase.from('presupuestos').select('id,titulo,obra_id,saldo').eq('activo', true).eq('estado', 'aceptado'),
      ])
      if (!vigente) return
      if (o.error) { setError('No se pudieron cargar las alertas.'); setCargando(false); return }
      setObras((o.data ?? []) as ObraAlerta[])
      setPresupuestos(((p.data ?? []) as PresupuestoAlerta[]).map((x) => ({ ...x, saldo: Number(x.saldo) || 0 })))
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [])

  const hoyStr = hoy()
  const en7 = sumarDias(hoyStr, 7)
  const nombreObra = (id: number | null) => obras.find((o) => o.id === id)?.nombre_obra ?? 'Sin obra'
  const alertas = [
    ...obras.filter((o) => o.fecha_fin_estimada && o.fecha_fin_estimada < hoyStr).map((o) => ({ clave: `v${o.id}`, icono: '⏰', titulo: `${o.nombre_obra} — plazo vencido`, detalle: `Fin estimado: ${fechaCorta(o.fecha_fin_estimada)}`, urgente: true })),
    ...obras.filter((o) => o.fecha_fin_estimada && o.fecha_fin_estimada >= hoyStr && o.fecha_fin_estimada <= en7).map((o) => ({ clave: `p${o.id}`, icono: '⏰', titulo: `${o.nombre_obra} — vence pronto`, detalle: `Fin estimado: ${fechaCorta(o.fecha_fin_estimada)}`, urgente: false })),
    ...presupuestos.filter((p) => p.saldo > 0).map((p) => ({ clave: `c${p.id}`, icono: '💰', titulo: `Saldo por cobrar — ${p.titulo}`, detalle: `${nombreObra(p.obra_id)} · ${moneda(p.saldo)} pendiente`, urgente: false })),
  ]

  if (cargando) return <p>Calculando alertas...</p>
  if (error) return <p className="loginError">{error}</p>
  return (
    <div className="clientesPanel">
      <p className="gestionAyuda" style={{ padding: '12px 20px 0', margin: 0 }}>Se arman solas con los plazos de las obras y los saldos de los presupuestos aceptados.</p>
      {alertas.length === 0 ? (
        <div className="empty"><span>✓</span><h3>Todo al día</h3><p>No hay plazos vencidos ni saldos pendientes.</p></div>
      ) : alertas.map((a) => (
        <div className="gestionNotificacion" key={a.clave}>
          <div className="gestionNotifIcono">{a.icono}</div>
          <div><strong>{a.titulo}</strong><p>{a.detalle}</p></div>
          {a.urgente && <span className="gestionEstado alerta">Urgente</span>}
        </div>
      ))}
    </div>
  )
}
