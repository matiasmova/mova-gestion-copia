import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import Clientes from './Clientes'
import Obras from './Obras'
import Presupuestos from './Presupuestos'
import ProductosServicios from './ProductosServicios'
import Finanzas from './Finanzas'
import Compras from './Compras'
import Personal from './Personal'
import Notificaciones from './Notificaciones'
import Tablero from './Tablero'
import GastosGenerales from './GastosGenerales'
import Usuarios from './Usuarios'
import Configuracion from './Configuracion'

type Vista =
  | 'dashboard'
  | 'tablero'
  | 'clientes'
  | 'obras'
  | 'presupuestos'
  | 'catalogo'
  | 'finanzas'
  | 'compras'
  | 'personal'
  | 'gastos'
  | 'notificaciones'
  | 'usuarios'
  | 'configuracion'

type ObraReciente = {
  id: number
  cliente_id: number
  nombre_obra: string
  localidad: string | null
  estado: string
  created_at: string
}

type ClienteResumen = {
  id: number
  nombre: string
  apellido: string | null
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [verificando, setVerificando] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mensajeError, setMensajeError] = useState('')
  const [ingresando, setIngresando] = useState(false)

  const [vista, setVista] =
    useState<Vista>('dashboard')

  // Navegación entre módulos: guarda qué obra o presupuesto abrir
  // automáticamente cuando se llega desde otro módulo (ej. "Ver presupuesto"
  // desde el detalle de una obra, o "Ver obra" desde Finanzas).
  const [obraAbrirId, setObraAbrirId] = useState<number | null>(null)
  const [presupuestoAbrirId, setPresupuestoAbrirId] = useState<number | null>(null)

  const [totalClientes, setTotalClientes] = useState(0)
  const [totalObrasActivas, setTotalObrasActivas] =
    useState(0)
    const [
      totalPresupuestosPendientes,
      setTotalPresupuestosPendientes,
    ] = useState(0)
  const [obrasRecientes, setObrasRecientes] = useState<
    ObraReciente[]
  >([])
  const [clientesResumen, setClientesResumen] = useState<
    ClienteResumen[]
  >([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setVerificando(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_evento, nuevaSession) => {
        setSession(nuevaSession)
        setVerificando(false)
      },
    )

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setTotalClientes(0)
      setTotalObrasActivas(0)
      setObrasRecientes([])
      return
    }

    if (vista !== 'dashboard') return

    async function cargarDashboard() {
      const [
        resultadoClientes,
        resultadoObras,
        resultadoRecientes,
        resultadoNombresClientes,
      ] = await Promise.all([
        supabase
          .from('Clientes')
          .select('*', {
            count: 'exact',
            head: true,
          }),

        supabase
          .from('obras')
          .select('*', {
            count: 'exact',
            head: true,
          })
          .eq('activo', true)
          .neq('estado', 'Finalizada'),

        supabase
          .from('obras')
          .select(
            `
              id,
              cliente_id,
              nombre_obra,
              localidad,
              estado,
              created_at
            `,
          )
          .eq('activo', true)
          .order('created_at', {
            ascending: false,
          })
          .limit(5),

        supabase
          .from('Clientes')
          .select('id, nombre, apellido'),
      ])

      if (resultadoClientes.error) {
        console.error(resultadoClientes.error)
      } else {
        setTotalClientes(resultadoClientes.count ?? 0)
      }

      if (resultadoObras.error) {
        console.error(resultadoObras.error)
      } else {
        setTotalObrasActivas(
          resultadoObras.count ?? 0,
        )
      }

      if (resultadoRecientes.error) {
        console.error(resultadoRecientes.error)
      } else {
        setObrasRecientes(
          (resultadoRecientes.data ??
            []) as ObraReciente[],
        )
      }

      if (resultadoNombresClientes.error) {
        console.error(
          resultadoNombresClientes.error,
        )
      } else {
        setClientesResumen(
          (resultadoNombresClientes.data ??
            []) as ClienteResumen[],
        )
      }
    }

    cargarDashboard()
  }, [session, vista])
  useEffect(() => {
    if (!session || vista !== 'dashboard') {
      return
    }

    async function cargarPresupuestosPendientes() {
      const { count, error } = await supabase
        .from('presupuestos')
        .select('*', {
          count: 'exact',
          head: true,
        })
        .eq('activo', true)
        .eq('estado', 'pendiente')

      if (error) {
        console.error(
          'Error al consultar presupuestos:',
          error,
        )
        return
      }

      setTotalPresupuestosPendientes(count ?? 0)
    }

    cargarPresupuestosPendientes()
  }, [session, vista])
  async function iniciarSesion(
    evento: FormEvent<HTMLFormElement>,
  ) {
    evento.preventDefault()
    setMensajeError('')
    setIngresando(true)

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    if (error) {
      setMensajeError(
        'El correo o la contraseña no son correctos.',
      )
    }

    setIngresando(false)
  }

  async function cerrarSesion() {
    await supabase.auth.signOut()
    setVista('dashboard')
  }

  function nombreCliente(clienteId: number) {
    const cliente = clientesResumen.find(
      (item) => item.id === clienteId,
    )

    if (!cliente) return 'Cliente'

    return `${cliente.nombre} ${
      cliente.apellido ?? ''
    }`.trim()
  }

  // Ir a Obras y abrir una obra puntual (ej. desde Finanzas u otro módulo).
  function irAObra(id: number) {
    setObraAbrirId(id)
    setVista('obras')
  }

  // Ir a Presupuestos y abrir un presupuesto puntual (ej. desde el detalle de una obra).
  function irAPresupuesto(id: number) {
    setPresupuestoAbrirId(id)
    setVista('presupuestos')
  }

  if (verificando) {
    return (
      <div className="loading">
        Cargando MOVA Gestión...
      </div>
    )
  }

  if (!session) {
    return (
      <div className="loginPage">
        <form
          className="loginCard"
          onSubmit={iniciarSesion}
        >
          <div className="loginBrand">
            <h1>MOVA</h1>
            <span>GESTIÓN</span>
          </div>

          <div className="loginTitle">
            <h2>Bienvenido</h2>
            <p>
              Ingresá para administrar tu empresa
            </p>
          </div>

          <label>
            Correo electrónico
            <input
              type="email"
              value={email}
              onChange={(evento) =>
                setEmail(evento.target.value)
              }
              placeholder="tu@correo.com"
              required
            />
          </label>

          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(evento) =>
                setPassword(evento.target.value)
              }
              placeholder="Tu contraseña"
              required
            />
          </label>

          {mensajeError && (
            <p className="loginError">
              {mensajeError}
            </p>
          )}

          <button
            type="submit"
            disabled={ingresando}
          >
            {ingresando
              ? 'Ingresando...'
              : 'Ingresar'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>MOVA</h1>
          <span>GESTIÓN</span>
        </div>

        <nav>
          <button
            className={
              vista === 'dashboard'
                ? 'active'
                : ''
            }
            onClick={() =>
              setVista('dashboard')
            }
          >
            ▦ Dashboard
          </button>

          <button
            className={
              vista === 'tablero'
                ? 'active'
                : ''
            }
            onClick={() =>
              setVista('tablero')
            }
          >
            📊 Tablero
          </button>

          <button
            className={
              vista === 'clientes'
                ? 'active'
                : ''
            }
            onClick={() =>
              setVista('clientes')
            }
          >
            👤 Clientes
          </button>

          <button
            className={
              vista === 'obras'
                ? 'active'
                : ''
            }
            onClick={() => setVista('obras')}
          >
            🏠 Obras
          </button>

          <button
            className={
              vista === 'presupuestos'
                ? 'active'
                : ''
            }
            onClick={() =>
              setVista('presupuestos')
            }
          >
            📄 Presupuestos
          </button>
          <button
  className={
    vista === 'catalogo'
      ? 'active'
      : ''
  }
  onClick={() => setVista('catalogo')}
>
  📦 Lista de productos y servicios
</button>

          <button className={vista === 'finanzas' ? 'active' : ''} onClick={() => setVista('finanzas')}>💰 Finanzas</button>
          <button className={vista === 'compras' ? 'active' : ''} onClick={() => setVista('compras')}>🧾 Compras</button>
          <button className={vista === 'personal' ? 'active' : ''} onClick={() => setVista('personal')}>👷 Personal</button>
          <button className={vista === 'gastos' ? 'active' : ''} onClick={() => setVista('gastos')}>💸 Gastos fijos</button>
          <button className={vista === 'notificaciones' ? 'active' : ''} onClick={() => setVista('notificaciones')}>🔔 Notificaciones</button>
          <button className={vista === 'usuarios' ? 'active' : ''} onClick={() => setVista('usuarios')}>🛡 Usuarios</button>
          <button className={vista === 'configuracion' ? 'active' : ''} onClick={() => setVista('configuracion')}>⚙️ Configuración</button>
        </nav>

        <div className="sidebarFooter">
          <span>MOVA</span>
          <small>Espacios inteligentes</small>
        </div>
      </aside>

      <main className="main">
        {vista === 'clientes' && <Clientes />}

        {vista === 'obras' && (
          <Obras
            obraAbrirId={obraAbrirId}
            onObraAbierta={() => setObraAbrirId(null)}
            onVerPresupuesto={irAPresupuesto}
          />
        )}

        {vista === 'presupuestos' && (
          <Presupuestos
            presupuestoAbrirId={presupuestoAbrirId}
            onPresupuestoAbierto={() => setPresupuestoAbrirId(null)}
          />
        )}
{vista === 'catalogo' && (
  <ProductosServicios />
)}
        {vista === 'finanzas' && <Finanzas />}
        {vista === 'compras' && <Compras />}
        {vista === 'personal' && <Personal />}
        {vista === 'gastos' && <GastosGenerales />}
        {vista === 'notificaciones' && <Notificaciones />}
        {vista === 'usuarios' && <Usuarios />}
        {vista === 'configuracion' && <Configuracion />}

        {vista === 'tablero' && (
          <Tablero onIrA={(destino) => setVista(destino)} />
        )}

        {vista === 'dashboard' && (
          <>
            <header>
              <div>
                <p className="subtitle">
                  MOVA GESTIÓN
                </p>
                <h2>Dashboard</h2>
                <p className="welcome">
                  Resumen general de tu empresa
                </p>
              </div>

              <div className="headerActions">
                <button
                  className="logoutButton"
                  onClick={cerrarSesion}
                >
                  Cerrar sesión
                </button>

                <button
                  className="newButton"
                  onClick={() =>
                    setVista('obras')
                  }
                >
                  + Nuevo
                </button>
              </div>
            </header>

            <section className="cards">
            <div className="card">
  <span>PRESUPUESTOS</span>
  <strong>{totalPresupuestosPendientes}</strong>
  <p>Presupuestos pendientes</p>
</div>

              <div className="card">
                <span>OBRAS ACTIVAS</span>
                <strong>
                  {totalObrasActivas}
                </strong>
                <p>Pendientes y en ejecución</p>
              </div>

              <div className="card">
                <span>CLIENTES</span>
                <strong>{totalClientes}</strong>
                <p>Clientes registrados</p>
              </div>

              <div className="card">
                <span>INGRESOS DEL MES</span>
                <strong>$ 0</strong>
                <p>Ingresos registrados</p>
              </div>
            </section>

            <section className="content">
              <div className="panel">
                <div className="panelTitle">
                  <div>
                    <h3>Obras recientes</h3>
                    <p>
                      Últimos trabajos registrados
                    </p>
                  </div>

                  <button
                    onClick={() =>
                      setVista('obras')
                    }
                  >
                    Ver todas
                  </button>
                </div>

                {obrasRecientes.length === 0 ? (
                  <div className="empty">
                    <span>🏠</span>
                    <h3>
                      Todavía no hay obras
                    </h3>
                    <p>
                      Las obras que agregues
                      aparecerán acá.
                    </p>
                  </div>
                ) : (
                  <div className="obrasRecientesLista">
                    {obrasRecientes.map(
                      (obra) => (
                        <div
                          className="obraRecienteItem"
                          key={obra.id}
                          role="button"
                          tabIndex={0}
                          style={{ cursor: 'pointer' }}
                          onClick={() =>
                            irAObra(obra.id)
                          }
                        >
                          <div className="obraRecienteIcono">
                            🏠
                          </div>

                          <div className="obraRecienteInfo">
                            <strong>
                              {obra.nombre_obra}
                            </strong>

                            <span>
                              {nombreCliente(
                                obra.cliente_id,
                              )}
                            </span>

                            <small>
                              {obra.localidad ||
                                'Sin localidad'}
                            </small>
                          </div>

                          <span className="obraRecienteEstado">
                            {obra.estado}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="panelTitle">
                  <div>
                    <h3>Actividad</h3>
                    <p>Últimos movimientos</p>
                  </div>
                </div>

                <div className="empty small">
                  <span>✓</span>
                  <p>
                    Todo listo para comenzar.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

export default App
