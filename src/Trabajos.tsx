import { useEffect, useState } from 'react'
import type { Pedido } from './BuscadorGlobal'
import Presupuestos from './Presupuestos'
import Obras from './Obras'
import { supabase } from './supabase'
import { obrasSinPresupuesto } from './estadoTrabajo'

// "Trabajos": presupuestos y obras en un solo lugar, con un solo camino:
// Armando → Enviados → En obra → Terminados. Los que no salieron no ocupan
// pestaña: se ven con "Ver los que no salieron".
// Quien no ve presupuestos (encargado, auxiliar) ve solo las pestañas de obra.

export type TabTrabajos = 'armando' | 'enviados' | 'en_obra' | 'terminadas'
// Nombres viejos que todavía pueden llegar de otras pantallas.
type TabPedida = TabTrabajos | 'por_cerrar' | 'rechazados'
const normalizarTab = (t: TabPedida): TabTrabajos => (t === 'por_cerrar' ? 'armando' : t === 'rechazados' ? 'enviados' : t)

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

const TABS: { id: TabTrabajos; texto: string; corto: string; presupuestos: boolean; ayuda: string }[] = [
  { id: 'armando', texto: '✏️ Armando', corto: 'Armando', presupuestos: true, ayuda: 'Lo que estás preparando: borradores y obras sin presupuesto.' },
  { id: 'enviados', texto: '📤 Enviados', corto: 'Enviados', presupuestos: true, ayuda: 'Esperando que el cliente responda.' },
  { id: 'en_obra', texto: '🏗️ En obra', corto: 'En obra', presupuestos: false, ayuda: 'Aceptados y en marcha.' },
  { id: 'terminadas', texto: '✅ Terminados', corto: 'Terminados', presupuestos: false, ayuda: 'Obras listas. Las que falta cobrar lo avisan.' },
]

