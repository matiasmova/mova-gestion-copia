import { useState } from 'react'

export type Vista = 'lista' | 'kanban'

/** Recuerda la vista elegida por módulo (por navegador). Nunca rompe si no hay storage. */
export function useVista(clave: string, inicial: Vista = 'kanban'): [Vista, (v: Vista) => void] {
  const [vista, setVista] = useState<Vista>(() => {
    try {
      const guardada = localStorage.getItem(`mova.vista.${clave}`)
      return guardada === 'lista' || guardada === 'kanban' ? guardada : inicial
    } catch {
      return inicial
    }
  })
  const cambiar = (v: Vista) => {
    setVista(v)
    try {
      localStorage.setItem(`mova.vista.${clave}`, v)
    } catch {
      /* modo privado o storage bloqueado: seguimos igual */
    }
  }
  return [vista, cambiar]
}

export default function VistaToggle({ vista, onCambio }: { vista: Vista; onCambio: (v: Vista) => void }) {
  return (
    <div className="vistaToggle" role="group" aria-label="Cambiar vista">
      <button
        type="button"
        className={vista === 'kanban' ? 'active' : ''}
        onClick={() => onCambio('kanban')}
        aria-pressed={vista === 'kanban'}
        title="Vista Kanban (por estado)"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="6" height="18" rx="1" /><rect x="10" y="3" width="6" height="12" rx="1" /><rect x="17" y="3" width="4" height="8" rx="1" /></svg>
        Kanban
      </button>
      <button
        type="button"
        className={vista === 'lista' ? 'active' : ''}
        onClick={() => onCambio('lista')}
        aria-pressed={vista === 'lista'}
        title="Vista Lista"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
        Lista
      </button>
    </div>
  )
}
