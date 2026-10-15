// Modo claro / oscuro de toda la app.
// La app tiene sus colores escritos a mano (hojas de estilo y estilos en línea),
// así que el modo oscuro se arma solo: se recorren esos colores y se convierten
// (fondos claros → oscuros, textos oscuros → claros). Los colores de marca
// (naranja, verde, violeta…) quedan iguales, y fotos y PDF no se tocan.

export type Tema = 'claro' | 'oscuro'
const CLAVE = 'mova_tema'
const ID_ESTILO = 'mova-tema-oscuro'

export function temaGuardado(): Tema {
  try { return localStorage.getItem(CLAVE) === 'oscuro' ? 'oscuro' : 'claro' } catch { return 'claro' }
}

// ---------- Conversión de un color ----------

type Tipo = 'texto' | 'fondo' | 'borde'

function aHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const c = max - min
  let h = 0, s = 0
  if (c > 0) {
    s = c / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / c) % 6
    else if (max === g) h = (b - r) / c + 2
    else h = (r - g) / c + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: Math.min(1, s), l, c }
}

function aRgb(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function convertir(r: number, g: number, b: number, a: number, tipo: Tipo): string | null {
  const { h, s, l, c } = aHsl(r, g, b)
  const neutro = c < 0.06
  let nl = l, ns = s
  if (tipo === 'fondo') {
    if (a < 0.9) return null // velos y transparencias: quedan como están
    if (neutro) nl = l >= 0.5 ? 0.1 + (1 - l) * 0.5 : 0.2 + l * 0.4
    else if (l > 0.85) { nl = 0.17; ns = Math.min(s, 0.4) }
    else return null
  } else if (tipo === 'texto') {
    if (neutro) { if (l > 0.6) return null; nl = 0.93 - l * 0.5 }
    else if (l < 0.45) nl = 0.68
    else return null
  } else {
    if (neutro) nl = l > 0.5 ? 0.14 + (1 - l) * 0.6 : Math.max(l, 0.3)
    else if (l > 0.8) { nl = 0.3; ns = Math.min(s, 0.4) }
    else return null
  }
  const [nr, ng, nb] = aRgb(h, ns, nl)
  return a < 1 ? `rgba(${nr}, ${ng}, ${nb}, ${a})` : `rgb(${nr}, ${ng}, ${nb})`
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b/g

function leer(token: string): [number, number, number, number] | null {
  const t = token.toLowerCase()
  if (t === 'white') return [255, 255, 255, 1]
  if (t === 'black') return [0, 0, 0, 1]
  if (t.startsWith('#')) {
    let x = t.slice(1)
    if (x.length === 3 || x.length === 4) x = [...x].map((ch) => ch + ch).join('')
    if (x.length !== 6 && x.length !== 8) return null
    const n = (i: number) => parseInt(x.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), x.length === 8 ? n(6) / 255 : 1]
  }
  const nums = t.match(/[\d.]+%?/g)
  if (!nums || nums.length < 3) return null
  const v = nums.map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)))
  return [v[0], v[1], v[2], v[3] ?? 1]
}

function tipoDe(prop: string): Tipo | null {
  // Variables de color de la app (--mova-bg, --mova-border…): según su nombre.
  if (prop.startsWith('--')) {
    if (/sidebar/.test(prop)) return null
    if (/bg|fondo/.test(prop)) return 'fondo'
    if (/border|borde/.test(prop)) return 'borde'
    if (/muted|text|tinta/.test(prop)) return 'texto'
    return null
  }
  if (prop === 'color' || prop === '-webkit-text-fill-color' || prop === 'text-decoration-color' || prop === 'caret-color' || prop === 'fill') return 'texto'
  if (prop === 'background-color' || prop === 'background-image' || prop === 'background') return 'fondo'
  if (prop.endsWith('-color') && (prop.startsWith('border') || prop.startsWith('outline') || prop.startsWith('column-rule'))) return 'borde'
  if (prop === 'box-shadow' || prop === 'stroke') return 'borde'
  return null
}

function convertirValor(prop: string, valor: string): string {
  const tipo = tipoDe(prop)
  if (!tipo || !valor || valor.includes('var(')) return valor
  return valor.replace(COLOR, (tok) => {
    const rgba = leer(tok)
    if (!rgba) return tok
    return convertir(rgba[0], rgba[1], rgba[2], rgba[3], tipo) ?? tok
  })
}

// ---------- Hojas de estilo ----------

function reglasOscuras(reglas: CSSRuleList): string {
  let salida = ''
  for (const regla of Array.from(reglas)) {
    if (regla instanceof CSSStyleRule) {
      const st = regla.style
      let cuerpo = ''
      for (let i = 0; i < st.length; i++) {
        const prop = st[i]
        if (!tipoDe(prop)) continue
        const valor = st.getPropertyValue(prop)
        const nuevo = convertirValor(prop, valor)
        if (nuevo !== valor) cuerpo += `${prop}:${nuevo}${st.getPropertyPriority(prop) ? ' !important' : ''};`
      }
      if (cuerpo) salida += `${regla.selectorText}{${cuerpo}}\n`
    } else if (regla instanceof CSSMediaRule) {
      // Las reglas para modo oscuro del sistema ya no hacen falta; el resto se respeta.
      if (regla.conditionText.includes('prefers-color-scheme')) continue
      const dentro = reglasOscuras(regla.cssRules)
      if (dentro) salida += `@media ${regla.conditionText}{${dentro}}\n`
    } else if (regla instanceof CSSSupportsRule) {
      const dentro = reglasOscuras(regla.cssRules)
      if (dentro) salida += `@supports ${regla.conditionText}{${dentro}}\n`
    }
  }
  return salida
}

