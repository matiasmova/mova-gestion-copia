import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { confirmarEliminacion } from './confirmar'

// Catálogo de soluciones: textos de beneficios que se eligen al armar un
// presupuesto (domótica, WiFi mesh, riego, etc.) y aparecen en el documento
// en la sección "Qué vas a disfrutar con este proyecto".

export type Solucion = { id: number; titulo: string; descripcion: string; orden: number; activo: boolean }

export async function cargarSoluciones(soloActivas = true): Promise<Solucion[]> {
  let consulta = supabase.from('soluciones').select('id, titulo, descripcion, orden, activo').order('orden', { ascending: true }).order('titulo', { ascending: true })
  if (soloActivas) consulta = consulta.eq('activo', true)
  const { data, error } = await consulta
  if (error) { console.error(error); return [] }
  return (data ?? []) as Solucion[]
}

const vacia: Solucion = { id: 0, titulo: '', descripcion: '', orden: 100, activo: true }

export default function Soluciones() {
  const [lista, setLista] = useState<Solucion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState<Solucion | null>(null)
  const [revision, setRevision] = useState(0)
  const [conIA, setConIA] = useState(false)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true); setError('')
      const { data, error: err } = await supabase.from('soluciones').select('id, titulo, descripcion, orden, activo').order('orden', { ascending: true }).order('titulo', { ascending: true })
      if (!vigente) return
      if (err) { console.error(err); setError('Falta ejecutar supabase-soluciones.sql en Supabase.'); setCargando(false); return }
      setLista((data ?? []) as Solucion[])
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [revision])

  async function cambiarActivo(sol: Solucion) {
    const { error: err } = await supabase.from('soluciones').update({ activo: !sol.activo }).eq('id', sol.id)
    if (err) { console.error(err); window.alert('No se pudo actualizar.'); return }
    setLista((l) => l.map((x) => (x.id === sol.id ? { ...x, activo: !x.activo } : x)))
  }

  async function eliminar(sol: Solucion) {
    if (!confirmarEliminacion(`¿Eliminar "${sol.titulo}"?\n\nLos presupuestos que ya la tienen no cambian: guardan su propia copia del texto.`)) return
    const { error: err } = await supabase.from('soluciones').delete().eq('id', sol.id)
    if (err) { console.error(err); window.alert('No se pudo eliminar.'); return }
    setRevision((v) => v + 1)
  }

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div>
          <p className="subtitle">GESTIÓN COMERCIAL</p>
          <h2>Soluciones</h2>
          <p className="welcome">Textos de beneficios que se eligen al armar un presupuesto y aparecen en "Qué vas a disfrutar con este proyecto"</p>
        </div>
        <div className="headerActions">
          <button className="editButton iaBoton" onClick={() => setConIA(true)}>✨ Crear con IA</button>
          <button className="newButton" onClick={() => setEditando({ ...vacia, orden: (lista[lista.length - 1]?.orden ?? 0) + 10 })}>+ Nueva solución</button>
        </div>
      </div>

      {cargando && <p>Cargando soluciones...</p>}
      {error && <p className="loginError">{error}</p>}

      {!cargando && !error && (lista.length === 0 ? (
        <div className="empty"><span>💡</span><h3>Todavía no hay soluciones</h3><p>Cargá la primera con "+ Nueva solución".</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {lista.map((sol) => (
            <div key={sol.id} className="crmCard" style={{ cursor: 'default', opacity: sol.activo ? 1 : 0.55 }}>
              <div className="crmCardTop">
                <div><h3>{sol.titulo}</h3></div>
                <span className={`crmBadge ${sol.activo ? 'est-aceptado' : 'est-borrador'}`}>{sol.activo ? 'Activa' : 'Oculta'}</span>
              </div>
              <p style={{ margin: '8px 0 12px', color: 'var(--mova-muted)', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{sol.descripcion || 'Sin descripción.'}</p>
              <div className="crmCardFoot">
                <button className="crmFootPrimary" onClick={() => setEditando(sol)}>Editar</button>
                <button onClick={() => void cambiarActivo(sol)}>{sol.activo ? 'Ocultar' : 'Mostrar'}</button>
                <button onClick={() => void eliminar(sol)}>🗑 Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      ))}

      <p className="gestionAyuda" style={{ marginTop: 16 }}>
        Las soluciones <strong>ocultas</strong> no aparecen para elegir en los presupuestos nuevos. Al elegir una en un presupuesto se guarda una copia del texto:
        si después la editás, los presupuestos ya enviados no cambian.
      </p>

      {conIA && <AsistenteIA existentes={lista.map((x) => x.titulo)} onCerrar={() => setConIA(false)}
        onElegir={(o) => { setConIA(false); setEditando({ ...vacia, titulo: o.titulo, descripcion: o.descripcion, orden: (lista[lista.length - 1]?.orden ?? 0) + 10 }) }} />}
      {editando && <FormularioSolucion existentes={lista.filter((x) => x.id !== editando.id).map((x) => x.titulo)} solucion={editando} onCancelar={() => setEditando(null)} onGuardado={() => { setEditando(null); setRevision((v) => v + 1) }} />}
    </div>
  )
}

function FormularioSolucion({ solucion, existentes, onCancelar, onGuardado }: { solucion: Solucion; existentes: string[]; onCancelar: () => void; onGuardado: () => void }) {
  const editando = solucion.id > 0
  const [f, setF] = useState({ titulo: solucion.titulo, descripcion: solucion.descripcion, orden: String(solucion.orden), activo: solucion.activo })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [opcionesIA, setOpcionesIA] = useState<OpcionIA[] | null>(null)
  const [pensando, setPensando] = useState(false)

  async function mejorarConIA() {
    setError(''); setPensando(true); setOpcionesIA(null)
    try { setOpcionesIA(await pedirIA({ accion: 'mejorar', titulo: f.titulo, descripcion: f.descripcion, existentes })) } catch (e) { setError((e as Error).message) }
    setPensando(false)
  }

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!f.titulo.trim()) { setError('Escribí el nombre de la solución.'); return }
    if (!f.descripcion.trim()) { setError('Escribí la descripción de los beneficios.'); return }
    setGuardando(true)
    const datos = { titulo: f.titulo.trim(), descripcion: f.descripcion.trim(), orden: Number(f.orden) || 0, activo: f.activo }
    const { error: err } = editando
      ? await supabase.from('soluciones').update(datos).eq('id', solucion.id)
      : await supabase.from('soluciones').insert(datos)
    if (err) { console.error(err); setError('No se pudo guardar.'); setGuardando(false); return }
    onGuardado()
  }

  return <div className="modalOverlay"><div className="modalCard">
    <div className="modalHeader"><div><p className="subtitle">{editando ? 'EDITAR SOLUCIÓN' : 'NUEVA SOLUCIÓN'}</p><h2>{editando ? f.titulo || 'Solución' : 'Nueva solución'}</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}>
      <div className="formGrid">
        <label className="formFull">Nombre *<input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ej.: Red WiFi Mesh" /></label>
        <label className="formFull">Qué va a disfrutar el cliente *
          <textarea rows={5} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} placeholder="Contá los beneficios en 2 o 3 oraciones, pensando en el cliente." />
        </label>
        <div className="formFull iaFila">
          <button type="button" className="editButton iaBoton" disabled={pensando || (!f.titulo.trim() && !f.descripcion.trim())} onClick={() => void mejorarConIA()}>{pensando ? '✨ Pensando…' : '✨ Mejorar con IA'}</button>
          <small>Te propone 3 versiones del texto. Elegís una y la podés retocar antes de guardar.</small>
        </div>
        {opcionesIA && <div className="formFull"><OpcionesIA opciones={opcionesIA} onElegir={(o) => { setF({ ...f, titulo: o.titulo, descripcion: o.descripcion }); setOpcionesIA(null) }} /></div>}
        <label>Orden<input type="number" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} /></label>
        <label>Estado<select value={f.activo ? 'si' : 'no'} onChange={(e) => setF({ ...f, activo: e.target.value === 'si' })}><option value="si">Activa (se puede elegir)</option><option value="no">Oculta</option></select></label>
      </div>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button></div>
    </form>
  </div></div>
}

