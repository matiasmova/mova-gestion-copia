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
  const [conIA, setConIA] = useState(false)

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
          <button type="button" className="editButton iaBoton" disabled={!f.titulo.trim() && !f.descripcion.trim()} onClick={() => setConIA((v) => !v)}>{conIA ? '✕ Cerrar ayuda de IA' : '✨ Mejorar con IA'}</button>
          {!conIA && <small>Claude te propone 3 versiones del texto (gratis, con tu cuenta de claude.ai).</small>}
        </div>
        {conIA && <div className="formFull"><PuenteClaude pedido={pedidoMejorar(f.titulo, f.descripcion, existentes)} onElegir={(o) => { setF({ ...f, titulo: o.titulo, descripcion: o.descripcion }); setConIA(false) }} /></div>}
        <label>Orden<input type="number" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} /></label>
        <label>Estado<select value={f.activo ? 'si' : 'no'} onChange={(e) => setF({ ...f, activo: e.target.value === 'si' })}><option value="si">Activa (se puede elegir)</option><option value="no">Oculta</option></select></label>
      </div>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button></div>
    </form>
  </div></div>
}

// ---------- Asistente con IA (gratis, a través de claude.ai) ----------
// La app arma el pedido con el estilo de MOVA, lo copia y abre claude.ai.
// Se pega la respuesta de vuelta y la app la separa en opciones para elegir.
type OpcionIA = { titulo: string; descripcion: string }

const ESTILO = `Sos redactor comercial de MOVA Tecnología Smart, una empresa de Mendoza (Argentina) que instala domótica, redes WiFi, cámaras, riego automático, electricidad y tecnología para hogares y empresas.

Escribís "soluciones": bloques cortos que aparecen en los presupuestos, en la sección "Qué vas a disfrutar con este proyecto". Cada una tiene:
- Título: nombre breve y claro (2 a 5 palabras, sin marcas ni modelos).
- Descripción: 2 a 4 oraciones (entre 250 y 420 caracteres) con los beneficios para el cliente en su vida diaria: comodidad, seguridad, ahorro, control desde el celular, tranquilidad.

Estilo: español rioplatense con voseo ("controlá", "tenés"), cálido, concreto, sin exageraciones ni promesas imposibles. Sin emojis, sin precios, sin marcas ni modelos de equipos, sin tecnicismos: que lo entienda un cliente sin conocimientos técnicos.`

const FORMATO = `Dame exactamente 3 opciones distintas entre sí (por ejemplo: una enfocada en comodidad, otra en seguridad o ahorro, otra más breve). Respondé SOLO con este formato, sin nada antes ni después:

TÍTULO: ...
DESCRIPCIÓN: ...
---
TÍTULO: ...
DESCRIPCIÓN: ...
---
TÍTULO: ...
DESCRIPCIÓN: ...`

const yaExisten = (existentes: string[]) => (existentes.length ? `\n\nSoluciones que ya tengo (no las repitas ni uses el mismo título): ${existentes.slice(0, 40).join(' · ')}` : '')

function pedidoCrear(idea: string, existentes: string[]) {
  return `${ESTILO}\n\nCreá una solución nueva a partir de esta idea: "${idea.trim()}"${yaExisten(existentes)}\n\n${FORMATO}`
}
function pedidoMejorar(titulo: string, descripcion: string, existentes: string[]) {
  return `${ESTILO}\n\nMejorá esta solución manteniendo la idea (podés ajustar el título si queda mejor):\nTítulo: "${titulo.trim()}"\nDescripción: "${descripcion.trim()}"${yaExisten(existentes)}\n\n${FORMATO}`
}

// Separa la respuesta pegada en opciones. Si no viene con el formato, la toma entera como descripción.
function leerRespuesta(texto: string): OpcionIA[] {
  const limpio = texto.replace(/\*\*/g, '').replace(/\r/g, '')
  const bloques = limpio.split(/\n\s*-{3,}\s*\n|\n(?=\s*(?:\d+[.)]\s*)?T[IÍ]TULO\s*:)/i).map((b) => b.trim()).filter(Boolean)
  const opciones = bloques.map((b) => {
    const t = /T[IÍ]TULO\s*:\s*(.+)/i.exec(b)?.[1]?.trim() ?? ''
    const d = /DESCRIPCI[OÓ]N\s*:\s*([\s\S]+)/i.exec(b)?.[1]?.trim().replace(/\s*\n\s*/g, ' ') ?? ''
    return { titulo: t.replace(/^["“]|["”]$/g, ''), descripcion: d.replace(/^["“]|["”]$/g, '') }
  }).filter((o) => o.titulo && o.descripcion)
  if (opciones.length) return opciones.slice(0, 5)
  const solo = limpio.trim()
  return solo ? [{ titulo: '', descripcion: solo }] : []
}

