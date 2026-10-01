import { useEffect, useState } from 'react'
import type { Pedido } from './BuscadorGlobal'
import Presupuestos from './Presupuestos'
import Obras from './Obras'

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

  const tabs = TABS.filter((t) => permitida(t.id))
  const esPresupuestos = tab === 'por_cerrar' || tab === 'rechazados'
  const pedidoPresupuestos = nuevo ?? pedido

  return (
    <div className="trabajosPage">
      <div className="pageHeader">
        <div>
          <p className="subtitle">PRESUPUESTOS Y OBRAS</p>
          <h2>Trabajos</h2>
          <p className="welcome">{verPresupuestos ? 'Del presupuesto a la obra terminada, en un solo lugar' : 'Las obras en curso y terminadas'}</p>
        </div>
        {verPresupuestos && <button className="newButton" onClick={() => { setTab('por_cerrar'); setNuevo({ accion: 'nuevo', n: Date.now() }) }}>+ Nuevo presupuesto</button>}
      </div>

      <div className="trabajosTabs" role="tablist" aria-label="Etapas de los trabajos" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'activo' : ''} onClick={() => setTab(t.id)}>
            <span className="trabajosTabLargo">{t.texto}</span><span className="trabajosTabCorto">{t.corto}</span>
          </button>
        ))}
      </div>

      {esPresupuestos && verPresupuestos && (
        <Presupuestos
          key={tab}
          embebido
          grupo={tab === 'rechazados' ? 'rechazados' : 'por_cerrar'}
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
          conIA={conIA}
          obraAbrirId={obraPedida ?? obraAbrirId}
          onObraAbierta={() => { setObraPedida(null); onObraAbierta() }}
          onVerPresupuesto={verPresupuestos ? (id) => { setPresupuestoPedido(id); setTab('por_cerrar') } : undefined}
        />
      )}
    </div>
  )
}
