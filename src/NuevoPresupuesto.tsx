import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import {
  descuentoItem,
  descuentoItems,
  importeBruto,
  importeNeto,
  pctItem,
  redondear,
} from './presupuestoCalculos'

export type ClienteOpcion = {
  id: number
  nombre: string
  apellido: string | null
}

export type ObraOpcion = {
  id: number
  cliente_id: number
  nombre_obra: string
}

export type ItemPresupuesto = {
  id?: number
  catalogo_id?: number | null
  tipo: 'producto' | 'servicio'
  descripcion: string
  cantidad: number
  precio_unitario: number
  costo_unitario: number
  // Descuento propio del ítem, en % (0 a 100).
  descuento_pct?: number
}

type ProductoServicio = {
  id: number
  tipo: 'producto' | 'servicio'
  nombre: string
  descripcion: string | null
  unidad: string
  precio_venta: number
  costo_unitario: number
}

export type PresupuestoEditable = {
  id: number
  cliente_id: number
  obra_id: number | null
  titulo: string
  descripcion: string | null
  fecha: string
  validez_dias: number
  estado: string
  etapa_trabajo: 'sin_iniciar' | 'en_proceso' | 'finalizado'
  // Total de descuentos guardados (descuentos por ítem + bonificación general).
  descuento: number
  total_pagado: number
  notas: string | null
  items: ItemPresupuesto[]
}

type Props = {
  clientes: ClienteOpcion[]
  obras: ObraOpcion[]
  presupuesto?: PresupuestoEditable | null
  onGuardado: () => void
  onCancelar: () => void
}

const itemVacio: ItemPresupuesto = {
  catalogo_id: null,
  tipo: 'servicio',
  descripcion: '',
  cantidad: 1,
  precio_unitario: 0,
  costo_unitario: 0,
  descuento_pct: 0,
}

