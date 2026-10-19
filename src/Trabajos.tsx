import { useEffect, useState } from 'react'
import type { Pedido } from './BuscadorGlobal'
import Presupuestos from './Presupuestos'
import Obras from './Obras'
import { supabase } from './supabase'
import TrabajosFlujo, { type Abrir } from './TrabajosFlujo'

// "Trabajos": presupuestos y obras en un solo lugar, en una sola lista
// ordenada por lo que necesita algo tuyo ("¿Qué hago ahora?"), con la cinta de
// etapas arriba: Armando → Enviado → En obra → Terminado. Al tocar un trabajo se
// abre su presupuesto o su obra (las ventanas siguen viviendo en Presupuestos y
// Obras, que acá no muestran su propia lista). Los que no salieron se ven al pie.
// Quien no ve presupuestos (encargado, auxiliar) ve solo las obras.

export type TabTrabajos = 'armando' | 'enviados' | 'en_obra' | 'terminadas'
// Nombres viejos que todavía pueden llegar de otras pantallas.
type TabPedida = TabTrabajos | 'por_cerrar' | 'rechazados'

type Props = {
  tabInicial: TabPedida
  verPresupuestos: boolean
  conIA: boolean
  obraAbrirId: number | null
  onObraAbierta: () => void
  presupuestoAbrirId: number | null
  onPresupuestoAbierto: () => void
  pedido: Pedido | null
  onPedidoAtendido: () => void
}

export default function Trabajos({ tabInicial, verPresupuestos, conIA, obraAbrirId, onObraAbierta, presupuestoAbrirId, onPresupuestoAbierto, pedido, onPedidoAtendido }: Props) {
  const [verNo, setVerNo] = useState(tabInicial === 'rechazados')
  const [nuevo, setNuevo] = useState<Pedido | null>(null)
  const [obraPedida, setObraPedida] = useState<number | null>(null)
  const [presupuestoPedido, setPresupuestoPedido] = useState<number | null>(null)
  const [revision, setRevision] = useState(0)
  const [busqueda, setBusqueda] = useState('')
  const [noSalieron, setNoSalieron] = useState(0)
  useEffect(() => {
    if (!verPresupuestos) return
    void supabase.from('presupuestos').select('id, estado, activo').eq('estado', 'rechazado').then(({ data, error }) => {
      if (!error) setNoSalieron(((data ?? []) as { activo: boolean | null }[]).filter((p) => p.activo !== false).length)
    })
  }, [verPresupuestos, revision])

  const abrir = (a: Abrir) => {
    if (a.tipo === 'presupuesto') setPresupuestoPedido(a.id)
    else if (a.tipo === 'obra') setObraPedida(a.id)
    else setNuevo({ accion: 'nuevo', id: a.obraId, clienteId: a.clienteId, n: Date.now() })
  }
  const pedidoPresupuestos = nuevo ?? pedido
  const actualizar = () => setRevision((v) => v + 1)

  return (
    <div className="trabajosPage tfPage">
      <div className="tfCab">
        <div><small>Trabajos</small><h2>¿Qué hago ahora?</h2></div>
        {verPresupuestos && <button type="button" className="tfNuevo" onClick={() => setNuevo({ accion: 'nuevo', n: Date.now() })}><span aria-hidden>＋</span> Nuevo<span className="tfNuevoLargo"> presupuesto</span></button>}
      </div>
      <label className="tfBuscar">
        <span aria-hidden>⌕</span>
        <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar trabajo, cliente u obra…" aria-label="Buscar trabajos" />
        {busqueda && <button type="button" aria-label="Borrar búsqueda" onClick={() => setBusqueda('')}>✕</button>}
      </label>

      <TrabajosFlujo verPlata={verPresupuestos} busqueda={busqueda} revision={revision} onAbrir={abrir} onNuevo={verPresupuestos ? () => setNuevo({ accion: 'nuevo', n: Date.now() }) : undefined} />

      {verPresupuestos && noSalieron > 0 && (
        <button type="button" className="trbVerNo" onClick={() => setVerNo((v) => !v)}>{verNo ? 'Ocultar' : 'Ver'} los que no salieron ({noSalieron})</button>
      )}
      {verPresupuestos && verNo && (
        <Presupuestos
          key="no-salieron"
          embebido
          grupo="rechazados"
          busquedaExterna={busqueda}
          presupuestoAbrirId={null}
          onCambio={actualizar}
          onAbrirObra={(id) => setObraPedida(id)}
        />
      )}

      {/* Las ventanas (ficha y editor del presupuesto, ficha de la obra), sin sus listas. */}
      {verPresupuestos && (
        <Presupuestos
          soloVentanas
          embebido
          pedido={pedidoPresupuestos}
          onPedidoAtendido={() => { setNuevo(null); if (pedido) onPedidoAtendido() }}
          presupuestoAbrirId={presupuestoPedido ?? presupuestoAbrirId}
          onPresupuestoAbierto={() => { setPresupuestoPedido(null); onPresupuestoAbierto() }}
          onAbrirObra={(id) => setObraPedida(id)}
          onCambio={actualizar}
        />
      )}
      <Obras
        soloVentanas
        embebido
        conIA={conIA}
        obraAbrirId={obraPedida ?? obraAbrirId}
        onObraAbierta={() => { setObraPedida(null); onObraAbierta() }}
        onCambio={actualizar}
        onVerPresupuesto={verPresupuestos ? (id) => setPresupuestoPedido(id) : undefined}
        onNuevoPresupuesto={verPresupuestos ? (o) => setNuevo({ accion: 'nuevo', id: o.id, clienteId: o.cliente_id, n: Date.now() }) : undefined}
      />
    </div>
  )
}
