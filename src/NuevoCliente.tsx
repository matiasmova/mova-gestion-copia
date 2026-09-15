import { useState, type FormEvent } from 'react'
import { supabase } from './supabase'

type ClienteEditable = {
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
}

export type ClienteParaObra = {
  id: number
  nombre: string
  apellido: string | null
  direccion: string | null
  localidad: string | null
}

type NuevoClienteProps = {
  cliente?: ClienteEditable | null
  onGuardado: () => void
  onGuardarYCrearObra?: (cliente: ClienteParaObra) => void
  onCancelar: () => void
}

function NuevoCliente({
  cliente,
  onGuardado,
  onGuardarYCrearObra,
  onCancelar,
}: NuevoClienteProps) {
  const [formulario, setFormulario] = useState({
    nombre: cliente?.nombre ?? '',
    apellido: cliente?.apellido ?? '',
    telefono: cliente?.telefono ?? '',
    email: cliente?.email ?? '',
    direccion: cliente?.direccion ?? '',
    localidad: cliente?.localidad ?? '',
    cuit_dni: cliente?.cuit_dni ?? '',
    tipo_cliente: cliente?.tipo_cliente ?? 'Particular',
    notas: cliente?.notas ?? '',
    lat: cliente?.lat != null ? String(cliente.lat) : '',
    lng: cliente?.lng != null ? String(cliente.lng) : '',
  })

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  function actualizar(campo: string, valor: string) {
    setFormulario((anterior) => ({
      ...anterior,
      [campo]: valor,
    }))
  }

  function usarMiUbicacion() {
    if (!navigator.geolocation) {
      setError('Tu navegador no permite obtener la ubicación.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        setFormulario((anterior) => ({
          ...anterior,
          lat: posicion.coords.latitude.toFixed(6),
          lng: posicion.coords.longitude.toFixed(6),
        }))
      },
      () =>
        setError(
          'No pudimos obtener tu ubicación. Podés cargarla manualmente.',
        ),
    )
  }

  async function guardarCliente(
    evento: FormEvent<HTMLFormElement>,
  ) {
    evento.preventDefault()
    setGuardando(true)
    setError('')

    const botonPresionado = (
      evento.nativeEvent as SubmitEvent
    ).submitter as HTMLButtonElement | null

    const crearObraDespues =
      botonPresionado?.value === 'crear-obra'

    const datosCliente = {
      nombre: formulario.nombre.trim(),
      apellido: formulario.apellido.trim() || null,
      telefono: formulario.telefono.trim() || null,
      email: formulario.email.trim() || null,
      direccion: formulario.direccion.trim() || null,
      localidad: formulario.localidad.trim() || null,
      cuit_dni: formulario.cuit_dni.trim() || null,
      tipo_cliente: formulario.tipo_cliente,
      notas: formulario.notas.trim() || null,
      lat: formulario.lat ? Number(formulario.lat) : null,
      lng: formulario.lng ? Number(formulario.lng) : null,
    }

    if (cliente) {
      const { error: errorActualizar } = await supabase
        .from('Clientes')
        .update(datosCliente)
        .eq('id', cliente.id)

      if (errorActualizar) {
        console.error(errorActualizar)
        setError('No se pudieron guardar los cambios.')
        setGuardando(false)
        return
      }

      onGuardado()
      return
    }

    const { data, error: errorCrear } = await supabase
      .from('Clientes')
      .insert({
        ...datosCliente,
        activo: true,
      })
      .select('id, nombre, apellido, direccion, localidad')
      .single()

    if (errorCrear || !data) {
      console.error(errorCrear)
      setError('No se pudo guardar el cliente.')
      setGuardando(false)
      return
    }

    if (crearObraDespues && onGuardarYCrearObra) {
      onGuardarYCrearObra(data as ClienteParaObra)
      return
    }

    onGuardado()
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard">
        <div className="modalHeader">
          <div>
            <p className="subtitle">
              {cliente ? 'EDITAR REGISTRO' : 'NUEVO REGISTRO'}
            </p>

            <h2>
              {cliente ? 'Editar cliente' : 'Agregar cliente'}
            </h2>
          </div>

          <button
            type="button"
            className="closeButton"
            onClick={onCancelar}
          >
            ×
          </button>
        </div>

        <form className="clienteForm" onSubmit={guardarCliente}>
          <div className="formGrid">
            <label>
              Nombre *
              <input
                value={formulario.nombre}
                onChange={(evento) =>
                  actualizar('nombre', evento.target.value)
                }
                required
              />
            </label>

            <label>
              Apellido
              <input
                value={formulario.apellido}
                onChange={(evento) =>
                  actualizar('apellido', evento.target.value)
                }
              />
            </label>

            <label>
              Teléfono
              <input
                value={formulario.telefono}
                onChange={(evento) =>
                  actualizar('telefono', evento.target.value)
                }
              />
            </label>

            <label>
              Correo electrónico
              <input
                type="email"
                value={formulario.email}
                onChange={(evento) =>
                  actualizar('email', evento.target.value)
                }
              />
            </label>

            <label>
              DNI o CUIT
              <input
                value={formulario.cuit_dni}
                onChange={(evento) =>
                  actualizar('cuit_dni', evento.target.value)
                }
              />
            </label>

            <label>
              Tipo de cliente
              <select
                value={formulario.tipo_cliente}
                onChange={(evento) =>
                  actualizar('tipo_cliente', evento.target.value)
                }
              >
                <option>Particular</option>
                <option>Empresa</option>
                <option>Consorcio</option>
              </select>
            </label>

            <label>
              Dirección
              <input
                value={formulario.direccion}
                onChange={(evento) =>
                  actualizar('direccion', evento.target.value)
                }
              />
            </label>

            <label>
              Localidad
              <input
                value={formulario.localidad}
                onChange={(evento) =>
                  actualizar('localidad', evento.target.value)
                }
              />
            </label>
          </div>

          <div className="ubicacionSeccion">
            <div className="ubicacionHeader">
              <span>📍 Ubicación georreferenciada</span>
              <button
                type="button"
                className="ubicacionBtn"
                onClick={usarMiUbicacion}
              >
                Usar mi ubicación
              </button>
            </div>
            <div className="ubicacionInputs">
              <input
                placeholder="Latitud (ej.: -32.889)"
                value={formulario.lat}
                onChange={(evento) => actualizar('lat', evento.target.value)}
              />
              <input
                placeholder="Longitud (ej.: -68.845)"
                value={formulario.lng}
                onChange={(evento) => actualizar('lng', evento.target.value)}
              />
            </div>
            {formulario.lat && formulario.lng && (
              <iframe
                title="Ubicación del cliente"
                className="ubicacionMapa"
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(formulario.lng) - 0.008}%2C${Number(formulario.lat) - 0.008}%2C${Number(formulario.lng) + 0.008}%2C${Number(formulario.lat) + 0.008}&layer=mapnik&marker=${formulario.lat}%2C${formulario.lng}`}
              />
            )}
          </div>

          <label>
            Notas
            <textarea
              rows={3}
              value={formulario.notas}
              onChange={(evento) =>
                actualizar('notas', evento.target.value)
              }
            />
          </label>

          {error && <p className="loginError">{error}</p>}

          <div className="formActions">
            <button
              type="button"
              className="cancelButton"
              onClick={onCancelar}
            >
              Cancelar
            </button>

            {!cliente && onGuardarYCrearObra && (
              <button
                type="submit"
                className="secondaryButton"
                value="guardar"
                disabled={guardando}
              >
                Guardar cliente
              </button>
            )}

            <button
              type="submit"
              className="newButton"
              value={cliente ? 'guardar' : 'crear-obra'}
              disabled={guardando}
            >
              {guardando
                ? 'Guardando...'
                : cliente
                  ? 'Guardar cambios'
                  : 'Guardar y crear obra'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default NuevoCliente
