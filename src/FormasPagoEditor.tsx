import { useEffect, useState } from 'react'
import { avisoGuardado } from './Animados'
import { MEDIOS_PAGO, cargarFormasPago, guardarFormasPago, textoMedios, type FormasPago } from './formasPago'

// Formas de pago del presupuesto, visibles y editables desde la ficha (sin
// tener que editar todo el presupuesto). Solo informativas: no cambian el precio.
export default function FormasPagoEditor({ presupuestoId, onGuardado }: { presupuestoId: number; onGuardado: () => void }) {
  const [formas, setFormas] = useState<FormasPago | null>(null)
  const [edicion, setEdicion] = useState<FormasPago | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setFormas(null); setEdicion(null); void cargarFormasPago(presupuestoId).then(setFormas) }, [presupuestoId])

  async function guardar() {
    if (!edicion) return
    setGuardando(true); setError('')
    const ok = await guardarFormasPago(presupuestoId, edicion)
    setGuardando(false)
    if (!ok) { setError('No se pudo guardar: falta correr en Supabase el SQL "supabase-formas-pago-fase-22.sql".'); return }
    setFormas(edicion); setEdicion(null); avisoGuardado('Formas de pago guardadas'); onGuardado()
  }

  if (!formas) return null
  return (
    <div className="formasPagoCard">
      {!edicion ? <>
        <span className="formasPagoIcono">💳</span>
        <div><small>Formas de pago</small><b>{formas.medios.length ? textoMedios(formas) : 'Sin formas de pago'}</b>{formas.nota && <span>{formas.nota}</span>}</div>
        <button type="button" className="editButton" onClick={() => setEdicion({ ...formas, medios: [...formas.medios] })}>✏️ Cambiar</button>
      </> : <div className="formasPagoEdicion">
        <small>Formas de pago que aceptás <em>(no cambian el precio)</em></small>
        <div className="caChips">
          {MEDIOS_PAGO.map((m) => {
            const activo = edicion.medios.includes(m.id)
            return <button type="button" key={m.id} className={activo ? 'activo' : ''} onClick={() => setEdicion((f) => f && ({ ...f, medios: activo ? f.medios.filter((x) => x !== m.id) : MEDIOS_PAGO.map((x) => x.id).filter((x) => x === m.id || f.medios.includes(x)) }))}>{m.icono} {m.texto}</button>
          })}
        </div>
        <input value={edicion.nota} maxLength={200} onChange={(e) => setEdicion((f) => f && ({ ...f, nota: e.target.value }))} placeholder="Aclaración opcional (ej.: tarjeta hasta 3 cuotas)" />
        {error && <p className="loginError" style={{ margin: 0 }}>{error}</p>}
        <div className="formasPagoAcc">
          <button type="button" className="cancelButton" onClick={() => { setEdicion(null); setError('') }}>Cancelar</button>
          <button type="button" className="newButton" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>}
    </div>
  )
}
