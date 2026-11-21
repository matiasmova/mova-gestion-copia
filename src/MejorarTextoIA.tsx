import { useState } from 'react'
import { pedirAsistente } from './asistenteIA'

// "✨ Corregir con IA" para la descripción de un ítem: la IA propone 3 versiones
// (corregida, clara y breve); se toca una para usarla y se puede deshacer.
export default function MejorarTextoIA({ texto, tipo, contexto, onCambiar }: { texto: string; tipo?: string | null; contexto?: string; onCambiar: (t: string) => void }) {
  const [opciones, setOpciones] = useState<string[]>([])
  const [pensando, setPensando] = useState(false)
  const [error, setError] = useState('')
  const [original, setOriginal] = useState<string | null>(null)

  async function pedir() {
    if (!texto.trim()) { setError('Escribí primero la descripción (como te salga).'); return }
    setError(''); setPensando(true); setOpciones([])
    try {
      const r = await pedirAsistente<{ opciones: string[] }>({ accion: 'mejorar_descripcion', texto, tipo: tipo === 'servicio' ? 'servicio' : 'producto', contexto })
      if (!r.opciones?.length) { setError('La IA no propuso textos. Probá de nuevo.'); return }
      setOriginal((o) => o ?? texto)
      setOpciones(r.opciones)
      onCambiar(r.opciones[Math.min(1, r.opciones.length - 1)])
    } catch (e) {
      const m = (e as Error).message
      setError(/desconocida/i.test(m) ? 'Falta publicar la función "asistente-ia" actualizada en Supabase para usar esto.' : m)
    } finally { setPensando(false) }
  }

  const ETIQUETAS = ['Corregida', 'Clara', 'Breve']
  return <div className="mtIA">
    <div className="mtIAFila">
      <button type="button" className="mtIABoton" disabled={pensando} onClick={() => void pedir()}>{pensando ? '✨ Corrigiendo…' : '✨ Corregir con IA'}</button>
      {original != null && !pensando && <button type="button" className="mtIADeshacer" onClick={() => { onCambiar(original); setOriginal(null); setOpciones([]) }}>↩ Volver a lo mío</button>}
    </div>
    {opciones.length > 1 && <div className="mtIAOpc" role="group" aria-label="Versiones propuestas">
      {opciones.map((o, i) => <button key={i} type="button" className={o === texto ? 'on' : ''} onClick={() => onCambiar(o)}><b>{ETIQUETAS[i] ?? `Opción ${i + 1}`}</b><span>{o}</span></button>)}
    </div>}
    {error && <p className="mtIAError" role="alert">{error}</p>}
  </div>
}
