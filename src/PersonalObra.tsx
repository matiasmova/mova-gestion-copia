import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta, hoy } from './gestionFormat'

type Persona = {
  id: number
  nombre: string
  apellido: string | null
  tipo: string
  especialidad: string | null
  costo_dia: number | null
}
type Asignacion = {
  id: number
  obra_id: number
  personal_id: number | null
  rol_en_obra: string | null
  modalidad: string | null
  valor_acordado: number | null
  notas: string | null
}
type CostoPersonal = { id: number; personal_id: number | null; monto: number; fecha: string; descripcion: string | null }
type Jornal = { id: number; personal_id: number | null; fecha: string; jornada: number; horas: number | null; observaciones: string | null }

const MODALIDADES: Record<string, string> = {
  por_dia: 'Por día', por_hora: 'Por hora', por_obra: 'Por obra', porcentaje: 'Por porcentaje', por_etapa: 'Por etapa',
}
const nombreDe = (p?: Persona) => (p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : 'Persona')

function PersonalObra({ obraId, puedeEditar = true, onCambio }: { obraId: number; puedeEditar?: boolean; onCambio?: () => void }) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [pagos, setPagos] = useState<CostoPersonal[]>([])
  const [jornales, setJornales] = useState<Jornal[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [formAbierto, setFormAbierto] = useState<'asignar' | 'pago' | 'jornal' | null>(null)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      const [rPers, rAsig, rCostos, rJorn] = await Promise.all([
        supabase.from('personal').select('id,nombre,apellido,tipo,especialidad,costo_dia').eq('activo', true).order('nombre'),
        supabase.from('obra_asignaciones').select('id,obra_id,personal_id,rol_en_obra,modalidad,valor_acordado,notas').eq('obra_id', obraId),
        supabase.from('costos').select('id,personal_id,monto,fecha,descripcion').eq('obra_id', obraId).in('tipo', ['mano_obra', 'terciarizado']),
        supabase.from('jornales').select('id,personal_id,fecha,jornada,horas,observaciones').eq('obra_id', obraId).order('fecha', { ascending: false }),
      ])
      if (!vigente) return
      if (rAsig.error || rPers.error) {
        console.error(rAsig.error || rPers.error)
        setError('Falta ejecutar supabase-personal-fase-8.sql en Supabase.')
        setCargando(false)
        return
      }
      setPersonas((rPers.data ?? []) as Persona[])
      setAsignaciones((rAsig.data ?? []).map((a) => ({ ...a, valor_acordado: a.valor_acordado == null ? null : Number(a.valor_acordado) })) as Asignacion[])
      setPagos(rCostos.error ? [] : (rCostos.data ?? []).map((c) => ({ ...c, monto: Number(c.monto) })) as CostoPersonal[])
      setJornales(rJorn.error ? [] : (rJorn.data ?? []).map((j) => ({ ...j, jornada: Number(j.jornada), horas: j.horas == null ? null : Number(j.horas) })) as Jornal[])
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [obraId, revision])

  const personaPorId = (id: number | null) => personas.find((p) => p.id === id)

  const filas = useMemo(() => asignaciones.map((a) => {
    const pagado = pagos.filter((c) => c.personal_id === a.personal_id).reduce((s, c) => s + c.monto, 0)
    const jorn = jornales.filter((j) => j.personal_id === a.personal_id).reduce((s, j) => s + j.jornada, 0)
    const acordado = Number(a.valor_acordado) || 0
    const pendiente = acordado > 0 ? Math.max(0, acordado - pagado) : 0
    return { asig: a, persona: personaPorId(a.personal_id), acordado, pagado, pendiente, jornadas: jorn }
  }), [asignaciones, pagos, jornales, personas])

  const totales = filas.reduce((acc, f) => ({
    acordado: acc.acordado + f.acordado, pagado: acc.pagado + f.pagado, pendiente: acc.pendiente + f.pendiente, jornadas: acc.jornadas + f.jornadas,
  }), { acordado: 0, pagado: 0, pendiente: 0, jornadas: 0 })

  function recargar() { setFormAbierto(null); setRevision((v) => v + 1); onCambio?.() }

  const asignados = filas.map((f) => f.persona).filter(Boolean) as Persona[]
  const sinAsignar = personas.filter((p) => !asignaciones.some((a) => a.personal_id === p.id))

  return (
    <section className="obraFotosSeccion" aria-label="Personal de la obra">
      <div className="seguimientoAcciones">
        <div>
          <h3>Personal de la obra</h3>
          <p>Trabajadores asignados, lo acordado, lo pagado y los jornales. Los pagos impactan como egreso de la obra.</p>
        </div>
        {puedeEditar && (
          <div className="adicAcciones">
            <button type="button" className="newButton" onClick={() => setFormAbierto(formAbierto === 'asignar' ? null : 'asignar')}>+ Asignar persona</button>
            {asignados.length > 0 && <button type="button" className="editButton" onClick={() => setFormAbierto(formAbierto === 'pago' ? null : 'pago')}>💵 Pago</button>}
            {asignados.length > 0 && <button type="button" className="editButton" onClick={() => setFormAbierto(formAbierto === 'jornal' ? null : 'jornal')}>📅 Jornal</button>}
          </div>
        )}
      </div>

      {!cargando && !error && (
        <div className="adicResumen">
          <div><span>Acordado</span><strong>{moneda(totales.acordado)}</strong><small>{asignados.length} persona(s)</small></div>
          <div><span>Pagado</span><strong>{moneda(totales.pagado)}</strong><small>Egreso de la obra</small></div>
          <div className="adicDestacado"><span>Pendiente a personal</span><strong>{moneda(totales.pendiente)}</strong><small>Sobre lo acordado</small></div>
          <div><span>Jornales</span><strong>{totales.jornadas.toLocaleString('es-AR')}</strong><small>Días registrados</small></div>
        </div>
      )}

      {formAbierto === 'asignar' && puedeEditar && (
        <FormAsignar obraId={obraId} personas={sinAsignar} onCancelar={() => setFormAbierto(null)} onGuardado={recargar} />
      )}
      {formAbierto === 'pago' && puedeEditar && (
        <FormPago obraId={obraId} personas={asignados} onCancelar={() => setFormAbierto(null)} onGuardado={recargar} />
      )}
      {formAbierto === 'jornal' && puedeEditar && (
        <FormJornal obraId={obraId} personas={asignados} onCancelar={() => setFormAbierto(null)} onGuardado={recargar} />
      )}

      {cargando && <p role="status">Cargando personal...</p>}
      {error && <p className="loginError" role="alert">{error}</p>}

      {!cargando && !error && (
        filas.length === 0 ? (
          <p className="adicVacio">Todavía no hay personal asignado a esta obra.</p>
        ) : (
          <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Persona</th><th>Modalidad</th><th>Acordado</th><th>Pagado</th><th>Pendiente</th><th>Jornales</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.asig.id}>
                    <td>
                      <strong>{nombreDe(f.persona)}</strong>
                      {(f.persona?.especialidad || f.asig.rol_en_obra) && (
                        <><br /><small>{[f.persona?.especialidad, f.asig.rol_en_obra].filter(Boolean).join(' · ')}</small></>
                      )}
                    </td>
                    <td>{f.asig.modalidad ? (MODALIDADES[f.asig.modalidad] ?? f.asig.modalidad) : '—'}</td>
                    <td>{f.acordado > 0 ? moneda(f.acordado) : <small>a jornal</small>}</td>
                    <td>{moneda(f.pagado)}</td>
                    <td>{f.acordado > 0 ? (f.pendiente > 0 ? <strong style={{ color: '#b86608' }}>{moneda(f.pendiente)}</strong> : <span className="adicBadge aprobado">saldado</span>) : '—'}</td>
                    <td>{f.jornadas ? f.jornadas.toLocaleString('es-AR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!cargando && !error && jornales.length > 0 && (
        <details className="adicDetalle">
          <summary>Ver jornales registrados ({jornales.length})</summary>
          <div className="gestionTabla" style={{ overflowX: 'auto', marginTop: 10 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Persona</th><th>Jornada</th><th>Horas</th><th>Observaciones</th></tr></thead>
              <tbody>
                {jornales.map((j) => (
                  <tr key={j.id}>
                    <td>{fechaCorta(j.fecha)}</td>
                    <td>{nombreDe(personaPorId(j.personal_id))}</td>
                    <td>{j.jornada.toLocaleString('es-AR')}</td>
                    <td>{j.horas != null ? j.horas.toLocaleString('es-AR') : '—'}</td>
                    <td>{j.observaciones || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}

function FormAsignar({ obraId, personas, onCancelar, onGuardado }: { obraId: number; personas: Persona[]; onCancelar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ personal_id: '', modalidad: 'por_obra', valor_acordado: '', rol_en_obra: '', notas: '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setF((a) => ({ ...a, [k]: v }))
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!f.personal_id) { setError('Elegí una persona.'); return }
    setGuardando(true)
    const { error: fallo } = await supabase.from('obra_asignaciones').insert({
      obra_id: obraId, personal_id: Number(f.personal_id), modalidad: f.modalidad,
      valor_acordado: f.valor_acordado ? Number(f.valor_acordado) : 0,
      rol_en_obra: f.rol_en_obra.trim() || null, notas: f.notas.trim() || null,
    })
    if (fallo) { console.error(fallo); setError('No se pudo asignar.'); setGuardando(false); return }
    onGuardado()
  }
  return (
    <form className="clienteForm adicForm" onSubmit={guardar}>
      <div className="formGrid">
        <label>Persona *<select required value={f.personal_id} onChange={(e) => set('personal_id', e.target.value)}><option value="">Seleccionar</option>{personas.map((p) => <option key={p.id} value={p.id}>{nombreDe(p)}{p.especialidad ? ` · ${p.especialidad}` : ''}</option>)}</select></label>
        <label>Modalidad<select value={f.modalidad} onChange={(e) => set('modalidad', e.target.value)}>{Object.entries(MODALIDADES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label>Valor acordado<input type="number" min="0" step="0.01" value={f.valor_acordado} onChange={(e) => set('valor_acordado', e.target.value)} placeholder="Dejar vacío si es a jornal" /></label>
        <label>Función en la obra<input value={f.rol_en_obra} onChange={(e) => set('rol_en_obra', e.target.value)} placeholder="Ej.: Instalador" /></label>
        <label className="adicAncho">Notas<input value={f.notas} onChange={(e) => set('notas', e.target.value)} /></label>
      </div>
      {personas.length === 0 && <p className="gestionAyuda">Ya están todas las personas activas asignadas. Cargá más en el módulo Personal.</p>}
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando || personas.length === 0}>{guardando ? 'Guardando...' : 'Asignar'}</button></div>
    </form>
  )
}

function FormPago({ obraId, personas, onCancelar, onGuardado }: { obraId: number; personas: Persona[]; onCancelar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ personal_id: '', monto: '', fecha: hoy(), detalle: '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setF((a) => ({ ...a, [k]: v }))
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    const persona = personas.find((p) => p.id === Number(f.personal_id))
    const monto = Number(f.monto)
    if (!persona) { setError('Elegí una persona.'); return }
    if (!(monto > 0)) { setError('Ingresá un monto mayor que cero.'); return }
    setGuardando(true)
    const { error: fallo } = await supabase.from('costos').insert({
      obra_id: obraId, personal_id: persona.id,
      tipo: persona.tipo === 'terciarizado' ? 'terciarizado' : 'mano_obra',
      descripcion: `Pago a ${nombreDe(persona)}${f.detalle.trim() ? ` · ${f.detalle.trim()}` : ''}`,
      monto, fecha: f.fecha,
    })
    if (fallo) { console.error(fallo); setError('No se pudo registrar el pago.'); setGuardando(false); return }
    onGuardado()
  }
  return (
    <form className="clienteForm adicForm" onSubmit={guardar}>
      <div className="formGrid">
        <label>Persona *<select required value={f.personal_id} onChange={(e) => set('personal_id', e.target.value)}><option value="">Seleccionar</option>{personas.map((p) => <option key={p.id} value={p.id}>{nombreDe(p)}</option>)}</select></label>
        <label>Monto *<input type="number" min="0.01" step="0.01" required value={f.monto} onChange={(e) => set('monto', e.target.value)} /></label>
        <label>Fecha *<input type="date" required value={f.fecha} onChange={(e) => set('fecha', e.target.value)} /></label>
        <label className="adicAncho">Detalle<input value={f.detalle} onChange={(e) => set('detalle', e.target.value)} placeholder="Ej.: adelanto, liquidación semana 2" /></label>
      </div>
      <p className="gestionAyuda">El pago se registra como egreso de la obra (mano de obra) y se ve en Finanzas.</p>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Registrar pago'}</button></div>
    </form>
  )
}

function FormJornal({ obraId, personas, onCancelar, onGuardado }: { obraId: number; personas: Persona[]; onCancelar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ personal_id: '', fecha: hoy(), jornada: '1', horas: '', observaciones: '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setF((a) => ({ ...a, [k]: v }))
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!f.personal_id) { setError('Elegí una persona.'); return }
    if (!(Number(f.jornada) > 0)) { setError('La jornada debe ser mayor que cero (usá 0,5 para media).'); return }
    setGuardando(true)
    const { error: fallo } = await supabase.from('jornales').insert({
      obra_id: obraId, personal_id: Number(f.personal_id), fecha: f.fecha,
      jornada: Number(f.jornada), horas: f.horas ? Number(f.horas) : null,
      observaciones: f.observaciones.trim() || null,
    })
    if (fallo) { console.error(fallo); setError('No se pudo registrar el jornal.'); setGuardando(false); return }
    onGuardado()
  }
  return (
    <form className="clienteForm adicForm" onSubmit={guardar}>
      <div className="formGrid">
        <label>Persona *<select required value={f.personal_id} onChange={(e) => set('personal_id', e.target.value)}><option value="">Seleccionar</option>{personas.map((p) => <option key={p.id} value={p.id}>{nombreDe(p)}</option>)}</select></label>
        <label>Fecha *<input type="date" required value={f.fecha} onChange={(e) => set('fecha', e.target.value)} /></label>
        <label>Jornada *<input type="number" min="0.25" step="0.25" required value={f.jornada} onChange={(e) => set('jornada', e.target.value)} placeholder="1 = día, 0.5 = medio" /></label>
        <label>Horas (opcional)<input type="number" min="0" step="0.5" value={f.horas} onChange={(e) => set('horas', e.target.value)} /></label>
        <label className="adicAncho">Observaciones<input value={f.observaciones} onChange={(e) => set('observaciones', e.target.value)} /></label>
      </div>
      <p className="gestionAyuda">El jornal registra asistencia. No genera un pago automático.</p>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Registrar jornal'}</button></div>
    </form>
  )
}

export default PersonalObra
