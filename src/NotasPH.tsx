import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { confirmarEliminacion } from './confirmar'

// Para hacer → Notas: cosas para acordarse, con o sin día y hora.
// Las que tienen día avisan al celular (a la hora, o a las 9 si no tiene hora)
// y entran en el resumen de la mañana (Edge Function "enviar-recordatorios").
// Son privadas: cada usuario ve las suyas (tabla "notas", fase 39).

export type Nota = { id: number; texto: string; fecha: string | null; hora: string | null; color: string | null; fijada: boolean; hecha: boolean; aviso: boolean; created_at: string }
type Borrador = { texto: string; fecha: string; hora: string; color: string; aviso: boolean }

const COLORES_NOTA: [string, string][] = [['', 'Sin color'], ['amarillo', 'Amarillo'], ['verde', 'Verde'], ['azul', 'Azul'], ['rojo', 'Rojo'], ['violeta', 'Violeta']]
const VACIO: Borrador = { texto: '', fecha: '', hora: '', color: '', aviso: true }
const pad = (n: number) => String(n).padStart(2, '0')
const isoHoy = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const sumar = (f: string, n: number) => { const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
// Cuándo avisar: el día a la hora elegida (9:00 si no tiene), hora de Argentina.
const momento = (fecha: string | null, hora: string | null, aviso: boolean) => (fecha && aviso ? new Date(`${fecha}T${(hora || '09:00').slice(0, 5)}:00-03:00`).toISOString() : null)

function cuando(n: Nota, hoy: string) {
  if (!n.fecha) return null
  const dia = n.fecha === hoy ? 'Hoy' : n.fecha === sumar(hoy, 1) ? 'Mañana' : n.fecha === sumar(hoy, -1) ? 'Ayer'
    : new Date(`${n.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}${n.hora ? ` · ${n.hora.slice(0, 5)}` : ''}`
}

export default function NotasPH() {
  const hoy = isoHoy()
  const [notas, setNotas] = useState<Nota[]>([])
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'falta'>('cargando')
  const [nueva, setNueva] = useState<Borrador>(VACIO)
  const [conDia, setConDia] = useState(false)
  const [editando, setEditando] = useState<{ id: number; b: Borrador } | null>(null)
  const [verHechas, setVerHechas] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void supabase.from('notas').select('id,texto,fecha,hora,color,fijada,hecha,aviso,created_at').order('created_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (e) { setEstado('falta'); return }
        setNotas((data ?? []) as Nota[]); setEstado('ok')
      })
  }, [])

  const datosDe = (b: Borrador) => {
    const fecha = b.fecha || null
    const hora = fecha && b.hora ? b.hora : null
    return { texto: b.texto.trim(), fecha, hora, color: b.color || null, aviso: b.aviso, notificar_en: momento(fecha, hora, b.aviso), notificado: false }
  }

  async function agregar() {
    if (!nueva.texto.trim()) return
    setGuardando(true); setError('')
    const { data, error: e } = await supabase.from('notas').insert(datosDe(nueva)).select('id,texto,fecha,hora,color,fijada,hecha,aviso,created_at').single()
    setGuardando(false)
    if (e || !data) { setError('No se pudo guardar la nota.'); return }
    setNotas((ns) => [data as Nota, ...ns]); setNueva(VACIO); setConDia(false)
  }
  async function cambiar(n: Nota, campos: Partial<Nota> & Record<string, unknown>) {
    const { error: e } = await supabase.from('notas').update(campos).eq('id', n.id)
    if (e) { setError('No se pudo actualizar.'); return false }
    setNotas((ns) => ns.map((x) => (x.id === n.id ? { ...x, ...campos } : x)))
    return true
  }
  async function guardarEdicion() {
    if (!editando || !editando.b.texto.trim()) return
    const n = notas.find((x) => x.id === editando.id)
    if (n && await cambiar(n, datosDe(editando.b))) setEditando(null)
  }
  async function borrar(n: Nota) {
    if (!confirmarEliminacion(`¿Borrar la nota "${n.texto.slice(0, 40)}"?`)) return
    const { error: e } = await supabase.from('notas').delete().eq('id', n.id)
    if (e) { setError('No se pudo borrar.'); return }
    setNotas((ns) => ns.filter((x) => x.id !== n.id))
  }

  // Fijadas arriba; después las que tienen día (la más próxima primero) y al final las sin día.
  const orden = (a: Nota, b: Nota) => Number(b.fijada) - Number(a.fijada)
    || (a.fecha && b.fecha ? `${a.fecha}${a.hora ?? ''}`.localeCompare(`${b.fecha}${b.hora ?? ''}`) : a.fecha ? -1 : b.fecha ? 1 : b.created_at.localeCompare(a.created_at))
  const pendientes = notas.filter((n) => !n.hecha).sort(orden)
  const hechas = notas.filter((n) => n.hecha)

  const campos = (b: Borrador, set: (b: Borrador) => void, dia: boolean) => <>
    {dia && <div className="ntCuando">
      <label>Día<input type="date" value={b.fecha} onChange={(e) => set({ ...b, fecha: e.target.value })} /></label>
      <label><span>Hora <small>(opcional)</small></span><input type="time" value={b.hora} disabled={!b.fecha} onChange={(e) => set({ ...b, hora: e.target.value })} /></label>
      <div className="ntAtajos">
        {[['Hoy', hoy], ['Mañana', sumar(hoy, 1)], ['En una semana', sumar(hoy, 7)]].map(([t, f]) => <button key={t} type="button" className={b.fecha === f ? 'on' : ''} onClick={() => set({ ...b, fecha: f })}>{t}</button>)}
      </div>
      {b.fecha && <label className="ntAviso"><input type="checkbox" checked={b.aviso} onChange={(e) => set({ ...b, aviso: e.target.checked })} /> Avisarme al celular {b.hora ? `a las ${b.hora}` : 'ese día a las 9'}</label>}
    </div>}
    <div className="ntColores" role="radiogroup" aria-label="Color">
      {COLORES_NOTA.map(([c, t]) => <button key={c || 'ninguno'} type="button" role="radio" aria-checked={b.color === c} aria-label={t} title={t} className={`ntCol c-${c || 'ninguno'}${b.color === c ? ' on' : ''}`} onClick={() => set({ ...b, color: c })} />)}
    </div>
  </>

  const tarjeta = (n: Nota) => {
    if (editando?.id === n.id) {
      const b = editando.b
      return <div key={n.id} className={`ntNota c-${b.color || 'ninguno'} editando`}>
        <textarea value={b.texto} rows={3} autoFocus onChange={(e) => setEditando({ id: n.id, b: { ...b, texto: e.target.value } })} aria-label="Texto de la nota" />
        {campos(b, (nb) => setEditando({ id: n.id, b: nb }), true)}
        <div className="ntAcc">
          {b.fecha && <button type="button" onClick={() => setEditando({ id: n.id, b: { ...b, fecha: '', hora: '' } })}>Quitar día</button>}
          <button type="button" onClick={() => setEditando(null)}>Cancelar</button>
          <button type="button" className="ok" onClick={() => void guardarEdicion()}>Guardar</button>
        </div>
      </div>
    }
    const c = cuando(n, hoy)
    const atrasada = !n.hecha && n.fecha && n.fecha < hoy
    return <div key={n.id} className={`ntNota c-${n.color || 'ninguno'}${n.hecha ? ' hecha' : ''}`}>
      <button type="button" className={`ntCheck${n.hecha ? ' on' : ''}`} aria-label={n.hecha ? 'Marcar como pendiente' : 'Marcar como hecha'} onClick={() => void cambiar(n, { hecha: !n.hecha })}>{n.hecha ? '✓' : ''}</button>
      <div className="ntCuerpo" onDoubleClick={() => setEditando({ id: n.id, b: { texto: n.texto, fecha: n.fecha ?? '', hora: n.hora?.slice(0, 5) ?? '', color: n.color ?? '', aviso: n.aviso } })}>
        <p>{n.texto}</p>
        {(c || n.fijada) && <div className="ntMeta">
          {n.fijada && <span className="fija">Fijada</span>}
          {c && <span className={atrasada ? 'atr' : n.fecha === hoy ? 'hoy' : ''}>{atrasada ? 'Atrasada · ' : ''}{c}{n.aviso && !n.hecha ? ' · aviso' : ''}</span>}
        </div>}
      </div>
      <div className="ntBotones">
        <button type="button" className={n.fijada ? 'on' : ''} title={n.fijada ? 'Desfijar' : 'Fijar arriba'} aria-label={n.fijada ? 'Desfijar' : 'Fijar arriba'} onClick={() => void cambiar(n, { fijada: !n.fijada })}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={n.fijada ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 17v5" /><path d="M9 10.8V4h6v6.8l3 3.2v2H6v-2z" /></svg>
        </button>
        <button type="button" title="Editar" aria-label="Editar" onClick={() => setEditando({ id: n.id, b: { texto: n.texto, fecha: n.fecha ?? '', hora: n.hora?.slice(0, 5) ?? '', color: n.color ?? '', aviso: n.aviso } })}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
        </button>
        <button type="button" title="Borrar" aria-label="Borrar" onClick={() => void borrar(n)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></svg>
        </button>
      </div>
    </div>
  }

  return <section className="ntPanel" aria-label="Notas">
    <div className="ntCab"><b>Notas</b>{pendientes.length > 0 && <span>{pendientes.length}</span>}</div>
    {estado === 'falta' ? <p className="gestionAyuda usFalta">Para usar las notas falta correr en Supabase el SQL <b>supabase-notas-fase-39.sql</b>.</p> : <>
      <div className={`ntNueva c-${nueva.color || 'ninguno'}`}>
        <textarea value={nueva.texto} rows={nueva.texto ? 3 : 1} placeholder="Escribí una nota…" aria-label="Nueva nota" onChange={(e) => setNueva({ ...nueva, texto: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void agregar() }} />
        {(nueva.texto || conDia) && <>
          {campos(nueva, setNueva, conDia)}
          <div className="ntAcc">
            <button type="button" className={conDia ? 'on' : ''} onClick={() => { setConDia((v) => !v); if (conDia) setNueva({ ...nueva, fecha: '', hora: '' }) }}>{conDia ? 'Sin día' : 'Ponerle día y hora'}</button>
            <button type="button" className="ok" disabled={guardando || !nueva.texto.trim()} onClick={() => void agregar()}>{guardando ? 'Guardando…' : 'Guardar nota'}</button>
          </div>
        </>}
      </div>
      {error && <p className="loginError">{error}</p>}
      {estado === 'cargando' ? <p className="ntVacio">Cargando notas…</p>
        : pendientes.length === 0 && !verHechas ? <p className="ntVacio">Sin notas pendientes.</p>
          : <div className="ntLista">{pendientes.map(tarjeta)}</div>}
      {hechas.length > 0 && <button type="button" className="ntVerHechas" onClick={() => setVerHechas((v) => !v)}>{verHechas ? 'Ocultar hechas' : `Ver hechas (${hechas.length})`}</button>}
      {verHechas && <div className="ntLista">{hechas.map(tarjeta)}</div>}
    </>}
  </section>
}
