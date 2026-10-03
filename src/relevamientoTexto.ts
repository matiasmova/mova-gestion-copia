// Ordena lo anotado o dictado en la visita ("1 tecla 2 puntos cocina (ver) + dimmer",
// "Dimmer 3 canales habitación principal", "1 lámpara smart jacuzzi"…) en ítems
// por ambiente. No usa IA: reglas simples pensadas para cómo anota MOVA.

export type TipoRelev = 'dimmer' | 'tecla' | 'onoff' | 'lampara' | 'otro'

export type ItemRelev = {
  id?: number
  ambiente: string
  cantidad: number
  tipo: TipoRelev
  canales: number | null
  detalle: string
  revisar: boolean
  smart: boolean
  orden?: number
}

export const TIPOS_RELEV: { id: TipoRelev; texto: string; icono: string }[] = [
  { id: 'dimmer', texto: 'Dimmer', icono: '🎚️' },
  { id: 'tecla', texto: 'Tecla', icono: '🔘' },
  { id: 'onoff', texto: 'On/Off', icono: '⏻' },
  { id: 'lampara', texto: 'Lámpara', icono: '💡' },
  { id: 'otro', texto: 'Otro', icono: '🔧' },
]
export const nombreTipo = (t: TipoRelev) => TIPOS_RELEV.find((x) => x.id === t)?.texto ?? 'Otro'

// Ambientes más comunes (para reconocerlos en el texto y como accesos rápidos).
export const AMBIENTES_COMUNES = ['Cochera', 'Frente', 'Entrada', 'Living', 'Comedor', 'Cocina', 'Galería', 'Terraza', 'Habitación principal', 'Habitación', 'Baño', 'Pasillo', 'Escalera', 'Patio', 'Quincho', 'Jacuzzi', 'Lavadero', 'Oficina']

const AMBIENTES_TEXTO: [RegExp, string][] = [
  [/habitaci[oó]n principal|dormitorio principal|suite/i, 'Habitación principal'],
  [/habitaci[oó]n|dormitorio|cuarto/i, 'Habitación'],
  [/cochera|garage|garaje/i, 'Cochera'],
  [/frente|fachada/i, 'Frente'],
  [/entrada|hall|recibidor/i, 'Entrada'],
  [/living|estar/i, 'Living'],
  [/comedor/i, 'Comedor'],
  [/cocina/i, 'Cocina'],
  [/galer[ií]a/i, 'Galería'],
  [/terraza|balc[oó]n/i, 'Terraza'],
  [/ba[ñn]o|toilette/i, 'Baño'],
  [/pasillo/i, 'Pasillo'],
  [/escalera/i, 'Escalera'],
  [/patio|jard[ií]n/i, 'Patio'],
  [/quincho|parrilla/i, 'Quincho'],
  [/jacuzzi|yacuzzi|yacuxi|jacuzi|hidromasaje/i, 'Jacuzzi'],
  [/lavadero/i, 'Lavadero'],
  [/oficina|escritorio/i, 'Oficina'],
  [/pileta|piscina/i, 'Pileta'],
  [/vestidor/i, 'Vestidor'],
]

const NUMEROS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 }
const num = (t: string) => (/^\d+$/.test(t) ? Number(t) : NUMEROS[t.toLowerCase()] ?? NaN)
const NUM = '(\\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)'
const UNIDAD = '(canales|canal|canes|puntos|punto|cables|v[ií]as)'

function tipoDe(t: string): TipoRelev | null {
  const s = t.toLowerCase()
  const pos: [TipoRelev, number][] = [
    ['dimmer', s.search(/dimm?er|dimer/)],
    ['onoff', s.search(/on\s*[/-]?\s*off/)],
    ['tecla', s.search(/tecla|llave|interruptor|pulsador/)],
    ['lampara', s.search(/l[aá]mpara|foco|bombita|luminaria/)],
  ]
  const hallados = pos.filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])
  return hallados[0]?.[0] ?? null
}

export function ambienteDe(t: string): string | null {
  for (const [re, nombre] of AMBIENTES_TEXTO) if (re.test(t)) return nombre
  return null
}

// Corta el texto en renglones: saltos de línea, ";" y frases dictadas ("…, y otro…").
function renglones(texto: string): string[] {
  return texto
    .replace(/\r/g, '')
    .split(/\n|;|\.\s+(?=[A-ZÁÉÍÓÚ0-9])|,\s*(?=(?:\d+|un|una|uno|dos|tres|cuatro|cinco|otra|otro)\b)/i)
    .map((r) => r.replace(/^[\s•·*\-–]+/, '').trim())
    .filter((r) => r.length > 1)
}