function NuevoPresupuesto({
  clientes,
  obras,
  presupuesto,
  onGuardado,
  onCancelar,
}: Props) {
  const [clienteId, setClienteId] = useState(
    presupuesto?.cliente_id.toString() ?? '',
  )
  const [obraId, setObraId] = useState(
    presupuesto?.obra_id?.toString() ?? '',
  )
  const [titulo, setTitulo] = useState(presupuesto?.titulo ?? '')
  const [descripcion, setDescripcion] = useState(
    presupuesto?.descripcion ?? '',
  )
  const [fecha, setFecha] = useState(
    presupuesto?.fecha ?? new Date().toISOString().slice(0, 10),
  )
  const [validezDias, setValidezDias] = useState(
    presupuesto?.validez_dias ?? 15,
  )
  const [estado, setEstado] = useState<string>(
    presupuesto?.estado ?? 'borrador',
  )

  // Bonificación general adicional: lo guardado menos lo que suman
  // los descuentos por ítem.
  const [descuento, setDescuento] = useState(() =>
    redondear(
      Math.max(
        (presupuesto?.descuento ?? 0) -
          descuentoItems(presupuesto?.items ?? []),
        0,
      ),
    ),
  )
  const [descuentoTipo, setDescuentoTipo] = useState<'monto' | 'porcentaje'>('monto')
  const totalPagado = presupuesto?.total_pagado ?? 0
  const [notas, setNotas] = useState(presupuesto?.notas ?? '')
  const [items, setItems] = useState<ItemPresupuesto[]>(
    presupuesto?.items.length
      ? presupuesto.items
      : [{ ...itemVacio }],
  )
  const [catalogo, setCatalogo] = useState<ProductoServicio[]>([])
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function cargarCatalogo() {
      const { data, error: errorCatalogo } = await supabase
        .from('productos_servicios')
        .select(
          'id, tipo, nombre, descripcion, unidad, precio_venta, costo_unitario',
        )
        .eq('activo', true)
        .order('tipo')
        .order('nombre')

      if (errorCatalogo) {
        console.error(errorCatalogo)
        setError('No se pudo cargar la lista de productos y servicios.')
      } else {
        setCatalogo((data ?? []) as ProductoServicio[])
      }

      setCargandoCatalogo(false)
    }

    cargarCatalogo()
  }, [])

  const obrasDisponibles = obras.filter(
    (obra) => Number(obra.cliente_id) === Number(clienteId),
  )

  function cambiarCliente(nuevoClienteId: string) {
    setClienteId(nuevoClienteId)

    const obrasDelCliente = obras.filter(
      (obra) =>
        Number(obra.cliente_id) === Number(nuevoClienteId),
    )

    if (obrasDelCliente.length === 1) {
      setObraId(obrasDelCliente[0].id.toString())
    } else {
      setObraId('')
    }
  }

  // Subtotal a precio de lista (sin descuentos).
  const subtotal = useMemo(
    () =>
      items.reduce(
        (acumulado, item) => acumulado + importeBruto(item),
        0,
      ),
    [items],
  )

  // Suma de los descuentos propios de cada ítem.
  const descuentoPorItems = useMemo(
    () => descuentoItems(items),
    [items],
  )

  // La bonificación general puede ingresarse en $ o en % (se calcula sobre
  // lo que queda después de los descuentos por ítem).
  const descuentoGeneral = Math.min(
    descuentoTipo === 'porcentaje'
      ? redondear(
          (subtotal - descuentoPorItems) *
            (Number(descuento || 0) / 100),
        )
      : Number(descuento || 0),
    Math.max(subtotal - descuentoPorItems, 0),
  )

  // Siempre se guarda un único monto en $ con todos los descuentos.
  const descuentoTotal = redondear(descuentoPorItems + descuentoGeneral)
  const total = Math.max(subtotal - descuentoTotal, 0)
  const saldo = Math.max(total - Number(totalPagado || 0), 0)

  function actualizarItem(
    indice: number,
    campo: keyof ItemPresupuesto,
    valor: string | number | null,
  ) {
    setItems((actuales) =>
      actuales.map((item, posicion) =>
        posicion === indice
          ? { ...item, [campo]: valor }
          : item,
      ),
    )
  }

  function agregarItem() {
    setItems((actuales) => [...actuales, { ...itemVacio }])
  }

  function seleccionarDelCatalogo(indice: number, valor: string) {
    if (!valor) {
      actualizarItem(indice, 'catalogo_id', null)
      return
    }

    const seleccionado = catalogo.find(
      (producto) => producto.id === Number(valor),
    )

    if (!seleccionado) return

    const descripcionCompleta = seleccionado.descripcion?.trim()
      ? `${seleccionado.nombre} — ${seleccionado.descripcion.trim()}`
      : seleccionado.nombre

    setItems((actuales) =>
      actuales.map((item, posicion) =>
        posicion === indice
          ? {
              ...item,
              catalogo_id: seleccionado.id,
              tipo: seleccionado.tipo,
              descripcion: descripcionCompleta,
              precio_unitario: Number(seleccionado.precio_venta),
              costo_unitario: Number(seleccionado.costo_unitario),
            }
          : item,
      ),
    )
  }

  function eliminarItem(indice: number) {
    setItems((actuales) =>
      actuales.length === 1
        ? [{ ...itemVacio }]
        : actuales.filter((_, posicion) => posicion !== indice),
    )
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setError('')

    const itemsValidos = items.filter(
      (item) => item.descripcion.trim() !== '',
    )

    if (!clienteId) {
      setError('Seleccioná un cliente.')
      return
    }

    if (!titulo.trim()) {
      setError('Ingresá un título para el presupuesto.')
      return
    }

    if (itemsValidos.length === 0) {
      setError('Agregá por lo menos un producto o servicio.')
      return
    }

    setGuardando(true)

    // Solo cuentan los descuentos de los ítems que se guardan.
    const descuentoItemsValidos = descuentoItems(itemsValidos)
    const descuentoAGuardar = redondear(
      descuentoItemsValidos +
        Math.min(
          descuentoGeneral,
          Math.max(
            itemsValidos.reduce(
              (suma, item) => suma + importeBruto(item),
              0,
            ) - descuentoItemsValidos,
            0,
          ),
        ),
    )

    const datosPresupuesto = {
      cliente_id: Number(clienteId),
      obra_id: obraId ? Number(obraId) : null,
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      fecha,
      validez_dias: Number(validezDias),
      estado,
      descuento: descuentoAGuardar,
      // La etapa del trabajo se maneja desde Presupuestos: al editar no se toca.
      ...(!presupuesto && { total_pagado: 0, etapa_trabajo: 'sin_iniciar' }),
      notas: notas.trim() || null,
      activo: true,
    }

    let presupuestoId = presupuesto?.id

    if (presupuestoId) {
      const { error: errorPresupuesto } = await supabase
        .from('presupuestos')
        .update(datosPresupuesto)
        .eq('id', presupuestoId)

      if (errorPresupuesto) {
        console.error(errorPresupuesto)
        setError('No se pudo actualizar el presupuesto.')
        setGuardando(false)
        return
      }

      const { error: errorEliminar } = await supabase
        .from('presupuesto_items')
        .delete()
        .eq('presupuesto_id', presupuestoId)

      if (errorEliminar) {
        console.error(errorEliminar)
        setError('No se pudieron actualizar los ítems.')
        setGuardando(false)
        return
      }
    } else {
      const { data, error: errorPresupuesto } = await supabase
        .from('presupuestos')
        .insert(datosPresupuesto)
        .select('id')
        .single()

      if (errorPresupuesto || !data) {
        console.error(errorPresupuesto)
        setError('No se pudo crear el presupuesto.')
        setGuardando(false)
        return
      }

      presupuestoId = data.id
    }

    const nuevosItems = itemsValidos.map((item, indice) => ({
      presupuesto_id: presupuestoId,
      catalogo_id: item.catalogo_id ?? null,
      tipo: item.tipo,
      descripcion: item.descripcion.trim(),
      cantidad: Number(item.cantidad),
      precio_unitario: Number(item.precio_unitario),
      costo_unitario: Number(item.costo_unitario),
      descuento_pct: pctItem(item),
      orden: indice,
    }))

    const { error: errorItems } = await supabase
      .from('presupuesto_items')
      .insert(nuevosItems)

    if (errorItems) {
      console.error(errorItems)
      setError('El presupuesto se guardó, pero hubo un error con los ítems.')
      setGuardando(false)
      return
    }

    setGuardando(false)
    onGuardado()
  }

  function formatoDinero(valor: number) {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(valor)
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard presupuestoModal">
        <div className="modalHeader">
          <div>
            <p className="subtitle">GESTIÓN COMERCIAL</p>
            <h2>
              {presupuesto
                ? 'Editar presupuesto'
                : 'Nuevo presupuesto'}
            </h2>
          </div>

          <button
            type="button"
            className="modalClose"
            onClick={onCancelar}
          >
            ×
          </button>
        </div>

        <form className="presupuestoForm" onSubmit={guardar}>
          <div className="formGrid">
            <label>
              Cliente *
              <select
                value={clienteId}
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
              Obra
              <select
                value={obraId}
                onChange={(evento) => setObraId(evento.target.value)}
                disabled={!clienteId}
              >
                <option value="">Sin obra asociada</option>

                {obrasDisponibles.map((obra) => (
                  <option key={obra.id} value={obra.id}>
                    {obra.nombre_obra}
                  </option>
                ))}
              </select>
            </label>

            <label className="formFull">
              Título del presupuesto *
              <input
                value={titulo}
                onChange={(evento) => setTitulo(evento.target.value)}
                placeholder="Ej.: Instalación domótica integral"
                required
              />
            </label>

            <label className="formFull">
              Descripción general
              <textarea
                value={descripcion}
                onChange={(evento) =>
                  setDescripcion(evento.target.value)
                }
                placeholder="Descripción general del trabajo..."
              />
            </label>

            <label>
              Fecha
              <input
                type="date"
                value={fecha}
                onChange={(evento) => setFecha(evento.target.value)}
                required
              />
            </label>

            <label>
              Validez en días
              <input
                type="number"
                min="1"
                value={validezDias}
                onChange={(evento) =>
                  setValidezDias(Number(evento.target.value))
                }
              />
            </label>

            <label>
              Estado
              <select
                value={estado}
                onChange={(evento) => setEstado(evento.target.value)}
              >
                <option value="borrador">Borrador</option>
                <option value="enviado">Enviado</option>
                <option value="aceptado">Aceptado</option>
                <option value="rechazado">Rechazado</option>
              </select>
            </label>
          </div>

          <div className="itemsHeader">
            <div>
              <h3>Productos y servicios</h3>
              <p>Agregá todos los conceptos del presupuesto.</p>
            </div>

            <button
              type="button"
              className="secondaryButton"
              onClick={agregarItem}
            >
              + Agregar ítem
            </button>
          </div>

          <div className="presupuestoItems">
            {items.map((item, indice) => (
              <div className="presupuestoItem" key={indice}>
                <label className="itemCampo itemCatalogo">
                  <span>Producto o servicio</span>
                  <select
                    value={item.catalogo_id ?? ''}
                    onChange={(evento) =>
                      seleccionarDelCatalogo(indice, evento.target.value)
                    }
                    disabled={cargandoCatalogo}
                  >
                    <option value="">
                      {cargandoCatalogo
                        ? 'Cargando lista...'
                        : 'Carga manual'}
                    </option>

                    {catalogo.map((producto) => (
                      <option key={producto.id} value={producto.id}>
                        {producto.nombre} ({producto.unidad})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="itemCampo">
                  <span>Tipo</span>
                  <select
                    value={item.tipo}
                    onChange={(evento) =>
                      actualizarItem(
                        indice,
                        'tipo',
                        evento.target.value as
                          | 'producto'
                          | 'servicio',
                      )
                    }
                  >
                    <option value="servicio">Servicio</option>
                    <option value="producto">Producto</option>
                  </select>
                </label>

                <label className="itemCampo itemDescripcionCampo">
                  <span>Descripción</span>
                  <input
                    className="itemDescripcion"
                    value={item.descripcion}
                    onChange={(evento) =>
                      actualizarItem(
                        indice,
                        'descripcion',
                        evento.target.value,
                      )
                    }
                    placeholder="Descripción"
                  />
                </label>

                <label className="itemCampo">
                  <span>Cantidad</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={item.cantidad}
                    onChange={(evento) =>
                      actualizarItem(
                        indice,
                        'cantidad',
                        Number(evento.target.value),
                      )
                    }
                  />
                </label>

                <label className="itemCampo">
                  <span>Precio unitario</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.precio_unitario}
                    onChange={(evento) =>
                      actualizarItem(
                        indice,
                        'precio_unitario',
                        Number(evento.target.value),
                      )
                    }
                  />
                </label>

                <label className="itemCampo">
                  <span>Costo unitario</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.costo_unitario}
                    onChange={(evento) =>
                      actualizarItem(
                        indice,
                        'costo_unitario',
                        Number(evento.target.value),
                      )
                    }
                  />
                </label>

                <div className="itemSubtotal">
                  <span>Subtotal</span>
                  <strong>
                    {formatoDinero(importeBruto(item))}
                  </strong>
                </div>

                <button
                  type="button"
                  className="removeItemButton"
                  onClick={() => eliminarItem(indice)}
                  title="Eliminar ítem"
                >
                  ×
                </button>

                {/* Descuento propio del ítem: ocupa una fila completa
                    debajo de los demás campos. */}
                <div
                  style={{
                    gridColumn: '1 / -1',
                    flexBasis: '100%',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '10px 16px',
                    paddingTop: '4px',
                    fontSize: '13px',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span>Descuento del ítem</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={item.descuento_pct ?? 0}
                      onChange={(evento) =>
                        actualizarItem(
                          indice,
                          'descuento_pct',
                          Number(evento.target.value),
                        )
                      }
                      style={{ width: '90px' }}
                      aria-label="Descuento del ítem en porcentaje"
                    />
                    <span>%</span>
                  </label>

                  {pctItem(item) > 0 && (
                    <span style={{ color: '#c62828', fontWeight: 600 }}>
                      − {formatoDinero(descuentoItem(item))} · Neto{' '}
                      {formatoDinero(importeNeto(item))}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="presupuestoEconomia">
            <label>
              Bonificación general (opcional)
              <div className="descuentoPresu">
                <div className="segTipo">
                  <button type="button" className={descuentoTipo === 'monto' ? 'active' : ''} onClick={() => setDescuentoTipo('monto')}>$</button>
                  <button type="button" className={descuentoTipo === 'porcentaje' ? 'active' : ''} onClick={() => setDescuentoTipo('porcentaje')}>%</button>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={descuento}
                  onChange={(evento) => setDescuento(Number(evento.target.value))}
                  placeholder={descuentoTipo === 'porcentaje' ? '% de descuento' : 'Monto en $'}
                />
              </div>
            </label>

            <div className="presupuestoTotales">
              <span>Subtotal: {formatoDinero(subtotal)}</span>
              {descuentoPorItems > 0 && (
                <span>Descuentos por ítem: −{formatoDinero(descuentoPorItems)}</span>
              )}
              {descuentoGeneral > 0 && (
                <span>Bonificación general: −{formatoDinero(descuentoGeneral)}{descuentoTipo === 'porcentaje' ? ` (${Number(descuento || 0)}%)` : ''}</span>
              )}
              <span>Total descuentos: {formatoDinero(descuentoTotal)}</span>
              <strong>Total: {formatoDinero(total)}</strong>
              <span>Cobrado: {formatoDinero(totalPagado)}</span>
              <span>Saldo: {formatoDinero(saldo)}</span>
            </div>
          </div>

          <label className="formFull">
            Notas
            <textarea
              value={notas}
              onChange={(evento) => setNotas(evento.target.value)}
              placeholder="Condiciones, forma de pago u observaciones..."
            />
          </label>

          {error && <p className="loginError">{error}</p>}

          <div className="modalActions">
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
                : presupuesto
                  ? 'Guardar cambios'
                  : 'Crear presupuesto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default NuevoPresupuesto
