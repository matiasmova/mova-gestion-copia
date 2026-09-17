import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import Clientes from './Clientes'
import Obras from './Obras'
import Presupuestos from './Presupuestos'
import ProductosServicios from './ProductosServicios'
import Finanzas from './Finanzas'
import Compras from './Compras'
import Personal from './Personal.tsx'
import Notificaciones from './Notificaciones'
import Configuracion from './Configuracion'
import Usuarios from './Usuarios'
import Calendario from './Calendario'
import logo from './assets/mova-logo.png'
import { moneda } from './gestionFormat'
import { etiquetaObra } from './obraEstado'
import './fase2.css'

type Rol = 'admin' | 'encargado' | 'auxiliar' | 'contable'
const ROLES: Record<Rol, string> = {
  admin: 'Administrador', encargado: 'Encargado', auxiliar: 'Auxiliar', contable: 'Contable',
}
const ROLES_VALIDOS: Rol[] = ['admin', 'encargado', 'auxiliar', 'contable']

const NAVEGACION = [
  ['dashboard', '▦', 'Home'],
  ['clientes', '👤', 'Clientes'],
  ['presupuestos', '📄', 'Presupuestos'],
  ['obras', '🏠', 'Obras'],
  ['catalogo', '📦', 'Productos y servicios'],
  ['compras', '🧾', 'Compras'],
  ['personal', '👷', 'Personal'],
  ['finanzas', '💰', 'Finanzas'],
  ['notificaciones', '🔔', 'Notificaciones'],
  ['usuarios', '🛡️', 'Usuarios'],
  ['configuracion', '⚙️', 'Configuración'],
] as const

type Vista = (typeof NAVEGACION)[number][0]

// Qué roles ven cada módulo. Si un módulo no figura acá, lo ven todos.
const PERMISOS: Partial<Record<Vista, Rol[]>> = {
  clientes: ['admin', 'encargado', 'contable'],
  presupuestos: ['admin', 'contable'],
  finanzas: ['admin', 'contable'],
  compras: ['admin', 'encargado', 'auxiliar'],
  personal: ['admin', 'encargado', 'contable'],
  usuarios: ['admin'],
  configuracion: ['admin'],
}
const puedeVer = (rol: Rol, vista: Vista) =>
  (PERMISOS[vista] ?? ROLES_VALIDOS).includes(rol)

type ObraResumen = { id: number; cliente_id: number; nombre_obra: string; localidad: string | null; estado: string; porcentaje_avance: number | null }
type ClienteResumen = { id: number; nombre: string; apellido: string | null }
type PresupuestoResumen = { id: number; cliente_id: number; obra_id: number | null; titulo: string; estado: string; total: number; total_pagado: number; saldo: number; fecha: string }
type PagoResumen = { id: number; monto: number; fecha: string }

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
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [rol, setRol] = useState<Rol>('admin')
  const [nombreUsuario, setNombreUsuario] = useState('')
  const [clientes, setClientes] = useState<ClienteResumen[]>([])
  const [obras, setObras] = useState<ObraResumen[]>([])
  const [presupuestos, setPresupuestos] = useState<PresupuestoResumen[]>([])
  const [pagos, setPagos] = useState<PagoResumen[]>([])
  const [cargandoDash, setCargandoDash] = useState(true)

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

  // Lee nombre y rol desde la tabla profiles. Si la tabla no existe todavía,
  // queda como 'admin' por defecto (defensivo, no rompe la app).
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
      }
    } catch {
      /* sin tabla profiles → se mantiene 'admin' */
    }
  }

  useEffect(() => {
    if (!session || vista !== 'dashboard') return
    async function cargar() {
      setCargandoDash(true)
      const [c, o, p, pagosResultado] = await Promise.all([
        supabase.from('Clientes').select('id,nombre,apellido').eq('activo', true).order('nombre'),
        supabase.from('obras').select('id,cliente_id,nombre_obra,localidad,estado,porcentaje_avance').eq('activo', true).order('created_at', { ascending: false }),
        supabase.from('presupuestos').select('id,cliente_id,obra_id,titulo,estado,total,total_pagado,saldo,fecha').eq('activo', true).order('created_at', { ascending: false }),
        supabase.from('pagos').select('id,monto,fecha').order('fecha', { ascending: false }),
      ])
      if (!c.error) setClientes((c.data ?? []) as ClienteResumen[])
      if (!o.error) setObras((o.data ?? []) as ObraResumen[])
      if (!p.error) setPresupuestos((p.data ?? []) as PresupuestoResumen[])
      if (!pagosResultado.error) setPagos((pagosResultado.data ?? []).map((pago) => ({ ...pago, monto: Number(pago.monto) })) as PagoResumen[])
      setCargandoDash(false)
    }
    cargar()
  }, [session, vista])

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
    clientes: <Clientes />, obras: <Obras />, presupuestos: <Presupuestos />,
    catalogo: <ProductosServicios />, finanzas: <Finanzas />, compras: <Compras />,
    personal: <Personal />, notificaciones: <Notificaciones />, usuarios: <Usuarios />, configuracion: <Configuracion />,
  }

  return <div className="fase2App">
    <button className="fase2MenuButton" onClick={() => setMenuAbierto((v) => !v)}>☰</button>
    <aside className={`fase2Sidebar ${menuAbierto ? 'abierto' : ''}`}>
      <div className="fase2Logo"><img src={logo} alt="MOVA" /><span>ESPACIOS INTELIGENTES</span></div>
      <nav>{modulos.map(([clave, icono, titulo]) => <button key={clave} className={vistaSegura === clave ? 'active' : ''} onClick={() => navegar(clave)}><span>{icono}</span>{titulo}</button>)}</nav>
      <div className="fase2Usuario"><div>{(nombreUsuario[0] ?? 'M').toUpperCase()}</div><span><strong>{nombreUsuario || 'Usuario'}</strong><small>{ROLES[rol]}</small></span><button title="Cerrar sesión" onClick={salir}>⏻</button></div>
    </aside>
    <main className="fase2Main">
      {vistaSegura === 'dashboard'
        ? <Dashboard nombre={nombreUsuario} rol={rol} cargando={cargandoDash} clientes={clientes} obras={obras} presupuestos={presupuestos} pagos={pagos} onNavegar={navegar} onSalir={salir} />
        : contenido[vistaSegura]}
    </main>
  </div>
}

