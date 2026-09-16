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
  url?: string
}

type FiltroEstado = 'todos' | EstadoObra

type ResumenEco = { valor: number; cobrado: number; pendiente: number }

const avanceInicial = {
  fecha: new Date().toISOString().slice(0, 10),
  titulo: '',
  descripcion: '',
  estado: 'en_proceso' as EstadoObra,
  porcentaje: 0,
}

function Obras() {
  const [obras, setObras] = useState<Obra[]>([])
  const [informeObra, setInformeObra] = useState<Obra | null>(null)
  const [seguTab, setSeguTab] = useState<'finanzas' | 'adicionales' | 'personal' | 'rentabilidad' | 'fotos' | 'timeline'>('finanzas')
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
  const [imagenes, setImagenes] = useState<ImagenObra[]>([])
  const [subiendoImagen, setSubiendoImagen] = useState(false)
  const [tipoImagen, setTipoImagen] = useState('avance')
  const [descripcionImagen, setDescripcionImagen] = useState('')
  const [economia, setEconomia] = useState<Record<number, ResumenEco>>({})
  const [pagosPdf, setPagosPdf] = useState<Obra | null>(null)
  const [vista, setVista] = useVista('obras', 'kanban')

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

          supabase.from('presupuestos').select('id, obra_id, total, estado, activo'),
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
      .select('id, storage_path, tipo, descripcion, created_at')
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
    setErrorAvances('')
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

    const { error: errorGuardar } = await supabase
      .from('obra_avances')
      .insert({
        obra_id: obraSeguimiento.id,
        fecha: formularioAvance.fecha,
        titulo: formularioAvance.titulo.trim(),
        descripcion:
          formularioAvance.descripcion.trim() || null,
        estado: formularioAvance.estado,
        porcentaje: Number(formularioAvance.porcentaje),
      })

    if (errorGuardar) {
      console.error(errorGuardar)
      setErrorAvances('No se pudo guardar el avance.')
      setGuardandoAvance(false)
      return
    }

    const obraActualizada = {
      ...obraSeguimiento,
      estado: formularioAvance.estado,
      porcentaje_avance: Number(formularioAvance.porcentaje),
    }

    setObraSeguimiento(obraActualizada)
    setMostrarNuevoAvance(false)
    setFormularioAvance({
      ...avanceInicial,
      fecha: new Date().toISOString().slice(0, 10),
      estado: formularioAvance.estado,
      porcentaje: Number(formularioAvance.porcentaje),
    })
    setGuardandoAvance(false)
    setActualizacion((valor) => valor + 1)
    cargarAvances(obraSeguimiento.id)
  }

  async function subirImagen(
    evento: React.ChangeEvent<HTMLInputElement>,
  ) {
    const archivo = evento.target.files?.[0]
    if (!archivo || !obraSeguimiento) return

    setSubiendoImagen(true)
    setErrorAvances('')
    const nombreSeguro = archivo.name.replace(
      /[^a-zA-Z0-9._-]/g,
      '_',
    )
    const ruta = `${obraSeguimiento.id}/${Date.now()}-${nombreSeguro}`
    const subida = await supabase.storage
      .from('obras')
      .upload(ruta, archivo)

    if (subida.error) {
      console.error(subida.error)
      setErrorAvances('No se pudo subir la fotografía.')
      setSubiendoImagen(false)
      return
    }

    const registro = await supabase.from('obra_imagenes').insert({
      obra_id: obraSeguimiento.id,
      storage_path: ruta,
      tipo: tipoImagen,
      descripcion: descripcionImagen.trim() || null,
    })

    if (registro.error) {
      console.error(registro.error)
      setErrorAvances('La foto subió, pero no pudo registrarse.')
    } else {
      setDescripcionImagen('')
      await cargarImagenes(obraSeguimiento.id)
    }

    evento.target.value = ''
    setSubiendoImagen(false)
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
            Seguimiento de trabajos y proyectos
          </p>
        </div>

        <button
          className="newButton"
          onClick={() => {
            setObraEditando(null)
            setMostrarFormulario(true)
          }}
        >
          + Nueva obra
        </button>
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

            <div className="gestionTabs seguTabs">
              <button className={seguTab === 'finanzas' ? 'active' : ''} onClick={() => setSeguTab('finanzas')}>💰 Finanzas</button>
              <button className={seguTab === 'adicionales' ? 'active' : ''} onClick={() => setSeguTab('adicionales')}>➕ Adicionales</button>
              <button className={seguTab === 'personal' ? 'active' : ''} onClick={() => setSeguTab('personal')}>👷 Personal</button>
              <button className={seguTab === 'rentabilidad' ? 'active' : ''} onClick={() => setSeguTab('rentabilidad')}>📊 Rentabilidad</button>
              <button className={seguTab === 'fotos' ? 'active' : ''} onClick={() => setSeguTab('fotos')}>📷 Fotos</button>
              <button className={seguTab === 'timeline' ? 'active' : ''} onClick={() => setSeguTab('timeline')}>🕐 Línea de tiempo</button>
            </div>

            {seguTab === 'finanzas' && <EconomiaObra key={obraSeguimiento.id} obraId={obraSeguimiento.id} />}

            {seguTab === 'adicionales' && <AdicionalesObra key={obraSeguimiento.id} obraId={obraSeguimiento.id} />}

            {seguTab === 'personal' && <PersonalObra key={obraSeguimiento.id} obraId={obraSeguimiento.id} />}

            {seguTab === 'rentabilidad' && <RentabilidadObra key={obraSeguimiento.id} obraId={obraSeguimiento.id} />}

            {seguTab === 'fotos' && (
            <section className="obraFotosSeccion">
              <div className="seguimientoAcciones">
                <div>
                  <h3>Fotografías de la obra</h3>
                  <p>Antes, avances, terminación y planos.</p>
                </div>
              </div>

              <div className="obraFotoCarga">
                <select
                  value={tipoImagen}
                  onChange={(evento) => setTipoImagen(evento.target.value)}
                >
                  <option value="avance">Avance</option>
                  <option value="antes">Antes</option>
                  <option value="despues">Después</option>
                  <option value="plano">Plano</option>
                  <option value="otro">Otro</option>
                </select>
                <input
                  value={descripcionImagen}
                  onChange={(evento) =>
                    setDescripcionImagen(evento.target.value)
                  }
                  placeholder="Descripción opcional"
                />
                <label className="newButton obraFotoBoton">
                  {subiendoImagen ? 'Subiendo...' : '+ Subir fotografía'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    disabled={subiendoImagen}
                    onChange={subirImagen}
                  />
                </label>
              </div>

              <div className="obraFotosGrid">
                {imagenes.map((imagen) => (
                  <figure key={imagen.id}>
                    {imagen.url && (
                      <a href={imagen.url} target="_blank" rel="noreferrer">
                        <img
                          src={imagen.url}
                          alt={imagen.descripcion || imagen.tipo}
                        />
                      </a>
                    )}
                    <figcaption>
                      <strong>{imagen.tipo}</strong>
                      <span>{imagen.descripcion || 'Sin descripción'}</span>
                    </figcaption>
                  </figure>
                ))}
                {imagenes.length === 0 && (
                  <div className="obraFotosVacio">
                    Todavía no hay fotografías cargadas.
                  </div>
                )}
              </div>
            </section>
            )}

            {seguTab === 'timeline' && (<>
            <div className="seguimientoAcciones">
              <div>
                <h3>Línea de tiempo</h3>
                <p>Historial de estados y trabajos realizados.</p>
              </div>

              <button
                type="button"
                className="newButton"
                onClick={() =>
                  setMostrarNuevoAvance((valor) => !valor)
                }
              >
                {mostrarNuevoAvance
                  ? 'Cancelar avance'
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
                      : 'Guardar avance'}
                  </button>
                </div>
              </form>
            )}

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

                        <span
                          className={`obraEstadoBadge ${claseEstado(
                            avance.estado,
                          )}`}
                        >
                          {etiquetaEstado(avance.estado)} ·{' '}
                          {avance.porcentaje}%
                        </span>
                      </div>

                      {avance.descripcion && (
                        <p>{avance.descripcion}</p>
                      )}
                    </div>
                  </article>
                ))}
            </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}

