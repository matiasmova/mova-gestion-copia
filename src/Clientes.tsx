import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import NuevoCliente, {
  type ClienteParaObra,
} from './NuevoCliente'
import NuevaObra from './NuevaObra'
import ClienteFicha from './ClienteFicha'

type Cliente = {
  id: number
  nombre: string
  apellido: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  localidad: string | null
  cuit_dni: string | null
  tipo_cliente: string | null
  notas: string | null
  lat: number | null
  lng: number | null
  activo: boolean
}

type FiltroEstado = 'todos' | 'activos' | 'inactivos'

function Clientes() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [mostrarFormularioObra, setMostrarFormularioObra] =
    useState(false)
  const [clienteParaObra, setClienteParaObra] =
    useState<ClienteParaObra | null>(null)

  const [clienteEditando, setClienteEditando] =
    useState<Cliente | null>(null)
  const [fichaCliente, setFichaCliente] =
    useState<Cliente | null>(null)

  const [actualizacion, setActualizacion] = useState(0)
  const [busqueda, setBusqueda] = useState('')

  const [filtroEstado, setFiltroEstado] =
    useState<FiltroEstado>('activos')

  const clientesFiltrados = clientes.filter((cliente) => {
    const textoCliente = `
      ${cliente.nombre}
      ${cliente.apellido ?? ''}
      ${cliente.telefono ?? ''}
      ${cliente.email ?? ''}
      ${cliente.localidad ?? ''}
    `.toLowerCase()

    const coincideBusqueda = textoCliente.includes(
      busqueda.toLowerCase().trim(),
    )

    const coincideEstado =
      filtroEstado === 'todos' ||
      (filtroEstado === 'activos' && cliente.activo) ||
      (filtroEstado === 'inactivos' && !cliente.activo)

    return coincideBusqueda && coincideEstado
  })

  const clientesParaSelector = clienteParaObra
    ? clientes.some((cliente) => cliente.id === clienteParaObra.id)
      ? clientes
      : [clienteParaObra, ...clientes]
    : clientes

  useEffect(() => {
    async function cargarClientes() {
      setCargando(true)
      setError('')

      const { data, error } = await supabase
        .from('Clientes')
        .select(`
          id,
          nombre,
          apellido,
          telefono,
          email,
          direccion,
          localidad,
          cuit_dni,
          tipo_cliente,
          notas,
          lat,
          lng,
          activo
        `)
        .order('created_at', { ascending: false })

      if (error) {
        setError('No se pudieron cargar los clientes.')
        console.error(error)
      } else {
        setClientes(data ?? [])
      }

      setCargando(false)
    }

    cargarClientes()
  }, [actualizacion])

  function cerrarFormulario() {
    setMostrarFormulario(false)
    setClienteEditando(null)
  }

  function clienteGuardado() {
    cerrarFormulario()
    setActualizacion((valor) => valor + 1)
  }

  function abrirNuevaObra(cliente: ClienteParaObra) {
    setClienteParaObra(cliente)
    setMostrarFormulario(false)
    setClienteEditando(null)
    setMostrarFormularioObra(true)
  }

  function clienteGuardadoYCrearObra(cliente: ClienteParaObra) {
    setActualizacion((valor) => valor + 1)
    abrirNuevaObra(cliente)
  }

  function cerrarFormularioObra() {
    setMostrarFormularioObra(false)
    setClienteParaObra(null)
  }

  function obraGuardada() {
    cerrarFormularioObra()
    window.alert('Cliente y obra guardados correctamente.')
  }

  async function cambiarEstado(cliente: Cliente) {
    const accion = cliente.activo ? 'desactivar' : 'activar'

    const confirmar = window.confirm(
      `¿Querés ${accion} a ${cliente.nombre} ${
        cliente.apellido ?? ''
      }?`,
    )

    if (!confirmar) return

    const { error } = await supabase
      .from('Clientes')
      .update({ activo: !cliente.activo })
      .eq('id', cliente.id)

    if (error) {
      console.error(error)
      window.alert('No se pudo cambiar el estado del cliente.')
      return
    }

    setActualizacion((valor) => valor + 1)
  }

  return (
    <div className="clientesPage">
      <div className="pageHeader">
        <div>
          <p className="subtitle">GESTIÓN COMERCIAL</p>
          <h2>Clientes</h2>
          <p className="welcome">
            Personas y empresas registradas
          </p>
        </div>

        <button
          className="newButton"
          onClick={() => {
            setClienteEditando(null)
            setMostrarFormulario(true)
          }}
        >
          + Nuevo cliente
        </button>
      </div>

      <div className="clientesToolbar">
        <input
          type="search"
          placeholder="Buscar por nombre, teléfono o correo..."
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
        />

        <select
          value={filtroEstado}
          onChange={(evento) =>
            setFiltroEstado(evento.target.value as FiltroEstado)
          }
        >
          <option value="activos">Clientes activos</option>
          <option value="inactivos">Clientes inactivos</option>
          <option value="todos">Todos los clientes</option>
        </select>
      </div>

      <div className="clientesPanel">
        {cargando && <p>Cargando clientes...</p>}

        {error && <p className="loginError">{error}</p>}

        {!cargando &&
          !error &&
          clientesFiltrados.length === 0 && (
            <div className="empty">
              <span>🔍</span>
              <h3>No encontramos clientes</h3>
              <p>
                Probá con otra búsqueda o cambiá el filtro.
              </p>
            </div>
          )}

        {!cargando && clientesFiltrados.length > 0 && (
          <div className="clientesList">
            {clientesFiltrados.map((cliente) => (
              <div className="clienteItem" key={cliente.id}>
                <div className="clienteAvatar">
                  {cliente.nombre.charAt(0).toUpperCase()}
                </div>

                <div
                  className="clienteInfo clienteInfoClick"
                  onClick={() => setFichaCliente(cliente)}
                  title="Ver ficha del cliente"
                >
                  <strong>
                    {cliente.nombre} {cliente.apellido}
                  </strong>

                  <span>
                    {cliente.telefono || 'Sin teléfono'}
                  </span>

                  <small>
                    {cliente.email ||
                      cliente.localidad ||
                      'Sin información adicional'}
                  </small>
                </div>

                <div className="clienteActions">
                  <span
                    className={
                      cliente.activo
                        ? 'estadoActivo'
                        : 'estadoInactivo'
                    }
                  >
                    {cliente.activo ? 'Activo' : 'Inactivo'}
                  </span>

                  <button
                    className="editButton"
                    onClick={() => setFichaCliente(cliente)}
                  >
                    Ver
                  </button>

                  <button
                    className="editButton"
                    onClick={() => abrirNuevaObra(cliente)}
                    disabled={!cliente.activo}
                  >
                    + Obra
                  </button>

                  <button
                    className="editButton"
                    onClick={() => {
                      setClienteEditando(cliente)
                      setMostrarFormulario(true)
                    }}
                  >
                    Editar
                  </button>

                  <button
                    className={
                      cliente.activo
                        ? 'deactivateButton'
                        : 'activateButton'
                    }
                    onClick={() => cambiarEstado(cliente)}
                  >
                    {cliente.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {mostrarFormulario && (
        <NuevoCliente
          cliente={clienteEditando}
          onCancelar={cerrarFormulario}
          onGuardado={clienteGuardado}
          onGuardarYCrearObra={clienteGuardadoYCrearObra}
        />
      )}

      {mostrarFormularioObra && clienteParaObra && (
        <NuevaObra
          clientes={clientesParaSelector}
          clienteInicial={clienteParaObra}
          onCancelar={cerrarFormularioObra}
          onGuardada={obraGuardada}
        />
      )}

      {fichaCliente && (
        <ClienteFicha
          cliente={fichaCliente}
          onCerrar={() => setFichaCliente(null)}
          onEditar={() => {
            setClienteEditando(fichaCliente)
            setMostrarFormulario(true)
            setFichaCliente(null)
          }}
          onNuevaObra={() => {
            const c = fichaCliente
            setFichaCliente(null)
            abrirNuevaObra(c)
          }}
        />
      )}
    </div>
  )
}

export default Clientes
