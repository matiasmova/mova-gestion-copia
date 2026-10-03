import { useEffect, useState } from 'react'
import './arranque.css'

// Pantalla de arranque: "Iniciando sistema MOVA" con un chip animado.
// Dura poco (≈2 s), se puede saltear tocando y respeta "reducir movimiento".
const PASOS = ['Conectando con el servidor…', 'Cargando obras y presupuestos…', 'Preparando tu tablero…', 'Sistema listo ✓']

export default function Arranque() {
  const reducido = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const duracion = reducido ? 700 : 2300
  const [paso, setPaso] = useState(0)
  const [saliendo, setSaliendo] = useState(false)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const cada = duracion / PASOS.length
    const t = window.setInterval(() => setPaso((p) => Math.min(p + 1, PASOS.length - 1)), cada)
    const fin = window.setTimeout(() => setSaliendo(true), duracion)
    return () => { window.clearInterval(t); window.clearTimeout(fin) }
  }, [duracion])
  useEffect(() => {
    if (!saliendo) return
    const t = window.setTimeout(() => setVisible(false), 550)
    return () => window.clearTimeout(t)
  }, [saliendo])

  if (!visible) return null
  return (
    <div className={`arranque ${saliendo ? 'sale' : ''}`} role="status" aria-label="Iniciando sistema MOVA" onClick={() => setSaliendo(true)}>
      <div className="arrGrilla" aria-hidden="true" />
      <div className="arrLuz a" aria-hidden="true" /><div className="arrLuz b" aria-hidden="true" />
      <div className="arrCentro">
        <svg className="arrChip" viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <linearGradient id="arrG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f08a2c" /><stop offset="1" stopColor="#25b46a" /></linearGradient>
            <linearGradient id="arrG2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#25b46a" /><stop offset="1" stopColor="#de7015" /></linearGradient>
          </defs>
          <circle className="arrAnillo uno" cx="100" cy="100" r="88" fill="none" stroke="url(#arrG)" strokeWidth="2.5" strokeDasharray="40 14 8 14" strokeLinecap="round" />
          <circle className="arrAnillo dos" cx="100" cy="100" r="74" fill="none" stroke="url(#arrG2)" strokeWidth="1.6" strokeDasharray="4 9" strokeLinecap="round" />
          {/* patitas del chip */}
          <g className="arrPatas" stroke="url(#arrG)" strokeWidth="3" strokeLinecap="round">
            {[78, 92, 106, 120].map((x) => <g key={x}><line x1={x} y1="46" x2={x} y2="58" /><line x1={x} y1="142" x2={x} y2="154" /><line x1="46" y1={x} x2="58" y2={x} /><line x1="142" y1={x} x2="154" y2={x} /></g>)}
          </g>
          <rect x="60" y="60" width="80" height="80" rx="16" fill="#12171f" stroke="url(#arrG)" strokeWidth="3" />
          {/* pistas que se encienden */}
          <g className="arrPistas" fill="none" stroke="#25b46a" strokeWidth="2" strokeLinecap="round">
            <path d="M74 120 h14 l8 -8 h10" /><path d="M126 80 h-14 l-8 8 h-8" /><path d="M74 86 h8" /><path d="M118 114 h8" />
          </g>
          <text x="100" y="111" textAnchor="middle" className="arrM">M</text>
          <circle className="arrPunto" cx="100" cy="12" r="5" fill="#f08a2c" />
        </svg>
        <div className="arrMarca"><b>MOVA</b><span>Tecnología Smart</span></div>
        <p className="arrTitulo">Iniciando sistema MOVA<span className="arrPuntos"><i>.</i><i>.</i><i>.</i></span></p>
        <div className="arrBarra"><i /></div>
        <p className="arrPaso" key={paso}>{PASOS[paso]}</p>
      </div>
    </div>
  )
}
