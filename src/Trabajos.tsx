import { useEffect, useState } from 'react'
import type { Pedido } from './BuscadorGlobal'
import Presupuestos from './Presupuestos'
import Obras from './Obras'
import { supabase } from './supabase'

// "Trabajos": presupuestos y obras en un solo lugar, por etapa.
// Un trabajo empieza como presupuesto (Por cerrar), pasa a En obra cuando el
// cliente acepta y termina en Terminadas. Los que no avanzan van a Rechazados.
// Quien no ve presupuestos (encargado, auxiliar) ve solo las pestañas de obra.

export type TabTrabajos = 'por_cerrar' | 'en_obra' | 'terminadas' | 'rechazados'

type Props = {
  tabInicial: TabTrabajos
  verPresupuestos: boolean
  conIA: boolean
  obraAbrirId: number | null
  onObraAbierta: () => void
  presupuestoAbrirId: number | null
  onPresupuestoAbierto: () => void
  pedido: Pedido | null
  onPedidoAtendido: () => void
}

const TABS: { id: TabTrabajos; texto: string; corto: string; presupuestos: boolean }[] = [
  { id: 'por_cerrar', texto: '📝 Por cerrar', corto: 'Por cerrar', presupuestos: true },
  { id: 'en_obra', texto: '🏗️ En obra', corto: 'En obra', presupuestos: false },
  { id: 'terminadas', texto: '🏁 Terminadas', corto: 'Terminadas', presupuestos: false },
  { id: 'rechazados', texto: '❌ Rechazados', corto: 'Rechazados', presupuestos: true },
]

export default function Trabajos({ tabInicial, verPresupuestos, conIA, obraAbrirId, onObraAbierta, presupuestoAbrirId, onPresupuestoAbierto, pedido, onPedidoAtendido }: Props) {
  const permitida = (t: TabTrabajos) => verPresupuestos || !TABS.find((x) => x.id === t)!.presupuestos
  const [tab, setTab] = useState<TabTrabajos>(permitida(tabInicial) ? tabInicial : 'en_obra')
  const [nuevo, setNuevo] = useState<Pedido | null>(null)
  // Saltos entre pestañas: abrir una obra desde un presupuesto, o al revés.
  const [obraPedida, setObraPedida] = useState<number | null>(null)
  const [presupuestoPedido, setPresupuestoPedido] = useState<number | null>(null)

  // Si se llega desde otra pantalla (buscador, Inicio, una ficha), se va a la pestaña pedida.
  useEffect(() => { if (permitida(tabInicial)) setTab(tabInicial) }, [tabInicial]) // eslint-disable-line react-hooks/exhaustive-deps
  // Abrir un presupuesto (por ejemplo desde una obra) muestra la pestaña de presupuestos.
  useEffect(() => { if (presupuestoAbrirId != null && verPresupuestos && tab !== 'por_cerrar' && tab !== 'rechazados') setTab('por_cerrar') }, [presupuestoAbrirId]) // eslint-disable-line react-hooks/exhaustive-deps
  // "+ Nuevo presupuesto" del buscador o del botón "+".
  useEffect(() => { if (pedido?.accion === 'nuevo' && verPresupuestos) setTab('por_cerrar') }, [pedido]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lupa de arriba: busca en la pestaña que se está viendo.
  const [buscando, setBuscando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  // Cuántos trabajos hay en cada pestaña (se recalcula al cambiar de pestaña).
  const [conteo, setConteo] = useState<Partial<Record<TabTrabajos, number>>>({})
  useEffect(() => {
    let vigente = true
    void Promise.all([
      supabase.from('presupuestos').select('id, obra_id, estado, activo'),
      supabase.from('obras').select('id, estado, porcentaje_avance'),
    ]).then(([rp, ro]) => {
      if (!vigente || rp.error || ro.error) return
      const pres = (rp.data ?? []) as { obra_id: number | null; estado: string; activo: boolean | null }[]
      const conAceptado = new Set(pres.filter((p) => p.obra_id != null && p.activo !== false && p.estado === 'aceptado').map((p) => Number(p.obra_id)))
      const obras = ((ro.data ?? []) as { id: number; estado: string | null; porcentaje_avance: number | string | null }[]).filter((o) => conAceptado.has(Number(o.id)))
      const terminada = (o: { estado: string | null; porcentaje_avance: number | string | null }) => o.estado === 'finalizada' || o.estado === 'observacion' || Number(o.porcentaje_avance) >= 100
      setConteo({
        por_cerrar: pres.filter((p) => p.estado === 'borrador' || p.estado === 'enviado' || (p.estado === 'aceptado' && p.obra_id == null)).length,
        rechazados: pres.filter((p) => p.estado === 'rechazado').length,
        en_obra: obras.filter((o) => !terminada(o)).length,
        terminadas: obras.filter(terminada).length,
      })
    })
    return () => { vigente = false }
  }, [tab])

  const tabs = TABS.filter((t) => permitida(t.id))
  const esPresupuestos = tab === 'por_cerrar' || tab === 'rechazados'
  const pedidoPresupuestos = nuevo ?? pedido

  return (
    <div className="trabajosPage">
      {/* Arriba, solo lo justo: el título, la lupa y "+ Nuevo". */}
      <div className="trbCab">
        <h2>Trabajos</h2>
        <button type="button" className={`trbIcono${buscando ? ' activo' : ''}`} aria-label="Buscar" aria-pressed={buscando} onClick={() => { setBuscando((v) => !v); if (buscando) setBusqueda('') }}>🔍</button>
        {verPresupuestos && <button type="button" className="trbNuevo" onClick={() => { setTab('por_cerrar'); setNuevo({ accion: 'nuevo', n: Date.now() }) }}>＋ Nuevo</button>}
      </div>
      {buscando && <input className="trbBuscar" type="search" autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar trabajo, cliente o lugar..." />}

      <div className="trabajosTabs trbTabs" role="tablist" aria-label="Etapas de los trabajos" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'activo' : ''} onClick={() => setTab(t.id)}>
            <span className="trabajosTabLargo">{t.texto}</span><span className="trabajosTabCorto">{t.corto}</span>
            {conteo[t.id] != null && <small>{conteo[t.id]}</small>}
          </button>
        ))}
      </div>

      {esPresupuestos && verPresupuestos && (
        <Presupuestos
          key={tab}
          embebido
          grupo={tab === 'rechazados' ? 'rechazados' : 'por_cerrar'}
          busquedaExterna={busqueda}
          pedido={pedidoPresupuestos}
          onPedidoAtendido={() => { setNuevo(null); if (pedido) onPedidoAtendido() }}
          presupuestoAbrirId={presupuestoPedido ?? presupuestoAbrirId}
          onPresupuestoAbierto={() => { setPresupuestoPedido(null); onPresupuestoAbierto() }}
          onAbrirObra={(id) => { setObraPedida(id); setTab('en_obra') }}
        />
      )}
      {!esPresupuestos && (
        <Obras
          key={tab}
          embebido
          grupo={tab === 'terminadas' ? 'terminadas' : 'en_obra'}
          busquedaExterna={busqueda}
          conIA={conIA}
          obraAbrirId={obraPedida ?? obraAbrirId}
          onObraAbierta={() => { setObraPedida(null); onObraAbierta() }}
          onVerPresupuesto={verPresupuestos ? (id) => { setPresupuestoPedido(id); setTab('por_cerrar') } : undefined}
        />
      )}
    </div>
  )
}
