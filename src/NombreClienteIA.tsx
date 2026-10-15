import { useState } from 'react'
import { pedirAsistente } from './asistenteIA'

// "✨ Crear con IA" para el nombre que ve el cliente en el presupuesto:
// corto, representativo y sin marca, modelo ni detalles técnicos. Propone 3.

export function useNombreClienteIA(nombre: string, tipo: string, onElegir: (n: string) => void) {
  const [opciones, setOpciones] = useState<string[]>([])
  const [pensando, setPensando] = useState(false)
  const [error, setError] = useState('')

  async function crear() {
    if (!nombre.trim()) { setError('Escribí primero el nombre del producto.'); return }
    setError(''); setPensando(true); setOpciones([])
    try {
      const r = await pedirAsistente<{ opciones: string[] }>({ accion: 'nombre_cliente', nombre: nombre.trim(), tipo })
      if (!r.opciones?.length) setError('La IA no propuso nombres. Probá de nuevo.')
      else { setOpciones(r.opciones); onElegir(r.opciones[0]) }
    } catch (e) {
      const m = (e as Error).message
      setError(/desconocida/i.test(m) ? 'Falta actualizar la función "asistente-ia" en Supabase para usar esto.' : m)
    } finally { setPensando(false) }
  }

  const boton = <button type="button" className="bcNombreIA" disabled={pensando} onClick={() => void crear()}>{pensando ? '✨ Pensando…' : '✨ Crear con IA'}</button>
  const elegir = (actual: string) => <>
    {opciones.length > 1 && <span className="bcNombreOpc">{opciones.map((n) => <button type="button" key={n} className={n === actual ? 'on' : ''} onClick={() => onElegir(n)}>{n}</button>)}</span>}
    {error && <small className="bcMercadoError">{error}</small>}
  </>
  return { boton, elegir, error }
}
