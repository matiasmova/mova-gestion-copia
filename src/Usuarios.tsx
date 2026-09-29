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

  const secciones = NAVEGACION.filter(([clave]) => clave !== 'dashboard')

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div><p className="subtitle">SEGURIDAD</p><h2>Usuarios y permisos</h2><p className="welcome">Quién entra a la app y qué puede ver cada uno</p></div>
        <button className="newButton" onClick={() => setInvitando(true)}>+ Invitar usuario</button>
      </div>

      {error && <p className="loginError">{error}</p>}
      {aviso && <p className="cfgOk usAviso">✓ {aviso}</p>}
      {detalle === null && !cargando && (
        <p className="gestionAyuda usFalta">Falta correr el SQL de Usuarios en Supabase: sin eso no se ven los emails ni el último ingreso, y "Inactivo" todavía no bloquea el acceso en la base de datos.</p>
      )}

      {cargando ? <p>Cargando usuarios...</p> : (
        <div className="usLista">
          {perfiles.length === 0 && <p className="agVacio">Todavía no hay usuarios. Invitá al primero con "+ Invitar usuario".</p>}
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
                  {d?.email && <button type="button" className="agBtn" title="Enviar link para cambiar la contraseña" disabled={trabajando === p.id} onClick={() => void enviarLinkClave(p)}>🔑</button>}
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

      {invitando && <FormInvitar onCancelar={() => setInvitando(false)} onInvitado={(msg) => { setInvitando(false); avisar(msg); void cargar() }} />}
    </div>
  )
}

function FormInvitar({ onCancelar, onInvitado }: { onCancelar: () => void; onInvitado: (msg: string) => void }) {
  const [f, setF] = useState({ email: '', nombre: '', rol: 'auxiliar' })
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  async function invitar(e: FormEvent) {
    e.preventDefault(); setError('')
    setEnviando(true)
    const { data, error: fallo } = await supabase.functions.invoke('gestionar-usuarios', {
      body: { accion: 'invitar', email: f.email, nombre: f.nombre, rol: f.rol, redirectTo: window.location.origin },
    })
    setEnviando(false)
    if (fallo) {
      // El detalle del error viene en la respuesta de la función.
      let msg = ''
      try { msg = (await (fallo as { context?: Response }).context?.json())?.error ?? '' } catch { /* sin detalle */ }
      setError(msg || 'No se pudo invitar. ¿Ya creaste la función "gestionar-usuarios" en Supabase?')
      return
    }
    onInvitado((data as { aviso?: string })?.aviso ?? `Invitación enviada a ${f.email}. Le llega un correo para crear su contraseña.`)
  }

  return (
    <div className="modalOverlay"><div className="modalCard">
      <div className="modalHeader"><div><p className="subtitle">USUARIOS</p><h2>Invitar usuario</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
      <form className="clienteForm" onSubmit={invitar}>
        <div className="formGrid">
          <label className="formFull">Email *<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nombre@correo.com" /></label>
          <label>Nombre<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej.: Juan Gómez" /></label>
          <label>Rol<select value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>{ROLES_VALIDOS.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}</select></label>
        </div>
        <p className="gestionAyuda">{DESCRIPCION_ROL[f.rol as Rol]} Le llega un correo con un link: al abrirlo crea su contraseña y entra.</p>
        {error && <p className="loginError">{error}</p>}
        <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar invitación'}</button></div>
      </form>
    </div></div>
  )
}