type CompraFicha = {
  id: number
  nombre: string
  cantidad: number
  unidad: string | null
  precio_unitario: number
  proveedor: string | null
  fecha: string | null
  numero_comprobante: string | null
  comprobante_path: string | null
}

type CostoFicha = {
  id: number
  tipo: string
  descripcion: string | null
  monto: number
  fecha: string | null
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

function EconomiaObra({ obraId }: { obraId: number }) {
  const [compras, setCompras] = useState<CompraFicha[]>([])
  const [costos, setCostos] = useState<CostoFicha[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [comprobante, setComprobante] = useState<{ id: number; url: string } | null>(null)
  const [abriendo, setAbriendo] = useState<number | null>(null)
  const [errorComprobante, setErrorComprobante] = useState('')

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      // Paginar evita mostrar un total incompleto si hay muchos movimientos.
      async function leerCompras() {
        const filas: CompraFicha[] = []
        for (let inicio = 0; ; inicio += 500) {
          const resultado = await supabase.from('materiales')
            .select('id,nombre,cantidad,unidad,precio_unitario,proveedor,fecha,numero_comprobante,comprobante_path')
            .eq('obra_id', obraId).order('id').range(inicio, inicio + 499)
          if (resultado.error) throw resultado.error
          filas.push(...(resultado.data ?? []) as CompraFicha[])
          if (!vigente || (resultado.data ?? []).length < 500) return filas.reverse()
        }
      }
      async function leerCostos() {
        const filas: CostoFicha[] = []
        for (let inicio = 0; ; inicio += 500) {
          const resultado = await supabase.from('costos')
            .select('id,tipo,descripcion,monto,fecha')
            .eq('obra_id', obraId).order('id').range(inicio, inicio + 499)
          if (resultado.error) throw resultado.error
          filas.push(...(resultado.data ?? []) as CostoFicha[])
          if (!vigente || (resultado.data ?? []).length < 500) return filas.reverse()
        }
      }
      try {
        const [nuevasCompras, nuevosCostos] = await Promise.all([leerCompras(), leerCostos()])
        if (vigente) {
          setCompras(nuevasCompras)
          setCostos(nuevosCostos)
        }
      } catch (fallo) {
        console.error(fallo)
        if (vigente) setError('No se pudieron cargar las compras y los costos de esta obra. Probá actualizar.')
      } finally {
        if (vigente) setCargando(false)
      }
    }
    void cargar()
    return () => { vigente = false }
  }, [obraId, revision])

  async function prepararComprobante(compra: CompraFicha) {
    if (!compra.comprobante_path || abriendo !== null) return
    setAbriendo(compra.id)
    setComprobante(null)
    setErrorComprobante('')
    try {
      const resultado = await supabase.storage.from('comprobantes')
        .createSignedUrl(compra.comprobante_path, 300)
      if (resultado.error || !resultado.data?.signedUrl) {
        throw resultado.error ?? new Error('No se recibió un enlace al comprobante')
      }
      setComprobante({ id: compra.id, url: resultado.data.signedUrl })
    } catch (fallo) {
      console.error(fallo)
      setErrorComprobante('No se pudo abrir el comprobante. Volvé a intentar.')
    } finally {
      setAbriendo(null)
    }
  }

  // Los costos ya incluyen las compras: no sumar materiales nuevamente.
  const totalCostos = costos.reduce((total, costo) => total + Number(costo.monto || 0), 0)
  const tipos: Record<string, string> = {
    material: 'Material', mano_obra: 'Mano de obra', terciarizado: 'Tercerizado', otro: 'Otro',
  }

  return <section className="obraFotosSeccion" aria-label="Compras y costos de la obra">
    <div className="seguimientoAcciones">
      <div><h3>Compras y costos de la obra</h3><p>Materiales, comprobantes y gastos asociados.</p></div>
      <button type="button" className="editButton" disabled={cargando} onClick={() => setRevision((valor) => valor + 1)}>Actualizar</button>
    </div>
    {cargando && <p role="status">Cargando compras y costos...</p>}
    {error && <p className="loginError" role="alert">{error}</p>}
    {!cargando && !error && <>
      <div className="seguimientoResumen">
        <div><span>Costo total registrado</span><strong>{dineroFicha(totalCostos)}</strong></div>
        <div><span>Compras registradas</span><strong>{compras.length}</strong></div>
      </div>
      <p>El total corresponde a los costos de Finanzas e incluye las compras vinculadas una sola vez.</p>
      <h4>Compras y comprobantes</h4>
      {compras.length === 0 ? <p>No hay compras registradas para esta obra.</p> :
        <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}><table>
          <thead><tr><th>Fecha</th><th>Material / proveedor</th><th>Cantidad</th><th>Precio unitario</th><th>Subtotal</th><th>Comprobante</th></tr></thead>
          <tbody>{compras.map((compra) => <tr key={compra.id}>
            <td>{fechaFicha(compra.fecha)}</td>
            <td><strong>{compra.nombre}</strong><br /><small>{compra.proveedor || 'Sin proveedor'}</small></td>
            <td>{Number(compra.cantidad)} {compra.unidad}</td>
            <td>{dineroFicha(Number(compra.precio_unitario || 0))}</td>
            <td>{dineroFicha(Math.round(Number(compra.cantidad) * Number(compra.precio_unitario || 0) * 100) / 100)}</td>
            <td>{compra.numero_comprobante && <div>{compra.numero_comprobante}</div>}
              {compra.comprobante_path ? <>
                <button type="button" className="editButton" disabled={abriendo !== null} onClick={() => void prepararComprobante(compra)}>
                  {abriendo === compra.id ? 'Preparando...' : 'Ver comprobante'}
                </button>
                {comprobante?.id === compra.id && <div><a href={comprobante.url} target="_blank" rel="noopener noreferrer">Abrir archivo (enlace por 5 minutos)</a></div>}
              </> : <span>Sin archivo adjunto</span>}
            </td>
          </tr>)}</tbody>
        </table></div>}
      {errorComprobante && <p className="loginError" role="alert">{errorComprobante}</p>}
      <h4>Detalle de costos</h4>
      {costos.length === 0 ? <p>No hay costos registrados para esta obra.</p> :
        <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}><table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Monto</th></tr></thead>
          <tbody>{costos.map((costo) => <tr key={costo.id}>
            <td>{fechaFicha(costo.fecha)}</td><td>{tipos[costo.tipo] ?? costo.tipo}</td>
            <td>{costo.descripcion || 'Sin detalle'}</td><td>{dineroFicha(Number(costo.monto || 0))}</td>
          </tr>)}</tbody>
        </table></div>}
    </>}
  </section>
}

export default Obras