// ---------- Asistente con IA ----------
type OpcionIA = { titulo: string; descripcion: string }

async function pedirIA(cuerpo: Record<string, unknown>): Promise<OpcionIA[]> {
  const { data, error } = await supabase.functions.invoke('asistente-ia', { body: cuerpo })
  if (error) {
    let msg = 'No se pudo conectar con el asistente. Revisá que la función "asistente-ia" esté instalada en Supabase.'
    try { const ctx = (error as { context?: Response }).context; if (ctx) msg = (await ctx.json()).error ?? msg } catch { /* sin detalle */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return (data?.opciones ?? []) as OpcionIA[]
}

function OpcionesIA({ opciones, onElegir }: { opciones: OpcionIA[]; onElegir: (o: OpcionIA) => void }) {
  return <div className="iaOpciones">
    {opciones.map((o, i) => (
      <div key={i} className="iaOpcion">
        <strong>{o.titulo}</strong>
        <p>{o.descripcion}</p>
        <button type="button" className="newButton" onClick={() => onElegir(o)}>Usar esta</button>
      </div>
    ))}
  </div>
}

function AsistenteIA({ existentes, onCerrar, onElegir }: { existentes: string[]; onCerrar: () => void; onElegir: (o: OpcionIA) => void }) {
  const [idea, setIdea] = useState('')
  const [opciones, setOpciones] = useState<OpcionIA[] | null>(null)
  const [pensando, setPensando] = useState(false)
  const [error, setError] = useState('')
  async function generar(e?: FormEvent) {
    e?.preventDefault(); setError(''); setPensando(true)
    try { setOpciones(await pedirIA({ accion: 'crear', idea, existentes })) } catch (err) { setError((err as Error).message) }
    setPensando(false)
  }
  return <div className="modalOverlay"><div className="modalCard" style={{ maxWidth: 760 }}>
    <div className="modalHeader"><div><p className="subtitle">ASISTENTE</p><h2>✨ Crear solución con IA</h2></div><button type="button" className="closeButton" onClick={onCerrar} disabled={pensando}>×</button></div>
    <form className="clienteForm" onSubmit={(e) => void generar(e)}>
      <label>¿Qué solución querés ofrecer?
        <textarea rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} autoFocus
          placeholder="Ej.: portón automático que se abre desde el celular y avisa si quedó abierto · alarma para comercio con cámaras · riego por goteo para huerta" />
      </label>
      <div className="iaEjemplos">
        {['Portón automático con app', 'Cortinas motorizadas', 'Control de acceso con huella', 'Paneles solares con monitoreo', 'Sonido multiroom'].map((x) => (
          <button type="button" key={x} onClick={() => setIdea(x)}>{x}</button>
        ))}
      </div>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions">
        <button type="button" className="cancelButton" onClick={onCerrar} disabled={pensando}>Cancelar</button>
        <button className="newButton" disabled={pensando || !idea.trim()}>{pensando ? '✨ Escribiendo…' : opciones ? '✨ Generar otras' : '✨ Generar'}</button>
      </div>
      {pensando && <p className="gestionAyuda">Esto tarda unos segundos…</p>}
      {opciones && <>
        <p className="pgTitulo">Elegí la que más te guste (después la podés retocar):</p>
        <OpcionesIA opciones={opciones} onElegir={onElegir} />
      </>}
    </form>
  </div></div>
}
