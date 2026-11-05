import { siguientePaso, terminarRecorrido, useRecorrido } from './recorridoPH'

// Barrita flotante del recorrido de pendientes: en cuál vas, "Hecho y
// siguiente", "Siguiente" y volver a Para hacer.
export default function BarraRecorrido({ onVolver }: { onVolver: () => void }) {
  const r = useRecorrido()
  if (!r) return null
  const ultimo = r.i >= r.pasos.length - 1
  const fin = (res: 'fin' | 'sigue' | undefined) => { if (res === 'fin') onVolver() }
  return <div className="brWrap" role="region" aria-label="Recorrido de pendientes">
    <div className="brInfo"><span aria-hidden>{r.icono}</span><b>{r.nombre}</b><small>{r.i + 1} de {r.pasos.length}</small>
      <button type="button" className="brCerrar" aria-label="Terminar recorrido y volver a Para hacer" onClick={() => { terminarRecorrido(); onVolver() }}>✕</button></div>
    <div className="brAcc">
      <button type="button" className="brHecho" onClick={() => fin(siguientePaso(true))}>✓ Hecho{ultimo ? '' : ' y siguiente'}</button>
      {!ultimo ? <button type="button" className="brSig" onClick={() => fin(siguientePaso(false))}>Siguiente ›</button>
        : <button type="button" className="brSig" onClick={() => { terminarRecorrido(); onVolver() }}>Volver a Para hacer</button>}
    </div>
  </div>
}
