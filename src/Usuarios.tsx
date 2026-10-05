import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { ROLES, ROLES_VALIDOS, NAVEGACION, puedeVer, type Rol } from './permisos'

// Usuarios y permisos (solo admin): tarjetas con nombre, email, rol, estado y
// último ingreso; invitar por email; enviar link de contraseña; y la tabla de
// qué ve cada rol (sale de permisos.ts, así nunca queda desactualizada).
// Protecciones: no podés quitarte el admin ni desactivarte, y la base exige
// que quede al menos un administrador activo.

type Perfil = { id: string; nombre: string | null; rol: string; activo: boolean; created_at: string }
type Detalle = { id: string; email: string; ultimo_ingreso: string | null; confirmado: boolean }

const DESCRIPCION_ROL: Record<Rol, string> = {
  admin: 'Todo, incluidos usuarios y configuración.',
  encargado: 'Clientes, obras, productos, compras y personal. No ve presupuestos ni movimientos de plata.',
  auxiliar: 'Obras, productos y compras.',
  contable: 'Clientes, presupuestos, obras, personal, movimientos y balance. No ve compras.',
}
// Llama a la función "gestionar-usuarios" y devuelve el error en palabras claras.
async function usarFuncion(cuerpo: Record<string, unknown>): Promise<{ data: { aviso?: string } | null; error: string }> {
  const { data, error: fallo } = await supabase.functions.invoke('gestionar-usuarios', { body: cuerpo })
  if (!fallo) return { data: data as { aviso?: string }, error: '' }
  let msg = ''
  const resp = (fallo as { context?: Response }).context
  try {
    const j = await resp?.clone().json()
    msg = j?.error ?? (j?.msg || j?.message ? `Supabase respondió: ${j.msg ?? j.message}` : '')
  } catch { /* sin detalle */ }
  if (!msg && resp?.status === 404) msg = 'Falta crear la función "gestionar-usuarios" en Supabase (Edge Functions).'
  if (!msg && resp?.status === 401) msg = 'Supabase rechazó el pedido: en la función "gestionar-usuarios" apagá "Verify JWT" y volvé a desplegarla.'
  return { data: null, error: msg || `No se pudo completar${resp?.status ? ` (error ${resp.status})` : ''}. Revisá la función "gestionar-usuarios" en Supabase.` }
}

// Contraseña fácil de dictar o copiar (sin letras que se confunden).
function generarClave() {
  const letras = 'abcdefghjkmnpqrstuvwxyz', nums = '23456789'
  const al = (t: string, n: number) => Array.from({ length: n }, () => t[Math.floor(Math.random() * t.length)]).join('')
  return `Mova-${al(letras, 4)}-${al(nums, 4)}`
}

const fechaHora = (f: string | null) => (f ? new Date(f).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : null)