function OpcionesIA({ opciones, onElegir }: { opciones: OpcionIA[]; onElegir: (o: OpcionIA) => void }) {
  return <div className="iaOpciones">
    {opciones.map((o, i) => (
      <div key={i} className="iaOpcion">
        <strong>{o.titulo || 'Sin título'}</strong>
        <p>{o.descripcion}</p>
        <button type="button" className="newButton" onClick={() => onElegir(o)}>Usar esta</button>
      </div>
    ))}
  </div>
}

function PuenteClaude({ pedido, deshabilitado, onElegir }: { pedido: string; deshabilitado?: boolean; onElegir: (o: OpcionIA) => void }) {
  const [copiado, setCopiado] = useState(false)
  const [respuesta, setRespuesta] = useState('')
  const [opciones, setOpciones] = useState<OpcionIA[] | null>(null)
  const [aviso, setAviso] = useState('')

  async function copiarYAbrir() {
    setAviso('')
    try { await navigator.clipboard.writeText(pedido); setCopiado(true) } catch { setAviso('No se pudo copiar solo: seleccioná el texto de abajo y copialo a mano.') ; setCopiado(true) }
    window.open('https://claude.ai/new', '_blank', 'noopener')
  }
  function verOpciones() {
    const o = leerRespuesta(respuesta)
    if (!o.length) { setAviso('Pegá primero la respuesta de Claude.'); return }
    setAviso(''); setOpciones(o)
  }

  return <div className="iaPuente">
    <div className="iaPaso">
      <span className="iaNum">1</span>
      <div>
        <button type="button" className="newButton" disabled={deshabilitado} onClick={() => void copiarYAbrir()}>📋 Copiar pedido y abrir Claude</button>
        <small>{copiado ? '✓ Copiado. En Claude, pegá con Ctrl + V (o mantené apretado → Pegar en el celular) y enviá.' : 'Se abre claude.ai en otra pestaña (gratis con tu cuenta).'}</small>
        {copiado && <details className="iaVer"><summary>Ver el pedido</summary><textarea readOnly rows={5} value={pedido} onFocus={(e) => e.currentTarget.select()} /></details>}
      </div>
    </div>
    <div className="iaPaso">
      <span className="iaNum">2</span>
      <div>
        <label>Pegá acá la respuesta de Claude
          <textarea rows={5} value={respuesta} onChange={(e) => { setRespuesta(e.target.value); setOpciones(null) }} placeholder={'TÍTULO: …\nDESCRIPCIÓN: …\n---\nTÍTULO: …'} />
        </label>
        <button type="button" className="editButton iaBoton" disabled={!respuesta.trim()} onClick={verOpciones}>Ver opciones</button>
      </div>
    </div>
    {aviso && <p className="loginError">{aviso}</p>}
    {opciones && <>
      <p className="pgTitulo">Elegí la que más te guste (después la podés retocar):</p>
      <OpcionesIA opciones={opciones} onElegir={onElegir} />
    </>}
  </div>
}

function AsistenteIA({ existentes, onCerrar, onElegir }: { existentes: string[]; onCerrar: () => void; onElegir: (o: OpcionIA) => void }) {
  const [idea, setIdea] = useState('')
  return <div className="modalOverlay"><div className="modalCard" style={{ maxWidth: 760 }}>
    <div className="modalHeader"><div><p className="subtitle">ASISTENTE</p><h2>✨ Crear solución con IA</h2></div><button type="button" className="closeButton" onClick={onCerrar}>×</button></div>
    <div className="clienteForm">
      <label>¿Qué solución querés ofrecer?
        <textarea rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} autoFocus
          placeholder="Ej.: instalación eléctrica nueva con tablero, disyuntor y cañerías embutidas · portón automático que se abre desde el celular" />
      </label>
      <div className="iaEjemplos">
        {['Portón automático con app', 'Cortinas motorizadas', 'Control de acceso con huella', 'Paneles solares con monitoreo', 'Sonido multiroom', 'Instalación eléctrica completa'].map((x) => (
          <button type="button" key={x} onClick={() => setIdea(x)}>{x}</button>
        ))}
      </div>
      <PuenteClaude pedido={pedidoCrear(idea, existentes)} deshabilitado={!idea.trim()} onElegir={onElegir} />
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCerrar}>Cerrar</button></div>
    </div>
  </div></div>
}
