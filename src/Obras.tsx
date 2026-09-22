import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'
import { supabase } from './supabase'
import NuevaObra from './NuevaObra'
import InformeObra from './InformeObra'
import AdicionalesObra from './AdicionalesObra'
import PersonalObra from './PersonalObra'
import RentabilidadObra from './RentabilidadObra'
import ResumenPagosPDF from './ResumenPagosPDF'
import VistaToggle, { useVista } from './VistaToggle'
import { OBRA_ESTADOS, etiquetaObra, claseObra } from './obraEstado'
import { useFinanzasObra, leerFinanzasObra, situacionCobro } from './finanzasObra'
import {
  eliminarObraCompleta,
  mensajeEliminacionObra,
  resumenEliminacionObra,
} from './eliminarObra'

type EstadoObra = 'en_proceso' | 'finalizada' | 'observacion'

type Obra = {
  id: number
  cliente_id: number
  nombre_obra: string
  direccion: string | null
  localidad: string | null
  estado: EstadoObra | null
  fecha_inicio: string | null
  fecha_fin_estimada: string | null
  descripcion: string | null
  porcentaje_avance: number
  activo: boolean
}

type Cliente = {
  id: number
  nombre: string
  apellido: string | null
  direccion: string | null
  localidad: string | null
}

type AvanceObra = {
  id: number
  created_at: string
  obra_id: number
  fecha: string
  titulo: string
  descripcion: string | null
  estado: EstadoObra
  porcentaje: number
}

type ImagenObra = {
  id: number
  storage_path: string
  tipo: string
  descripcion: string | null
  created_at: string
  avance_id: number | null
  url?: string
}

type FiltroEstado = 'todos' | EstadoObra

type ResumenEco = { valor: number; cobrado: number; pendiente: number }

const ESTADOS_PRESUPUESTO: Record<string, string> = {
  borrador: 'Borrador', enviado: 'Enviado', aceptado: 'Aceptado', rechazado: 'Rechazado',
}
const etiquetaEstadoPresupuesto = (v: string) => ESTADOS_PRESUPUESTO[v] ?? v

const avanceInicial = {
  fecha: new Date().toISOString().slice(0, 10),
  titulo: '',
  descripcion: '',
  estado: 'en_proceso' as EstadoObra,
  porcentaje: 0,
}

