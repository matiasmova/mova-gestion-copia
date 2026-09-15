import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'

type Persona = { id: number; nombre: string; apellido: string | null; tipo: string; telefono: string | null; costo_dia: number | null; activo: boolean }
type Obra = { id: number; nombre_obra: string }
type Asignacion = { id: number; obra_id: number; personal_id: number | null; rol_en_obra: string | null }

function Personal() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [obras, setObras] = useState<Obra[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [mostrarNuevo, setMostrarNuevo] = useState(false)
  const [personaAsignando, setPersonaAsignando] = useState<Persona | null>(null)
  const [actualizacion, setActualizacion] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    async function cargar() {
      const [p, o, a] = await Promise.all([
        supabase.from('personal').select('*').eq('activo', true).order('nombre'),
        supabase.from('obras').select('id, nombre_obra').eq('activo', true).order('nombre_obra'),
        supabase.from('obra_asignaciones').select('id, obra_id, personal_id, rol_en_obra'),
      ])
      if (p.error || o.error || a.error) { console.error(p.error || o.error || a.error); setError('Falta ejecutar la migración de integración en Supabase.'); return }
      setPersonas((p.data ?? []) as Persona[]); setObras((o.data ?? []) as Obra[]); setAsignaciones((a.data ?? []) as Asignacion[]); setError('')
    }
    cargar()
  }, [actualizacion])

  const obrasDe = (personaId: number) => asignaciones.filter((a) => a.personal_id === personaId).map((a) => obras.find((o) => o.id === a.obra_id)?.nombre_obra).filter(Boolean).join(', ')

  return <div className="gestionPage"><div className="pageHeader"><div><p className="subtitle">RECURSOS HUMANOS</p><h2>Personal</h2><p className="welcome">Obreros, auxiliares y terceros</p></div><button className="newButton" onClick={() => setMostrarNuevo(true)}>+ Nuevo</button></div>
    {error && <p className="loginError">{error}</p>}
    {!error && <div className="clientesPanel">{personas.length === 0 ? <div className="empty"><span>👷</span><h3>Sin personal cargado</h3></div> : personas.map((persona) => <div className="clienteItem" key={persona.id}><div className="clienteAvatar">{persona.nombre.charAt(0).toUpperCase()}</div><div className="clienteInfo"><strong>{persona.nombre} {persona.apellido}</strong><span>{persona.telefono || 'Sin teléfono'} · {persona.costo_dia ? `${moneda(persona.costo_dia)}/día` : 'Costo a convenir'}</span><small>Asignado a: {obrasDe(persona.id) || 'sin obras'}</small></div><div className="clienteActions"><span className="estadoActivo">{persona.tipo}</span><button className="editButton" onClick={() => setPersonaAsignando(persona)}>Asignar a obra</button></div></div>)}</div>}
    <ManoObra revision={actualizacion} />
    {mostrarNuevo && <FormularioPersona onCancelar={() => setMostrarNuevo(false)} onGuardado={() => { setMostrarNuevo(false); setActualizacion((v) => v + 1) }} />}
    {personaAsignando && <FormularioAsignacion persona={personaAsignando} obras={obras} onCancelar={() => setPersonaAsignando(null)} onGuardado={() => { setPersonaAsignando(null); setActualizacion((v) => v + 1) }} />}
  </div>
}

function FormularioPersona({ onCancelar, onGuardado }: { onCancelar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ nombre: '', apellido: '', tipo: 'obrero', telefono: '', costo_dia: '' }); const [guardando, setGuardando] = useState(false); const [error, setError] = useState('')
  const set = (k: string, v: string) => setF((a) => ({ ...a, [k]: v }))
  async function guardar(e: FormEvent) { e.preventDefault(); setGuardando(true); const r = await supabase.from('personal').insert({ nombre: f.nombre.trim(), apellido: f.apellido.trim() || null, tipo: f.tipo, telefono: f.telefono.trim() || null, costo_dia: f.costo_dia ? Number(f.costo_dia) : null, activo: true }); if (r.error) { console.error(r.error); setError('No se pudo guardar.'); setGuardando(false); return } onGuardado() }
  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">NUEVO REGISTRO</p><h2>Agregar personal</h2></div><button className="closeButton" onClick={onCancelar}>×</button></div><form className="clienteForm" onSubmit={guardar}><div className="formGrid"><label>Nombre *<input required value={f.nombre} onChange={(e) => set('nombre', e.target.value)} /></label><label>Apellido<input value={f.apellido} onChange={(e) => set('apellido', e.target.value)} /></label><label>Tipo<select value={f.tipo} onChange={(e) => set('tipo', e.target.value)}><option value="obrero">Obrero</option><option value="auxiliar">Auxiliar</option><option value="terciarizado">Terciarizado</option></select></label><label>Teléfono<input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} /></label><label>Costo por día<input type="number" min="0" value={f.costo_dia} onChange={(e) => set('costo_dia', e.target.value)} /></label></div>{error && <p className="loginError">{error}</p>}<div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button></div></form></div></div>
}

