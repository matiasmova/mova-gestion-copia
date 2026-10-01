// Línea de vida de un trabajo: Borrador → Enviado → Aceptado → En obra →
// Terminada → Cobrada. La usan la ficha del presupuesto, la de la obra y la lista.

export type ObraEtapa = { estado: string | null; porcentaje_avance: number | null }
type Paso = { texto: string; estado: 'ok' | 'hoy' | 'futuro' | 'no' }

const terminada = (o?: ObraEtapa | null) => !!o && (o.estado === 'finalizada' || o.estado === 'observacion' || Number(o.porcentaje_avance) >= 100)

// En qué etapa está un presupuesto (con su obra, si tiene).
export function etapaDe(estado: string, obra?: ObraEtapa | null, saldo?: number): number {
  if (estado === 'borrador') return 0
  if (estado === 'enviado') return 1
  if (estado === 'rechazado') return -1
  if (!obra) return 2
  if (!terminada(obra)) return 3
  return saldo != null && saldo <= 0.5 ? 6 : 4 // 6 = todo cumplido
}

export function pasosPresupuesto(estado: string, obra?: ObraEtapa | null, saldo?: number): Paso[] {
  const e = etapaDe(estado, obra, saldo)
  const avance = Math.round(Number(obra?.porcentaje_avance) || 0)
  const textos = ['Borrador', 'Enviado', 'Aceptado', obra && e === 3 ? `En obra ${avance}%` : 'En obra', 'Terminada', 'Cobrada']
  if (e === -1) return [{ texto: 'Borrador', estado: 'ok' }, { texto: 'Enviado', estado: 'ok' }, { texto: 'Rechazado', estado: 'no' }]
  return textos.map((texto, i) => ({ texto, estado: i < e ? 'ok' : i === e ? 'hoy' : 'futuro' }))
}

// Para la obra: desde que se aceptó.
export function pasosObra(obra: ObraEtapa, saldo?: number): Paso[] {
  return pasosPresupuesto('aceptado', obra, saldo).slice(2)
}

// Etiqueta corta para la lista de presupuestos.
export function etiquetaEtapa(p: { estado: string; enviado_at?: string | null; fecha: string; motivo_rechazo?: string | null }, obra?: ObraEtapa | null, saldo?: number): { texto: string; clase: string; avance?: number } {
  const e = etapaDe(p.estado, obra, saldo)
  const dias = Math.max(0, Math.floor((Date.now() - new Date((p.enviado_at || p.fecha).slice(0, 10) + 'T12:00:00').getTime()) / 86400000))
  switch (e) {
    case 0: return { texto: '📝 Borrador', clase: 'et-borrador' }
    case 1: return { texto: `📤 Enviado · ${dias === 0 ? 'hoy' : `${dias} día${dias === 1 ? '' : 's'}`}`, clase: 'et-enviado' }
    case -1: return { texto: `❌ Rechazado${p.motivo_rechazo ? ` · ${p.motivo_rechazo.split(':')[0].toLowerCase()}` : ''}`, clase: 'et-rechazado' }
    case 2: return { texto: '✅ Aceptado · falta crear la obra', clase: 'et-aceptado' }
    case 3: { const a = Math.round(Number(obra?.porcentaje_avance) || 0); return { texto: `🏗️ En obra · ${a}%`, clase: 'et-obra', avance: a } }
    case 4: return { texto: '🏁 Terminada · falta cobrar', clase: 'et-obra', avance: 100 }
    default: return { texto: '✅ Terminada y cobrada', clase: 'et-cobrada' }
  }
}

export default function VidaEtapas({ pasos }: { pasos: Paso[] }) {
  return (
    <ol className="vidaEtapas" aria-label="Etapas">
      {pasos.map((p, i) => (
        <li key={i} className={`vida-${p.estado}`} aria-current={p.estado === 'hoy' ? 'step' : undefined}>
          <i>{p.estado === 'ok' ? '✓' : p.estado === 'no' ? '✕' : ''}</i>
          <span>{p.texto}</span>
        </li>
      ))}
    </ol>
  )
}
