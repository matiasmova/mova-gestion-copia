import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Aviso al instante (con la app abierta) cuando un cliente envía un comprobante
// de pago desde la página de pago. Necesita el SQL de la fase 25 (tiempo real).
type Nuevo = { id: number; cliente: string | null; titulo: string | null; obra_id: number | null; origen?: string | null }

export default function AvisoComprobantes({ onAbrirObra }: { onAbrirObra: (obraId: number | null) => void }) {
  const [aviso, setAviso] = useState<Nuevo | null>(null)
  const [ver, setVer] = useState(false)

  useEffect(() => {
    const canal = supabase.channel('comprobantes-pago')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pago_comprobantes' }, (p) => {
        const c = p.new as Nuevo
        if (c.origen === 'manual') return
        setAviso(c); setVer(false)
        requestAnimationFrame(() => requestAnimationFrame(() => setVer(true)))
        try { navigator.vibrate?.([120, 60, 120]) } catch { /* sin vibración */ }
      })
      .subscribe()
    return () => { void supabase.removeChannel(canal) }
  }, [])

  if (!aviso) return null
  const cerrar = () => { setVer(false); window.setTimeout(() => setAviso(null), 450) }
  return (
    <div className={`avisoComp ${ver ? 'ver' : ''}`} role="alert">
      <span className="ico">🧾</span>
      <div><b>¡Llegó un comprobante de pago!</b><small>{aviso.cliente ?? 'Un cliente'}{aviso.titulo ? ` · ${aviso.titulo}` : ''}</small></div>
      <button type="button" className="ir" onClick={() => { onAbrirObra(aviso.obra_id); cerrar() }}>Ver</button>
      <button type="button" className="x" aria-label="Cerrar" onClick={cerrar}>✕</button>
    </div>
  )
}
