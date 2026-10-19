// Categorías propias de la app para los PRODUCTOS (los servicios usan las suyas, aparte).
// Se usan en Productos y servicios para filtrar y ordenar el catálogo.
// sugerirCategoria propone una a partir del nombre (para ordenar los que ya están cargados).

export type CategoriaApp = { nombre: string; icono: string }

export const CATEGORIAS_PRODUCTO: CategoriaApp[] = [
  { nombre: 'Teclas', icono: '🎛️' },
  { nombre: 'Switch', icono: '🔀' },
  { nombre: 'Sensores', icono: '📡' },
  { nombre: 'Hub', icono: '🧠' },
  { nombre: 'Cámaras', icono: '📷' },
  { nombre: 'WiFi', icono: '📶' },
  { nombre: 'LED', icono: '💡' },
  { nombre: 'Accesorios', icono: '🔌' },
  { nombre: 'Cerraduras', icono: '🔐' },
  { nombre: 'Iluminación solar', icono: '☀️' },
  { nombre: 'Protectores de tensión', icono: '⚡' },
  { nombre: 'Termostatos', icono: '🌡️' },
  { nombre: 'Pantallas', icono: '📺' },
  { nombre: 'Alexa', icono: '🔊' },
]

const NOMBRES = new Set(CATEGORIAS_PRODUCTO.map((c) => c.nombre))
export const esCategoriaApp = (c: string | null | undefined) => !!c && NOMBRES.has(c.trim())
export const iconoCategoria = (c: string | null | undefined) => CATEGORIAS_PRODUCTO.find((x) => x.nombre === c?.trim())?.icono ?? '🏷️'

// En orden: la primera que coincide gana (por ejemplo "cámara wifi" es Cámaras, no WiFi).
const REGLAS: [string, RegExp][] = [
  ['Iluminación solar', /solar/],
  ['Cámaras', /c[aá]mara|camara|dvr|nvr|\bipc-|\bdomo\b|bullet|videoportero|portero/],
  ['Cerraduras', /cerradura|lock|biom[eé]tric/],
  ['Termostatos', /termostato/],
  ['Protectores de tensión', /protector|tensi[oó]n|estabilizador|supresor/],
  ['Alexa', /alexa|\becho\b|google (nest|home)|asistente de voz/],
  ['Pantallas', /pantalla|display|tablet|monitor|panel t[aá]ctil/],
  ['Hub', /\bhub\b|gateway|bridge|concentrador/],
  ['Sensores', /sensor|detector|presencia|movimiento|humo|apertura|inundaci/],
  ['Teclas', /tecla|interruptor de pared|llave de luz|touch de pared|botonera/],
  ['Switch', /switch|rel[eé]\b|m[oó]dulo|breaker|smart plug|enchufe inteligente|toma inteligente|cortina/],
  ['WiFi', /wi-?fi|mesh|router|access point|deco\b|repetidor|extensor|antena|switch de red/],
  ['LED', /\bled\b|tira|foco|l[aá]mpara|reflector|spot|plaf[oó]n|bombilla|luz/],
  ['Accesorios', /fuente|cable|adaptador|soporte|bater[ií]a|pila|caja|conector|ficha|disco|memoria|micro ?sd|control remoto/],
]

export function sugerirCategoria(nombre: string, extra = ''): string | null {
  // Primero por el nombre; la categoría vieja solo si el nombre no alcanza.
  const buscar = (t: string) => REGLAS.find(([, re]) => re.test(t.toLowerCase()))?.[0] ?? null
  return buscar(nombre) ?? (extra ? buscar(extra) : null)
}

// Color del producto (opcional, si corresponde). El punto se pinta con su color.
export const COLORES: [string, string][] = [
  ['Blanco', '#ffffff'], ['Negro', '#1d1d1f'], ['Gris', '#8e939b'], ['Plateado', '#c9ced6'], ['Dorado', '#d4af37'],
  ['Beige', '#e8dcc4'], ['Madera', '#a0703c'], ['Rojo', '#d93636'], ['Azul', '#2f6fd6'], ['Verde', '#2e9d5b'],
]
export const hexColor = (c: string | null | undefined) => COLORES.find(([n]) => n.toLowerCase() === (c ?? '').trim().toLowerCase())?.[1] ?? null
const REGLAS_COLOR: [string, RegExp][] = [
  ['Blanco', /\bblanc[oa]s?\b|\bwhite\b/], ['Negro', /\bnegr[oa]s?\b|\bblack\b/], ['Gris', /\bgris(es)?\b|\bgr[ae]y\b/],
  ['Plateado', /\bplatead[oa]s?\b|\bplata\b|\bsilver\b/], ['Dorado', /\bdorad[oa]s?\b|\bgold\b/], ['Beige', /\bbeige\b/],
  ['Madera', /\bmadera\b/], ['Rojo', /\broj[oa]s?\b/], ['Azul', /\bazul(es)?\b/], ['Verde', /\bverdes?\b/],
]
export function sugerirColor(nombre: string): string | null {
  const t = nombre.toLowerCase()
  return REGLAS_COLOR.find(([, re]) => re.test(t))?.[0] ?? null
}