const ESTADOS_OBRA: { clave: string; t: string; clase: string }[] = [
  { clave: 'en_proceso', t: 'En proceso', clase: 'ejecucion' },
  { clave: 'finalizada', t: 'Finalizada', clase: 'fin' },
  { clave: 'observacion', t: 'En observación', clase: 'pausa' },
]

function Dashboard({ nombre, rol, cargando, clientes, obras, presupuestos, pagos, onNavegar, onSalir }: {
  nombre: string; rol: Rol; cargando: boolean
  clientes: ClienteResumen[]; obras: ObraResumen[]; presupuestos: PresupuestoResumen[]; pagos: PagoResumen[]
  onNavegar: (v: Vista) => void; onSalir: () => void
}) {
  const [mesSel, setMesSel] = useState(() => new Date().toISOString().slice(0, 7))
  const pendientes = presupuestos.filter((p) => p.estado === 'borrador' || p.estado === 'enviado')
  const obrasActivas = obras.filter((o) => o.estado === 'en_proceso')
  const pagosMes = pagos.filter((pago) => pago.fecha?.slice(0, 7) === mesSel)
  const ingresosMes = pagosMes.reduce((suma, pago) => suma + pago.monto, 0)
  const porCobrar = presupuestos.filter((p) => p.estado === 'aceptado' && Number(p.saldo) > 0)
  const nombreCliente = (id: number) => { const c = clientes.find((x) => x.id === id); return c ? `${c.nombre} ${c.apellido ?? ''}`.trim() : 'Cliente' }
  const claseEstado = (estado: string) => estado === 'finalizada' ? 'fin' : estado === 'observacion' ? 'pausa' : 'ejecucion'
  const saldoTotal = useMemo(() => porCobrar.reduce((s, p) => s + Number(p.saldo), 0), [porCobrar])
  const distribucion = ESTADOS_OBRA.map((e) => ({ ...e, n: obras.filter((o) => o.estado === e.clave).length }))
  const totalObras = obras.length || 1
  const [dashTab, setDashTab] = useState<'resumen' | 'calendario'>('resumen')

  return <div className="fase2Dashboard">
    <header className="fase2Encabezado">
      <div><p className="subtitle">MOVA GESTIÓN · {ROLES[rol].toUpperCase()}</p><h2>Hola, {nombre || 'bienvenido'}</h2><p className="welcome">Resumen general de tu empresa</p></div>
      <div className="headerActions"><button className="logoutButton" onClick={onSalir}>Cerrar sesión</button><button className="newButton" onClick={() => onNavegar('clientes')}>+ Nuevo</button></div>
    </header>

    <div className="gestionTabs" style={{ marginBottom: 18 }}>
      <button className={dashTab === 'resumen' ? 'active' : ''} onClick={() => setDashTab('resumen')}>Resumen</button>
      <button className={dashTab === 'calendario' ? 'active' : ''} onClick={() => setDashTab('calendario')}>📅 Calendario</button>
    </div>

    {dashTab === 'calendario' && <Calendario obras={obras.map((o) => ({ id: o.id, nombre_obra: o.nombre_obra }))} />}

    {dashTab === 'resumen' && (<>

    <div className="dashMesFiltro">
      <label>Ver mes<input type="month" value={mesSel} onChange={(e) => setMesSel(e.target.value)} /></label>
      <span>{pagosMes.length} cobro{pagosMes.length === 1 ? '' : 's'} · {moneda(ingresosMes)} cobrado en el mes</span>
    </div>

    {cargando ? (
      <section className="fase2Kpis">{[0, 1, 2, 3].map((i) => <div key={i}><span className="skel skelLine" /><strong className="skel skelBig" /><small className="skel skelLine" /></div>)}</section>
    ) : (
      <section className="fase2Kpis">
        <div><span>CLIENTES</span><strong>{clientes.length}</strong><small>Clientes activos</small></div>
        <div><span>OBRAS ACTIVAS</span><strong>{obrasActivas.length}</strong><small>Pendientes y en ejecución</small></div>
        <div><span>PRESUPUESTOS</span><strong>{pendientes.length}</strong><small>Pendientes</small></div>
        <div className="destacado"><span>INGRESOS DEL MES</span><strong>{moneda(ingresosMes)}</strong><small>{new Date(mesSel + '-01T00:00:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</small></div>
      </section>
    )}

    {!cargando && obras.length > 0 && (
      <section className="fase2Distribucion">
        <div className="fase2DistHead"><h3>Obras por estado</h3><span>{obras.length} en total</span></div>
        <div className="fase2DistBar">
          {distribucion.filter((d) => d.n > 0).map((d) => <i key={d.clave} className={d.clase} style={{ width: `${(d.n / totalObras) * 100}%` }} title={`${d.t}: ${d.n}`} />)}
        </div>
        <div className="fase2DistLeyenda">
          {distribucion.map((d) => <span key={d.clave}><em className={d.clase} />{d.t} <b>{d.n}</b></span>)}
        </div>
      </section>
    )}

    <section className="fase2Paneles">
      <div className="fase2Panel">
        <div className="fase2PanelTitulo"><div><h3>Obras recientes</h3><p>Últimos trabajos registrados</p></div><button onClick={() => onNavegar('obras')}>Ver todas →</button></div>
        {cargando ? [0, 1, 2].map((i) => <div className="fase2ObraFila" key={i}><span className="skel skelIcono" /><div style={{ width: '100%' }}><strong className="skel skelLine" /><span className="skel skelLine" /></div></div>)
          : obras.length === 0 ? <div className="fase2Vacio"><span>🏠</span><p>Todavía no hay obras.</p></div>
          : obras.slice(0, 5).map((obra) => <div className="fase2ObraFila" key={obra.id}><span className="icono">🏠</span><div><strong>{obra.nombre_obra}</strong><span>{nombreCliente(obra.cliente_id)}</span><small>{obra.localidad || 'Sin localidad'} · {obra.porcentaje_avance ?? 0}% avance</small></div><em className={claseEstado(obra.estado)}>{etiquetaObra(obra.estado)}</em></div>)}
      </div>
      <div className="fase2Panel">
        <div className="fase2PanelTitulo"><div><h3>Cuentas por cobrar</h3><p>{moneda(saldoTotal)} pendiente</p></div></div>
        {cargando ? [0, 1, 2].map((i) => <div className="fase2Cuenta" key={i}><div style={{ width: '100%' }}><strong className="skel skelLine" /><span className="skel skelLine" /></div></div>)
          : porCobrar.length === 0 ? <div className="fase2Vacio"><span>✓</span><p>Sin saldos pendientes.</p></div>
          : porCobrar.slice(0, 5).map((p) => <div className="fase2Cuenta" key={p.id}><div><strong>{p.titulo}</strong><span>{nombreCliente(p.cliente_id)}</span></div><b>{moneda(p.saldo)}</b></div>)}
      </div>
    </section>
    </>)}
  </div>
}