function FormularioAsignacion({ persona, obras, onCancelar, onGuardado }: { persona: Persona; obras: Obra[]; onCancelar: () => void; onGuardado: () => void }) {
  const [obraId, setObraId] = useState(''); const [rol, setRol] = useState(''); const [guardando, setGuardando] = useState(false); const [error, setError] = useState('')
  async function guardar(e: FormEvent) { e.preventDefault(); setGuardando(true); const r = await supabase.from('obra_asignaciones').insert({ obra_id: Number(obraId), personal_id: persona.id, rol_en_obra: rol.trim() || null }); if (r.error) { console.error(r.error); setError('No se pudo asignar.'); setGuardando(false); return } onGuardado() }
  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">{persona.nombre} {persona.apellido}</p><h2>Asignar a obra</h2></div><button className="closeButton" onClick={onCancelar}>×</button></div><form className="clienteForm" onSubmit={guardar}><div className="formGrid"><label>Obra *<select required value={obraId} onChange={(e) => setObraId(e.target.value)}><option value="">Seleccionar obra</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}</select></label><label>Función en la obra<input value={rol} onChange={(e) => setRol(e.target.value)} placeholder="Ej.: Instalador" /></label></div>{error && <p className="loginError">{error}</p>}<div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Asignar'}</button></div></form></div></div>
}

type ObraCosto = Obra & { activo: boolean }
type CostoPersonal = {
  id: number
  obra_id: number
  personal_id: number | null
  tipo: string
  descripcion: string | null
  monto: number
  fecha: string
}

const nombrePersona = (persona: Persona) => `${persona.nombre} ${persona.apellido ?? ''}`.trim()
const fechaPersonal = (fecha: string) => new Date(`${fecha.slice(0, 10)}T00:00:00`).toLocaleDateString('es-AR')
function fechaLocalPersonal() {
  const fecha = new Date()
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
}

