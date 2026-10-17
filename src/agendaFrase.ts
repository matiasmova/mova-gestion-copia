// Entiende una frase dictada o escrita para la agenda:
// "reunión con Aldo el jueves a las 3 de la tarde" → tipo, día, hora, cliente y obra.

export type Opcion = { id: number; nombre: string }
export type FraseEntendida = { tipo: 'reunion' | 'llamada' | 'visita' | 'recordatorio'; fecha: string; hora: string | null; cliente_id: number | null; obra_id: number | null; titulo: string }

const pad = (n: number) => String(n).padStart(2, '0')
export const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
const NUMEROS: Record<string, number> = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 }

export function entenderFrase(frase: string, clientes: Opcion[], obras: Opcion[], hoy = new Date()): FraseEntendida {
  const s = sinTildes(frase).replace(/(\d)\s*(hs|h|horas)\b/g, '$1 hs')
  const tipo: FraseEntendida['tipo'] = /llam|telefon/.test(s) ? 'llamada' : /visita|medir|medicion|relevamiento|ir a la obra/.test(s) ? 'visita' : /reunion|juntarme|encuentro/.test(s) ? 'reunion' : 'recordatorio'

  // Día
  let fecha = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const mas = (n: number) => { const d = new Date(fecha); d.setDate(d.getDate() + n); return d }
  const fechaNum = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  const elDia = s.match(/\bel (\d{1,2})\b(?!\s*(hs|:|de la))/)
  if (/pasado manana/.test(s)) fecha = mas(2)
  else if (/\bmanana\b/.test(s.replace(/(de|por) la manana/g, ''))) fecha = mas(1)
  else if (fechaNum) {
    const a = fechaNum[3] ? Number(fechaNum[3].length === 2 ? `20${fechaNum[3]}` : fechaNum[3]) : fecha.getFullYear()
    fecha = new Date(a, Number(fechaNum[2]) - 1, Number(fechaNum[1]))
  } else {
    const k = DIAS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(s))
    if (k >= 0) fecha = mas(((k - fecha.getDay() + 7) % 7) || 7)
    else if (elDia) {
      const d = Number(elDia[1])
      fecha = new Date(fecha.getFullYear(), fecha.getMonth() + (d < fecha.getDate() ? 1 : 0), d)
    }
  }

  // Hora: "15hs", "10:30", "a las 3 de la tarde", "a las tres", "9 am"
  let hora: string | null = null
  const m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(hs|am|pm)\b/) ?? s.match(/\ba las (\d{1,2}|[a-z]+)(?::(\d{2}))?(?:\s*y\s*(media|cuarto))?/) ?? s.match(/\b(\d{1,2}):(\d{2})\b/)
  if (m) {
    let h = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMEROS[m[1]] ?? NaN
    let min = m[2] ? Number(m[2]) : 0
    if (m[3] === 'media') min = 30
    if (m[3] === 'cuarto') min = 15
    if (!Number.isNaN(h) && h <= 23) {
      if ((m[3] === 'pm' || /de la tarde|de la noche/.test(s)) && h < 12) h += 12
      else if (!/de la manana|am\b/.test(s) && h >= 1 && h <= 7 && !/hs/.test(m[0])) h += 12 // "a las 3" = 15
      hora = `${pad(h)}:${pad(min)}`
    }
  }

  // Cliente y obra por nombre: gana el que tiene más palabras propias en la frase
  // (las genéricas como "casa" u "obra" no alcanzan solas).
  const GENERICAS = new Set(['casa', 'obra', 'depto', 'departamento', 'local', 'oficina', 'barrio', 'calle', 'del', 'los', 'las', 'con', 'para'])
  const palabras = new Set(s.split(/[^a-z0-9ñ]+/).filter(Boolean))
  const buscar = (lista: Opcion[]) => {
    let mejor: Opcion | null = null, puntos = 0
    for (const o of lista) {
      const n = sinTildes(o.nombre)
      const propias = n.split(/\s+/).filter((w) => w.length > 2 && !GENERICAS.has(w))
      const coinciden = propias.filter((w) => palabras.has(w)).length
      const p = (s.includes(n) ? 10 : 0) + coinciden
      if (coinciden > 0 && p > puntos) { mejor = o; puntos = p }
    }
    return mejor
  }
  const cliente = buscar(clientes)
  const obra = buscar(obras)

  // Título: la frase sin la parte de día y hora
  let titulo = frase
    .replace(/\ba las \S+(\s*y\s*(media|cuarto))?(\s*de la (mañana|manana|tarde|noche))?/gi, '')
    .replace(/\b(de|por) la (mañana|manana|tarde|noche)\b/gi, '')
    .replace(/\b(pasado mañana|pasado manana|mañana|manana|hoy)\b/gi, '')
    .replace(/\b(el|este|próximo|proximo)\s+(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/gi, '')
    .replace(/\b(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/gi, '')
    .replace(/\ba las \S+(\s*y\s*(media|cuarto))?(\s*de la (mañana|manana|tarde|noche))?/gi, '')
    .replace(/\b\d{1,2}(:\d{2})?\s*(hs|h|horas|am|pm)\b/gi, '')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '')
    .replace(/\bel \d{1,2}\b/gi, '')
    .replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim().replace(/[,.]$/, '')
  if (titulo) titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1)

  return { tipo, fecha: isoLocal(fecha), hora, cliente_id: cliente?.id ?? null, obra_id: obra?.id ?? null, titulo: titulo || 'Recordatorio' }
}
