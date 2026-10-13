import { ESTADOS_TRABAJO, type EstadoTrabajo } from './estadoTrabajo'

// Barrita de 5 tramos: en qué punto del camino está el trabajo.
export function VidaTrabajo({ estado }: { estado: EstadoTrabajo }) {
  const paso = ESTADOS_TRABAJO[estado].paso
  return (
    <div className={`vidaTrab${estado === 'no' ? ' no' : ''}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < paso || estado === 'cobrado' ? 'ok' : i === paso ? 'hoy' : ''} />)}
    </div>
  )
}

export function PillTrabajo({ estado, extra }: { estado: EstadoTrabajo; extra?: string }) {
  const e = ESTADOS_TRABAJO[estado]
  return <span className={`pillTrab ${e.clase}`}>{e.texto}{extra ? ` · ${extra}` : ''}</span>
}
