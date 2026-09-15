import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { fechaCorta, hoy } from './gestionFormat'

type Recordatorio = {
  id: number
  titulo: string
  detalle: string | null
  fecha: string
  hora: string | null
  tipo: string | null
  obra_id: number | null
  completado: boolean
}

type ObraOpcion = { id: number; nombre_obra: string }

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const pad = (n: number) => String(n).padStart(2, '0')

export default function Calendario({ obras }: { obras: ObraOpcion[] }) {
  const [items, setItems] = useState<Recordatorio[]>([])
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { anio: d.getFullYear(), mes: d.getMonth() }
  })
  const [nuevo, setNuevo] = useState<string | null>(null) // fecha preseleccionada o null

  useEffect(() => {
    async function cargar() {
      const { data, error } = await supabase
        .from('recordatorios')
        .select('id, titulo, detalle, fecha, hora, tipo, obra_id, completado')
        .order('fecha', { ascending: true })
      if (error) {
        console.error(error)
        setError('No se pudieron cargar los recordatorios. ¿Se corrió la migración fase 5?')
      } else {
        setItems((data ?? []) as Recordatorio[])
      }
    }
    cargar()
  }, [tick])

  const { anio, mes } = cursor
  const celdas = useMemo(() => {
    const offset = (new Date(anio, mes, 1).getDay() + 6) % 7
    const dias = new Date(anio, mes + 1, 0).getDate()
    const arr: (number | null)[] = []
    for (let i = 0; i < offset; i++) arr.push(null)
    for (let d = 1; d <= dias; d++) arr.push(d)
    return arr
  }, [anio, mes])

  const porDia = (dia: number) => {
    const f = `${anio}-${pad(mes + 1)}-${pad(dia)}`
    return items.filter((r) => r.fecha === f)
  }

  const nombreObra = (id: number | null) => obras.find((o) => o.id === id)?.nombre_obra ?? null
  const hoyStr = hoy()
  const proximos = items
    .filter((r) => !r.completado && r.fecha >= hoyStr)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .slice(0, 8)

  async function completar(r: Recordatorio) {
    const { error } = await supabase.from('recordatorios').update({ completado: !r.completado }).eq('id', r.id)
    if (error) { setError('No se pudo actualizar el recordatorio.'); return }
    setItems((arr) => arr.map((x) => (x.id === r.id ? { ...x, completado: !x.completado } : x)))
  }

  function mover(delta: number) {
    setCursor((c) => {
      const nm = c.mes + delta
      return { anio: c.anio + Math.floor(nm / 12), mes: ((nm % 12) + 12) % 12 }
    })
  }

  return (
    <div className="calWrap">
      <div className="calMain">
        <div className="calHead">
          <button onClick={() => mover(-1)} aria-label="Mes anterior">‹</button>
          <h3>{MESES[mes]} {anio}</h3>
          <button onClick={() => mover(1)} aria-label="Mes siguiente">›</button>
          <button className="calHoy" onClick={() => { const d = new Date(); setCursor({ anio: d.getFullYear(), mes: d.getMonth() }) }}>Hoy</button>
          <button className="newButton calNuevo" onClick={() => setNuevo(hoyStr)}>+ Recordatorio</button>
        </div>

        {error && <p className="loginError">{error}</p>}

        <div className="calSemana">{DIAS.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="calGrid">
          {celdas.map((dia, i) => {
            if (dia === null) return <div className="calCell vacia" key={`v${i}`} />
            const f = `${anio}-${pad(mes + 1)}-${pad(dia)}`
            const delDia = porDia(dia)
            return (
              <div className={`calCell ${f === hoyStr ? 'hoy' : ''}`} key={f} onClick={() => setNuevo(f)}>
                <span className="calNum">{dia}</span>
                {delDia.slice(0, 3).map((r) => (
                  <span className={`calChip ${r.completado ? 'ok' : ''}`} key={r.id} title={r.titulo}>{r.titulo}</span>
                ))}
                {delDia.length > 3 && <span className="calMas">+{delDia.length - 3}</span>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="calLateral">
        <div className="calLateralTitulo">Próximos pendientes</div>
        {proximos.length === 0 ? (
          <div className="fase2Vacio" style={{ minHeight: 160 }}><span>✓</span><p>Sin pendientes próximos.</p></div>
        ) : (
          proximos.map((r) => (
            <div className="calPendiente" key={r.id}>
              <button className="calCheck" onClick={() => completar(r)} aria-label="Completar">○</button>
              <div>
                <strong>{r.titulo}</strong>
                <small>{fechaCorta(r.fecha)}{r.hora ? ` · ${r.hora.slice(0, 5)}` : ''}{nombreObra(r.obra_id) ? ` · ${nombreObra(r.obra_id)}` : ''}</small>
              </div>
            </div>
          ))
        )}
      </div>

      {nuevo && (
        <FormRecordatorio
          fecha={nuevo}
          obras={obras}
          onCancelar={() => setNuevo(null)}
          onGuardado={() => { setNuevo(null); setTick((t) => t + 1) }}
        />
      )}
    </div>
  )
}

function FormRecordatorio({ fecha, obras, onCancelar, onGuardado }: { fecha: string; obras: ObraOpcion[]; onCancelar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ titulo: '', fecha, hora: '', obra_id: '', detalle: '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (campo: string, valor: string) => setF((a) => ({ ...a, [campo]: valor }))

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    if (!f.titulo.trim()) { setError('Ingresá un título.'); return }
    setGuardando(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('recordatorios').insert({
      titulo: f.titulo.trim(),
      fecha: f.fecha,
      hora: f.hora || null,
      obra_id: f.obra_id ? Number(f.obra_id) : null,
      detalle: f.detalle.trim() || null,
      tipo: 'recordatorio',
      user_id: userData.user?.id ?? null,
    })
    if (error) { console.error(error); setError('No se pudo guardar el recordatorio.'); setGuardando(false); return }
    onGuardado()
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard">
        <div className="modalHeader">
          <div><p className="subtitle">AGENDA</p><h2>Nuevo recordatorio</h2></div>
          <button type="button" className="closeButton" onClick={onCancelar}>×</button>
        </div>
        <form className="clienteForm" onSubmit={guardar}>
          <div className="formGrid">
            <label className="formFull">Título *<input value={f.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ej.: Llamar a cliente / Comprar materiales" required /></label>
            <label>Fecha *<input type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} required /></label>
            <label>Hora<input type="time" value={f.hora} onChange={(e) => set('hora', e.target.value)} /></label>
            <label className="formFull">Obra (opcional)<select value={f.obra_id} onChange={(e) => set('obra_id', e.target.value)}><option value="">Sin obra</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}</select></label>
            <label className="formFull">Detalle<textarea value={f.detalle} onChange={(e) => set('detalle', e.target.value)} placeholder="Notas..." /></label>
          </div>
          {error && <p className="loginError">{error}</p>}
          <div className="formActions">
            <button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button>
            <button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar recordatorio'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
