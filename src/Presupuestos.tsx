import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import NuevoPresupuesto, {
  type ClienteOpcion,
  type ItemPresupuesto,
  type ObraOpcion,
  type PresupuestoEditable,
} from './NuevoPresupuesto'
import PresupuestoPDF from './PresupuestoPDF'
import PresupuestoFicha from './PresupuestoFicha'
import VistaToggle, { useVista } from './VistaToggle'
import { moneda, fechaCorta } from './gestionFormat'

type PresupuestoCompleto = PresupuestoEditable & {
  created_at: string
  subtotal: number
  total: number
  total_pagado: number
  saldo: number
  activo: boolean
}

const ESTADOS = [
  { v: 'borrador', t: 'Borrador' },
  { v: 'enviado', t: 'Enviado' },
  { v: 'aceptado', t: 'Aceptado' },
  { v: 'rechazado', t: 'Rechazado' },
]
const etiquetaEstado = (v: string) => ESTADOS.find((e) => e.v === v)?.t ?? v

function Presupuestos() {
  const [presupuestos, setPresupuestos] = useState<PresupuestoCompleto[]>([])
  const [clientes, setClientes] = useState<ClienteOpcion[]>([])
  const [obras, setObras] = useState<ObraOpcion[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('todos')
  const [vista, setVista] = useVista('presupuestos', 'kanban')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [presupuestoEditado, setPresupuestoEditado] = useState<PresupuestoCompleto | null>(null)
  const [pdfPresupuesto, setPdfPresupuesto] = useState<PresupuestoCompleto | null>(null)
  const [ficha, setFicha] = useState<PresupuestoCompleto | null>(null)
  const [convirtiendo, setConvirtiendo] = useState<number | null>(null)

  useEffect(() => { cargarDatos() }, [])

  async function cargarDatos() {
    setCargando(true)
    setError('')
    const [rPres, rItems, rClientes, rObras] = await Promise.all([
      supabase.from('presupuestos').select('id, created_at, cliente_id, obra_id, titulo, descripcion, fecha, validez_dias, estado, etapa_trabajo, subtotal, descuento, total, total_pagado, saldo, notas, activo').eq('activo', true).order('created_at', { ascending: false }),
      supabase.from('presupuesto_items').select('id, presupuesto_id, catalogo_id, tipo, descripcion, cantidad, precio_unitario, costo_unitario, orden').order('orden', { ascending: true }),
      supabase.from('Clientes').select('id, nombre, apellido').order('nombre', { ascending: true }),
      supabase.from('obras').select('id, cliente_id, nombre_obra').order('nombre_obra', { ascending: true }),
    ])
    if (rPres.error || rItems.error || rClientes.error || rObras.error) {
      console.error(rPres.error || rItems.error || rClientes.error || rObras.error)
      setError('No se pudieron cargar los presupuestos.')
      setCargando(false)
      return
    }
    const items = (rItems.data ?? []) as Array<ItemPresupuesto & { presupuesto_id: number; orden: number }>
    const cargados = (rPres.data ?? []).map((p) => ({
      ...p,
      subtotal: Number(p.subtotal), descuento: Number(p.descuento), total: Number(p.total),
      total_pagado: Number(p.total_pagado), saldo: Number(p.saldo),
      items: items.filter((it) => it.presupuesto_id === p.id).map((it) => ({
        id: it.id, catalogo_id: it.catalogo_id ?? null, tipo: it.tipo, descripcion: it.descripcion,
        cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), costo_unitario: Number(it.costo_unitario),
      })),
    })) as PresupuestoCompleto[]
    setClientes((rClientes.data ?? []) as ClienteOpcion[])
    setObras((rObras.data ?? []) as ObraOpcion[])
    setPresupuestos(cargados)
    setCargando(false)
    // Si hay una ficha abierta, refrescarla con los datos nuevos
    setFicha((actual) => (actual ? cargados.find((p) => p.id === actual.id) ?? null : null))
  }

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    return presupuestos.filter((p) => {
      const cli = clientes.find((c) => c.id === p.cliente_id)
      const ob = obras.find((o) => o.id === p.obra_id)
      const nom = `${cli?.nombre ?? ''} ${cli?.apellido ?? ''}`.toLowerCase()
      const coincide = !texto || p.titulo.toLowerCase().includes(texto) || nom.includes(texto) || (ob?.nombre_obra ?? '').toLowerCase().includes(texto)
      const coincideEstado = estadoFiltro === 'todos' || p.estado === estadoFiltro
      return coincide && coincideEstado
    })
  }, [presupuestos, clientes, obras, busqueda, estadoFiltro])

  const nombreCliente = (id: number) => {
    const c = clientes.find((x) => x.id === id)
    return c ? `${c.nombre} ${c.apellido ?? ''}`.trim() : 'Cliente no encontrado'
  }
  const nombreObra = (id: number | null) => (!id ? 'Sin obra asociada' : obras.find((o) => o.id === id)?.nombre_obra ?? 'Obra no encontrada')

  function abrirNuevo() { setPresupuestoEditado(null); setMostrarFormulario(true) }
  function editar(p: PresupuestoCompleto) { setPresupuestoEditado(p); setMostrarFormulario(true); setFicha(null) }
  function cerrarFormulario() { setMostrarFormulario(false); setPresupuestoEditado(null) }
  async function guardado() { cerrarFormulario(); await cargarDatos() }

  async function cambiarEstado(p: PresupuestoCompleto, nuevo: string) {
    const { error: err } = await supabase.from('presupuestos').update({ estado: nuevo }).eq('id', p.id)
    if (err) { console.error(err); window.alert('No se pudo modificar el estado.'); return }
    setPresupuestos((prev) => prev.map((x) => (x.id === p.id ? { ...x, estado: nuevo } : x)))
    setFicha((f) => (f && f.id === p.id ? { ...f, estado: nuevo } : f))
  }

  async function convertirEnObra(p: PresupuestoCompleto) {
    if (convirtiendo) return
    if (!window.confirm(`Se creará una obra a partir de "${p.titulo}" para ${nombreCliente(p.cliente_id)}.\n\nEl presupuesto se conserva y queda vinculado. ¿Continuar?`)) return
    setConvirtiendo(p.id)
    const { data: obraNueva, error: errObra } = await supabase.from('obras').insert({
      cliente_id: p.cliente_id, nombre_obra: p.titulo, descripcion: p.descripcion ?? null,
      estado: 'en_proceso', porcentaje_avance: 0, activo: true,
    }).select('id').single()
    if (errObra || !obraNueva) { console.error(errObra); window.alert('No se pudo crear la obra.'); setConvirtiendo(null); return }
    const { error: errVinc } = await supabase.from('presupuestos').update({ obra_id: obraNueva.id }).eq('id', p.id)
    if (errVinc) { console.error(errVinc); window.alert('La obra se creó pero no se pudo vincular el presupuesto.') }
    setConvirtiendo(null)
    await cargarDatos()
    window.alert('Obra creada y vinculada. Ya podés cargarle avances, adicionales y cobros desde Obras.')
  }

  const abrirFicha = (p: PresupuestoCompleto) => setFicha(p)

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div>
          <p className="subtitle">GESTIÓN COMERCIAL</p>
          <h2>Presupuestos</h2>
          <p className="welcome">Propuestas, trabajos y seguimiento de pagos</p>
        </div>
        <button className="newButton" onClick={abrirNuevo}>+ Nuevo presupuesto</button>
      </div>

      <div className="crmToolbar">
        <div className="crmFiltros">
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por título, cliente u obra..." />
          <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}>
            <option value="todos">Todos los estados</option>
            {ESTADOS.map((s) => <option key={s.v} value={s.v}>{s.t}</option>)}
          </select>
        </div>
        <VistaToggle vista={vista} onCambio={setVista} />
      </div>

      {cargando && <div className="presupuestosPanel"><p>Cargando presupuestos...</p></div>}
      {error && <div className="presupuestosPanel"><p className="loginError">{error}</p></div>}

      {!cargando && !error && filtrados.length === 0 && (
        <div className="presupuestosPanel"><div className="empty"><span>📄</span><h3>No hay presupuestos</h3><p>Los presupuestos que agregues aparecerán acá.</p></div></div>
      )}

      {!cargando && !error && filtrados.length > 0 && vista === 'kanban' && (
        <div className="crmKanban">
          {ESTADOS.map((s) => {
            const cols = filtrados.filter((p) => p.estado === s.v)
            return (
              <div className={`crmKanbanCol tope col-${s.v}`} key={s.v}>
                <div className="crmKanbanHead"><h3>{s.t}</h3><span className="cuenta">{cols.length}</span></div>
                <div className="crmKanbanBody">
                  {cols.length === 0 ? <div className="crmKanbanVacio">—</div> : cols.map((p) => (
                    <TarjetaPresupuesto key={p.id} p={p} cliente={nombreCliente(p.cliente_id)} onAbrir={() => abrirFicha(p)} onPDF={() => setPdfPresupuesto(p)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!cargando && !error && filtrados.length > 0 && vista === 'lista' && (
        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Código</th><th>Título</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Saldo</th><th>Estado</th></tr></thead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.id} onClick={() => abrirFicha(p)}>
                  <td>#{p.id.toString().padStart(4, '0')}</td>
                  <td><strong>{p.titulo}</strong></td>
                  <td>{nombreCliente(p.cliente_id)}</td>
                  <td>{fechaCorta(p.fecha)}</td>
                  <td>{moneda(p.total)}</td>
                  <td>{moneda(p.saldo)}</td>
                  <td><span className={`crmBadge est-${p.estado}`}>{etiquetaEstado(p.estado)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mostrarFormulario && (
        <NuevoPresupuesto clientes={clientes} obras={obras} presupuesto={presupuestoEditado} onCancelar={cerrarFormulario} onGuardado={guardado} />
      )}
      {pdfPresupuesto && (
        <PresupuestoPDF presupuesto={pdfPresupuesto} cliente={nombreCliente(pdfPresupuesto.cliente_id)} obra={nombreObra(pdfPresupuesto.obra_id)} onCerrar={() => setPdfPresupuesto(null)} />
      )}
      {ficha && (
        <PresupuestoFicha
          presupuesto={ficha}
          cliente={nombreCliente(ficha.cliente_id)}
          obra={nombreObra(ficha.obra_id)}
          convirtiendo={convirtiendo === ficha.id}
          onCerrar={() => setFicha(null)}
          onEditar={() => editar(ficha)}
          onPDF={() => setPdfPresupuesto(ficha)}
          onCrearObra={() => convertirEnObra(ficha)}
          onCambiarEstado={(nuevo) => cambiarEstado(ficha, nuevo)}
        />
      )}
    </div>
  )
}

function TarjetaPresupuesto({ p, cliente, onAbrir, onPDF }: { p: PresupuestoCompleto; cliente: string; onAbrir: () => void; onPDF: () => void }) {
  return (
    <div className="crmCard" onClick={onAbrir}>
      <div className="crmCardTop">
        <div>
          <h3>{p.titulo}</h3>
          <p className="crmCardCli">{cliente}</p>
        </div>
        <span className={`crmBadge est-${p.estado}`}>{etiquetaEstado(p.estado)}</span>
      </div>
      <div className="crmCardMeta">
        <span>#{p.id.toString().padStart(4, '0')}</span>
        <span>{fechaCorta(p.fecha)}</span>
        <span>{p.items.length} ítems</span>
      </div>
      <div className="crmCardEco">
        <div><span>Total</span><strong>{moneda(p.total)}</strong></div>
        <div><span>Pagado</span><strong>{moneda(p.total_pagado)}</strong></div>
        <div><span>Saldo</span><strong className={p.saldo > 0 ? 'pend' : ''}>{moneda(p.saldo)}</strong></div>
      </div>
      <div className="crmCardFoot" onClick={(e) => e.stopPropagation()}>
        <button className="crmFootPrimary" onClick={onAbrir}>Ver ficha</button>
        <button onClick={onPDF}>📄 PDF</button>
      </div>
    </div>
  )
}

export default Presupuestos
