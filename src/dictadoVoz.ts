import { useEffect, useRef, useState } from 'react'

// Dictado con el micrófono (reconocimiento de voz del navegador, en español).
type Reconocedor = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((ev: { error: string }) => void) | null }
export function useDictado(alTexto: (texto: string, final: boolean) => void) {
  const [escuchando, setEscuchando] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<Reconocedor | null>(null)
  function empezar() {
    setError('')
    const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor }
    const Clase = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Clase) { setError('En este navegador no se puede usar el micrófono acá. Tocá el campo y usá el 🎤 del teclado para dictar.'); return }
    const r = new Clase()
    r.lang = 'es-AR'; r.interimResults = true; r.continuous = false
    r.onresult = (ev) => {
      let texto = '', final = false
      for (let i = 0; i < ev.results.length; i++) { texto += ev.results[i][0].transcript; final = ev.results[i].isFinal }
      alTexto(texto.trim(), final)
    }
    r.onerror = (ev) => setError(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'No hay permiso para el micrófono. Habilitalo en los ajustes del navegador, o usá el 🎤 del teclado.' : ev.error === 'no-speech' ? 'No te escuché. Probá de nuevo.' : 'No se pudo usar el micrófono. Usá el 🎤 del teclado.')
    r.onend = () => setEscuchando(false)
    ref.current = r
    try { r.start(); setEscuchando(true) } catch { setError('No se pudo usar el micrófono. Usá el 🎤 del teclado.') }
  }
  function parar() { ref.current?.stop(); setEscuchando(false) }
  useEffect(() => () => ref.current?.stop(), [])
  return { escuchando, error, empezar, parar }
}
