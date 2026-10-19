import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { EstadoPush } from './push'

// Para hacer → 🔔 Avisos: qué notificaciones llegan al celular.
// La Edge Function "enviar-recordatorios" (cada 15 minutos) lee esta
// configuración (configuracion → clave "avisos") y manda el resumen del día.

export type ConfigAvisos = { resumen: boolean; hora: number; viernes: boolean; stock: boolean }
export const AVISOS_DEF: ConfigAvisos = { resumen: true, hora: 8, viernes: true, stock: true }

export default function AvisosDiarios({ push, onPush, onCerrar }: { push: EstadoPush | 'cargando' | 'procesando'; onPush: () => void; onCerrar: () => void }) {
  const [cfg, setCfg] = useState<ConfigAvisos>(AVISOS_DEF)
  const [estado, setEstado] = useState('')
  useEffect(() => {
    void supabase.from('configuracion').select('valor').eq('clave', 'avisos').maybeSingle()
      .then(({ data }) => setCfg({ ...AVISOS_DEF, ...(data?.valor as Partial<ConfigAvisos> | undefined) }))
  }, [])
  async function guardar(nueva: ConfigAvisos) {
    setCfg(nueva); setEstado('Guardando…')
    const { error } = await supabase.from('configuracion').upsert({ clave: 'avisos', valor: nueva, updated_at: new Date().toISOString() })
    setEstado(error ? 'No se pudo guardar. Probá de nuevo.' : '✓ Guardado')
  }
  const sw = (k: 'resumen' | 'viernes' | 'stock') => <button type="button" role="switch" aria-checked={cfg[k]} className={`avSw${cfg[k] ? ' on' : ''}`} onClick={() => void guardar({ ...cfg, [k]: !cfg[k] })} />

  return <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
    <div className="modalCard avModal" role="dialog" aria-modal="true" aria-label="Avisos en el celular">
      <div className="modalHeader"><div><p className="subtitle">PARA HACER</p><h2>🔔 Avisos en el celular</h2></div><button type="button" className="closeButton" onClick={onCerrar} aria-label="Cerrar">×</button></div>
      <div className="avCuerpo">
        <div className={`avEste${push === 'activo' ? ' on' : ''}`}>
          <div><b>{push === 'activo' ? '✓ Este dispositivo recibe avisos' : push === 'bloqueado' ? 'Los avisos están bloqueados en este dispositivo' : push === 'no-soportado' ? 'Este dispositivo no puede recibir avisos' : 'Este dispositivo no recibe avisos'}</b>
            <small>{push === 'no-soportado' ? 'En iPhone: Compartir → Agregar a inicio, y abrí la app desde el ícono.' : push === 'bloqueado' ? 'Habilitalos en los ajustes del navegador o del teléfono y recargá.' : 'Activalo en cada celular o computadora donde quieras recibirlos.'}</small></div>
          <button type="button" className={push === 'activo' ? 'cancelButton' : 'newButton'} disabled={push === 'cargando' || push === 'procesando'} onClick={onPush}>{push === 'activo' ? 'Desactivar' : push === 'procesando' ? 'Activando…' : 'Activar'}</button>
        </div>
        <div className="avOp"><div><b>☀ Resumen de la mañana</b><small>Todo lo que tenés para hacer ese día: cobros, visitas, presupuestos, obras atrasadas.</small></div>
          <select aria-label="Hora del resumen" value={cfg.hora} disabled={!cfg.resumen} onChange={(e) => void guardar({ ...cfg, hora: Number(e.target.value) })}>
            {[6, 7, 8, 9, 10].map((h) => <option key={h} value={h}>{h}:00</option>)}
          </select>{sw('resumen')}</div>
        <div className="avOp"><div><b>📊 Resumen del viernes</b><small>A la tarde, cómo cerró la semana: vendido, cobrado y lo que quedó pendiente.</small></div>{sw('viernes')}</div>
        <div className="avOp"><div><b>📦 Stock bajo en el resumen</b><small>Suma al resumen de la mañana los productos que llegaron al mínimo.</small></div>{sw('stock')}</div>
        <div className="avOp fija"><div><b>📍 Antes de cada visita o reunión</b><small>Se elige en cada evento de la agenda (por defecto, 1 hora antes).</small></div><span>Siempre</span></div>
        <div className="avOp fija"><div><b>🧾 Cuando un cliente manda un comprobante</b><small>Apenas llega, para que lo revises.</small></div><span>Siempre</span></div>
        {estado && <p className="avEstado" role="status">{estado}</p>}
      </div>
    </div>
  </div>
}
