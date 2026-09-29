import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import Clientes from './Clientes'
import Obras from './Obras'
import Presupuestos from './Presupuestos'
import Soluciones from './Soluciones'
import ProductosServicios from './ProductosServicios'
import Finanzas from './Finanzas'
import Compras from './Compras'
import Personal from './Personal.tsx'
import Agenda from './Agenda'
import Configuracion from './Configuracion'
import Usuarios from './Usuarios'
import HomeResumen from './HomeResumen'
import logo from './assets/mova-logo.png'
import './fase2.css'
import './menu.css'
import IconoMenu from './iconosMenu'

type Rol = 'admin' | 'encargado' | 'auxiliar' | 'contable'
const ROLES: Record<Rol, string> = {
  admin: 'Administrador', encargado: 'Encargado', auxiliar: 'Auxiliar', contable: 'Contable',
}
const ROLES_VALIDOS: Rol[] = ['admin', 'encargado', 'auxiliar', 'contable']

// Inicio reúne el resumen y lo que antes era el Tablero (balance, cobranzas,
// personal, gastos fijos e inventario), cada cosa en su pestaña.
const NAVEGACION = [
  ['dashboard', 'principal', 'Inicio'],
  ['agenda', 'principal', 'Agenda'],
  ['clientes', 'comercial', 'Clientes'],
  ['presupuestos', 'comercial', 'Presupuestos'],
  ['obras', 'comercial', 'Obras'],
  ['soluciones', 'comercial', 'Soluciones'],
  ['catalogo', 'operacion', 'Productos y servicios'],
  ['compras', 'operacion', 'Compras'],
  ['personal', 'operacion', 'Personal'],
  ['finanzas', 'operacion', 'Movimientos'],
  ['usuarios', 'sistema', 'Usuarios'],
  ['configuracion', 'sistema', 'Configuración'],
] as const

// Secciones del menú, en orden.
const GRUPOS_MENU: [string, string][] = [
  ['principal', 'Principal'],
  ['comercial', 'Comercial'],
  ['operacion', 'Operación'],
  ['sistema', 'Sistema'],
]

type Vista = (typeof NAVEGACION)[number][0]

// Qué roles ven cada módulo. Si un módulo no figura acá, lo ven todos.
const PERMISOS: Partial<Record<Vista, Rol[]>> = {
  clientes: ['admin', 'encargado', 'contable'],
  presupuestos: ['admin', 'contable'],
  soluciones: ['admin', 'contable'],
  finanzas: ['admin', 'contable'],
  compras: ['admin', 'encargado', 'auxiliar'],
  personal: ['admin', 'encargado', 'contable'],
  usuarios: ['admin'],
  configuracion: ['admin'],
}
const puedeVer = (rol: Rol, vista: Vista) =>
  (PERMISOS[vista] ?? ROLES_VALIDOS).includes(rol)

