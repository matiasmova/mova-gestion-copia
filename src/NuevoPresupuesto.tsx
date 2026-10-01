import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'
import {
  descuentoItem,
  descuentoItems,
  importeBruto,
  importeNeto,
  pctItem,
  redondear,
} from './presupuestoCalculos'
import { cargarSoluciones, type Solucion } from './Soluciones'
import { pedirAsistente } from './asistenteIA'
import CompararMercado, { type ProductoAComparar } from './CompararMercado'
import { cargarSolucionesPresupuesto, type SolucionPresupuesto } from './presupuestoSoluciones'
import NuevoCliente from './NuevoCliente'
import { configActual } from './config'
import NuevaObra from './NuevaObra'

export type ClienteOpcion = {
  id: number
  nombre: string
  apellido: string | null
  direccion?: string | null
  localidad?: string | null
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
  nombre_presupuesto?: string | null
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

// Título automático a partir de las soluciones elegidas.
const tituloDesdeSoluciones = (lista: SolucionPresupuesto[]) => lista.map((s) => s.titulo).join(' + ')

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
  // Clientes y obras creados desde acá se suman a la lista sin salir del presupuesto.
  const [clientesLista, setClientesLista] = useState<ClienteOpcion[]>(clientes)
  const [obrasLista, setObrasLista] = useState<ObraOpcion[]>(obras)
  const [creando, setCreando] = useState<'cliente' | 'obra' | null>(null)
  const [titulo, setTitulo] = useState(presupuesto?.titulo ?? '')
  // Si el título ya existe o se escribe a mano, las soluciones no lo pisan.
  const [tituloManual, setTituloManual] = useState(!!presupuesto?.titulo)
  const [descripcion, setDescripcion] = useState(
    presupuesto?.descripcion ?? '',
  )
  const [fecha, setFecha] = useState(
    presupuesto?.fecha ?? new Date().toISOString().slice(0, 10),
  )
  const [validezDias, setValidezDias] = useState(
    presupuesto?.validez_dias ?? configActual().presupuestos.validezDias,
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

  // Soluciones (textos de beneficios) del catálogo y las elegidas para este presupuesto.
  const [catalogoSoluciones, setCatalogoSoluciones] = useState<Solucion[]>([])
  const [soluciones, setSoluciones] = useState<SolucionPresupuesto[]>([])
  const [teniaSoluciones, setTeniaSoluciones] = useState(false)

  useEffect(() => {
    async function cargarCatalogo() {
      const columnas = 'id, tipo, nombre, descripcion, unidad, precio_venta, costo_unitario'
      let consulta = await supabase.from('productos_servicios').select(`${columnas}, nombre_presupuesto`).eq('activo', true).order('tipo').order('nombre')
      // Sin el SQL de Productos todavía no existe nombre_presupuesto: se lee como antes.
      if (consulta.error) consulta = await supabase.from('productos_servicios').select(columnas).eq('activo', true).order('tipo').order('nombre') as typeof consulta
      const { data, error: errorCatalogo } = consulta

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

  useEffect(() => {
    let vigente = true
    void cargarSoluciones().then((lista) => { if (vigente) setCatalogoSoluciones(lista) })
    if (presupuesto?.id) {
      void cargarSolucionesPresupuesto(presupuesto.id).then((lista) => {
        if (!vigente) return
        setSoluciones(lista)
        setTeniaSoluciones(lista.length > 0)
      })
    }
    return () => { vigente = false }
  }, [presupuesto?.id])

  const solucionesParaAgregar = catalogoSoluciones.filter(
    (sol) => !soluciones.some((elegida) => elegida.titulo === sol.titulo),
  )

  function cambiarSoluciones(nuevas: SolucionPresupuesto[]) {
    setSoluciones(nuevas)
    if (!tituloManual) setTitulo(tituloDesdeSoluciones(nuevas))
  }

  function agregarSolucion(id: string) {
    const sol = catalogoSoluciones.find((s) => s.id === Number(id))
    if (!sol) return
    cambiarSoluciones([...soluciones, { titulo: sol.titulo, descripcion: sol.descripcion }])
  }

  function quitarSolucion(tituloSolucion: string) {
    cambiarSoluciones(soluciones.filter((s) => s.titulo !== tituloSolucion))
  }

  const obrasDisponibles = obrasLista.filter(
    (obra) => Number(obra.cliente_id) === Number(clienteId),
  )

  function cambiarCliente(nuevoClienteId: string) {
    setClienteId(nuevoClienteId)

    const obrasDelCliente = obrasLista.filter(
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

    // En el presupuesto va solo el nombre para el cliente: sin marca, modelo ni
    // detalle interno. Si no se cargó, el nombre del producto.
    const descripcionCompleta = seleccionado.nombre_presupuesto?.trim() || seleccionado.nombre

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

  // ---- Armar con IA: a partir de lo que pide el cliente ----
  const [iaAbierta, setIaAbierta] = useState(!presupuesto)
  const [iaPedido, setIaPedido] = useState('')
  const [iaPensando, setIaPensando] = useState(false)
  const [iaError, setIaError] = useState('')
  const [iaNotas, setIaNotas] = useState('')

  const [mercado, setMercado] = useState<ProductoAComparar[] | null>(null)
  // Productos del presupuesto con el precio por unidad que paga el cliente
  // (con el descuento del ítem y la bonificación general).
  function compararMercado() {
    const base = subtotal - descuentoPorItems
    const factorGeneral = base > 0 ? 1 - descuentoGeneral / base : 1
    const lista = items.filter((it) => it.tipo === 'producto' && it.descripcion.trim() && it.cantidad > 0).slice(0, 24).map((it) => {
      const p = it.catalogo_id ? catalogo.find((x) => Number(x.id) === Number(it.catalogo_id)) : undefined
      return { id: p?.id ?? null, nombre: p?.nombre ?? it.descripcion, cantidad: it.cantidad, costo: it.costo_unitario, precio: Math.round((importeNeto(it) / it.cantidad) * factorGeneral * 100) / 100 }
    })
    setMercado(lista)
  }
  const hayProductos = items.some((it) => it.tipo === 'producto' && it.descripcion.trim())

  async function armarConIA() {
    setIaError(''); setIaNotas(''); setIaPensando(true)
    try {
      const r = await pedirAsistente<{ titulo: string; descripcion: string; notas: string; descuento_general_pct?: number; cliente_id?: number | null; obra_id?: number | null; cliente_texto?: string; obra_texto?: string; soluciones: number[]; items: { catalogo_id: number | null; descripcion: string; cantidad: number; tipo: 'producto' | 'servicio'; precio_pedido?: number; precio_catalogo?: number; descuento_pct?: number }[] }>({ accion: 'presupuesto', pedido: iaPedido })
      const nuevos: ItemPresupuesto[] = r.items.map((it) => {
        const p = it.catalogo_id ? catalogo.find((x) => Number(x.id) === Number(it.catalogo_id)) : undefined
        // Precio: el que dijo el pedido; si no, el de tu lista de productos.
        const precio = Number(it.precio_pedido) > 0 ? Number(it.precio_pedido) : Number(p?.precio_venta) || Number(it.precio_catalogo) || 0
        return p
          ? { ...itemVacio, catalogo_id: p.id, tipo: p.tipo, descripcion: p.nombre_presupuesto?.trim() || p.nombre, cantidad: it.cantidad, precio_unitario: precio, costo_unitario: Number(p.costo_unitario) || 0, descuento_pct: Number(it.descuento_pct) || 0 }
          : { ...itemVacio, catalogo_id: it.catalogo_id ?? null, tipo: it.tipo, descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: precio, descuento_pct: Number(it.descuento_pct) || 0 }
      })
      if (!nuevos.length) { setIaError('La IA no encontró ítems para ese pedido. Probá contarlo con más detalle.'); return }
      // Si la lista estaba vacía se reemplaza; si ya había ítems, se suman al final.
      setItems((actuales) => {
        const conDatos = actuales.filter((it) => it.descripcion.trim() || it.precio_unitario > 0)
        return [...conDatos, ...nuevos]
      })
      const elegidas = r.soluciones.map((id) => catalogoSoluciones.find((x) => x.id === id)).filter((x): x is Solucion => !!x)
        .filter((x) => !soluciones.some((y) => y.titulo === x.titulo)).map((x) => ({ titulo: x.titulo, descripcion: x.descripcion }))
      if (elegidas.length) setSoluciones((actuales) => [...actuales, ...elegidas])
      if (r.titulo && (!titulo.trim() || !tituloManual)) { setTitulo(r.titulo); setTituloManual(true) }
      if (r.descripcion && !descripcion.trim()) setDescripcion(r.descripcion)
      if (Number(r.descuento_general_pct) > 0) { setDescuentoTipo('porcentaje'); setDescuento(Number(r.descuento_general_pct)) }
      // Cliente y obra nombrados en el pedido.
      const cli = r.cliente_id ? clientesLista.find((c) => Number(c.id) === Number(r.cliente_id)) : undefined
      const obr = r.obra_id ? obrasLista.find((o) => Number(o.id) === Number(r.obra_id)) : undefined
      if (cli) {
        cambiarCliente(String(cli.id))
        if (obr && Number(obr.cliente_id) === Number(cli.id)) setObraId(String(obr.id))
      }
      const enCero = nuevos.filter((it) => !(it.precio_unitario > 0))
      setIaNotas([
        r.notas,
        Number(r.descuento_general_pct) > 0 ? `Apliqué ${r.descuento_general_pct}% de bonificación general.` : '',
        cli ? `Cliente: ${cli.nombre} ${cli.apellido ?? ''}${obr ? ` · obra ${obr.nombre_obra}` : ''}.` : '',
        !cli && r.cliente_texto ? `⚠ No encontré a "${r.cliente_texto}" entre tus clientes: crealo con "+ Nuevo cliente".` : '',
        cli && !obr && r.obra_texto ? `⚠ No encontré la obra "${r.obra_texto}" de ese cliente: creala con "+ Nueva obra".` : '',
        enCero.length ? `⚠ Quedaron sin precio (en tu lista están en $0 o no están): ${enCero.map((it) => it.descripcion).join(', ')}. Cargales el precio acá o en Productos y servicios.` : '',
      ].filter(Boolean).join(' '))
      setIaAbierta(false)
    } catch (e) { setIaError((e as Error).message) } finally { setIaPensando(false) }
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
      setError('Ingresá un título para el presupuesto (o elegí una solución).')
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
      // Copia de las soluciones elegidas (solo se envía si se usan, así no falla
      // si todavía no se ejecutó supabase-soluciones.sql).
      ...((soluciones.length > 0 || teniaSoluciones) && { soluciones }),
    }

    let presupuestoId = presupuesto?.id

    if (presupuestoId) {
      const { error: errorPresupuesto } = await supabase
        .from('presupuestos')
        .update(datosPresupuesto)
        .eq('id', presupuestoId)

      if (errorPresupuesto) {
        console.error(errorPresupuesto)
        setError(
          errorPresupuesto.message?.includes('soluciones')
            ? 'Falta ejecutar supabase-soluciones.sql en Supabase para guardar las soluciones.'
            : 'No se pudo actualizar el presupuesto.',
        )
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
        setError(
          errorPresupuesto?.message?.includes('soluciones')
            ? 'Falta ejecutar supabase-soluciones.sql en Supabase para guardar las soluciones.'
            : 'No se pudo crear el presupuesto.',
        )
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

        {creando === 'cliente' && createPortal(
          <NuevoCliente
            onCancelar={() => setCreando(null)}
            onGuardado={() => setCreando(null)}
            onCreado={(nuevo) => {
              setClientesLista((lista) => [...lista, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
              setClienteId(String(nuevo.id))
              setObraId('')
              setCreando(null)
            }}
          />,
          document.body,
        )}
        {creando === 'obra' && createPortal(
          <NuevaObra
            clientes={clientesLista}
            clienteInicial={clientesLista.find((c) => c.id === Number(clienteId)) ?? null}
            onCancelar={() => setCreando(null)}
            onGuardada={() => setCreando(null)}
            onCreada={(nueva) => {
              setObrasLista((lista) => [...lista, nueva])
              setClienteId(String(nueva.cliente_id))
              setObraId(String(nueva.id))
              setCreando(null)
            }}
          />,
          document.body,
        )}

        {mercado && <CompararMercado titulo={titulo.trim() || 'Este presupuesto'} productos={mercado} onCerrar={() => setMercado(null)} />}

        <form className="presupuestoForm" onSubmit={guardar}>
          <div className={`iaArmar ${iaAbierta ? 'abierto' : ''}`}>
            <button type="button" className="iaArmarTit" onClick={() => setIaAbierta((v) => !v)}>
              <span>✨ Armar con IA</span><small>{iaAbierta ? 'Contá lo que pide el cliente y la IA arma los ítems con tu catálogo' : 'Tocá para armar ítems desde una descripción'}</small><b>{iaAbierta ? '▲' : '▼'}</b>
            </button>
            {iaAbierta && <>
              <textarea rows={3} value={iaPedido} onChange={(e) => setIaPedido(e.target.value)}
                placeholder="Ej.: casa de 200 m², WiFi en todo el terreno, 4 cámaras afuera, domótica de luces en living y cocina, riego para 3 zonas" />
              <div className="iaArmarAcc">
                <small>🎤 Podés dictarlo con el micrófono del teclado. Después revisá cantidades y precios.</small>
                <button type="button" className="newButton" disabled={!iaPedido.trim() || iaPensando || cargandoCatalogo} onClick={() => void armarConIA()}>{iaPensando ? 'Armando…' : 'Armar presupuesto'}</button>
              </div>
              {iaError && <p className="loginError">{iaError}</p>}
            </>}
            {!iaAbierta && iaNotas && <p className="iaNotas">💡 {iaNotas}</p>}
          </div>
          <div className="formGrid">
            <label>
              <span className="npEtiqueta">Cliente *<button type="button" className="npNuevo" onClick={(e) => { e.preventDefault(); setCreando('cliente') }}>+ Nuevo cliente</button></span>
              <select
                value={clienteId}
                onChange={(evento) =>
                    cambiarCliente(evento.target.value)
                  }
                required
              >
                <option value="">Seleccionar cliente</option>

                {clientesLista.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nombre} {cliente.apellido ?? ''}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="npEtiqueta">Obra<button type="button" className="npNuevo" disabled={!clienteId} title={clienteId ? undefined : 'Primero elegí el cliente'} onClick={(e) => { e.preventDefault(); setCreando('obra') }}>+ Nueva obra</button></span>
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
              {clienteId && (
                <small className="npAyuda">
                  {obrasDisponibles.length
                    ? '¿Otro trabajo en una obra que ya tiene? Elegí esa obra: al aceptarlo se suma a lo que ya tiene. Si es algo aparte, creá una obra nueva.'
                    : 'Este cliente todavía no tiene obras. Podés crear una o dejarlo sin obra.'}
                </small>
              )}
            </label>

            {(catalogoSoluciones.length > 0 || soluciones.length > 0) && (
              <div className="formFull" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ margin: 0 }}>
                  Soluciones del proyecto
                  <select
                    value=""
                    onChange={(evento) => agregarSolucion(evento.target.value)}
                    disabled={solucionesParaAgregar.length === 0}
                  >
                    <option value="">
                      {solucionesParaAgregar.length === 0 ? 'Ya elegiste todas las soluciones' : '+ Elegí una solución para agregarla…'}
                    </option>
                    {solucionesParaAgregar.map((sol) => (
                      <option key={sol.id} value={sol.id}>{sol.titulo}</option>
                    ))}
                  </select>
                </label>
                {soluciones.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {soluciones.map((sol) => (
                      <span
                        key={sol.titulo}
                        title={sol.descripcion}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 6px 5px 12px', borderRadius: '999px', background: 'linear-gradient(135deg, rgba(253,64,62,0.12), rgba(228,123,0,0.12))', border: '1px solid rgba(228,123,0,0.35)', color: '#8a3d00', fontSize: '13px', fontWeight: 600 }}
                      >
                        ✓ {sol.titulo}
                        <button
                          type="button"
                          onClick={() => quitarSolucion(sol.titulo)}
                          aria-label={`Quitar ${sol.titulo}`}
                          style={{ border: 0, background: 'rgba(255,255,255,0.8)', color: '#8a3d00', width: '20px', height: '20px', borderRadius: '50%', cursor: 'pointer', lineHeight: 1, fontSize: '14px' }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <small style={{ color: 'var(--mova-muted)', fontSize: '12px' }}>
                  Aparecen en el presupuesto en "Qué vas a disfrutar con este proyecto".
                  {!tituloManual && soluciones.length > 0 && ' El título se arma solo con lo que elegís; podés editarlo.'}
                </small>
              </div>
            )}

            <label className="formFull">
              Título del presupuesto *
              <input
                value={titulo}
                onChange={(evento) => { setTitulo(evento.target.value); setTituloManual(evento.target.value.trim() !== '') }}
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
                {/* Cabecera del ítem (solo en el celular): número, importe y borrar. */}
                <div className="itemCabecera">
                  <span>Ítem {indice + 1}</span>
                  <strong>{formatoDinero(pctItem(item) > 0 ? importeNeto(item) : importeBruto(item))}</strong>
                  <button type="button" onClick={() => eliminarItem(indice)} aria-label={`Eliminar ítem ${indice + 1}`}>Quitar</button>
                </div>
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
                        {producto.nombre}{producto.nombre_presupuesto ? ` → "${producto.nombre_presupuesto}"` : ''} ({producto.unidad})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="itemCampo itemTipo">
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

                <label className="itemCampo itemCantidad">
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

                <label className="itemCampo itemPrecio">
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

                <label className="itemCampo itemCosto">
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
                <div className="itemDescuentoFila">
                  <label>
                    <span>Descuento del ítem</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      inputMode="decimal"
                      value={item.descuento_pct ?? 0}
                      onChange={(evento) =>
                        actualizarItem(
                          indice,
                          'descuento_pct',
                          Number(evento.target.value),
                        )
                      }
                      aria-label="Descuento del ítem en porcentaje"
                    />
                    <span>%</span>
                  </label>

                  {pctItem(item) > 0 && (
                    <span className="itemDescuentoNeto">
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
              {hayProductos && <button type="button" className="editButton mercadoBtnPresu" onClick={compararMercado}>💲 ¿Cómo estoy de precio?</button>}
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
            <span className="presuPieTotal">Total <strong>{formatoDinero(total)}</strong></span>
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