function ManoObra({ revision }: { revision: number }) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [obras, setObras] = useState<ObraCosto[]>([])
  const [costos, setCostos] = useState<CostoPersonal[]>([])
  const [filtroObra, setFiltroObra] = useState('')
  const [mostrando, setMostrando] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [actualizacion, setActualizacion] = useState(0)
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      try {
        async function leerPersonas() {
          const filas: Persona[] = []
          for (let inicio = 0; ; inicio += 500) {
            const r = await supabase.from('personal')
              .select('id,nombre,apellido,tipo,telefono,costo_dia,activo').order('id').range(inicio, inicio + 499)
            if (r.error) throw r.error
            filas.push(...(r.data ?? []) as Persona[])
            if (!vigente || (r.data ?? []).length < 500) return filas
          }
        }
        async function leerObras() {
          const filas: ObraCosto[] = []
          for (let inicio = 0; ; inicio += 500) {
            const r = await supabase.from('obras').select('id,nombre_obra,activo')
              .order('id').range(inicio, inicio + 499)
            if (r.error) throw r.error
            filas.push(...(r.data ?? []) as ObraCosto[])
            if (!vigente || (r.data ?? []).length < 500) return filas
          }
        }
        async function leerCostos() {
          const filas: CostoPersonal[] = []
          for (let inicio = 0; ; inicio += 500) {
            const r = await supabase.from('costos').select('id,obra_id,personal_id,tipo,descripcion,monto,fecha')
              .in('tipo', ['mano_obra', 'terciarizado']).order('fecha', { ascending: false })
              .order('id', { ascending: false }).range(inicio, inicio + 499)
            if (r.error) throw r.error
            filas.push(...(r.data ?? []).map((c) => ({ ...c, monto: Number(c.monto) })) as CostoPersonal[])
            if (!vigente || (r.data ?? []).length < 500) return filas
          }
        }
        const [p, o, c] = await Promise.all([leerPersonas(), leerObras(), leerCostos()])
        if (vigente) { setPersonas(p); setObras(o); setCostos(c) }
      } catch (fallo) {
        console.error(fallo)
        if (vigente) setError('No se pudo cargar la mano de obra. Probá actualizar.')
      } finally {
        if (vigente) setCargando(false)
      }
    }
    void cargar()
    return () => { vigente = false }
  }, [revision, actualizacion])

  const visibles = costos.filter((c) => !filtroObra || c.obra_id === Number(filtroObra))
  const total = visibles.reduce((suma, c) => suma + c.monto, 0)
  const obraNombre = (id: number) => obras.find((o) => o.id === id)?.nombre_obra ?? `Obra #${id}`
  const personaNombre = (id: number | null) => {
    const persona = personas.find((p) => p.id === id)
    return persona ? nombrePersona(persona) : 'Sin persona vinculada'
  }
  const resumen = Array.from(new Set(visibles.map((c) => c.obra_id))).map((id) => ({
    id, total: visibles.filter((c) => c.obra_id === id).reduce((s, c) => s + c.monto, 0),
  }))

  return <section style={{ marginTop: 28 }} aria-label="Mano de obra">
    <div className="pageHeader"><div><h3>Mano de obra por obra</h3><p className="welcome">Jornadas y trabajos acordados, vinculados a Finanzas.</p></div>
      <button type="button" className="newButton" disabled={cargando || !!error} onClick={() => { setMensaje(''); setMostrando(true) }}>+ Registrar mano de obra</button>
    </div>
    <div className="clientesToolbar">
      <label>Obra <select value={filtroObra} onChange={(e) => setFiltroObra(e.target.value)}>
        <option value="">Todas las obras</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}{o.activo ? '' : ' (inactiva)'}</option>)}
      </select></label>
      <button type="button" className="editButton" disabled={cargando} onClick={() => setActualizacion((v) => v + 1)}>Actualizar</button>
    </div>
    {mensaje && <p role="status">{mensaje}</p>}
    {cargando && <p role="status">Cargando mano de obra...</p>}
    {error && <p className="loginError" role="alert">{error}</p>}
    {!cargando && !error && <>
      <p>Total de mano de obra y terceros: <strong>{moneda(total)}</strong></p>
      <p className="gestionAyuda">Son los mismos costos que se ven en Finanzas y en la ficha de cada obra. No vuelvas a cargarlos allí. Registrar un costo no registra un pago al trabajador.</p>
      <div className="gestionTabla" style={{ overflowX: 'auto' }}><table>
        <thead><tr><th>Obra</th><th>Costo acumulado</th></tr></thead>
        <tbody>{resumen.length === 0 ? <tr><td colSpan={2}>Sin costos de mano de obra registrados.</td></tr> : resumen.map((r) => <tr key={r.id}><td>{obraNombre(r.id)}</td><td>{moneda(r.total)}</td></tr>)}</tbody>
      </table></div>
      <h4>Movimientos registrados</h4>
      <div className="gestionTabla" style={{ overflowX: 'auto' }}><table>
        <thead><tr><th>Fecha</th><th>Obra</th><th>Persona</th><th>Tipo</th><th>Detalle</th><th>Monto</th></tr></thead>
        <tbody>{visibles.length === 0 ? <tr><td colSpan={6}>Todavía no hay movimientos.</td></tr> : visibles.map((c) => <tr key={c.id}>
          <td>{fechaPersonal(c.fecha)}</td><td>{obraNombre(c.obra_id)}</td><td>{personaNombre(c.personal_id)}</td>
          <td>{c.tipo === 'terciarizado' ? 'Tercerizado' : 'Mano de obra'}</td><td>{c.descripcion || 'Sin detalle'}</td><td>{moneda(c.monto)}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
    {mostrando && <FormularioManoObra personas={personas.filter((p) => p.activo)} obras={obras.filter((o) => o.activo)}
      onCancelar={() => setMostrando(false)} onGuardado={() => {
        setMostrando(false); setMensaje('Costo guardado. Ya está disponible en Finanzas y en la ficha de la obra.'); setActualizacion((v) => v + 1)
      }} />}
  </section>
}

function FormularioManoObra({ personas, obras, onCancelar, onGuardado }: {
  personas: Persona[]; obras: Obra[]; onCancelar: () => void; onGuardado: () => void
}) {
  const [personaId, setPersonaId] = useState('')
  const [obraId, setObraId] = useState('')
  const [modo, setModo] = useState('jornadas')
  const [jornadas, setJornadas] = useState('1')
  const [tarifa, setTarifa] = useState('')
  const [importe, setImporte] = useState('')
  const [fecha, setFecha] = useState(fechaLocalPersonal)
  const [detalle, setDetalle] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [incierto, setIncierto] = useState(false)
  const bloqueo = useRef(false)
  const persona = personas.find((p) => p.id === Number(personaId))
  const total = Math.round((modo === 'jornadas' ? Number(jornadas) * Number(tarifa) : Number(importe)) * 100) / 100

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (bloqueo.current || incierto) return
    setError('')
    if (!persona || !obras.some((o) => o.id === Number(obraId))) { setError('Seleccioná una persona y una obra.'); return }
    if (!Number.isFinite(total) || total <= 0 || (modo === 'jornadas' && Number(jornadas) <= 0)) {
      setError('Ingresá un costo mayor que cero y una cantidad válida de jornadas.'); return
    }
    if (!fecha || !detalle.trim()) { setError('Ingresá la fecha y el detalle del trabajo.'); return }
    bloqueo.current = true
    setGuardando(true)
    const calculo = modo === 'jornadas' ? `${jornadas} jornada(s) × ${moneda(Number(tarifa))}` : 'Importe acordado'
    try {
      // Una sola inserción: la ficha y Finanzas consultan este mismo registro.
      const r = await supabase.from('costos').insert({
        obra_id: Number(obraId), personal_id: persona.id,
        tipo: persona.tipo === 'terciarizado' ? 'terciarizado' : 'mano_obra',
        descripcion: `${nombrePersona(persona)} · ${calculo} · ${detalle.trim()}`,
        monto: total, fecha,
      })
      if (r.error) throw r.error
      onGuardado()
    } catch (fallo) {
      console.error(fallo)
      setIncierto(true)
      setError('No se pudo confirmar el guardado. Cerrá y actualizá los movimientos antes de volver a cargarlo, para evitar duplicados.')
    } finally {
      bloqueo.current = false
      setGuardando(false)
    }
  }

  return <div className="modalOverlay"><div className="modalCard" role="dialog" aria-modal="true" aria-labelledby="tituloManoObra">
    <div className="modalHeader"><div><p className="subtitle">COSTO DEL TRABAJO</p><h2 id="tituloManoObra">Registrar mano de obra</h2></div>
      <button type="button" className="closeButton" disabled={guardando} onClick={onCancelar} aria-label="Cerrar">×</button></div>
    <form className="clienteForm" onSubmit={guardar}>
      <fieldset disabled={guardando || incierto} style={{ border: 0, margin: 0, padding: 0 }}><div className="formGrid">
        <label>Persona *<select required value={personaId} onChange={(e) => {
          setPersonaId(e.target.value)
          const p = personas.find((x) => x.id === Number(e.target.value))
          setTarifa(p?.costo_dia != null ? String(p.costo_dia) : '')
          setModo(p?.tipo === 'terciarizado' ? 'importe' : 'jornadas')
        }}><option value="">Seleccionar persona</option>{personas.map((p) => <option key={p.id} value={p.id}>{nombrePersona(p)}</option>)}</select></label>
        <label>Obra *<select required value={obraId} onChange={(e) => setObraId(e.target.value)}><option value="">Seleccionar obra</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}</select></label>
        <label>Forma de cálculo<select value={modo} onChange={(e) => setModo(e.target.value)}><option value="jornadas">Por jornadas</option><option value="importe">Importe acordado</option></select></label>
        <label>Fecha del costo *<input required type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        {modo === 'jornadas' ? <>
          <label>Jornadas *<input required type="number" min="0.01" step="0.01" value={jornadas} onChange={(e) => setJornadas(e.target.value)} /></label>
          <label>Costo por jornada *<input required type="number" min="0.01" step="0.01" value={tarifa} onChange={(e) => setTarifa(e.target.value)} /></label>
        </> : <label>Importe *<input required type="number" min="0.01" step="0.01" value={importe} onChange={(e) => setImporte(e.target.value)} /></label>}
        <label>Detalle del trabajo *<input required value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej.: Tendido de cañerías, sector cocina" /></label>
      </div></fieldset>
      {personas.length === 0 && <p>Primero agregá una persona con el botón + Nuevo.</p>}
      {obras.length === 0 && <p>Necesitás una obra activa para registrar el costo.</p>}
      <p>Total a registrar: <strong>{moneda(Number.isFinite(total) ? total : 0)}</strong></p>
      <p className="gestionAyuda">Para media jornada podés ingresar 0,5. Cambiar la tarifa aquí no modifica costos anteriores ni la tarifa de la persona.</p>
      {error && <p className="loginError" role="alert">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" disabled={guardando} onClick={onCancelar}>{incierto ? 'Cerrar y revisar' : 'Cancelar'}</button>
        <button type="submit" className="newButton" disabled={guardando || incierto || !personas.length || !obras.length}>{guardando ? 'Guardando...' : 'Guardar costo'}</button></div>
    </form>
  </div></div>
}

export default Personal