export default function AppFase2() {
  const [session, setSession] = useState<Session | null>(null)
  const [verificando, setVerificando] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mensajeError, setMensajeError] = useState('')
  const [ingresando, setIngresando] = useState(false)
  const [modoAuth, setModoAuth] = useState<'login' | 'reset'>('login')
  const [avisoReset, setAvisoReset] = useState('')
  const [vista, setVista] = useState<Vista>('dashboard')
  const [obraAbrirId, setObraAbrirId] = useState<number | null>(null)
  const [presupuestoAbrirId, setPresupuestoAbrirId] = useState<number | null>(null)
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [rol, setRol] = useState<Rol>('auxiliar')
  const [nombreUsuario, setNombreUsuario] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) await cargarPerfil(data.session)
      setVerificando(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_evento, nueva) => {
      setSession(nueva)
      if (nueva) await cargarPerfil(nueva)
      setVerificando(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Lee nombre y rol desde la tabla profiles. SEGURIDAD: si no hay perfil o
  // falla la lectura, se mantiene el mínimo privilegio ('auxiliar'), nunca admin.
  // El rol admin SOLO se otorga si el perfil en la BD lo dice explícitamente.
  async function cargarPerfil(sesion: Session) {
    setNombreUsuario(sesion.user.email?.split('@')[0] ?? 'Usuario')
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('nombre,rol')
        .eq('id', sesion.user.id)
        .maybeSingle()
      if (!error && data) {
        if (data.nombre) setNombreUsuario(data.nombre)
        if (data.rol && ROLES_VALIDOS.includes(data.rol as Rol)) setRol(data.rol as Rol)
        else setRol('auxiliar')
      } else {
        setRol('auxiliar')
      }
    } catch {
      setRol('auxiliar') // fail-closed: sin perfil → mínimo privilegio
    }
  }

  async function ingresar(evento: FormEvent) {
    evento.preventDefault(); setIngresando(true); setMensajeError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMensajeError('El correo o la contraseña no son correctos.')
    setIngresando(false)
  }

  async function enviarReset(evento: FormEvent) {
    evento.preventDefault(); setIngresando(true); setMensajeError(''); setAvisoReset('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    if (error) setMensajeError('No pudimos enviar el correo. Revisá el email ingresado.')
    else setAvisoReset('Listo. Revisá tu correo para restablecer la contraseña.')
    setIngresando(false)
  }

  async function salir() { await supabase.auth.signOut(); setVista('dashboard') }
  function navegar(destino: Vista) { setVista(destino); setMenuAbierto(false) }

  if (verificando) return <div className="loading">Cargando MOVA Gestión...</div>

  if (!session) return (
    <div className="fase2Login">
      <form className="fase2LoginCard" onSubmit={modoAuth === 'login' ? ingresar : enviarReset}>
        <img className="fase2LoginLogo" src={logo} alt="MOVA" />
        {modoAuth === 'login' ? (
          <>
            <h2>Bienvenido</h2>
            <p className="fase2LoginSub">Ingresá para administrar tu empresa</p>
            <label>Correo electrónico
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" required />
            </label>
            <label>Contraseña
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Tu contraseña" required />
            </label>
            <button type="button" className="fase2LoginLink" onClick={() => { setModoAuth('reset'); setMensajeError(''); setAvisoReset('') }}>
              ¿Olvidaste tu contraseña?
            </button>
            {mensajeError && <p className="loginError">{mensajeError}</p>}
            <button className="fase2LoginBtn" disabled={ingresando}>{ingresando ? 'Ingresando...' : 'Ingresar'}</button>
          </>
        ) : (
          <>
            <h2>Recuperar contraseña</h2>
            <p className="fase2LoginSub">Te enviamos un enlace para restablecerla</p>
            <label>Correo electrónico
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" required />
            </label>
            {mensajeError && <p className="loginError">{mensajeError}</p>}
            {avisoReset && <p className="fase2LoginOk">{avisoReset}</p>}
            <button className="fase2LoginBtn" disabled={ingresando}>{ingresando ? 'Enviando...' : 'Enviar enlace'}</button>
            <button type="button" className="fase2LoginLink" onClick={() => { setModoAuth('login'); setMensajeError('') }}>← Volver a ingresar</button>
          </>
        )}
      </form>
    </div>
  )

  const vistaSegura: Vista = puedeVer(rol, vista) ? vista : 'dashboard'
  const modulos = NAVEGACION.filter(([clave]) => puedeVer(rol, clave))

  const contenido: Record<Exclude<Vista, 'dashboard'>, React.ReactNode> = {
    clientes: <Clientes />,
    obras: <Obras obraAbrirId={obraAbrirId} onObraAbierta={() => setObraAbrirId(null)} onVerPresupuesto={(id) => { setPresupuestoAbrirId(id); navegar('presupuestos') }} />,
    presupuestos: <Presupuestos presupuestoAbrirId={presupuestoAbrirId} onPresupuestoAbierto={() => setPresupuestoAbrirId(null)} />,
    catalogo: <ProductosServicios />,
    soluciones: <Soluciones />,
    finanzas: <Finanzas onAbrirObra={(id) => { setObraAbrirId(id); navegar('obras') }} />,
    compras: <Compras />,
    personal: <Personal />, agenda: <Agenda />, usuarios: <Usuarios />, configuracion: <Configuracion />,
  }

  return <div className="fase2App">
    <button className="fase2MenuButton" aria-label="Abrir menú" onClick={() => setMenuAbierto((v) => !v)}><IconoMenu nombre="menu" tamano={22} /></button>
    <aside className={`fase2Sidebar ${menuAbierto ? 'abierto' : ''}`}>
      <div className="fase2Logo"><img src={logo} alt="MOVA Tecnología Smart" /></div>
      <nav>
        {GRUPOS_MENU.map(([grupo, etiqueta]) => {
          const delGrupo = modulos.filter(([, g]) => g === grupo)
          if (delGrupo.length === 0) return null
          return (
            <div key={grupo}>
              <span className="menuGrupo">{etiqueta}</span>
              {delGrupo.map(([clave, , titulo]) => (
                <button key={clave} className={`menuItem ${vistaSegura === clave ? 'active' : ''}`} aria-current={vistaSegura === clave ? 'page' : undefined} onClick={() => navegar(clave)}>
                  <span className="menuIcono"><IconoMenu nombre={clave} /></span>
                  <span className="menuTexto">{titulo}</span>
                </button>
              ))}
            </div>
          )
        })}
      </nav>
      <div className="fase2Usuario"><div>{(nombreUsuario[0] ?? 'M').toUpperCase()}</div><span><strong>{nombreUsuario || 'Usuario'}</strong><small>{ROLES[rol]}</small></span><button title="Cerrar sesión" aria-label="Cerrar sesión" onClick={salir}><IconoMenu nombre="salir" /></button></div>
    </aside>
    <main className="fase2Main">
      {vistaSegura === 'dashboard'
        ? <HomeResumen nombre={nombreUsuario} rol={rol} rolEtiqueta={ROLES[rol]} onNavegar={navegar} onSalir={salir} onAbrirObra={(id) => { setObraAbrirId(id); navegar('obras') }} />
        : contenido[vistaSegura]}
    </main>
  </div>
}
