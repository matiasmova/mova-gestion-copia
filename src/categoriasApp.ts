// Categorías propias de la app para los PRODUCTOS (los servicios usan las suyas, aparte).
// Se usan en Productos y servicios para filtrar y ordenar el catálogo.
// sugerirCategoria propone una a partir del nombre (para ordenar los que ya están cargados).

import { useSyncExternalStore } from 'react'

// "icono" es la clave del dibujo y del color (ver IconoCategoria): así una
// categoría se puede renombrar sin perder su ícono.
export type CategoriaApp = { nombre: string; icono: string }

export const CATEGORIAS_DEF: CategoriaApp[] = ['Teclas', 'Switch', 'Sensores', 'Hub', 'Cámaras', 'WiFi', 'LED', 'Accesorios', 'Cerraduras',
  'Iluminación solar', 'Protectores de tensión', 'Termostatos', 'Pantallas', 'Alexa'].map((n) => ({ nombre: n, icono: n }))

// Las categorías son editables (se guardan en configuracion → "categorias_producto").
// Se guardan acá en memoria para que toda la app use la misma lista.
let lista: CategoriaApp[] = CATEGORIAS_DEF
const avisar = new Set<() => void>()
export const categoriasProducto = () => lista
export function fijarCategorias(nuevas: unknown) {
  const ok = Array.isArray(nuevas) ? nuevas.map((c) => ({ nombre: String((c as CategoriaApp)?.nombre ?? '').trim(), icono: String((c as CategoriaApp)?.icono ?? '') })).filter((c) => c.nombre) : []
  lista = ok.length ? ok : CATEGORIAS_DEF
  avisar.forEach((f) => f())
}
export function useCategoriasProducto() {
  return useSyncExternalStore((f) => { avisar.add(f); return () => { avisar.delete(f) } }, () => lista)
}

export const esCategoriaApp = (c: string | null | undefined) => !!c && lista.some((x) => x.nombre === c.trim())
// Clave del ícono de una categoría por su nombre actual.
export const iconoDe = (c: string | null | undefined) => lista.find((x) => x.nombre === (c ?? '').trim())?.icono ?? (c ?? '').trim()

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
  const clave = buscar(nombre) ?? (extra ? buscar(extra) : null)
  // Las reglas usan los nombres originales: se traduce al nombre actual (si sigue existiendo).
  return clave ? lista.find((c) => c.icono === clave)?.nombre ?? (esCategoriaApp(clave) ? clave : null) : null
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

// Colores disponibles de un producto, cada uno con su stock (columna "colores").
export type ColorStock = { color: string; stock: number }
export function leerColores(x: unknown): ColorStock[] {
  if (!Array.isArray(x)) return []
  return x.map((e) => ({ color: String((e as ColorStock)?.color ?? '').trim(), stock: Number((e as ColorStock)?.stock) || 0 })).filter((e) => e.color)
}
// "Tecla 1 módulo (Negro)" → "Negro", si ese color es uno de los del producto.
export function colorDeTexto(texto: string, colores: ColorStock[]): string | null {
  const m = /\(([^()]+)\)\s*$/.exec(texto)
  if (!m) return null
  return colores.find((c) => c.color.toLowerCase() === m[1].trim().toLowerCase())?.color ?? null
}
// Saca "(Color)" del final si es uno de los colores del producto.
export const sinColor = (texto: string, colores: ColorStock[]) => (colorDeTexto(texto, colores) ? texto.replace(/\s*\([^()]+\)\s*$/, '') : texto)