function Obras({ obraAbrirId, onObraAbierta, onVerPresupuesto }: { obraAbrirId?: number | null; onObraAbierta?: () => void; onVerPresupuesto?: (presupuestoId: number) => void } = {}) {
  const [obras, setObras] = useState<Obra[]>([])
  const [presupuestosObra, setPresupuestosObra] = useState<{ id: number; obra_id: number | null; estado: string; activo: boolean; titulo: string }[]>([])
  const [informeObra, setInformeObra] = useState<Obra | null>(null)
  const [seguTab, setSeguTab] = useState<'finanzas' | 'adicionales' | 'personal' | 'rentabilidad' | 'timeline'>('timeline')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] =
    useState<FiltroEstado>('todos')
  const [mostrarFormulario, setMostrarFormulario] =
    useState(false)
  const [obraEditando, setObraEditando] =
    useState<Obra | null>(null)
  const [actualizacion, setActualizacion] = useState(0)

  const [obraSeguimiento, setObraSeguimiento] =
    useState<Obra | null>(null)
  const [avances, setAvances] = useState<AvanceObra[]>([])
  const [cargandoAvances, setCargandoAvances] =
    useState(false)
  const [errorAvances, setErrorAvances] = useState('')
  const [mostrarNuevoAvance, setMostrarNuevoAvance] =
    useState(false)
  const [guardandoAvance, setGuardandoAvance] =
    useState(false)
  const [formularioAvance, setFormularioAvance] =
    useState(avanceInicial)
  const [editandoAvanceId, setEditandoAvanceId] = useState<number | null>(null)
  const [imagenes, setImagenes] = useState<ImagenObra[]>([])
  const [fotoAvance, setFotoAvance] = useState<File | null>(null)
  const [economia, setEconomia] = useState<Record<number, ResumenEco>>({})
  const [pagosPdf, setPagosPdf] = useState<Obra | null>(null)
  const [eliminandoObra, setEliminandoObra] = useState<number | null>(null)
  const [vista, setVista] = useVista('obras', 'kanban')
  // Finanzas de la obra abierta: se recargan al cambiar de pestaña o al guardar.
  const finanzasSeg = useFinanzasObra(obraSeguimiento?.id ?? null, `${seguTab}-${actualizacion}`)

  useEffect(() => {
    async function cargarDatos() {
      setCargando(true)
      setError('')

      const [resultadoObras, resultadoClientes, rPresupuestos, rAdicionales, rPagos] =
        await Promise.all([
          supabase
            .from('obras')
            .select(`
              id,
              cliente_id,
              nombre_obra,
              direccion,
              localidad,
              estado,
              fecha_inicio,
              fecha_fin_estimada,
              descripcion,
              porcentaje_avance,
              activo
            `)
            .order('created_at', { ascending: false }),

          supabase
            .from('Clientes')
            .select(
              'id, nombre, apellido, direccion, localidad',
            )
            .order('nombre', { ascending: true }),

          supabase.from('presupuestos').select('id, obra_id, total, estado, activo, titulo'),
          supabase.from('adicionales').select('obra_id, importe, estado'),
          supabase.from('pagos').select('monto, obra_id, presupuesto_id'),
        ])

      if (resultadoObras.error || resultadoClientes.error) {
        console.error(
          resultadoObras.error || resultadoClientes.error,
        )
        setError('No se pudieron cargar las obras.')
      } else {
        setObras((resultadoObras.data ?? []) as Obra[])
        setClientes(resultadoClientes.data ?? [])
        if (rPresupuestos.error) console.error('No se pudieron cargar los presupuestos de las obras:', rPresupuestos.error)
        setPresupuestosObra(rPresupuestos.error ? [] : (rPresupuestos.data ?? []) as typeof presupuestosObra)
        setEconomia(calcularEconomia(
          rPresupuestos.error ? [] : rPresupuestos.data ?? [],
          rAdicionales.error ? [] : rAdicionales.data ?? [],
          rPagos.error ? [] : rPagos.data ?? [],
        ))
      }

      setCargando(false)
    }

    cargarDatos()
  }, [actualizacion])

  // Abrir automáticamente una obra cuando se llega desde otro módulo (ej. Finanzas)
  useEffect(() => {
    if (obraAbrirId == null || obras.length === 0) return
    const obra = obras.find((o) => o.id === obraAbrirId)
    if (obra) { abrirSeguimiento(obra); onObraAbierta?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraAbrirId, obras])

  function obtenerCliente(clienteId: number) {
    const cliente = clientes.find(
      (item) => item.id === clienteId,
    )

    if (!cliente) return 'Cliente no disponible'

    return `${cliente.nombre} ${
      cliente.apellido ?? ''
    }`.trim()
  }

  function formatearFecha(fecha: string | null) {
    if (!fecha) return 'Sin fecha'

    return new Date(`${fecha.slice(0, 10)}T00:00:00`)
      .toLocaleDateString('es-AR')
  }

  const etiquetaEstado = etiquetaObra
  const claseEstado = claseObra

  // Presupuestos activos vinculados a la obra que está abierta en el modal de seguimiento.
  const presupuestosDeObra = obraSeguimiento
    ? presupuestosObra.filter((p) => p.obra_id != null && Number(p.obra_id) === Number(obraSeguimiento.id) && p.activo !== false)
    : []

  function cerrarFormulario() {
    setMostrarFormulario(false)
    setObraEditando(null)
  }

  function obraGuardada() {
    cerrarFormulario()
    setActualizacion((valor) => valor + 1)
  }

  async function cargarAvances(obraId: number) {
    setCargandoAvances(true)
    setErrorAvances('')

    const { data, error: errorCarga } = await supabase
      .from('obra_avances')
      .select(`
        id,
        created_at,
        obra_id,
        fecha,
        titulo,
        descripcion,
        estado,
        porcentaje
      `)
      .eq('obra_id', obraId)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })

    if (errorCarga) {
      console.error(errorCarga)
      setErrorAvances('No se pudo cargar el seguimiento.')
    } else {
      setAvances((data ?? []) as AvanceObra[])
    }

    setCargandoAvances(false)
  }

  async function cargarImagenes(obraId: number) {
    const { data, error: errorCarga } = await supabase
      .from('obra_imagenes')
      .select('id, storage_path, tipo, descripcion, created_at, avance_id')
      .eq('obra_id', obraId)
      .order('created_at', { ascending: false })

    if (errorCarga) {
      console.error(errorCarga)
      setErrorAvances('No se pudieron cargar las fotografías.')
      return
    }

    const conUrls = await Promise.all(
      ((data ?? []) as ImagenObra[]).map(async (imagen) => {
        const { data: url } = await supabase.storage
          .from('obras')
          .createSignedUrl(imagen.storage_path, 3600)
        return { ...imagen, url: url?.signedUrl }
      }),
    )
    setImagenes(conUrls)
  }

  function abrirSeguimiento(obra: Obra) {
    setObraSeguimiento(obra)
    setMostrarNuevoAvance(false)
    setFotoAvance(null)
    setFormularioAvance({
      ...avanceInicial,
      fecha: new Date().toISOString().slice(0, 10),
      estado: obra.estado ?? 'en_proceso',
      porcentaje: Number(obra.porcentaje_avance || 0),
    })
    cargarAvances(obra.id)
    cargarImagenes(obra.id)
  }

  function abrirEn(obra: Obra, tab: typeof seguTab) {
    setSeguTab(tab)
    abrirSeguimiento(obra)
  }

  function cerrarSeguimiento() {
    setObraSeguimiento(null)
    setAvances([])
    setImagenes([])
    setMostrarNuevoAvance(false)
    setFotoAvance(null)
    setErrorAvances('')
  }

  // Elimina la obra con todo lo cargado en ella (avances, fotos, compras,
  // costos, adicionales, personal y cobros), previa confirmación.
  async function eliminarObra(obra: Obra) {
    if (eliminandoObra !== null) return

    setEliminandoObra(obra.id)

    try {
      const resumen = await resumenEliminacionObra(obra.id)

      if (!window.confirm(mensajeEliminacionObra(obra.nombre_obra, resumen))) {
        return
      }

      const resultado = await eliminarObraCompleta(obra.id)

      if (!resultado.ok) {
        window.alert(resultado.mensaje)
        return
      }

      if (obraSeguimiento?.id === obra.id) cerrarSeguimiento()
      setActualizacion((valor) => valor + 1)

      if (resultado.presupuestosAceptados > 0) {
        window.alert(
          'La obra se eliminó. El presupuesto vinculado sigue en estado Aceptado: ' +
            'si el trabajo se canceló, pasalo a Rechazado desde Presupuestos.',
        )
      }
    } catch (fallo) {
      console.error(fallo)
      window.alert('No se pudo revisar la obra. No se borró nada.')
    } finally {
      setEliminandoObra(null)
    }
  }

  function actualizarAvance(
    campo: keyof typeof formularioAvance,
    valor: string | number,
  ) {
    setFormularioAvance((anterior) => ({
      ...anterior,
      [campo]: valor,
    }))
  }

  function cambiarEstadoAvance(estado: EstadoObra) {
    setFormularioAvance((anterior) => ({
      ...anterior,
      estado,
      porcentaje:
        estado === 'finalizada' ? 100 : anterior.porcentaje,
    }))
  }

  async function guardarAvance(
    evento: FormEvent<HTMLFormElement>,
  ) {
    evento.preventDefault()

    if (!obraSeguimiento) return

    if (!formularioAvance.titulo.trim()) {
      setErrorAvances('Ingresá un título para el avance.')
      return
    }

    setGuardandoAvance(true)
    setErrorAvances('')

    const datosAvance = {
      obra_id: obraSeguimiento.id,
      fecha: formularioAvance.fecha,
      titulo: formularioAvance.titulo.trim(),
      descripcion: formularioAvance.descripcion.trim() || null,
      estado: formularioAvance.estado,
      porcentaje: Number(formularioAvance.porcentaje),
    }

    let avanceId = editandoAvanceId

    if (editandoAvanceId) {
      const { error: errorGuardar } = await supabase
        .from('obra_avances')
        .update(datosAvance)
        .eq('id', editandoAvanceId)

      if (errorGuardar) {
        console.error(errorGuardar)
        setErrorAvances('No se pudo guardar el avance.')
        setGuardandoAvance(false)
        return
      }
    } else {
      const { data: creado, error: errorGuardar } = await supabase
        .from('obra_avances')
        .insert(datosAvance)
        .select('id')
        .single()

      if (errorGuardar) {
        console.error(errorGuardar)
        setErrorAvances('No se pudo guardar el avance.')
        setGuardandoAvance(false)
        return
      }
      avanceId = creado?.id ?? null
    }

    // La foto es opcional: si el avance se guardó pero la foto falla, avisamos
    // pero no perdemos el avance ya guardado.
    if (fotoAvance && avanceId) {
      const nombreSeguro = fotoAvance.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const ruta = `${obraSeguimiento.id}/${Date.now()}-${nombreSeguro}`
      const subida = await supabase.storage.from('obras').upload(ruta, fotoAvance)

      if (subida.error) {
        console.error(subida.error)
        setErrorAvances('El avance se guardó, pero no se pudo subir la foto.')
      } else {
        const registro = await supabase.from('obra_imagenes').insert({
          obra_id: obraSeguimiento.id,
          avance_id: avanceId,
          storage_path: ruta,
          tipo: 'avance',
          descripcion: null,
        })
        if (registro.error) console.error(registro.error)
      }
    }

    // El estado y % de la obra siempre reflejan el avance MÁS RECIENTE (crear o editar).
    const { data: ultimo } = await supabase
      .from('obra_avances')
      .select('estado,porcentaje')
      .eq('obra_id', obraSeguimiento.id)
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ultimo) {
      await supabase.from('obras')
        .update({ estado: ultimo.estado, porcentaje_avance: Number(ultimo.porcentaje) })
        .eq('id', obraSeguimiento.id)
      setObraSeguimiento({
        ...obraSeguimiento,
        estado: ultimo.estado as EstadoObra,
        porcentaje_avance: Number(ultimo.porcentaje),
      })
    }
    setMostrarNuevoAvance(false)
    setEditandoAvanceId(null)
    setFotoAvance(null)
    setFormularioAvance({
      ...avanceInicial,
      fecha: new Date().toISOString().slice(0, 10),
      estado: formularioAvance.estado,
      porcentaje: Number(formularioAvance.porcentaje),
    })
    setGuardandoAvance(false)
    setActualizacion((valor) => valor + 1)
    cargarAvances(obraSeguimiento.id)
    cargarImagenes(obraSeguimiento.id)
  }

  function editarAvance(avance: AvanceObra) {
    setEditandoAvanceId(avance.id)
    setFotoAvance(null)
    setFormularioAvance({
      fecha: (avance.fecha || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      titulo: avance.titulo,
      descripcion: avance.descripcion ?? '',
      estado: avance.estado,
      porcentaje: Number(avance.porcentaje) || 0,
    })
    setMostrarNuevoAvance(true)
  }

  const obrasFiltradas = obras.filter((obra) => {
    const texto = `
      ${obra.nombre_obra}
      ${obra.direccion ?? ''}
      ${obra.localidad ?? ''}
      ${obra.estado ?? ''}
      ${obtenerCliente(obra.cliente_id)}
    `.toLowerCase()

    const coincideBusqueda = texto.includes(
      busqueda.toLowerCase().trim(),
    )

    const coincideEstado =
      filtroEstado === 'todos' ||
      obra.estado === filtroEstado

    return coincideBusqueda && coincideEstado
  })

  return (
    <div className="obrasPage">
      <div className="pageHeader">
        <div>
          <p className="subtitle">GESTIÓN DE TRABAJOS</p>
          <h2>Obras</h2>
          <p className="welcome">
            Las obras nacen de un presupuesto aceptado
          </p>
        </div>
      </div>

      <div className="crmToolbar">
        <div className="crmFiltros">
          <input
            type="search"
            placeholder="Buscar obra, cliente o localidad..."
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
          <select
            value={filtroEstado}
            onChange={(evento) => setFiltroEstado(evento.target.value as FiltroEstado)}
          >
            <option value="todos">Todos los estados</option>
            {OBRA_ESTADOS.map((e) => <option key={e.v} value={e.v}>{e.t}</option>)}
          </select>
        </div>
        <VistaToggle vista={vista} onCambio={setVista} />
      </div>

      {cargando && <p>Cargando obras...</p>}
      {error && <p className="loginError">{error}</p>}

      {!cargando && !error && obrasFiltradas.length === 0 && (
        <div className="empty obrasEmpty">
          <span>🏠</span>
          <h3>No encontramos obras</h3>
          <p>Las obras nacen de un presupuesto aceptado. Probá con otra búsqueda o cambiá el filtro.</p>
        </div>
      )}

      {!cargando && !error && obrasFiltradas.length > 0 && vista === 'kanban' && (
        <div className="crmKanban">
          {OBRA_ESTADOS.map((s) => {
            const cols = obrasFiltradas.filter((o) => (o.estado ?? 'en_proceso') === s.v)
            return (
              <div className={`crmKanbanCol tope col-${claseObra(s.v)}`} key={s.v}>
                <div className="crmKanbanHead"><h3>{s.t}</h3><span className="cuenta">{cols.length}</span></div>
                <div className="crmKanbanBody">
                  {cols.length === 0 ? <div className="crmKanbanVacio">—</div> : cols.map((obra) => (
                    <div className="crmCard" key={obra.id} onClick={() => abrirSeguimiento(obra)}>
                      <div className="crmCardTop">
                        <div><h3>{obra.nombre_obra}</h3><p className="crmCardCli">{obtenerCliente(obra.cliente_id)}</p></div>
                        <span className={`crmBadge est-${claseObra(obra.estado)}`}>{etiquetaObra(obra.estado)}</span>
                      </div>
                      <div className="crmCardMeta">
                        <span>{obra.localidad || 'Sin localidad'}</span>
                        <span>{Number(obra.porcentaje_avance || 0)}% avance</span>
                      </div>
                      <div className="crmBarra"><span style={{ width: `${Number(obra.porcentaje_avance || 0)}%` }} /></div>
                      <div className="crmCardEco">
                        <div><span>Valor</span><strong>{dineroFicha(economia[obra.id]?.valor ?? 0)}</strong></div>
                        <div><span>Cobrado</span><strong>{dineroFicha(economia[obra.id]?.cobrado ?? 0)}</strong></div>
                        <div><span>Pendiente</span><strong className={(economia[obra.id]?.pendiente ?? 0) > 0 ? 'pend' : ''}>{dineroFicha(economia[obra.id]?.pendiente ?? 0)}</strong></div>
                      </div>
                      <div className="obraCardAccesos" onClick={(e) => e.stopPropagation()}>
                        <button type="button" title="Finanzas" onClick={() => abrirEn(obra, 'finanzas')}>💰</button>
                        <button type="button" title="Rentabilidad" onClick={() => abrirEn(obra, 'rentabilidad')}>📊</button>
                        <button type="button" title="Personal" onClick={() => abrirEn(obra, 'personal')}>👷</button>
                        <button type="button" title="Adicionales" onClick={() => abrirEn(obra, 'adicionales')}>➕</button>
                      </div>
                      <div className="crmCardFoot" onClick={(e) => e.stopPropagation()}>
                        <button className="crmFootPrimary" onClick={() => abrirSeguimiento(obra)}>Ver ficha</button>
                        <button onClick={() => setInformeObra(obra)}>📄 Informe</button>
                        <button onClick={() => setPagosPdf(obra)}>🧾 Pagos</button>
                        <button onClick={() => { setObraEditando(obra); setMostrarFormulario(true) }}>Editar</button>
                        <button
                          title="Eliminar obra"
                          disabled={eliminandoObra === obra.id}
                          onClick={() => void eliminarObra(obra)}
                        >
                          {eliminandoObra === obra.id ? 'Revisando...' : '🗑 Eliminar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!cargando && !error && obrasFiltradas.length > 0 && vista === 'lista' && (
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Obra</th><th>Cliente</th><th>Avance</th><th>Valor</th><th>Cobrado</th><th>Pendiente</th><th>Estado</th></tr></thead>
            <tbody>
              {obrasFiltradas.map((obra) => (
                <tr key={obra.id} onClick={() => abrirSeguimiento(obra)}>
                  <td><strong>{obra.nombre_obra}</strong></td>
                  <td>{obtenerCliente(obra.cliente_id)}</td>
                  <td>{Number(obra.porcentaje_avance || 0)}%</td>
                  <td>{dineroFicha(economia[obra.id]?.valor ?? 0)}</td>
                  <td>{dineroFicha(economia[obra.id]?.cobrado ?? 0)}</td>
                  <td>{dineroFicha(economia[obra.id]?.pendiente ?? 0)}</td>
                  <td><span className={`crmBadge est-${claseObra(obra.estado)}`}>{etiquetaObra(obra.estado)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mostrarFormulario && (
        <NuevaObra
          clientes={clientes}
          obra={obraEditando}
          onCancelar={cerrarFormulario}
          onGuardada={obraGuardada}
        />
      )}

      {informeObra && (
        <InformeObra
          obra={informeObra}
          cliente={obtenerCliente(informeObra.cliente_id)}
          onCerrar={() => setInformeObra(null)}
        />
      )}

      {pagosPdf && (
        <ResumenPagosPDF
          obra={pagosPdf}
          cliente={obtenerCliente(pagosPdf.cliente_id)}
          onCerrar={() => setPagosPdf(null)}
        />
      )}

      {obraSeguimiento && (
        <div className="modalOverlay">
          <div className="modalCard obraSeguimientoModal">
            <div className="modalHeader">
              <div>
                <p className="subtitle">SEGUIMIENTO DE OBRA</p>
                <h2>{obraSeguimiento.nombre_obra}</h2>
                <p className="welcome">
                  {obtenerCliente(obraSeguimiento.cliente_id)}
                </p>
              </div>

              <button
                type="button"
                className="closeButton"
                onClick={cerrarSeguimiento}
              >
                ×
              </button>
            </div>

            <div className="seguimientoResumen">
              <div>
                <span>Estado actual</span>
                <strong>
                  {etiquetaEstado(obraSeguimiento.estado)}
                </strong>
              </div>

              <div>
                <span>Avance</span>
                <strong>
                  {obraSeguimiento.porcentaje_avance}%
                </strong>
              </div>

              <div className="seguimientoProgreso">
                <span
                  style={{
                    width: `${obraSeguimiento.porcentaje_avance}%`,
                  }}
                />
              </div>
            </div>

            {onVerPresupuesto && presupuestosDeObra.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                {presupuestosDeObra.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="editButton"
                    onClick={() => onVerPresupuesto(p.id)}
                  >
                    📄 {p.titulo || `Presupuesto #${p.id}`} · {etiquetaEstadoPresupuesto(p.estado)}
                  </button>
                ))}
              </div>
            )}

            <div className="gestionTabs seguTabs">
              <button className={seguTab === 'timeline' ? 'active' : ''} onClick={() => setSeguTab('timeline')}>🕐 Estados</button>
              <button className={seguTab === 'personal' ? 'active' : ''} onClick={() => setSeguTab('personal')}>👷 Personal</button>
              <button className={seguTab === 'rentabilidad' ? 'active' : ''} onClick={() => setSeguTab('rentabilidad')}>📊 Rentabilidad</button>
              <button className={seguTab === 'finanzas' ? 'active' : ''} onClick={() => setSeguTab('finanzas')}>💰 Finanzas</button>
              <button className={seguTab === 'adicionales' ? 'active' : ''} onClick={() => setSeguTab('adicionales')}>➕ Adicionales</button>
            </div>

            {seguTab === 'finanzas' && <EconomiaObra key={obraSeguimiento.id} obraId={obraSeguimiento.id} onGenerarPdf={() => setPagosPdf(obraSeguimiento)} />}

            {seguTab === 'adicionales' && <AdicionalesObra key={obraSeguimiento.id} obraId={obraSeguimiento.id} />}

            {seguTab === 'personal' && <PersonalObra key={obraSeguimiento.id} obraId={obraSeguimiento.id} avance={Number(obraSeguimiento.porcentaje_avance || 0)} />}

            {seguTab === 'rentabilidad' && <RentabilidadObra key={obraSeguimiento.id} obraId={obraSeguimiento.id} avance={Number(obraSeguimiento.porcentaje_avance || 0)} />}

            {seguTab === 'timeline' && (<>
            <div className="seguimientoAcciones">
              <div>
                <h3>Estados y avances</h3>
                <p>Historial de estados y trabajos realizados. Podés editar un avance si te equivocaste al cargarlo.</p>
              </div>

              <button
                type="button"
                className="newButton"
                onClick={() => {
                  setFotoAvance(null)
                  if (mostrarNuevoAvance) {
                    setMostrarNuevoAvance(false)
                    setEditandoAvanceId(null)
                  } else {
                    setEditandoAvanceId(null)
                    setFormularioAvance({
                      ...avanceInicial,
                      fecha: new Date().toISOString().slice(0, 10),
                      estado: (obraSeguimiento?.estado as EstadoObra) ?? 'en_proceso',
                      porcentaje: Number(obraSeguimiento?.porcentaje_avance || 0),
                    })
                    setMostrarNuevoAvance(true)
                  }
                }}
              >
                {mostrarNuevoAvance
                  ? 'Cancelar'
                  : '+ Agregar avance'}
              </button>
            </div>

            {mostrarNuevoAvance && (
              <form
                className="avanceForm"
                onSubmit={guardarAvance}
              >
                <div className="formGrid">
                  <label>
                    Fecha
                    <input
                      type="date"
                      value={formularioAvance.fecha}
                      onChange={(evento) =>
                        actualizarAvance(
                          'fecha',
                          evento.target.value,
                        )
                      }
                      required
                    />
                  </label>

                  <label>
                    Estado de la obra
                    <select
                      value={formularioAvance.estado}
                      onChange={(evento) =>
                        cambiarEstadoAvance(
                          evento.target.value as EstadoObra,
                        )
                      }
                    >
                      {OBRA_ESTADOS.map((e) => (
                        <option key={e.v} value={e.v}>{e.t}</option>
                      ))}
                    </select>
                  </label>

                  <label className="formFull">
                    Título del avance *
                    <input
                      value={formularioAvance.titulo}
                      onChange={(evento) =>
                        actualizarAvance(
                          'titulo',
                          evento.target.value,
                        )
                      }
                      placeholder="Ej.: Canalización terminada"
                      required
                    />
                  </label>

                  <label>
                    Porcentaje completado
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formularioAvance.porcentaje}
                      onChange={(evento) =>
                        actualizarAvance(
                          'porcentaje',
                          Number(evento.target.value),
                        )
                      }
                      required
                    />
                  </label>

                  <label className="formFull">
                    Detalle del trabajo realizado
                    <textarea
                      rows={3}
                      value={formularioAvance.descripcion}
                      onChange={(evento) =>
                        actualizarAvance(
                          'descripcion',
                          evento.target.value,
                        )
                      }
                      placeholder="Descripción, observaciones o pendientes..."
                    />
                  </label>

                  <label className="formFull">
                    Foto (opcional)
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(evento) =>
                        setFotoAvance(evento.target.files?.[0] ?? null)
                      }
                    />
                    {fotoAvance && (
                      <small>
                        {fotoAvance.name}{' '}
                        <button
                          type="button"
                          className="editButton"
                          onClick={() => setFotoAvance(null)}
                        >
                          Quitar
                        </button>
                      </small>
                    )}
                  </label>
                </div>

                {errorAvances && (
                  <p className="loginError">{errorAvances}</p>
                )}

                <div className="formActions">
                  <button
                    type="submit"
                    className="newButton"
                    disabled={guardandoAvance}
                  >
                    {guardandoAvance
                      ? 'Guardando...'
                      : editandoAvanceId
                        ? 'Guardar cambios'
                        : 'Guardar avance'}
                  </button>
                </div>
              </form>
            )}

            {(() => {
              const hoy = situacionCobro(finanzasSeg.valorProgresivo, finanzasSeg.gastoExtraPendiente, finanzasSeg.cobros, Number(obraSeguimiento.porcentaje_avance || 0))
              if (finanzasSeg.valor <= 0 && finanzasSeg.cobros.length === 0) return null
              return (
                <div style={{ margin: '4px 0 18px' }}>
                  <div className="seguimientoResumen">
                    <div><span>Valor de la obra</span><strong>{dineroFicha(finanzasSeg.valor)}</strong></div>
                    <div><span>Corresponde cobrar ({hoy.pct}%)</span><strong>{dineroFicha(hoy.corresponde)}</strong></div>
                    <div><span>Cobrado hasta hoy</span><strong>{dineroFicha(hoy.cobrado)}</strong></div>
                    <div>
                      <span>{hoy.diferencia > 0 ? 'Adelanto del cliente' : hoy.diferencia < 0 ? 'Falta cobrar por avance' : 'Cobros al día'}</span>
                      <strong style={{ color: hoy.diferencia > 0 ? '#1f7a4d' : hoy.diferencia < 0 ? '#c2410c' : undefined }}>{dineroFicha(Math.abs(hoy.diferencia))}</strong>
                    </div>
                  </div>
                </div>
              )
            })()}

            <div className="obraTimeline">
              {cargandoAvances && <p>Cargando avances...</p>}

              {!mostrarNuevoAvance && errorAvances && (
                <p className="loginError">{errorAvances}</p>
              )}

              {!cargandoAvances &&
                !errorAvances &&
                avances.length === 0 && (
                  <div className="empty seguimientoEmpty">
                    <span>🕐</span>
                    <h3>Todavía no hay avances</h3>
                    <p>
                      Agregá el primer movimiento de esta obra.
                    </p>
                  </div>
                )}

              {!cargandoAvances &&
                avances.map((avance) => (
                  <article
                    className="timelineItem"
                    key={avance.id}
                  >
                    <span className="timelinePunto" />

                    <div className="timelineContenido">
                      <div className="timelineEncabezado">
                        <div>
                          <time>
                            {formatearFecha(avance.fecha)}
                          </time>
                          <h4>{avance.titulo}</h4>
                        </div>

                        <div className="timelineAcciones">
                          <span className={`crmBadge est-${claseEstado(avance.estado)}`}>
                            {etiquetaEstado(avance.estado)} · {avance.porcentaje}%
                          </span>
                          <button type="button" className="editButton" onClick={() => editarAvance(avance)}>Editar</button>
                        </div>
                      </div>

                      {avance.descripcion && (
                        <p>{avance.descripcion}</p>
                      )}

                      {(() => {
                        const fotosDelAvance = imagenes.filter((imagen) => imagen.avance_id === avance.id)
                        if (fotosDelAvance.length === 0) return null
                        return (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                            {fotosDelAvance.map((imagen) => (
                              <a key={imagen.id} href={imagen.url} target="_blank" rel="noreferrer">
                                {imagen.url && (
                                  <img
                                    src={imagen.url}
                                    alt="Foto del avance"
                                    style={{
                                      width: '72px',
                                      height: '72px',
                                      objectFit: 'cover',
                                      borderRadius: '8px',
                                      border: '1px solid #e2e5e9',
                                    }}
                                  />
                                )}
                              </a>
                            ))}
                          </div>
                        )
                      })()}

                      {(finanzasSeg.valor > 0 || finanzasSeg.cobros.length > 0) && (() => {
                        const sit = situacionCobro(finanzasSeg.valorProgresivo, finanzasSeg.gastoExtraPendiente, finanzasSeg.cobros, Number(avance.porcentaje), avance.fecha)
                        const color = sit.diferencia > 0 ? '#1f7a4d' : sit.diferencia < 0 ? '#c2410c' : '#4b525c'
                        return (
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '6px 18px',
                              marginTop: '10px',
                              paddingTop: '10px',
                              borderTop: '1px dashed #e2e5e9',
                              fontSize: '13px',
                              color: '#64748b',
                            }}
                          >
                            <span>💰 Al {sit.pct}% corresponde cobrar <strong style={{ color: '#101318' }}>{dineroFicha(sit.corresponde)}</strong></span>
                            <span>Cobrado a esa fecha <strong style={{ color: '#101318' }}>{dineroFicha(sit.cobrado)}</strong></span>
                            <span style={{ color }}>
                              <strong>
                                {sit.diferencia > 0
                                  ? `Adelanto ${dineroFicha(sit.diferencia)}`
                                  : sit.diferencia < 0
                                    ? `Falta cobrar ${dineroFicha(-sit.diferencia)}`
                                    : 'Al día'}
                              </strong>
                            </span>
                          </div>
                        )
                      })()}
                    </div>
                  </article>
                ))}
            </div>
            </>)}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '24px',
                paddingTop: '16px',
                borderTop: '1px solid #e2e5e9',
              }}
            >
              <button
                type="button"
                className="deactivateButton"
                disabled={eliminandoObra === obraSeguimiento.id}
                onClick={() => void eliminarObra(obraSeguimiento)}
              >
                {eliminandoObra === obraSeguimiento.id
                  ? 'Revisando...'
                  : '🗑 Eliminar obra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function calcularEconomia(
  presupuestos: Array<{ id: number; obra_id: number | null; total: number | string; estado: string; activo: boolean }>,
  adicionales: Array<{ obra_id: number | null; importe: number | string; estado: string }>,
  pagos: Array<{ monto: number | string; obra_id: number | null; presupuesto_id: number | null }>,
): Record<number, ResumenEco> {
  const mapa: Record<number, ResumenEco> = {}
  const asegurar = (id: number) => (mapa[id] ??= { valor: 0, cobrado: 0, pendiente: 0 })
  // Presupuesto -> obra (para atribuir pagos por presupuesto)
  const obraDePresupuesto: Record<number, number> = {}
  for (const p of presupuestos) {
    if (p.obra_id == null) continue
    obraDePresupuesto[p.id] = p.obra_id
    if (p.activo !== false && p.estado === 'aceptado') asegurar(p.obra_id).valor += Number(p.total) || 0
  }
  for (const a of adicionales) {
    if (a.obra_id == null || a.estado !== 'aprobado') continue
    asegurar(a.obra_id).valor += Number(a.importe) || 0
  }
  for (const pago of pagos) {
    const obraId = pago.obra_id ?? (pago.presupuesto_id != null ? obraDePresupuesto[pago.presupuesto_id] : undefined)
    if (obraId == null) continue
    asegurar(obraId).cobrado += Number(pago.monto) || 0
  }
  for (const id of Object.keys(mapa)) {
    const eco = mapa[Number(id)]
    eco.pendiente = Math.max(0, eco.valor - eco.cobrado)
  }
  return mapa
}

function dineroFicha(valor: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2,
  }).format(valor)
}

function fechaFicha(fecha: string | null) {
  return fecha
    ? new Date(`${fecha.slice(0, 10)}T00:00:00`).toLocaleDateString('es-AR')
    : 'Sin fecha'
}

type AdicionalMovimiento = {
  id: number
  fecha: string
  tipo: string
  descripcion: string | null
  motivo: string | null
  importe: number
  estado: string
}

const TIPOS_ADIC: Record<string, string> = {
  adicional: 'Adicional', producto: 'Producto extra', servicio: 'Servicio extra', cambio: 'Cambio de alcance',
  gasto_extra: 'Gasto extra', ajuste: 'Ajuste', bonificacion: 'Bonificación',
}
const ESTADO_ADIC_CLASE: Record<string, string> = {
  aprobado: 'adicBadge aprobado', pagado: 'adicBadge aprobado', rechazado: 'adicBadge rechazado', pendiente: 'adicBadge pendiente',
}
const ESTADO_ADIC_LABEL: Record<string, string> = {
  aprobado: 'Aprobado', pagado: 'Pagado', rechazado: 'Rechazado', pendiente: 'Pendiente',
}

// Pestaña Finanzas, simplificada: solo registrar los cobros del cliente, ver
// los movimientos de Adicionales (se editan en esa pestaña) y generar el
// comprobante en PDF. El resto de los números (valor de obra, corresponde
// cobrar, costos, compras) se ve todo junto en Rentabilidad.
function EconomiaObra({ obraId, onGenerarPdf }: { obraId: number; onGenerarPdf: () => void }) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [cobros, setCobros] = useState<{ id: number; monto: number; fecha: string; medio_pago: string | null; referencia: string | null }[]>([])
  const [movimientos, setMovimientos] = useState<AdicionalMovimiento[]>([])
  const [mostrarCobro, setMostrarCobro] = useState(false)
  const [cobroForm, setCobroForm] = useState({ monto: '', fecha: new Date().toISOString().slice(0, 10), medio_pago: 'transferencia', referencia: '' })
  const [guardandoCobro, setGuardandoCobro] = useState(false)

  async function guardarCobro(e: FormEvent) {
    e.preventDefault()
    const monto = Number(cobroForm.monto)
    if (!(monto > 0)) return
    setGuardandoCobro(true)
    const { error: fallo } = await supabase.from('pagos').insert({
      obra_id: obraId, presupuesto_id: null, monto, fecha: cobroForm.fecha,
      medio_pago: cobroForm.medio_pago, referencia: cobroForm.referencia.trim() || null,
    })
    setGuardandoCobro(false)
    if (fallo) { console.error(fallo); window.alert('No se pudo registrar el cobro.'); return }
    setMostrarCobro(false)
    setCobroForm({ monto: '', fecha: new Date().toISOString().slice(0, 10), medio_pago: 'transferencia', referencia: '' })
    setRevision((v) => v + 1)
  }

  async function eliminarCobro(id: number) {
    if (!window.confirm('¿Eliminar este cobro?')) return
    const { error: fallo } = await supabase.from('pagos').delete().eq('id', id)
    if (fallo) { console.error(fallo); window.alert('No se pudo eliminar el cobro.'); return }
    setRevision((v) => v + 1)
  }

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      const [finanzas, rAdic] = await Promise.all([
        leerFinanzasObra(obraId),
        supabase.from('adicionales').select('id,fecha,tipo,descripcion,motivo,importe,estado').eq('obra_id', obraId).order('fecha', { ascending: false }),
      ])
      if (!vigente) return
      setCobros(finanzas.cobros)
      if (rAdic.error) {
        console.error(rAdic.error)
        setError('No se pudieron cargar los movimientos de Adicionales.')
      } else {
        setMovimientos((rAdic.data ?? []).map((a: AdicionalMovimiento) => ({ ...a, importe: Number(a.importe) })))
      }
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [obraId, revision])

  return <section className="obraFotosSeccion" aria-label="Finanzas de la obra">
    <div className="seguimientoAcciones">
      <div><h3>Finanzas de la obra</h3><p>Registrá los cobros del cliente y generá su comprobante. Los números completos de la obra están en Rentabilidad.</p></div>
      <div className="adicAcciones">
        <button type="button" className="newButton" onClick={() => setMostrarCobro((v) => !v)}>{mostrarCobro ? 'Cancelar' : '💵 Registrar cobro'}</button>
        <button type="button" className="editButton" onClick={onGenerarPdf}>📄 Generar comprobante</button>
        <button type="button" className="editButton" disabled={cargando} onClick={() => setRevision((valor) => valor + 1)}>Actualizar</button>
      </div>
    </div>

    {mostrarCobro && (
      <form className="clienteForm adicForm" onSubmit={guardarCobro}>
        <div className="formGrid">
          <label>Monto *<input type="number" min="0.01" step="0.01" required value={cobroForm.monto} onChange={(e) => setCobroForm((f) => ({ ...f, monto: e.target.value }))} /></label>
          <label>Fecha *<input type="date" required value={cobroForm.fecha} onChange={(e) => setCobroForm((f) => ({ ...f, fecha: e.target.value }))} /></label>
          <label>Medio<select value={cobroForm.medio_pago} onChange={(e) => setCobroForm((f) => ({ ...f, medio_pago: e.target.value }))}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="cheque">Cheque</option><option value="otro">Otro</option></select></label>
          <label>Referencia<input value={cobroForm.referencia} onChange={(e) => setCobroForm((f) => ({ ...f, referencia: e.target.value }))} /></label>
        </div>
        <div className="formActions"><button type="button" className="cancelButton" onClick={() => setMostrarCobro(false)}>Cancelar</button><button className="newButton" disabled={guardandoCobro}>{guardandoCobro ? 'Guardando...' : 'Guardar cobro'}</button></div>
      </form>
    )}

    {cargando && <p role="status">Cargando...</p>}
    {error && <p className="loginError" role="alert">{error}</p>}
    {!cargando && !error && <>
      <h4>Cobros registrados</h4>
      {cobros.length === 0 ? <p className="adicVacio">Todavía no registraste ningún cobro de esta obra.</p> : (
        <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}><table>
          <thead><tr><th>Fecha</th><th>Medio</th><th>Referencia</th><th>Monto</th><th>Acción</th></tr></thead>
          <tbody>{cobros.map((c) => <tr key={c.id}>
            <td>{fechaFicha(c.fecha)}</td><td>{(c.medio_pago || '').replace('_', ' ')}</td><td>{c.referencia || '—'}</td><td><strong>{dineroFicha(c.monto)}</strong></td>
            <td><button type="button" className="adicNo" onClick={() => eliminarCobro(c.id)}>Eliminar</button></td>
          </tr>)}</tbody>
        </table></div>
      )}

      <h4 style={{ marginTop: '22px' }}>Movimientos registrados en Adicionales</h4>
      <p className="gestionAyuda" style={{ marginTop: 0 }}>Se cargan y editan en la pestaña Adicionales; acá solo se muestran.</p>
      {movimientos.length === 0 ? <p className="adicVacio">Todavía no hay adicionales cargados en esta obra.</p> : (
        <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}><table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Importe</th><th>Estado</th></tr></thead>
          <tbody>{movimientos.map((m) => <tr key={m.id}>
            <td>{fechaFicha(m.fecha)}</td>
            <td>{TIPOS_ADIC[m.tipo] ?? m.tipo}</td>
            <td>{m.descripcion || m.motivo || 'Sin detalle'}</td>
            <td><strong>{dineroFicha(m.importe)}</strong></td>
            <td><span className={ESTADO_ADIC_CLASE[m.estado] ?? 'adicBadge pendiente'}>{ESTADO_ADIC_LABEL[m.estado] ?? m.estado}</span></td>
          </tr>)}</tbody>
        </table></div>
      )}
    </>}
  </section>
}

export default Obras
