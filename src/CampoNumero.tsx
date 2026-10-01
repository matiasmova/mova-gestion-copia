import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'

// Campo de número para toda la app (reemplaza a <input type="number">):
//  · Muestra puntos de miles y coma decimal mientras se escribe (400.000,50).
//  · Al tocarlo selecciona todo, así lo que se escribe reemplaza el 0.
//  · Hacia afuera se comporta igual que antes: onChange/onBlur reciben en
//    e.target.value el número "crudo" con punto decimal ("400000.5"), así que
//    los formularios no cambian.

type Evento = { target: { value: string }; currentTarget: { value: string } }
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'onBlur'> & {
  value?: number | string | null
  defaultValue?: number | string | null
  onChange?: (e: Evento) => void
  onBlur?: (e: Evento) => void
}

const evento = (value: string): Evento => ({ target: { value }, currentTarget: { value } })
const conMiles = (digitos: string) => digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

// Número (o texto con punto decimal) → texto argentino: 1234.5 → "1.234,5".
export function formatoCampo(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return ''
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return String(v)
  const [ent, dec] = String(Math.round(n * 10000) / 10000).replace('-', '').split('.')
  return `${n < 0 ? '-' : ''}${conMiles(ent)}${dec ? `,${dec}` : ''}`
}

// Lo que escribió la persona → texto a mostrar y número crudo.
function interpretar(texto: string, negativo: boolean): { mostrar: string; crudo: string } {
  const signo = negativo && texto.trim().startsWith('-') ? '-' : ''
  const limpio = texto.replace(/[^\d,]/g, '')
  const coma = limpio.indexOf(',')
  const ent = (coma >= 0 ? limpio.slice(0, coma) : limpio).replace(/^0+(?=\d)/, '')
  const dec = coma >= 0 ? limpio.slice(coma + 1).replace(/,/g, '').slice(0, 4) : ''
  const mostrar = `${signo}${conMiles(ent)}${coma >= 0 ? `,${dec}` : ''}`
  const crudo = ent || dec ? `${signo}${ent || '0'}${dec ? `.${dec}` : ''}` : signo
  return { mostrar, crudo }
}

export default function CampoNumero({ value, defaultValue, onChange, onBlur, onFocus, min, ...resto }: Props) {
  const controlado = value !== undefined
  const negativo = min === undefined || Number(min) < 0
  const [texto, setTexto] = useState(() => formatoCampo(controlado ? value : defaultValue))
  const crudoRef = useRef(interpretar(texto, negativo).crudo)
  const enfocado = useRef(false)

  // Si el valor cambia desde afuera (cálculos, al abrir otro registro), se muestra.
  useEffect(() => {
    if (!controlado) return
    const externo = value === null || value === '' ? '' : String(value)
    if (externo === crudoRef.current) return
    // Mientras se escribe, si es el mismo número no se toca (así se puede
    // borrar todo aunque el formulario lo guarde como 0).
    const numCrudo = Number(crudoRef.current === '-' ? 0 : crudoRef.current || 0)
    if (Number(externo || 0) === numCrudo && (enfocado.current || (externo !== '' && crudoRef.current !== ''))) return
    const t = formatoCampo(value)
    setTexto(t)
    crudoRef.current = interpretar(t, negativo).crudo
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  function cambiar(nuevo: string) {
    // Un punto escrito a mano (teclados sin coma) se toma como coma decimal:
    // los puntos de miles los pone el campo solo.
    if (nuevo.length === texto.length + 1 && !nuevo.includes(',')) {
      let i = 0
      while (i < texto.length && texto[i] === nuevo[i]) i++
      if (nuevo[i] === '.') nuevo = `${nuevo.slice(0, i)},${nuevo.slice(i + 1)}`
    }
    const { mostrar, crudo } = interpretar(nuevo, negativo)
    setTexto(mostrar)
    crudoRef.current = crudo
    onChange?.(evento(crudo === '-' ? '' : crudo))
  }

  return (
    <input
      {...resto}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={texto}
      onChange={(e) => cambiar(e.target.value)}
      onFocus={(e) => {
        enfocado.current = true
        // Seleccionar todo: lo que se escribe reemplaza el valor (adiós al 0 adelante).
        const el = e.currentTarget
        requestAnimationFrame(() => { try { el.select() } catch { /* sin selección */ } })
        onFocus?.(e)
      }}
      onBlur={() => {
        enfocado.current = false
        const crudo = crudoRef.current === '-' ? '' : crudoRef.current
        // Al salir se prolija (por ejemplo "12," queda "12").
        setTexto(crudo === '' ? '' : formatoCampo(crudo))
        onBlur?.(evento(crudo))
      }}
    />
  )
}
