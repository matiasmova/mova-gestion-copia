import { useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { OBRA_ESTADOS } from './obraEstado'

type ClienteOpcion = {
  id: number
  nombre: string
  apellido: string | null
  direccion?: string | null
  localidad?: string | null
}

type ObraEditable = {
  id: number
  cliente_id: number
  nombre_obra: string
  direccion: string | null
  localidad: string | null
  estado: string | null
  fecha_inicio: string | null
  fecha_fin_estimada: string | null
  descripcion: string | null
  activo: boolean
}

type NuevaObraProps = {
  clientes: ClienteOpcion[]
  obra?: ObraEditable | null
  clienteInicial?: ClienteOpcion | null
  onGuardada: () => void
  onCancelar: () => void
}

function NuevaObra({
  clientes,
  obra,
  clienteInicial,
  onGuardada,
  onCancelar,
}: NuevaObraProps) {
  const [formulario, setFormulario] = useState({
    cliente_id: obra
      ? String(obra.cliente_id)
      : clienteInicial
        ? String(clienteInicial.id)
        : '',
    nombre_obra: obra?.nombre_obra ?? '',
    direccion:
      obra?.direccion ?? clienteInicial?.direccion ?? '',
    localidad:
      obra?.localidad ?? clienteInicial?.localidad ?? '',
    estado: obra?.estado ?? 'en_proceso',
    fecha_inicio: obra?.fecha_inicio ?? '',
    fecha_fin_estimada: obra?.fecha_fin_estimada ?? '',
    descripcion: obra?.descripcion ?? '',
  })

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  function actualizar(campo: string, valor: string) {
    setFormulario((anterior) => ({
      ...anterior,
      [campo]: valor,
    }))
  }

  function cambiarCliente(clienteId: string) {
    const clienteSeleccionado = clientes.find(
      (cliente) => cliente.id === Number(clienteId),
    )

    setFormulario((anterior) => ({
      ...anterior,
      cliente_id: clienteId,
      direccion: clienteSeleccionado?.direccion ?? '',
      localidad: clienteSeleccionado?.localidad ?? '',
    }))
  }

  async function guardarObra(
    evento: FormEvent<HTMLFormElement>,
  ) {
    evento.preventDefault()
    setGuardando(true)
    setError('')

    const datosObra = {
      cliente_id: Number(formulario.cliente_id),
      nombre_obra: formulario.nombre_obra.trim(),
      direccion: formulario.direccion.trim() || null,
      localidad: formulario.localidad.trim() || null,
      estado: formulario.estado,
      fecha_inicio: formulario.fecha_inicio || null,
      fecha_fin_estimada:
        formulario.fecha_fin_estimada || null,
      descripcion: formulario.descripcion.trim() || null,
    }

    const { error } = obra
      ? await supabase
          .from('obras')
          .update(datosObra)
          .eq('id', obra.id)
      : await supabase
          .from('obras')
          .insert({
            ...datosObra,
            activo: true,
          })

    if (error) {
      console.error(error)
      setError(
        obra
          ? 'No se pudieron guardar los cambios.'
          : 'No se pudo guardar la obra.',
      )
      setGuardando(false)
      return
    }

    onGuardada()
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard">
        <div className="modalHeader">
          <div>
            <p className="subtitle">
              {obra ? 'EDITAR TRABAJO' : 'NUEVO TRABAJO'}
            </p>

            <h2>
              {obra ? 'Editar obra' : 'Agregar obra'}
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

        <form className="clienteForm" onSubmit={guardarObra}>
          <div className="formGrid">
            <label>
              Cliente *
              <select
                value={formulario.cliente_id}
                onChange={(evento) =>
                  cambiarCliente(evento.target.value)
                }
                required
              >
                <option value="">Seleccionar cliente</option>

                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nombre} {cliente.apellido ?? ''}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Nombre de la obra *
              <input
                value={formulario.nombre_obra}
                onChange={(evento) =>
                  actualizar('nombre_obra', evento.target.value)
                }
                placeholder="Ej.: Casa Barzola"
                required
              />
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

            <label>
              Estado
              <select
                value={formulario.estado}
                onChange={(evento) =>
                  actualizar('estado', evento.target.value)
                }
              >
                {OBRA_ESTADOS.map((e) => (
                  <option key={e.v} value={e.v}>{e.t}</option>
                ))}
              </select>
            </label>

            <label>
              Fecha de inicio
              <input
                type="date"
                value={formulario.fecha_inicio}
                onChange={(evento) =>
                  actualizar('fecha_inicio', evento.target.value)
                }
              />
            </label>

            <label>
              Fin estimado
              <input
                type="date"
                value={formulario.fecha_fin_estimada}
                onChange={(evento) =>
                  actualizar(
                    'fecha_fin_estimada',
                    evento.target.value,
                  )
                }
              />
            </label>
          </div>

          <label>
            Descripción
            <textarea
              rows={4}
              value={formulario.descripcion}
              onChange={(evento) =>
                actualizar('descripcion', evento.target.value)
              }
              placeholder="Detalle general del trabajo..."
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

            <button
              type="submit"
              className="newButton"
              disabled={guardando}
            >
              {guardando
                ? 'Guardando...'
                : obra
                  ? 'Guardar cambios'
                  : 'Guardar obra'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default NuevaObra
