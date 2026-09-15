import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import NuevoPresupuesto, {
  type ClienteOpcion,
  type ItemPresupuesto,
  type ObraOpcion,
  type PresupuestoEditable,
} from './NuevoPresupuesto'
import PresupuestoPDF from './PresupuestoPDF'

type PresupuestoCompleto = PresupuestoEditable & {
  created_at: string
  subtotal: number
  total: number
  saldo: number
  activo: boolean
}

type EstadoFiltro =
  | 'todos'
  | 'pendiente'
  | 'aceptado'
  | 'rechazado'

function Presupuestos() {
  const [presupuestos, setPresupuestos] = useState<
    PresupuestoCompleto[]
  >([])
  const [clientes, setClientes] = useState<ClienteOpcion[]>([])
  const [obras, setObras] = useState<ObraOpcion[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [estadoFiltro, setEstadoFiltro] =
    useState<EstadoFiltro>('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mostrarFormulario, setMostrarFormulario] =
    useState(false)
  const [presupuestoEditado, setPresupuestoEditado] =
    useState<PresupuestoCompleto | null>(null)
  const [pdfPresupuesto, setPdfPresupuesto] =
    useState<PresupuestoCompleto | null>(null)

  useEffect(() => {
    cargarDatos()
  }, [])

  async function cargarDatos() {
    setCargando(true)
    setError('')

    const [
      resultadoPresupuestos,
      resultadoItems,
      resultadoClientes,
      resultadoObras,
    ] = await Promise.all([
      supabase
        .from('presupuestos')
        .select(
          `
            id,
            created_at,
            cliente_id,
            obra_id,
            titulo,
            descripcion,
            fecha,
            validez_dias,
            estado,
            etapa_trabajo,
            subtotal,
            descuento,
            total,
            total_pagado,
            saldo,
            notas,
            activo
          `,
        )
        .eq('activo', true)
        .order('created_at', { ascending: false }),

      supabase
        .from('presupuesto_items')
        .select(
          `
            id,
            presupuesto_id,
            catalogo_id,
            tipo,
            descripcion,
            cantidad,
            precio_unitario,
            costo_unitario,
            orden
          `,
        )
        .order('orden', { ascending: true }),

      supabase
        .from('Clientes')
        .select('id, nombre, apellido')
        .order('nombre', { ascending: true }),

      supabase
        .from('obras')
        .select('id, cliente_id, nombre_obra')
        .order('nombre_obra', { ascending: true }),
    ])

    const algunError =
      resultadoPresupuestos.error ||
      resultadoItems.error ||
      resultadoClientes.error ||
      resultadoObras.error

    if (algunError) {
      console.error(algunError)
      setError('No se pudieron cargar los presupuestos.')
      setCargando(false)
      return
    }

    const clientesCargados =
      (resultadoClientes.data ?? []) as ClienteOpcion[]

    const obrasCargadas =
      (resultadoObras.data ?? []) as ObraOpcion[]

    const itemsCargados = (resultadoItems.data ?? []) as Array<
      ItemPresupuesto & {
        presupuesto_id: number
        orden: number
      }
    >

    const presupuestosCargados = (
      resultadoPresupuestos.data ?? []
    ).map((presupuesto) => ({
      ...presupuesto,
      subtotal: Number(presupuesto.subtotal),
      descuento: Number(presupuesto.descuento),
      total: Number(presupuesto.total),
      total_pagado: Number(presupuesto.total_pagado),
      saldo: Number(presupuesto.saldo),
      items: itemsCargados
        .filter(
          (item) =>
            item.presupuesto_id === presupuesto.id,
        )
        .map((item) => ({
          id: item.id,
          catalogo_id: item.catalogo_id ?? null,
          tipo: item.tipo,
          descripcion: item.descripcion,
          cantidad: Number(item.cantidad),
          precio_unitario: Number(item.precio_unitario),
          costo_unitario: Number(item.costo_unitario),
        })),
    })) as PresupuestoCompleto[]

    setClientes(clientesCargados)
    setObras(obrasCargadas)
    setPresupuestos(presupuestosCargados)
    setCargando(false)
  }

  const presupuestosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()

    return presupuestos.filter((presupuesto) => {
      const cliente = clientes.find(
        (item) => item.id === presupuesto.cliente_id,
      )

      const obra = obras.find(
        (item) => item.id === presupuesto.obra_id,
      )

      const nombreCliente =
        `${cliente?.nombre ?? ''} ${cliente?.apellido ?? ''}`.toLowerCase()

      const coincideBusqueda =
        !texto ||
        presupuesto.titulo.toLowerCase().includes(texto) ||
        nombreCliente.includes(texto) ||
        (obra?.nombre_obra ?? '')
          .toLowerCase()
          .includes(texto)

      const coincideEstado =
        estadoFiltro === 'todos' ||
        presupuesto.estado === estadoFiltro

      return coincideBusqueda && coincideEstado
    })
  }, [
    presupuestos,
    clientes,
    obras,
    busqueda,
    estadoFiltro,
  ])

  function abrirNuevoPresupuesto() {
    setPresupuestoEditado(null)
    setMostrarFormulario(true)
  }

  function editarPresupuesto(
    presupuesto: PresupuestoCompleto,
  ) {
    setPresupuestoEditado(presupuesto)
    setMostrarFormulario(true)
  }

  function cerrarFormulario() {
    setMostrarFormulario(false)
    setPresupuestoEditado(null)
  }

  async function presupuestoGuardado() {
    cerrarFormulario()
    await cargarDatos()
  }

  async function cambiarEstado(
    presupuesto: PresupuestoCompleto,
    nuevoEstado:
      | 'pendiente'
      | 'aceptado'
      | 'rechazado',
  ) {
    const { error: errorActualizacion } = await supabase
      .from('presupuestos')
      .update({ estado: nuevoEstado })
      .eq('id', presupuesto.id)

    if (errorActualizacion) {
      console.error(errorActualizacion)
      window.alert(
        'No se pudo modificar el estado del presupuesto.',
      )
      return
    }

    setPresupuestos((actuales) =>
      actuales.map((item) =>
        item.id === presupuesto.id
          ? { ...item, estado: nuevoEstado }
          : item,
      ),
    )
  }

  function nombreCliente(clienteId: number) {
    const cliente = clientes.find(
      (item) => item.id === clienteId,
    )

    if (!cliente) return 'Cliente no encontrado'

    return `${cliente.nombre} ${cliente.apellido ?? ''}`.trim()
  }

  function nombreObra(obraId: number | null) {
    if (!obraId) return 'Sin obra asociada'

    return (
      obras.find((item) => item.id === obraId)
        ?.nombre_obra ?? 'Obra no encontrada'
    )
  }

  function formatoDinero(valor: number) {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2,
    }).format(Number(valor || 0))
  }

  function formatoFecha(fecha: string) {
    return new Intl.DateTimeFormat('es-AR').format(
      new Date(`${fecha}T12:00:00`),
    )
  }

  function etiquetaEtapa(etapa: string) {
    if (etapa === 'en_proceso') return 'En proceso'
    if (etapa === 'finalizado') return 'Finalizado'
    return 'Sin iniciar'
  }

  return (
    <div className="presupuestosPage">
      <div className="pageHeader">
        <div>
          <p className="subtitle">GESTIÓN COMERCIAL</p>
          <h2>Presupuestos</h2>
          <p className="welcome">
            Propuestas, trabajos y seguimiento de pagos
          </p>
        </div>

        <button
          className="newButton"
          onClick={abrirNuevoPresupuesto}
        >
          + Nuevo presupuesto
        </button>
      </div>

      <div className="presupuestoFiltros">
        <input
          type="search"
          value={busqueda}
          onChange={(evento) =>
            setBusqueda(evento.target.value)
          }
          placeholder="Buscar por título, cliente u obra..."
        />

        <select
          value={estadoFiltro}
          onChange={(evento) =>
            setEstadoFiltro(
              evento.target.value as EstadoFiltro,
            )
          }
        >
          <option value="todos">Todos los estados</option>
          <option value="pendiente">Pendientes</option>
          <option value="aceptado">Aceptados</option>
          <option value="rechazado">Rechazados</option>
        </select>
      </div>

      {cargando && (
        <div className="presupuestosPanel">
          <p>Cargando presupuestos...</p>
        </div>
      )}

      {error && (
        <div className="presupuestosPanel">
          <p className="loginError">{error}</p>
        </div>
      )}

      {!cargando &&
        !error &&
        presupuestosFiltrados.length === 0 && (
          <div className="presupuestosPanel">
            <div className="empty">
              <span>📄</span>
              <h3>Todavía no hay presupuestos</h3>
              <p>
                Los presupuestos que agregues aparecerán acá.
              </p>
            </div>
          </div>
        )}

      {!cargando &&
        !error &&
        presupuestosFiltrados.length > 0 && (
          <div className="presupuestosList">
            {presupuestosFiltrados.map(
              (presupuesto) => (
                <article
                  className="presupuestoCard"
                  key={presupuesto.id}
                >
                  <div className="presupuestoCardPrincipal">
                    <div className="presupuestoIcono">
                      📄
                    </div>

                    <div className="presupuestoInfo">
                      <small>
                        PRESUPUESTO #
                        {presupuesto.id
                          .toString()
                          .padStart(4, '0')}
                      </small>

                      <h3>{presupuesto.titulo}</h3>

                      <strong>
                        {nombreCliente(
                          presupuesto.cliente_id,
                        )}
                      </strong>

                      <span>
                        {nombreObra(presupuesto.obra_id)}
                      </span>

                      <span>
                        Fecha: {formatoFecha(presupuesto.fecha)}
                      </span>
                    </div>
                  </div>

                  <div className="presupuestoEstado">
                    <select
                      className={`estadoPresupuesto ${presupuesto.estado}`}
                      value={presupuesto.estado}
                      onChange={(evento) =>
                        cambiarEstado(
                          presupuesto,
                          evento.target.value as
                            | 'pendiente'
                            | 'aceptado'
                            | 'rechazado',
                        )
                      }
                    >
                      <option value="pendiente">
                        Pendiente
                      </option>
                      <option value="aceptado">
                        Aceptado
                      </option>
                      <option value="rechazado">
                        Rechazado
                      </option>
                    </select>

                    <span className="etapaPresupuesto">
                      {etiquetaEtapa(
                        presupuesto.etapa_trabajo,
                      )}
                    </span>
                  </div>

                  <div className="presupuestoMontos">
                    <div>
                      <span>Total</span>
                      <strong>
                        {formatoDinero(presupuesto.total)}
                      </strong>
                    </div>

                    <div>
                      <span>Pagado</span>
                      <strong>
                        {formatoDinero(
                          presupuesto.total_pagado,
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>Saldo</span>
                      <strong>
                        {formatoDinero(presupuesto.saldo)}
                      </strong>
                    </div>
                  </div>

                  <div className="presupuestoAcciones">
                    <span>
                      {presupuesto.items.length}{' '}
                      {presupuesto.items.length === 1
                        ? 'ítem'
                        : 'ítems'}
                    </span>

                    <button
                      className="editButton"
                      onClick={() =>
                        setPdfPresupuesto(presupuesto)
                      }
                    >
                      📄 PDF
                    </button>

                    <button
                      className="editButton"
                      onClick={() =>
                        editarPresupuesto(presupuesto)
                      }
                    >
                      Editar
                    </button>
                  </div>
                </article>
              ),
            )}
          </div>
        )}

      {mostrarFormulario && (
        <NuevoPresupuesto
          clientes={clientes}
          obras={obras}
          presupuesto={presupuestoEditado}
          onCancelar={cerrarFormulario}
          onGuardado={presupuestoGuardado}
        />
      )}

      {pdfPresupuesto && (
        <PresupuestoPDF
          presupuesto={pdfPresupuesto}
          cliente={nombreCliente(pdfPresupuesto.cliente_id)}
          obra={nombreObra(pdfPresupuesto.obra_id)}
          onCerrar={() => setPdfPresupuesto(null)}
        />
      )}

    </div>
  )
}

export default Presupuestos