export default function Trabajos({ tabInicial, verPresupuestos, conIA, obraAbrirId, onObraAbierta, presupuestoAbrirId, onPresupuestoAbierto, pedido, onPedidoAtendido }: Props) {
  const permitida = (t: TabTrabajos) => verPresupuestos || !TABS.find((x) => x.id === t)!.presupuestos
  const [tab, setTab] = useState<TabTrabajos>(permitida(normalizarTab(tabInicial)) ? normalizarTab(tabInicial) : 'en_obra')
  const [verNo, setVerNo] = useState(tabInicial === 'rechazados')
  const [nuevo, setNuevo] = useState<Pedido | null>(null)
  // Saltos entre pestañas: abrir una obra desde un presupuesto, o al revés.
  const [obraPedida, setObraPedida] = useState<number | null>(null)
  const [presupuestoPedido, setPresupuestoPedido] = useState<number | null>(null)

  // Si se llega desde otra pantalla (buscador, Inicio, una ficha), se va a la pestaña pedida.
  useEffect(() => { const t = normalizarTab(tabInicial); if (permitida(t)) setTab(t) }, [tabInicial]) // eslint-disable-line react-hooks/exhaustive-deps
  // Abrir un presupuesto (por ejemplo desde una obra) muestra la pestaña de presupuestos.
  useEffect(() => { if (presupuestoAbrirId != null && verPresupuestos && tab !== 'armando' && tab !== 'enviados') setTab('armando') }, [presupuestoAbrirId]) // eslint-disable-line react-hooks/exhaustive-deps
  // "+ Nuevo presupuesto" del buscador o del botón "+".
  useEffect(() => { if (pedido?.accion === 'nuevo' && verPresupuestos) setTab('armando') }, [pedido]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lupa de arriba: busca en la pestaña que se está viendo.
  const [buscando, setBuscando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  // Cuántos trabajos hay en cada pestaña (se recalcula al cambiar de pestaña).
  const [conteo, setConteo] = useState<Partial<Record<TabTrabajos, number>>>({})
  const [noSalieron, setNoSalieron] = useState(0)
  useEffect(() => {
    let vigente = true
    void Promise.all([
      supabase.from('presupuestos').select('id, obra_id, estado, activo'),
      supabase.from('obras').select('id, estado, porcentaje_avance, activo'),
    ]).then(([rp, ro]) => {
      if (!vigente || rp.error || ro.error) return
      const pres = (rp.data ?? []) as { obra_id: number | null; estado: string; activo: boolean | null }[]
      const conAceptado = new Set(pres.filter((p) => p.obra_id != null && p.activo !== false && p.estado === 'aceptado').map((p) => Number(p.obra_id)))
      const todas = (ro.data ?? []) as { id: number; estado: string | null; porcentaje_avance: number | string | null; activo: boolean | null }[]
      const obras = todas.filter((o) => conAceptado.has(Number(o.id)))
      const terminada = (o: { estado: string | null; porcentaje_avance: number | string | null }) => o.estado === 'finalizada' || o.estado === 'observacion' || Number(o.porcentaje_avance) >= 100
      setConteo({
        armando: pres.filter((p) => p.activo !== false && (p.estado === 'borrador' || (p.estado === 'aceptado' && p.obra_id == null))).length + obrasSinPresupuesto(todas, pres).length,
        enviados: pres.filter((p) => p.activo !== false && p.estado === 'enviado').length,
        en_obra: obras.filter((o) => !terminada(o)).length,
        terminadas: obras.filter(terminada).length,
      })
      setNoSalieron(pres.filter((p) => p.activo !== false && p.estado === 'rechazado').length)
    })
    return () => { vigente = false }
  }, [tab])

  const tabs = TABS.filter((t) => permitida(t.id))
  const esPresupuestos = tab === 'armando' || tab === 'enviados'
  const ayuda = TABS.find((t) => t.id === tab)?.ayuda
  const pedidoPresupuestos = nuevo ?? pedido

  return (
    <div className="trabajosPage">
      {/* Arriba, solo lo justo: el título, la lupa y "+ Nuevo". */}
      <div className="trbCab">
        <h2>Trabajos</h2>
        <button type="button" className={`trbIcono${buscando ? ' activo' : ''}`} aria-label="Buscar" aria-pressed={buscando} onClick={() => { setBuscando((v) => !v); if (buscando) setBusqueda('') }}>🔍</button>
        {verPresupuestos && <button type="button" className="trbNuevo" onClick={() => { setTab('armando'); setNuevo({ accion: 'nuevo', n: Date.now() }) }}>＋ Nuevo</button>}
      </div>
      {buscando && <input className="trbBuscar" type="search" autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar trabajo, cliente o lugar..." />}

      <div className="trabajosTabs trbTabs" role="tablist" aria-label="Etapas de los trabajos" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'activo' : ''} onClick={() => { setTab(t.id); setVerNo(false) }}>
            <span className="trabajosTabLargo">{t.texto}</span><span className="trabajosTabCorto">{t.corto}</span>
            {conteo[t.id] != null && <small>{conteo[t.id]}</small>}
          </button>
        ))}
      </div>
      {ayuda && <p className="trbAyuda">{ayuda}</p>}

      {esPresupuestos && verPresupuestos && (
        <Presupuestos
          key={tab}
          embebido
          grupo={tab === 'enviados' ? 'enviados' : 'armando'}
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
          onVerPresupuesto={verPresupuestos ? (id) => { setPresupuestoPedido(id); setTab('armando') } : undefined}
          onNuevoPresupuesto={verPresupuestos ? (o) => { setTab('armando'); setNuevo({ accion: 'nuevo', id: o.id, clienteId: o.cliente_id, n: Date.now() }) } : undefined}
        />
      )}

      {/* Los que no salieron: sin pestaña propia, al pie de Enviados y Terminados. */}
      {verPresupuestos && (tab === 'enviados' || tab === 'terminadas') && noSalieron > 0 && (
        <button type="button" className="trbVerNo" onClick={() => setVerNo((v) => !v)}>{verNo ? 'Ocultar' : 'Ver'} los que no salieron ({noSalieron})</button>
      )}
      {verPresupuestos && verNo && (tab === 'enviados' || tab === 'terminadas') && (
        <Presupuestos
          key="no-salieron"
          embebido
          grupo="rechazados"
          busquedaExterna={busqueda}
          presupuestoAbrirId={null}
          onAbrirObra={(id) => { setObraPedida(id); setTab('en_obra') }}
        />
      )}
    </div>
  )
}