const BASE = `html[data-tema="oscuro"]{color-scheme:dark;background:#16191e}
html[data-tema="oscuro"] body{background:#16191e;color:#e3e6ea}
html[data-tema="oscuro"] img:not([src$=".svg"]){filter:brightness(.92)}
`

function armarHoja() {
  let css = BASE
  for (const hoja of Array.from(document.styleSheets)) {
    if ((hoja.ownerNode as Element | null)?.id === ID_ESTILO) continue
    try { css += reglasOscuras(hoja.cssRules) } catch { /* hoja de otro dominio (fuentes): se saltea */ }
  }
  let el = document.getElementById(ID_ESTILO) as HTMLStyleElement | null
  if (!el) { el = document.createElement('style'); el.id = ID_ESTILO }
  el.textContent = css
  document.head.appendChild(el) // siempre al final, para que gane
}

// ---------- Estilos en línea (style={{…}}) ----------

type ConEstilo = HTMLElement | SVGElement
// SVG a los que se les pasó el color a estilo: al volver al modo claro se limpia.
const svgCopiados = new Set<SVGElement>()
const originales = new WeakMap<ConEstilo, Map<string, { original: string; nuevo: string }>>()

function procesarElemento(el: ConEstilo) {
  const st = el.style
  if (!st) return
  // Gráficos SVG: el color viene como atributo (fill / stroke); se pasa a estilo para poder cambiarlo.
  if (el instanceof SVGElement) for (const attr of ['fill', 'stroke']) {
    const v = el.getAttribute(attr)
    if (v && !st.getPropertyValue(attr)) { st.setProperty(attr, v); svgCopiados.add(el) }
  }
  if (!st.length) return
  let memo = originales.get(el)
  for (let i = 0; i < st.length; i++) {
    const prop = st[i]
    if (!tipoDe(prop)) continue
    const valor = st.getPropertyValue(prop)
    const previo = memo?.get(prop)
    if (previo && previo.nuevo === valor) continue
    const nuevo = convertirValor(prop, valor)
    if (nuevo === valor) continue
    if (!memo) { memo = new Map(); originales.set(el, memo) }
    memo.set(prop, { original: valor, nuevo })
    st.setProperty(prop, nuevo, st.getPropertyPriority(prop))
  }
}

const CON_COLOR = '[style],svg [fill],svg [stroke]'
function procesarArbol(raiz: Element) {
  if ((raiz instanceof HTMLElement || raiz instanceof SVGElement) && raiz.matches(CON_COLOR)) procesarElemento(raiz)
  raiz.querySelectorAll<ConEstilo>(CON_COLOR).forEach(procesarElemento)
}

function restaurarEnLinea() {
  document.querySelectorAll<ConEstilo>(CON_COLOR).forEach((el) => {
    const memo = originales.get(el)
    if (!memo) return
    for (const [prop, { original, nuevo }] of memo) if (el.style.getPropertyValue(prop) === nuevo) el.style.setProperty(prop, original)
    originales.delete(el)
  })
  for (const el of svgCopiados) { el.style.removeProperty('fill'); el.style.removeProperty('stroke') }
  svgCopiados.clear()
}

// ---------- Encender / apagar ----------

let observador: MutationObserver | null = null
let pendienteHoja = 0

export function aplicarTema(tema: Tema) {
  try { localStorage.setItem(CLAVE, tema) } catch { /* sin almacenamiento: vale para esta sesión */ }
  const oscuro = tema === 'oscuro'
  document.documentElement.dataset.tema = tema
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? '#16191e' : '#ffffff')
  observador?.disconnect()
  observador = null
  if (!oscuro) {
    document.getElementById(ID_ESTILO)?.remove()
    restaurarEnLinea()
    return
  }
  armarHoja()
  procesarArbol(document.body)
  observador = new MutationObserver((cambios) => {
    let hojaNueva = false
    for (const m of cambios) {
      if (m.type === 'attributes' && (m.target instanceof HTMLElement || m.target instanceof SVGElement)) procesarElemento(m.target)
      else for (const n of Array.from(m.addedNodes)) {
        if (n instanceof HTMLLinkElement) n.addEventListener('load', () => { if (document.documentElement.dataset.tema === 'oscuro') armarHoja() }, { once: true })
        else if (n instanceof HTMLStyleElement) { if (n.id !== ID_ESTILO) hojaNueva = true }
        else if (n instanceof Element) procesarArbol(n)
      }
    }
    // Una hoja de estilo nueva (pantallas que se cargan después): se rearma el modo oscuro.
    if (hojaNueva) { window.clearTimeout(pendienteHoja); pendienteHoja = window.setTimeout(armarHoja, 120) }
  })
  observador.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'fill', 'stroke'] })
}

export function iniciarTema() {
  if (temaGuardado() === 'oscuro') aplicarTema('oscuro')
}
