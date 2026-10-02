import { useEffect, useRef, useState } from 'react'

// Efectos de movimiento de la app. Todos respetan "Reducir movimiento" del celular.
const quieto = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Monto que "cuenta" desde el valor anterior (o 0) hasta el nuevo.
export function Cifra({ valor, formato, dur = 900 }: { valor: number; formato: (n: number) => string; dur?: number }) {
  const [mostrado, setMostrado] = useState(() => (quieto() ? valor : 0))
  const desde = useRef(quieto() ? valor : 0)
  useEffect(() => {
    if (quieto() || !Number.isFinite(valor)) { setMostrado(valor); desde.current = valor; return }
    const inicio = desde.current, t0 = performance.now()
    let id = 0
    const paso = (t: number) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3)
      const n = inicio + (valor - inicio) * e
      setMostrado(p < 1 ? n : valor)
      if (p < 1) id = requestAnimationFrame(paso)
      else desde.current = valor
    }
    id = requestAnimationFrame(paso)
    return () => { cancelAnimationFrame(id); desde.current = valor }
  }, [valor, dur])
  return <span className="cifraAnim">{formato(mostrado)}</span>
}

// Aviso abajo con tilde que se dibuja ("✓ Cobro guardado").
let temporizador = 0
export function avisoGuardado(texto: string) {
  if (typeof document === 'undefined') return
  document.querySelector('.avisoOk')?.remove()
  const el = document.createElement('div')
  el.className = 'avisoOk'
  el.setAttribute('role', 'status')
  el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12"/><path d="M7 12.5l3.2 3.2L17 9"/></svg><span></span>'
  el.querySelector('span')!.textContent = texto
  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('ver'))
  window.clearTimeout(temporizador)
  temporizador = window.setTimeout(() => { el.classList.remove('ver'); window.setTimeout(() => el.remove(), 350) }, 2400)
}
