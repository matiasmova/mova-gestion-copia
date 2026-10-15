import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cargarHistorialPrecios, ETIQUETA_ORIGEN, type CambioPrecio } from './historialPrecios'
import { formatoDinero } from './catalogoMoneda'

// Trazabilidad de precios de un producto: cada cambio de precio de venta o de
// costo, cuándo, quién y de dónde vino (catálogo, mercado, importación, dólar…).

const fechaHora = (f: string) => new Date(f).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

function Variacion({ antes, ahora }: { antes: number | null; ahora: number | null }) {
  if (ahora == null) return null
  if (antes == null || antes === ahora) return <b>{formatoDinero(ahora)}</b>
  const pct = antes > 0 ? ((ahora - antes) / antes) * 100 : null
  return <span className="hpVar">
    <s>{formatoDinero(antes)}</s> → <b>{formatoDinero(ahora)}</b>
    {pct != null && <em className={pct > 0 ? 'sube' : 'baja'}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%</em>}
  </span>
}

export function ListaHistorialPrecios({ productoId }: { productoId: number }) {
  const [cambios, setCambios] = useState<CambioPrecio[] | null | undefined>(undefined)
  useEffect(() => { void cargarHistorialPrecios(productoId).then(setCambios) }, [productoId])

  if (cambios === undefined) return <p className="gestionAyuda">Cargando historial…</p>
  if (cambios === null) return <p className="gestionAyuda">Para ver el historial de precios falta correr en Supabase el SQL <b>supabase-historial-precios-fase-31.sql</b>.</p>
  if (!cambios.length) return <p className="gestionAyuda">Todavía no hay cambios de precio registrados. Desde ahora, cada cambio queda anotado acá.</p>
  return <ol className="hpLista">
    {cambios.map((c) => {
      const cambioPrecio = c.precio_anterior !== c.precio_nuevo || c.origen === 'alta'
      const cambioCosto = c.costo_anterior !== c.costo_nuevo && (c.costo_nuevo ?? 0) > 0
      return <li key={c.id}>
        <div className="hpCab"><b>{ETIQUETA_ORIGEN[c.origen] ?? c.origen}</b><time>{fechaHora(c.fecha)}</time></div>
        {cambioPrecio && <div className="hpFila"><small>Venta</small><Variacion antes={c.precio_anterior} ahora={c.precio_nuevo} /></div>}
        {cambioCosto && <div className="hpFila"><small>Costo</small><Variacion antes={c.costo_anterior} ahora={c.costo_nuevo} /></div>}
        {(c.nota || c.usuario) && <small className="hpPie">{[c.nota, c.usuario && c.usuario !== 'sistema' ? c.usuario.split('@')[0] : null].filter(Boolean).join(' · ')}</small>}
      </li>
    })}
  </ol>
}

export default function HistorialPrecios({ producto, onCerrar }: { producto: { id: number; nombre: string }; onCerrar: () => void }) {
  return createPortal(
    <div className="modalOverlay" onClick={onCerrar}>
      <div className="modalCard catalogoModal hpModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div><p className="subtitle">🕑 HISTORIAL DE PRECIOS</p><h2>{producto.nombre}</h2></div>
          <button type="button" className="modalClose closeButton" onClick={onCerrar}>×</button>
        </div>
        <ListaHistorialPrecios productoId={producto.id} />
      </div>
    </div>,
    document.body,
  )
}