export function ordenarTexto(texto: string, ambientePorDefecto = 'General'): ItemRelev[] {
  const salida: ItemRelev[] = []
  let tipoEncabezado: TipoRelev | null = null
  let ambienteActual: string | null = null
  for (const crudo of renglones(texto)) {
    const tipo = tipoDe(crudo)
    // Un renglón que es solo un tipo ("• dimmer") vale como encabezado de los siguientes.
    if (tipo && crudo.replace(/[^a-záéíóúñ]/gi, '').length <= 7 && !/\d/.test(crudo)) { tipoEncabezado = tipo; continue }
    // Un renglón que es solo un ambiente ("Cocina:") cambia el ambiente de los siguientes.
    const amb = ambienteDe(crudo)
    if (amb && !tipo && !new RegExp(`^${NUM}\\b`, 'i').test(crudo) && crudo.replace(/[:\s]/g, '').length <= 22) { ambienteActual = amb; continue }

    let resto = crudo
    let cantidad = 1
    let canales: number | null = null
    // "3 canales entrada" → 1 equipo de 3 canales; "2 dimmer…" → 2 equipos.
    const alInicio = resto.match(new RegExp(`^${NUM}\\s*${UNIDAD}\\b`, 'i'))
    if (alInicio) {
      canales = num(alInicio[1]) || null
    } else {
      const q = resto.match(new RegExp(`^${NUM}\\b\\s*`, 'i'))
      if (q) { cantidad = num(q[1]) || 1; resto = resto.slice(q[0].length) }
      const c = resto.match(new RegExp(`${NUM}\\s*${UNIDAD}\\b`, 'i'))
      if (c) canales = num(c[1]) || null
    }
    const revisar = /\(?\s*\bver\b\s*\.?\)?/i.test(resto)
    const smart = /smart|wifi|inteligente/i.test(resto)
    // Ambiente: el escrito en el renglón; si no hay, el de los paréntesis; si no, el anterior.
    const fuera = ambienteDe(resto.replace(/\([^)]*\)/g, ' '))
    const parentesis = [...resto.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]).find((p) => ambienteDe(p))
    const ambiente = fuera || (parentesis && ambienteDe(parentesis)) || ambienteActual || ambientePorDefecto
    const detalle = resto
      .replace(/\(\s*ver\s*\.?\s*\)/gi, '')
      .replace(/\bver\s*\.?\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,.:+-]+|[\s,.:+-]+$/g, '')
      .trim()
    salida.push({ ambiente, cantidad, tipo: tipo ?? tipoEncabezado ?? 'otro', canales, detalle, revisar, smart })
  }
  return salida
}

// Lo que el detalle agrega además del tipo, los canales y el ambiente
// ("tecla 1 punto cocina + dimmer" → "con dimmer").
export function extraDetalle(it: ItemRelev): string {
  let t = ` ${it.detalle} `
  t = t.replace(new RegExp(`\\b${NUM}\\s*${UNIDAD}\\b`, 'gi'), ' ')
  for (const [re] of AMBIENTES_TEXTO) t = t.replace(new RegExp(re.source, 'gi'), ' ')
  const primero = it.tipo === 'otro' ? null : [/dimm?er|dimer/i, /on\s*[/-]?\s*off/i, /tecla|llave|interruptor|pulsador/i, /l[aá]mparas?|focos?|bombitas?|luminarias?/i][['dimmer', 'onoff', 'tecla', 'lampara'].indexOf(it.tipo)]
  if (primero) t = t.replace(primero, ' ')
  t = t.replace(/\bsmart\b/gi, ' ').replace(/\b(en|la|el|los|las|de|del|para el|para la)\b(?=\s*(\(|$|[,.]))/gi, ' ')
    .replace(new RegExp(`\\b${UNIDAD}\\b`, 'gi'), ' ')
    .replace(/\(\s*\d*\s*\)/g, ' ').replace(/^\s*(en|de|del)\s+(la|el)?\s*/i, ' ').replace(/^\s*y\s+/i, ' con ')
    .replace(/\+/g, ' con ').replace(/\s{2,}/g, ' ').replace(/^[\s,.:y-]+|[\s,.:-]+$/g, '').trim()
  return t.length > 2 ? t : ''
}

// Renglón del presupuesto a partir de un ítem del relevamiento.
export function descripcionPresupuesto(it: ItemRelev): string {
  const unidad = it.tipo === 'tecla' ? (it.canales === 1 ? 'punto' : 'puntos') : it.canales === 1 ? 'canal' : 'canales'
  const titulo = [nombreTipo(it.tipo) === 'Otro' ? '' : nombreTipo(it.tipo), it.canales ? `${it.canales} ${unidad}` : '', it.smart ? 'Smart' : '']
    .filter(Boolean).join(' ')
  if (!titulo) return `${it.detalle || 'Ítem'} · ${it.ambiente}`
  const extra = extraDetalle(it)
  return `${titulo} · ${it.ambiente}${extra ? `\n${extra.charAt(0).toUpperCase()}${extra.slice(1)}` : ''}`
}