export default function Usuarios() {
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [detalle, setDetalle] = useState<Record<string, Detalle> | null>(null)
  const [yo, setYo] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [invitando, setInvitando] = useState(false)
  const [editandoNombre, setEditandoNombre] = useState<{ id: string; nombre: string } | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [verPermisos, setVerPermisos] = useState(false)
  const [claveDe, setClaveDe] = useState<Perfil | null>(null)

  useEffect(() => { void cargar() }, [])

  async function cargar() {
    setCargando(true); setError('')
    const [rP, rD, rU] = await Promise.all([
      supabase.from('profiles').select('id, nombre, rol, activo, created_at').order('created_at', { ascending: true }),
      supabase.rpc('usuarios_detalle'),
      supabase.auth.getUser(),
    ])
    if (rP.error) { console.error(rP.error); setError('No se pudieron cargar los usuarios.') }
    else setPerfiles((rP.data ?? []) as Perfil[])
    // Si todavía no se corrió el SQL de Usuarios, no hay emails ni último ingreso.
    setDetalle(rD.error ? null : Object.fromEntries(((rD.data ?? []) as Detalle[]).map((d) => [d.id, d])))
    setYo(rU.data.user?.id ?? null)
    setCargando(false)
  }

  function avisar(texto: string) { setAviso(texto); setTimeout(() => setAviso(''), 4000) }
  const nombreDe = (p: Perfil) => p.nombre || detalle?.[p.id]?.email || 'Sin nombre'
  const mensajeError = (e: { message?: string } | null) =>
    e?.message?.includes('al menos un administrador') ? 'Tiene que quedar al menos un administrador activo.' : 'No se pudo guardar. Solo un administrador puede cambiar usuarios.'

  async function cambiarRol(p: Perfil, rol: string) {
    if (rol === p.rol) return
    if (!window.confirm(`¿Cambiar el rol de ${nombreDe(p)} a ${ROLES[rol as Rol]}?\n\nVa a ver: ${DESCRIPCION_ROL[rol as Rol]}`)) return
    setTrabajando(p.id); setError('')
    const { error: e } = await supabase.from('profiles').update({ rol }).eq('id', p.id)
    setTrabajando(null)
    if (e) { setError(mensajeError(e)); return }
    setPerfiles((arr) => arr.map((x) => (x.id === p.id ? { ...x, rol } : x)))
    avisar(`${nombreDe(p)} ahora es ${ROLES[rol as Rol]}. Lo ve la próxima vez que entre o recargue.`)
  }

  async function cambiarActivo(p: Perfil) {
    const texto = p.activo
      ? `¿Desactivar a ${nombreDe(p)}?\n\nNo va a poder entrar ni ver ningún dato hasta que lo vuelvas a activar.`
      : `¿Volver a activar a ${nombreDe(p)}?`
    if (!window.confirm(texto)) return
    setTrabajando(p.id); setError('')
    const { error: e } = await supabase.from('profiles').update({ activo: !p.activo }).eq('id', p.id)
    setTrabajando(null)
    if (e) { setError(mensajeError(e)); return }
    setPerfiles((arr) => arr.map((x) => (x.id === p.id ? { ...x, activo: !x.activo } : x)))
    avisar(p.activo ? `${nombreDe(p)} quedó desactivado.` : `${nombreDe(p)} está activo de nuevo.`)
  }

  async function guardarNombre() {
    if (!editandoNombre) return
    const nombre = editandoNombre.nombre.trim()
    if (!nombre) return
    setTrabajando(editandoNombre.id)
    const { error: e } = await supabase.from('profiles').update({ nombre }).eq('id', editandoNombre.id)
    setTrabajando(null)
    if (e) { setError(mensajeError(e)); return }
    setPerfiles((arr) => arr.map((x) => (x.id === editandoNombre.id ? { ...x, nombre } : x)))
    setEditandoNombre(null)
  }

  async function enviarLinkClave(p: Perfil) {
    const email = detalle?.[p.id]?.email
    if (!email) return
    if (!window.confirm(`¿Enviar a ${email} un link para crear una contraseña nueva?`)) return
    setTrabajando(p.id)
    const { error: e } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setTrabajando(null)
    if (e) { setError('No se pudo enviar el correo. Probá de nuevo en unos minutos.'); return }
    avisar(`Listo: le llegó a ${email} un link para cambiar la contraseña.`)
  }

  async function eliminar(p: Perfil) {
    if (!window.confirm(`¿Eliminar a ${nombreDe(p)}?\n\nNo va a poder entrar más y se borra su usuario. Lo que cargó (obras, gastos, etc.) queda guardado. No se puede deshacer.`)) return
    setTrabajando(p.id); setError('')
    const r = await usarFuncion({ accion: 'eliminar', id: p.id })
    setTrabajando(null)
    if (r.error) { setError(r.error); return }
    setPerfiles((arr) => arr.filter((x) => x.id !== p.id))
    avisar(`${nombreDe(p)} fue eliminado.`)
  }

  const secciones = NAVEGACION.filter(([clave]) => clave !== 'dashboard')

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div><p className="subtitle">SEGURIDAD</p><h2>Usuarios y permisos</h2><p className="welcome">Quién entra a la app y qué puede ver cada uno</p></div>
        <button className="newButton" onClick={() => setInvitando(true)}>+ Nuevo usuario</button>
      </div>

      {error && <p className="loginError">{error}</p>}
      {aviso && <p className="cfgOk usAviso">✓ {aviso}</p>}
      {detalle === null && !cargando && (
        <p className="gestionAyuda usFalta">Falta correr el SQL de Usuarios en Supabase: sin eso no se ven los emails ni el último ingreso, y "Inactivo" todavía no bloquea el acceso en la base de datos.</p>
      )}

      {cargando ? <p>Cargando usuarios...</p> : (
        <div className="usLista">
          {perfiles.length === 0 && <p className="agVacio">Todavía no hay usuarios. Creá el primero con "+ Nuevo usuario".</p>}
          {perfiles.map((p) => {
            const d = detalle?.[p.id]
            const esYo = p.id === yo
            return (
              <article key={p.id} className={`usCard ${p.activo ? '' : 'inactivo'}`}>
                <div className="usAvatar">{(nombreDe(p)[0] ?? '?').toUpperCase()}</div>
                <div className="usInfo">
                  {editandoNombre?.id === p.id ? (
                    <div className="usNombreEdit">
                      <input autoFocus value={editandoNombre.nombre} onChange={(e) => setEditandoNombre({ id: p.id, nombre: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void guardarNombre(); if (e.key === 'Escape') setEditandoNombre(null) }} />
                      <button type="button" className="newButton" disabled={trabajando === p.id} onClick={() => void guardarNombre()}>Guardar</button>
                      <button type="button" className="cancelButton" onClick={() => setEditandoNombre(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <strong>
                      {nombreDe(p)}{esYo && <span className="usYo">Vos</span>}
                      <button type="button" className="usLapiz" title="Cambiar nombre" onClick={() => setEditandoNombre({ id: p.id, nombre: p.nombre ?? '' })}>✏️</button>
                    </strong>
                  )}
                  {d?.email && <small>{d.email}</small>}
                  <small className="usMeta">
                    Alta {new Date(p.created_at).toLocaleDateString('es-AR')}
                    {d && (d.ultimo_ingreso ? ` · último ingreso ${fechaHora(d.ultimo_ingreso)}` : d.confirmado ? ' · nunca entró' : '')}
                    {d && !d.confirmado && <span className="usPendiente">Invitación pendiente</span>}
                  </small>
                </div>
                <div className="usControles">
                  <label className="usRol">
                    <span>Rol</span>
                    <select value={p.rol} disabled={esYo || trabajando === p.id} title={esYo ? 'No podés cambiar tu propio rol' : undefined} onChange={(e) => void cambiarRol(p, e.target.value)}>
                      {ROLES_VALIDOS.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
                    </select>
                  </label>
                  <button type="button" className={`usEstado ${p.activo ? 'ok' : 'off'}`} disabled={esYo || trabajando === p.id} title={esYo ? 'No podés desactivarte a vos mismo' : 'Tocá para cambiar'} onClick={() => void cambiarActivo(p)}>
                    {p.activo ? '● Activo' : '○ Inactivo'}
                  </button>
                  <button type="button" className="agBtn" title="Contraseña" disabled={trabajando === p.id} onClick={() => setClaveDe(p)}>🔑</button>
                  {!esYo && <button type="button" className="agBtn usBorrar" title="Eliminar usuario" aria-label="Eliminar usuario" disabled={trabajando === p.id} onClick={() => void eliminar(p)}>🗑</button>}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <section className="usPermisos">
        <button type="button" className="usPermisosHead" onClick={() => setVerPermisos((v) => !v)} aria-expanded={verPermisos}>
          <strong>🔐 Qué ve cada rol</strong><span className="homeChevron" style={{ transform: verPermisos ? 'rotate(90deg)' : undefined }}>›</span>
        </button>
        {verPermisos && <>
          <div className="usRoles">
            {ROLES_VALIDOS.map((r) => <div key={r}><b>{ROLES[r]}</b><small>{DESCRIPCION_ROL[r]}</small></div>)}
          </div>
          <div className="gestionTabla usMatriz"><table>
            <thead><tr><th>Sección</th>{ROLES_VALIDOS.map((r) => <th key={r}>{ROLES[r]}</th>)}</tr></thead>
            <tbody>
              <tr><td>Inicio y Agenda</td>{ROLES_VALIDOS.map((r) => <td key={r}>✓</td>)}</tr>
              {secciones.filter(([c]) => c !== 'agenda').map(([clave, , titulo]) => (
                <tr key={clave}><td>{titulo}</td>{ROLES_VALIDOS.map((r) => <td key={r} className={puedeVer(r, clave) ? 'si' : 'no'}>{puedeVer(r, clave) ? '✓' : '—'}</td>)}</tr>
              ))}
            </tbody>
          </table></div>
          <p className="gestionAyuda">En Inicio, las pestañas de plata (Balance, Cobranzas, Personal, Gastos fijos, Inventario) solo las ven Administrador y Contable.</p>
        </>}
      </section>

      {claveDe && <FormClave perfil={claveDe} nombre={nombreDe(claveDe)} email={detalle?.[claveDe.id]?.email ?? null} onCerrar={() => setClaveDe(null)}
        onLink={() => { const p = claveDe; setClaveDe(null); void enviarLinkClave(p) }} onListo={(msg) => { setClaveDe(null); avisar(msg) }} />}
      {invitando && <FormInvitar onCancelar={() => setInvitando(false)} onInvitado={(msg) => { setInvitando(false); avisar(msg); void cargar() }} />}
    </div>
  )
}

// Datos para pasarle al usuario (copiar o mandar por WhatsApp).
function DatosAcceso({ email, clave, nombre }: { email: string; clave: string; nombre: string }) {
  const [copiado, setCopiado] = useState(false)
  const texto = `Hola${nombre ? ` ${nombre.split(' ')[0]}` : ''}! Te creé el acceso a MOVA Gestión.\nEntrá en: ${window.location.origin}\nCorreo: ${email}\nContraseña: ${clave}`
  return (
    <div className="usAcceso">
      <b>✓ Listo. Pasale estos datos:</b>
      <pre>{texto}</pre>
      <div className="usAccesoBtns">
        <button type="button" className="editButton" onClick={() => { const ok = () => { setCopiado(true); setTimeout(() => setCopiado(false), 1800) }; if (navigator.clipboard) void navigator.clipboard.writeText(texto).then(ok, ok); else ok() }}>{copiado ? '✓ Copiado' : '📋 Copiar'}</button>
        <a className="newButton" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">💬 Mandar por WhatsApp</a>
      </div>
      <small>Por seguridad, después de mandarlo borrá el mensaje o pedile que cambie la contraseña.</small>
    </div>
  )
}

function FormInvitar({ onCancelar, onInvitado }: { onCancelar: () => void; onInvitado: (msg: string) => void }) {
  const [f, setF] = useState({ email: '', nombre: '', rol: 'auxiliar', clave: generarClave() })
  const [modo, setModo] = useState<'clave' | 'mail'>('clave')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [creado, setCreado] = useState<{ email: string; clave: string; nombre: string; aviso?: string } | null>(null)

  async function enviar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (modo === 'clave' && f.clave.trim().length < 8) { setError('La contraseña tiene que tener al menos 8 caracteres.'); return }
    setEnviando(true)
    const r = await usarFuncion(modo === 'clave'
      ? { accion: 'crear', email: f.email, nombre: f.nombre, rol: f.rol, clave: f.clave.trim() }
      : { accion: 'invitar', email: f.email, nombre: f.nombre, rol: f.rol, redirectTo: window.location.origin })
    setEnviando(false)
    if (r.error) { setError(r.error); return }
    if (modo === 'clave') setCreado({ email: f.email.trim().toLowerCase(), clave: f.clave.trim(), nombre: f.nombre.trim(), aviso: r.data?.aviso })
    else onInvitado(r.data?.aviso ?? `Invitación enviada a ${f.email}. Le llega un correo para crear su contraseña.`)
  }

  return (
    <div className="modalOverlay"><div className="modalCard">
      <div className="modalHeader"><div><p className="subtitle">USUARIOS</p><h2>Nuevo usuario</h2></div><button type="button" className="closeButton" onClick={creado ? () => onInvitado(`Usuario creado: ${creado.email}`) : onCancelar}>×</button></div>
      {creado ? (
        <div className="clienteForm">
          {creado.aviso && <p className="gestionAyuda">{creado.aviso}</p>}
          <DatosAcceso email={creado.email} clave={creado.clave} nombre={creado.nombre} />
          <div className="formActions"><button type="button" className="newButton" onClick={() => onInvitado(`Usuario creado: ${creado.email}`)}>Listo</button></div>
        </div>
      ) : (
      <form className="clienteForm" onSubmit={enviar}>
        <div className="usModo">
          <button type="button" className={modo === 'clave' ? 'activo' : ''} onClick={() => setModo('clave')}><b>🔐 Con contraseña</b><small>Vos la elegís y se la pasás</small></button>
          <button type="button" className={modo === 'mail' ? 'activo' : ''} onClick={() => setModo('mail')}><b>✉️ Por correo</b><small>Le llega un link para crearla</small></button>
        </div>
        <div className="formGrid">
          <label className="formFull">Email *<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nombre@correo.com" /></label>
          <label>Nombre<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej.: Juan Gómez" /></label>
          <label>Rol<select value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>{ROLES_VALIDOS.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}</select></label>
          {modo === 'clave' && (
            <label className="formFull">Contraseña *
              <div className="usClaveFila">
                <input value={f.clave} onChange={(e) => setF({ ...f, clave: e.target.value })} minLength={8} required autoComplete="off" />
                <button type="button" className="editButton" onClick={() => setF({ ...f, clave: generarClave() })}>🎲 Otra</button>
              </div>
            </label>
          )}
        </div>
        <p className="gestionAyuda">{DESCRIPCION_ROL[f.rol as Rol]} {modo === 'clave' ? 'Entra directo con este correo y contraseña.' : 'Le llega un correo con un link: al abrirlo crea su contraseña y entra.'}</p>
        {error && <p className="loginError">{error}</p>}
        <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={enviando}>{enviando ? 'Guardando…' : modo === 'clave' ? 'Crear usuario' : 'Enviar invitación'}</button></div>
      </form>
      )}
    </div></div>
  )
}

// Contraseña de un usuario existente: ponerle una nueva o mandarle un link.
function FormClave({ perfil, nombre, email, onCerrar, onLink, onListo }: { perfil: Perfil; nombre: string; email: string | null; onCerrar: () => void; onLink: () => void; onListo: (msg: string) => void }) {
  const [clave, setClave] = useState(generarClave())
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState(false)
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (clave.trim().length < 8) { setError('Usá al menos 8 caracteres.'); return }
    setGuardando(true)
    const r = await usarFuncion({ accion: 'clave', id: perfil.id, clave: clave.trim() })
    setGuardando(false)
    if (r.error) { setError(r.error); return }
    setHecho(true)
  }
  return (
    <div className="modalOverlay"><div className="modalCard">
      <div className="modalHeader"><div><p className="subtitle">CONTRASEÑA</p><h2>{nombre}</h2></div><button type="button" className="closeButton" onClick={hecho ? () => onListo(`Contraseña nueva para ${nombre}.`) : onCerrar}>×</button></div>
      {hecho && email ? (
        <div className="clienteForm">
          <DatosAcceso email={email} clave={clave.trim()} nombre={nombre} />
          <div className="formActions"><button type="button" className="newButton" onClick={() => onListo(`Contraseña nueva para ${nombre}.`)}>Listo</button></div>
        </div>
      ) : (
        <form className="clienteForm" onSubmit={guardar}>
          <label>Contraseña nueva
            <div className="usClaveFila">
              <input value={clave} onChange={(e) => setClave(e.target.value)} minLength={8} required autoComplete="off" />
              <button type="button" className="editButton" onClick={() => setClave(generarClave())}>🎲 Otra</button>
            </div>
          </label>
          <p className="gestionAyuda">Se cambia al instante; después le pasás la contraseña.</p>
          {error && <p className="loginError">{error}</p>}
          <div className="formActions">
            {email && <button type="button" className="cancelButton" onClick={onLink}>✉️ Mejor mandarle un link</button>}
            <button className="newButton" disabled={guardando}>{guardando ? 'Guardando…' : 'Poner contraseña'}</button>
          </div>
        </form>
      )}
    </div></div>
  )
}
