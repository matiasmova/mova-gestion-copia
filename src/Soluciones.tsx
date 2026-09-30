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
          <button className="editButton iaBoton" onClick={() => { setConIA(true); setEditando({ ...vacia, orden: (lista[lista.length - 1]?.orden ?? 0) + 10 }) }}>✨ Crear con IA</button>
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

      {editando && <FormularioSolucion existentes={lista.filter((x) => x.id !== editando.id).map((x) => x.titulo)} solucion={editando} conIdea={conIA} onCancelar={() => { setEditando(null); setConIA(false) }} onGuardado={() => { setEditando(null); setConIA(false); setRevision((v) => v + 1) }} />}
    </div>
  )
}

function FormularioSolucion({ solucion, existentes, conIdea, onCancelar, onGuardado }: { solucion: Solucion; existentes: string[]; conIdea?: boolean; onCancelar: () => void; onGuardado: () => void }) {
  const editando = solucion.id > 0
  const [f, setF] = useState({ titulo: solucion.titulo, descripcion: solucion.descripcion, orden: String(solucion.orden), activo: solucion.activo })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  // Ayuda de IA (Gemini): idea rápida, títulos y descripciones sugeridos.
  const [idea, setIdea] = useState('')
  const [pensando, setPensando] = useState<'' | 'completar' | 'titulos' | 'descripciones'>('')
  const [opciones, setOpciones] = useState<{ titulo: string; descripcion: string }[]>([])
  const [titulos, setTitulos] = useState<string[]>([])
  const [descripciones, setDescripciones] = useState<string[]>([])
  const [errorIA, setErrorIA] = useState('')

  async function pedir(accion: 'completar' | 'titulos' | 'descripciones') {
    setErrorIA(''); setPensando(accion)
    const { data, error: fallo } = await supabase.functions.invoke('asistente-ia', { body: { accion, idea, titulo: f.titulo, descripcion: f.descripcion, existentes } })
    setPensando('')
    if (fallo || data?.error) {
      let msg = data?.error ?? 'No se pudo conectar con el asistente. Revisá que la función "asistente-ia" esté instalada en Supabase (con Verify JWT apagado).'
      try { const ctx = (fallo as { context?: Response } | null)?.context; if (ctx) { const j = await ctx.json(); msg = j.error ?? j.message ?? msg } } catch { /* sin detalle */ }
      setErrorIA(msg); return
    }
    const lista = (data?.opciones ?? []) as never[]
    if (!lista.length) { setErrorIA('No llegaron sugerencias. Probá de nuevo.'); return }
    if (accion === 'completar') {
      const ops = lista as { titulo: string; descripcion: string }[]
      setF((x) => ({ ...x, titulo: ops[0].titulo, descripcion: ops[0].descripcion }))
      setOpciones(ops.slice(1)); setTitulos([]); setDescripciones([])
    } else if (accion === 'titulos') setTitulos(lista as string[])
    else setDescripciones(lista as string[])
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

  const hayTexto = !!(f.titulo.trim() || f.descripcion.trim() || idea.trim())
  return <div className="modalOverlay"><div className="modalCard" style={{ maxWidth: 720 }}>
    <div className="modalHeader"><div><p className="subtitle">{editando ? 'EDITAR SOLUCIÓN' : 'NUEVA SOLUCIÓN'}</p><h2>{editando ? f.titulo || 'Solución' : 'Nueva solución'}</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}>
      {!editando && <div className="iaIdea">
        <label>✨ Idea rápida <small>(la IA completa el título y la descripción)</small>
          <div className="iaIdeaFila">
            <input value={idea} onChange={(e) => setIdea(e.target.value)} autoFocus={conIdea} placeholder="Ej.: portón automático que se abre desde el celular"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (idea.trim()) void pedir('completar') } }} />
            <button type="button" className="newButton" disabled={!idea.trim() || !!pensando} onClick={() => void pedir('completar')}>{pensando === 'completar' ? 'Escribiendo…' : 'Completar'}</button>
          </div>
        </label>
        {opciones.length > 0 && <div className="iaChips"><span>Otras opciones:</span>{opciones.map((o, i) => (
          <button type="button" key={i} title={o.descripcion} onClick={() => { setOpciones((ops) => [...ops.filter((_, k) => k !== i), { titulo: f.titulo, descripcion: f.descripcion }]); setF((x) => ({ ...x, titulo: o.titulo, descripcion: o.descripcion })) }}>{o.titulo}</button>
        ))}</div>}
      </div>}
      <div className="formGrid">
        <label className="formFull">
          <span className="iaEtiqueta">Nombre *<button type="button" className="iaMini" disabled={!hayTexto || !!pensando} onClick={() => void pedir('titulos')}>{pensando === 'titulos' ? '…' : '✨ Sugerir títulos'}</button></span>
          <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ej.: Red WiFi Mesh" />
          {titulos.length > 0 && <div className="iaChips">{titulos.map((t) => <button type="button" key={t} onClick={() => { setF((x) => ({ ...x, titulo: t })); setTitulos([]) }}>{t}</button>)}<button type="button" className="iaCerrar" onClick={() => setTitulos([])}>✕</button></div>}
        </label>
        <label className="formFull">
          <span className="iaEtiqueta">Qué va a disfrutar el cliente *<button type="button" className="iaMini" disabled={!hayTexto || !!pensando} onClick={() => void pedir('descripciones')}>{pensando === 'descripciones' ? '…' : f.descripcion.trim() ? '✨ Mejorar texto' : '✨ Escribir texto'}</button></span>
          <textarea rows={5} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} placeholder="Contá los beneficios en 2 o 3 oraciones, pensando en el cliente." />
          {descripciones.length > 0 && <div className="iaSugerencias">
            {descripciones.map((d, i) => <button type="button" key={i} onClick={() => { setF((x) => ({ ...x, descripcion: d })); setDescripciones([]) }}><span>{d}</span><b>Usar</b></button>)}
            <button type="button" className="iaCerrar" onClick={() => setDescripciones([])}>✕ Cerrar sugerencias</button>
          </div>}
        </label>
        {errorIA && <p className="loginError formFull">{errorIA}</p>}
        <label>Orden<input type="number" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} /></label>
        <label>Estado<select value={f.activo ? 'si' : 'no'} onChange={(e) => setF({ ...f, activo: e.target.value === 'si' })}><option value="si">Activa (se puede elegir)</option><option value="no">Oculta</option></select></label>
      </div>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button></div>
    </form>
  </div></div>
}
