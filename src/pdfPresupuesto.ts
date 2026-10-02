import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type RGB, type PDFPage } from 'pdf-lib'
import logoUrl from './assets/mova-logo.png'
import { moneda, fechaCorta } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import { importeBruto, importeNeto, partirDescripcion, pctItem, formatoPct } from './presupuestoCalculos'
import { antesYAhora, etiquetaModificacion } from './presupuestoModificaciones'
import { cargarSolucionesPresupuesto, type SolucionPresupuesto } from './presupuestoSoluciones'
import { configActual, lineaContacto, textoCondicion } from './config'
import { cargarEstadoPresupuesto, mensajeEstado, PCT_ANTICIPO, totalAPagarHoy, type EstadoPresupuesto } from './estadoObra'
import { cargarDatosContacto, type DatosContacto } from './presupuestoContacto'
import { codigoPresupuesto, nombreArchivo } from './codigoPresupuesto'
import { supabase } from './supabase'
import { cargarFormasPago, textoMedios, type FormasPago } from './formasPago'

export const GRUPOS_DOCUMENTO: Record<string, string> = {
  producto: 'Productos y equipos', servicio: 'Servicios', material: 'Materiales',
  mano_obra: 'Mano de obra e instalación', otro: 'Otros',
}

// Agrupa los ítems por tipo, en el orden en que aparecen. Lo usan el PDF y la
// vista en pantalla (DocumentoPresupuesto.tsx) para que se vean iguales.
export function agruparPorTipo(items: ItemPresupuesto[]) {
  const grupos: { clave: string; titulo: string; items: ItemPresupuesto[] }[] = []
  for (const it of items) {
    const c = it.tipo || 'otro'
    let g = grupos.find((x) => x.clave === c)
    if (!g) { g = { clave: c, titulo: GRUPOS_DOCUMENTO[c] ?? c, items: [] }; grupos.push(g) }
    g.items.push(it)
  }
  return grupos
}

export type DatosPdf = {
  id: number; titulo: string; descripcion?: string | null; fecha: string; validez_dias?: number | null
  subtotal: number; descuento: number; total: number; notas?: string | null
  items: ItemPresupuesto[]; cliente: string; obra: string
  // Opcionales: si no se pasan, se leen de la base.
  soluciones?: SolucionPresupuesto[]
  estado?: EstadoPresupuesto | null
  contacto?: DatosContacto | null
  // "Formas de uso y recomendaciones": solo si se eligió incluirlas (null = no van).
  recomendaciones?: string | null
  // Formas de pago que acepta (solo informativas).
  formasPago?: FormasPago
  // Campo viejo, ya no se usa (se deja para no romper llamadas anteriores).
  resumen?: unknown
}

// Carga todo lo que el documento necesita (estado de obra, soluciones y contacto).
export async function completarDatosDocumento(d: DatosPdf): Promise<DatosPdf> {
  // Ojo: la fila de "presupuestos" trae una columna "estado" ('aceptado', 'borrador'…) que NO es
  // el estado de obra. Solo se reutiliza si es un estado de obra ya calculado.
  const estadoValido = (x: unknown): x is EstadoPresupuesto | null =>
    x === null || (typeof x === 'object' && x !== null && Array.isArray((x as EstadoPresupuesto).linea))
  const [estado, soluciones, contacto, recomendaciones, formasPago] = await Promise.all([
    estadoValido(d.estado) ? Promise.resolve(d.estado) : cargarEstadoPresupuesto(d.id, Number(d.total) || 0),
    d.soluciones ? Promise.resolve(d.soluciones) : cargarSolucionesPresupuesto(d.id).catch(() => [] as SolucionPresupuesto[]),
    d.contacto !== undefined ? Promise.resolve(d.contacto) : cargarDatosContacto(d.id).catch(() => null),
    d.recomendaciones !== undefined ? Promise.resolve(d.recomendaciones) : cargarRecomendaciones(d.id),
    d.formasPago !== undefined ? Promise.resolve(d.formasPago) : cargarFormasPago(d.id),
  ])
  return { ...d, estado, soluciones, contacto, recomendaciones, formasPago }
}

// Recomendaciones guardadas del presupuesto, si se eligió incluirlas.
export async function cargarRecomendaciones(id: number): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('presupuestos').select('recomendaciones, recomendaciones_incluir').eq('id', id).maybeSingle()
    if (error || !data) return null
    const texto = String(data.recomendaciones ?? '').trim()
    return data.recomendaciones_incluir && texto ? texto : null
  } catch { return null }
}

// Texto guardado → una recomendación por renglón (sin viñetas escritas a mano).
export function lineasRecomendaciones(texto: string | null | undefined): string[] {
  return (texto ?? '').split('\n').map((l) => l.replace(/^[\s•\-*·]+/, '').trim()).filter(Boolean)
}

// Nombre del archivo: Cliente_Obra_fecha_código.pdf
export const nombreArchivoPresupuesto = (d: Pick<DatosPdf, 'id' | 'cliente' | 'obra'>) => nombreArchivo(d.cliente, d.obra, d.id)

// Color de marca en hex, usado también en la vista en pantalla.
export const COLOR_MARCA_HEX = '#DE7015'

// Paleta
const NARANJA = rgb(0.871, 0.439, 0.082) // #DE7015
const NARANJA_SUAVE = rgb(1, 0.933, 0.867) // #FFEEDD
const NARANJA_OSC = rgb(0.659, 0.314, 0.031) // #A85008
const AVISO_FONDO = rgb(1, 0.965, 0.925)
const AVISO_BORDE = rgb(0.965, 0.839, 0.702)
const OSCURO = rgb(0.078, 0.094, 0.118) // #14181E
const TEXTO = rgb(0.357, 0.384, 0.439)
const GRIS = rgb(0.541, 0.576, 0.627)
const GRIS_CLARO = rgb(0.965, 0.969, 0.976)
const LINEA = rgb(0.91, 0.918, 0.933)
const LINEA_SUAVE = rgb(0.945, 0.949, 0.957)
const VERDE = rgb(0.137, 0.463, 0.306)
const VERDE_SUAVE = rgb(0.925, 0.965, 0.945)
const VERDE_CLARO = rgb(0.498, 0.82, 0.639)
const GRIS_CAJA = rgb(0.788, 0.808, 0.839)
const DIVISOR_CAJA = rgb(0.224, 0.251, 0.294)
const BLANCO = rgb(1, 1, 1)

// Tamaños de letra
const F_GRANDE = 16.5
const F_CIFRA = 14
const F_NORMAL = 9
const F_CHICO = 7.5
const F_MINI = 6.8

// Sanitiza a caracteres que las fuentes estándar (WinAnsi) pueden dibujar.
function win(s: string): string {
  return (s ?? '')
    .replace(/[  ]/g, ' ')
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    .replace(/[^\x00-\xFF]/g, '')
}

const conSigno = (n: number) => (n < 0 ? `- ${moneda(Math.abs(n))}` : `+ ${moneda(n)}`)

// Foto de un comprobante → JPEG liviano y derecho (el navegador aplica la
// rotación de la cámara al dibujarla). Sirve también para HEIC en el iPhone.
async function imagenAJpeg(blob: Blob): Promise<{ bytes: ArrayBuffer; w: number; h: number }> {
  const url = URL.createObjectURL(blob)
  try {
    const img = document.createElement('img')
    await new Promise<void>((ok, mal) => { img.onload = () => ok(); img.onerror = () => mal(new Error('imagen')); img.src = url })
    const max = 1600
    let w = img.naturalWidth, h = img.naturalHeight
    if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r) }
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const jpg = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82))
    if (!jpg) throw new Error('jpeg')
    return { bytes: await jpg.arrayBuffer(), w, h }
  } finally { URL.revokeObjectURL(url) }
}

// Cómo van los comprobantes de los gastos a reintegrar:
//  · 'boton': un botón "Descargar factura" con link permanente (función "comprobante").
//  · 'anexo': las fotos/PDF agregados al final del documento.
//  · 'no':    sin comprobantes.
export type ModoComprobantes = 'boton' | 'anexo' | 'no'
const MODO_KEY = 'mova_modo_comprobantes'
export function leerModoComprobantes(): ModoComprobantes {
  try { const v = localStorage.getItem(MODO_KEY); return v === 'anexo' || v === 'no' ? v : 'boton' } catch { return 'boton' }
}
export function guardarModoComprobantes(m: ModoComprobantes) { try { localStorage.setItem(MODO_KEY, m) } catch { /* sin almacenamiento */ } }

// Links permanentes de descarga (si la función "comprobante" no está instalada, null).
async function linksComprobantes(ids: number[]): Promise<Record<number, string> | null> {
  if (!ids.length) return {}
  try {
    const { data, error } = await supabase.functions.invoke('comprobante', { body: { ids } })
    if (error || !data?.links) return null
    return data.links as Record<number, string>
  } catch { return null }
}

export async function generarPdfPresupuesto(entrada: DatosPdf, opciones: { comprobantes?: ModoComprobantes; onAviso?: (msg: string) => void; linkPago?: string | null } = {}): Promise<Blob> {
  const d = await completarDatosDocumento(entrada)
  const estado = d.estado ?? null
  const soluciones = d.soluciones ?? []
  const contacto = d.contacto ?? null

  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  try { logo = await pdf.embedPng(await fetch(logoUrl).then((r) => r.arrayBuffer())) } catch { logo = null }

  const W = 595.28, H = 841.89, M = 40
  const CW = W - 2 * M
  const PIE = M + 34
  const codigo = codigoPresupuesto(d.id)
  const validez = d.validez_dias ?? configActual().presupuestos.validezDias
  const venceEl = fechaCorta(new Date(new Date(`${d.fecha.slice(0, 10)}T12:00:00`).getTime() + validez * 86400000).toISOString().slice(0, 10))
  // Comprobantes de los gastos: botón con link permanente o anexo al final.
  let modo: ModoComprobantes = opciones.comprobantes ?? 'boton'
  const gastosCon = !estado || modo === 'no' ? [] : estado.gastosExtra.filter((g) => g.comprobante)
  let links: Record<number, string> = {}
  if (modo === 'boton' && gastosCon.length) {
    const r = await linksComprobantes(gastosCon.map((g) => g.id))
    if (r) links = r
    else { modo = 'anexo'; opciones.onAviso?.('Falta instalar la función "comprobante" en Supabase: por ahora los comprobantes van adjuntos al final.') }
  }
  const conComprobante = modo === 'anexo' ? gastosCon : []
  const diaMes = (f: string) => fechaCorta(f).replace(/\/\d{4}$/, '')
  let page: PDFPage = pdf.addPage([W, H])
  let y = H - M

  // ---------- Utilidades ----------
  const texto = (t: string, x: number, yy: number, size: number, f: PDFFont = font, color: RGB = TEXTO) =>
    page.drawText(win(t), { x, y: yy, size, font: f, color })
  const ancho = (t: string, size: number, f: PDFFont = font) => f.widthOfTextAtSize(win(t), size)
  const derecha = (t: string, right: number, yy: number, size: number, f: PDFFont = font, color: RGB = TEXTO) =>
    texto(t, right - ancho(t, size, f), yy, size, f, color)
  // Mayúsculas con letras separadas (títulos y etiquetas).
  const SEP = 1.1
  const anchoEsp = (t: string, size: number, f: PDFFont = bold) => {
    const s = win(t); return s.length ? f.widthOfTextAtSize(s, size) + SEP * (s.length - 1) : 0
  }
  const espaciado = (t: string, x: number, yy: number, size: number, color: RGB = GRIS, f: PDFFont = bold) => {
    let xx = x
    for (const c of win(t)) { page.drawText(c, { x: xx, y: yy, size, font: f, color }); xx += f.widthOfTextAtSize(c, size) + SEP }
    return xx - SEP - x
  }
  const espaciadoDer = (t: string, right: number, yy: number, size: number, color: RGB = GRIS) => espaciado(t, right - anchoEsp(t, size), yy, size, color)
  const rect = (x: number, yy: number, w: number, h: number, color: RGB) => page.drawRectangle({ x, y: yy, width: w, height: h, color })
  // Rectángulo con puntas redondeadas; (x, arriba) es la esquina superior izquierda.
  const caja = (x: number, arriba: number, w: number, h: number, o: { fondo?: RGB; borde?: RGB; r?: number } = {}) => {
    const r = Math.min(o.r ?? 7, w / 2, h / 2)
    page.drawSvgPath(`M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`, {
      x, y: arriba, ...(o.fondo ? { color: o.fondo } : {}), ...(o.borde ? { borderColor: o.borde, borderWidth: 0.75 } : { borderWidth: 0 }),
    })
  }
  const linea = (x1: number, yy: number, x2: number, grosor = 0.6, color: RGB = LINEA) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: grosor, color })
  const partir = (t: string, size: number, maxW: number, f: PDFFont = font): string[] => {
    const salida: string[] = []
    for (const crudo of win(t).split('\n')) {
      let renglon = ''
      for (const palabra of crudo.split(/\s+/).filter(Boolean)) {
        const prueba = renglon ? `${renglon} ${palabra}` : palabra
        if (f.widthOfTextAtSize(prueba, size) > maxW && renglon) { salida.push(renglon); renglon = palabra }
        else renglon = prueba
      }
      salida.push(renglon)
    }
    return salida.filter((r, i, arr) => r !== '' || (i > 0 && i < arr.length - 1))
  }
  // Título de sección: mayúsculas espaciadas y una línea fina hasta el borde.
  const titulo = (t: string) => {
    const w = espaciado(t.toUpperCase(), M, y, F_CHICO + 0.4, OSCURO)
    linea(M + w + 8, y + 2.6, M + CW, 0.7)
    y -= 17
  }
  const nuevaPagina = () => {
    page = pdf.addPage([W, H]); y = H - M
    texto(`Presupuesto ${codigo} · ${d.cliente}`, M, y, F_CHICO, font, GRIS)
    derecha('continuación', M + CW, y, F_CHICO, font, GRIS)
    y -= 26
  }
  const lugar = (alto: number) => { if (y - alto < PIE) { nuevaPagina(); return true } return false }
  // Circulito de estado: tilde verde, "!" naranja o vacío (lo que viene).
  const icono = (x: number, yy: number, tipo: 'ok' | 'pendiente' | 'futuro', r = 7) => {
    if (tipo === 'futuro') { page.drawCircle({ x, y: yy, size: r - 0.6, color: BLANCO, borderColor: GRIS_CAJA, borderWidth: 1.1 }); return }
    page.drawCircle({ x, y: yy, size: r, color: tipo === 'ok' ? VERDE : NARANJA })
    if (tipo === 'ok') {
      page.drawLine({ start: { x: x - 3, y: yy }, end: { x: x - 0.8, y: yy - 2.4 }, thickness: 1.3, color: BLANCO })
      page.drawLine({ start: { x: x - 0.8, y: yy - 2.4 }, end: { x: x + 3.2, y: yy + 2.6 }, thickness: 1.3, color: BLANCO })
    } else {
      page.drawLine({ start: { x, y: yy + 3.2 }, end: { x, y: yy - 0.4 }, thickness: 1.4, color: BLANCO })
      page.drawCircle({ x, y: yy - 2.6, size: 0.8, color: BLANCO })
    }
  }
  // Tres tarjetas de cifras; la marcada va llena de naranja (o verde si está al día).
  type Cifra = { e: string; v: string; s?: string; destacada?: 'naranja' | 'verde'; color?: RGB }
  const tarjetas = (cifras: Cifra[]) => {
    const gap = 8, w = (CW - gap * 2) / 3, h = 54
    lugar(h + 8)
    cifras.forEach((c, i) => {
      const x = M + i * (w + gap)
      const fondo = c.destacada === 'naranja' ? NARANJA : c.destacada === 'verde' ? VERDE : undefined
      caja(x, y, w, h, fondo ? { fondo, r: 9 } : { borde: LINEA, r: 9 })
      espaciado(c.e, x + 11, y - 15, F_MINI, fondo ? BLANCO : GRIS)
      let size = F_CIFRA
      while (size > 9 && ancho(c.v, size, bold) > w - 22) size -= 0.5
      texto(c.v, x + 11, y - 33, size, bold, fondo ? BLANCO : (c.color ?? OSCURO))
      if (c.s) texto(partir(c.s, F_MINI + 0.4, w - 22)[0] ?? '', x + 11, y - 45, F_MINI + 0.4, font, fondo ? BLANCO : GRIS)
    })
    y -= h + 10
  }
  // Barra de progreso redondeada.
  const barra = (x: number, yy: number, w: number, pct: number, color: RGB = NARANJA, alto = 4.5) => {
    caja(x, yy + alto, w, alto, { fondo: LINEA, r: alto / 2 })
    const p = Math.max(0, Math.min(1, pct))
    if (p > 0) caja(x, yy + alto, Math.max(w * p, alto), alto, { fondo: color, r: alto / 2 })
  }
  // Caja negra de totales: renglones chicos arriba y el total grande abajo.
  const cajaNegra = (renglones: { t: string; v: string; verde?: boolean }[], etiqueta: string, monto: string) => {
    const w = 270, x = M + CW - w
    const h = 22 + renglones.length * 14 + (renglones.length ? 10 : 0) + 18
    lugar(h + 6)
    const arriba = y
    caja(x, y, w, h, { fondo: OSCURO, r: 9 })
    let yy = y - 18
    for (const r of renglones) {
      texto(r.t, x + 14, yy, F_NORMAL - 0.5, font, r.verde ? VERDE_CLARO : GRIS_CAJA)
      derecha(r.v, x + w - 14, yy, F_NORMAL - 0.5, font, r.verde ? VERDE_CLARO : GRIS_CAJA)
      yy -= 14
    }
    if (renglones.length) { linea(x + 14, yy + 6, x + w - 14, 0.7, DIVISOR_CAJA); yy -= 10 }
    espaciado(etiqueta, x + 14, yy + 1, F_CHICO, BLANCO)
    derecha(monto, x + w - 14, yy - 1, F_CIFRA, bold, BLANCO)
    y -= h + 14
    return { arriba, alto: h }
  }
  // Botón con link (anotación del PDF que abre la dirección al tocarla).
  const boton = (etiqueta: string, url: string, x: number, yy: number) => {
    const s2 = win(etiqueta)
    const w = bold.widthOfTextAtSize(s2, F_MINI + 0.4) + 22, h = 13
    caja(x, yy + h - 3.5, w, h, { fondo: NARANJA, r: 3.5 })
    // flechita de descarga
    const fx = x + 8, fy = yy + 3
    page.drawLine({ start: { x: fx, y: fy + 4 }, end: { x: fx, y: fy - 0.5 }, thickness: 1, color: BLANCO })
    page.drawSvgPath('M -2.3 0 L 2.3 0 L 0 2.6 Z', { x: fx, y: fy - 0.2, color: BLANCO })
    page.drawLine({ start: { x: fx - 2.8, y: fy - 3 }, end: { x: fx + 2.8, y: fy - 3 }, thickness: 0.8, color: BLANCO })
    page.drawText(s2, { x: x + 15, y: yy, size: F_MINI + 0.4, font: bold, color: BLANCO })
    const anotacion = pdf.context.register(pdf.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [x, yy - 3.5, x + w, yy - 3.5 + h], Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    }))
    page.node.addAnnot(anotacion)
  }

  // ---------- Encabezado ----------
  if (logo) {
    const lh = 34, lw = lh * (logo.width / logo.height)
    page.drawImage(logo, { x: M, y: y - lh + 4, width: lw, height: lh })
  }
  espaciadoDer(estado ? 'PRESUPUESTO Y ESTADO DE OBRA' : 'PRESUPUESTO', M + CW, y - 2, F_MINI, NARANJA); y -= 20
  derecha(codigo, M + CW, y, 17, bold, OSCURO); y -= 12
  derecha(estado ? `Emitido ${fechaCorta(d.fecha)} · Actualizado ${fechaCorta(estado.ultimaActualizacion)}` : `Emitido ${fechaCorta(d.fecha)} · Válido hasta ${venceEl}`, M + CW, y, F_CHICO, font, GRIS)
  y -= 14
  caja(M, y, CW, 2.2, { fondo: LINEA, r: 1.1 })
  caja(M, y, CW * 0.18, 2.2, { fondo: NARANJA, r: 1.1 })
  y -= 14

  // ---------- Cliente / obra / condiciones ----------
  const hayObra = !!d.obra && d.obra !== 'Sin obra asociada'
  const gap = 8
  const anchos = [(CW - 2 * gap) * 0.38, (CW - 2 * gap) * 0.36, (CW - 2 * gap) * 0.26]
  const etapa = !estado ? null : estado.terminada ? 'Obra finalizada' : estado.enObra ? `En obra · avance ${estado.avance}%` : 'Presupuesto aceptado'
  const partes = [
    { e: 'CLIENTE', n: d.cliente, l: [
      contacto?.telefono ? `Tel. ${contacto.telefono}` : null,
      contacto?.email ?? null,
      contacto?.documento ? `${contacto.documento.etiqueta}: ${contacto.documento.valor}` : null,
      contacto?.direccionCliente ?? null,
    ] },
    { e: hayObra ? 'OBRA' : 'PRESUPUESTO', n: hayObra ? d.obra : codigo, l: [
      hayObra ? (contacto?.direccionObra || contacto?.direccionCliente || null) : null,
      etapa ?? `Válido hasta el ${venceEl}`,
    ] },
    { e: 'CONDICIONES', n: `Seña ${PCT_ANTICIPO}%`, l: ['Saldo al finalizar', `Validez ${validez} ${validez === 1 ? 'día' : 'días'}`] },
  ].map((p, i) => ({
    ...p,
    nr: partir(p.n, F_NORMAL + 1, anchos[i] - 22, bold).slice(0, 2),
    lr: p.l.filter((x): x is string => !!x).flatMap((x) => partir(x, F_CHICO, anchos[i] - 22)),
  }))
  const altoPartes = 30 + Math.max(...partes.map((p) => p.nr.length * 12 + p.lr.length * 10)) + 2
  let xp = M
  partes.forEach((p, i) => {
    caja(xp, y, anchos[i], altoPartes, { borde: LINEA, r: 8 })
    espaciado(p.e, xp + 11, y - 14, F_MINI, GRIS)
    let yy = y - 27
    for (const r of p.nr) { texto(r, xp + 11, yy, F_NORMAL + 1, bold, OSCURO); yy -= 12 }
    yy -= 1
    for (const r of p.lr) { texto(r, xp + 11, yy, F_CHICO, font, TEXTO); yy -= 10 }
    xp += anchos[i] + gap
  })
  y -= altoPartes + 24

  // ---------- Título y descripción ----------
  for (const r of partir(d.titulo, F_GRANDE, CW, bold)) { lugar(22); texto(r, M, y, F_GRANDE, bold, OSCURO); y -= 20 }
  if (d.descripcion) { y += 3; for (const r of partir(d.descripcion, F_NORMAL, CW)) { lugar(13); texto(r, M, y, F_NORMAL, font, GRIS); y -= 12.5 } }
  y -= 8

  // ---------- Cifras principales ----------
  const aPagarHoy = estado ? totalAPagarHoy(estado) : 0
  if (estado) {
    const pctPagado = estado.totalActualizado > 0 ? Math.round(Math.min(1, estado.cobrado / estado.totalActualizado) * 100) : 0
    tarjetas([
      { e: 'TOTAL DE LA OBRA', v: moneda(estado.totalActualizado), s: estado.modificaciones.length ? 'Con modificaciones' : 'Presupuesto aceptado' },
      { e: 'YA PAGASTE', v: moneda(estado.cobrado), s: `${pctPagado}% del total`, color: estado.cobrado > 0 ? VERDE : OSCURO },
      aPagarHoy > 0.5
        ? { e: 'A PAGAR HOY', v: moneda(aPagarHoy), s: estado.gastoExtraPendiente > 0.5 ? 'Obra + gastos a reintegrar' : 'Según el avance de la obra', destacada: 'naranja' }
        : { e: 'A PAGAR HOY', v: moneda(0), s: 'Estás al día', destacada: 'verde' },
    ])
    y -= 8
  } else {
    tarjetas([
      { e: 'TOTAL DEL PRESUPUESTO', v: moneda(d.total), s: 'Precio final', destacada: 'naranja' },
      { e: `SEÑA PARA CONFIRMAR (${PCT_ANTICIPO}%)`, v: moneda(Math.round(d.total * PCT_ANTICIPO) / 100), s: 'Reserva la fecha y los materiales' },
      { e: 'VÁLIDO HASTA', v: venceEl, s: `${validez} ${validez === 1 ? 'día' : 'días'} desde la emisión` },
    ])
    y -= 14
  }

  // ---------- Botón "Pagar" (página de pago del cliente) ----------
  if (opciones.linkPago && (!estado || aPagarHoy > 0.5)) {
    const alto = 34
    lugar(alto + 12)
    caja(M, y, CW, alto, { fondo: OSCURO, r: 10 })
    espaciado('PAGAR AHORA', M + 16, y - 21, F_CHICO + 0.5, BLANCO)
    texto('Transferencia o efectivo  ·  tocá acá', M + 16 + anchoEsp('PAGAR AHORA', F_CHICO + 0.5) + 12, y - 21, F_CHICO + 0.5, font, GRIS_CAJA)
    derecha('>', M + CW - 16, y - 22, F_GRANDE - 2, bold, NARANJA)
    const anotacion = pdf.context.register(pdf.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [M, y - alto, M + CW, y], Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(opciones.linkPago) },
    }))
    page.node.addAnnot(anotacion)
    y -= alto + 16
  }

  // ---------- Qué vas a disfrutar (soluciones) ----------
  if (soluciones.length) {
    lugar(60)
    titulo('Qué vas a disfrutar')
    for (const sol of soluciones) {
      const tit = partir(sol.titulo, F_NORMAL, CW - 46, bold)
      const desc = partir(sol.descripcion, F_CHICO + 0.5, CW - 46)
      const alto = tit.length * 11.5 + desc.length * 10.5 + 16
      lugar(alto + 6)
      caja(M, y + 8, CW, alto, { borde: LINEA, r: 8 })
      icono(M + 17, y - 4, 'ok')
      let yy = y - 6
      for (const r of tit) { texto(r, M + 32, yy, F_NORMAL, bold, OSCURO); yy -= 11.5 }
      for (const r of desc) { texto(r, M + 32, yy, F_CHICO + 0.5, font, TEXTO); yy -= 10.5 }
      y -= alto + 6
    }
    y -= 12
  }

  // ---------- Detalle de ítems ----------
  const xImp = M + CW - 4
  const xDescr = M + 30
  const anchoDescr = CW - 30 - 120
  lugar(60)
  titulo(estado ? 'Presupuesto aceptado' : 'Detalle del presupuesto')
  let numero = 0
  let sumaNeta = 0
  let sumaBruta = 0
  for (const g of agruparPorTipo(d.items)) {
    lugar(44)
    espaciado(g.titulo.toUpperCase(), M + 2, y, F_MINI, NARANJA)
    y -= 14
    for (const it of g.items) {
      numero++
      const { titulo: tit, detalle } = partirDescripcion(it.descripcion)
      const renglonesTit = partir(tit, F_NORMAL, anchoDescr, bold)
      const renglonesDet = detalle ? partir(detalle, F_CHICO, anchoDescr) : []
      const alto = renglonesTit.length * 11.5 + renglonesDet.length * 10 + 10 + 12
      lugar(alto)
      const neto = importeNeto(it)
      const bruto = importeBruto(it)
      const pct = pctItem(it)
      sumaNeta += neto
      sumaBruta += bruto
      // número en un cuadradito naranja suave
      caja(M + 2, y + 9, 17, 17, { fondo: NARANJA_SUAVE, r: 4.5 })
      const nTxt = String(numero).padStart(2, '0')
      texto(nTxt, M + 2 + (17 - ancho(nTxt, F_CHICO, bold)) / 2, y - 3.5, F_CHICO, bold, NARANJA_OSC)
      let yy = y
      for (const r of renglonesTit) { texto(r, xDescr, yy, F_NORMAL, bold, OSCURO); yy -= 11.5 }
      for (const r of renglonesDet) { texto(r, xDescr, yy + 0.5, F_CHICO, font, GRIS); yy -= 10 }
      const cuenta = `${Number(it.cantidad).toLocaleString('es-AR')} × ${moneda(it.precio_unitario)}`
      texto(cuenta, xDescr, yy, F_CHICO, font, GRIS)
      if (pct > 0) {
        const pTxt = `-${formatoPct(pct)}%`
        const xPill = xDescr + ancho(cuenta, F_CHICO) + 5
        const wPill = ancho(pTxt, F_MINI, bold) + 9
        caja(xPill, yy + 7.3, wPill, 9.6, { fondo: NARANJA_SUAVE, r: 4.8 })
        texto(pTxt, xPill + 4.5, yy - 0.2, F_MINI, bold, NARANJA_OSC)
      }
      derecha(moneda(neto), xImp, y, F_NORMAL + 0.5, bold, OSCURO)
      if (pct > 0) {
        const tachado = moneda(bruto)
        derecha(tachado, xImp, y - 11.5, F_CHICO, font, GRIS)
        linea(xImp - ancho(tachado, F_CHICO), y - 9, xImp, 0.6, GRIS)
      }
      y -= alto
      linea(M, y + 11, M + CW, 0.6, LINEA_SUAVE)
    }
    y -= 4
  }
  y -= 6

  // ---------- Totales (caja negra) ----------
  const ahorro = Math.round((sumaBruta - d.total) * 100) / 100
  const totalCaja = cajaNegra(
    ahorro > 0.5 ? [{ t: 'Subtotal', v: moneda(sumaBruta) }, { t: 'Te ahorrás (descuentos)', v: `- ${moneda(ahorro)}`, verde: true }]
      : Math.abs(sumaNeta - d.total) > 0.5 ? [{ t: 'Subtotal', v: moneda(sumaNeta) }, { t: 'Ajuste', v: conSigno(d.total - sumaNeta) }] : [],
    estado ? 'TOTAL ACEPTADO' : 'TOTAL', moneda(d.total),
  )
  // Formas de pago, a la izquierda de la caja del total.
  const formas = d.formasPago
  if (formas && formas.medios.length) {
    const anchoF = CW - 270 - 18
    const notaF = formas.nota ? partir(formas.nota, F_CHICO, anchoF - 24) : []
    const altoF = Math.max(totalCaja.alto, 44 + notaF.length * 10)
    caja(M, totalCaja.arriba, anchoF, altoF, { borde: LINEA, r: 9 })
    espaciado('FORMAS DE PAGO', M + 12, totalCaja.arriba - 15, F_MINI, GRIS)
    let yf = totalCaja.arriba - 30
    for (const r of partir(textoMedios(formas), F_NORMAL, anchoF - 24, bold)) { texto(r, M + 12, yf, F_NORMAL, bold, OSCURO); yf -= 12 }
    for (const r of notaF) { texto(r, M + 12, yf, F_CHICO, font, TEXTO); yf -= 10 }
    if (altoF > totalCaja.alto) y -= altoF - totalCaja.alto
  }
  y -= 6

  if (estado) {
    // ---------- Modificaciones durante la obra ----------
    if (estado.modificaciones.length > 0) {
      lugar(90)
      titulo('Modificaciones durante la obra')
      for (const r of partir('El presupuesto de arriba se mantiene tal como fue aceptado. Estos son los cambios registrados después:', F_CHICO + 0.5, CW)) { texto(r, M, y, F_CHICO + 0.5, font, GRIS); y -= 10.5 }
      y -= 6
      const anchoConc = CW - 30 - 120
      estado.modificaciones.forEach((m, iMod) => {
        const { antes, ahora } = antesYAhora(m, moneda)
        const renglones: { t: string; size: number; f: PDFFont; color: RGB }[] = [
          ...partir(m.descripcion, F_NORMAL, anchoConc, bold).map((t) => ({ t, size: F_NORMAL, f: bold, color: OSCURO })),
          { t: `${fechaCorta(m.fecha)} · ${etiquetaModificacion(m)}`, size: F_CHICO, f: font, color: GRIS },
          ...(antes ? partir(`Antes: ${antes}`, F_CHICO, anchoConc).map((t) => ({ t, size: F_CHICO, f: font, color: GRIS })) : []),
          ...(ahora ? partir(`Ahora: ${ahora}`, F_CHICO, anchoConc).map((t) => ({ t, size: F_CHICO, f: font, color: TEXTO })) : []),
          ...(m.motivo ? partir(`Motivo: ${m.motivo}`, F_CHICO, anchoConc).map((t) => ({ t, size: F_CHICO, f: font, color: GRIS })) : []),
        ]
        const alto = renglones.reduce((s, r) => s + r.size + 3, 0) + 12
        // el último cambio va en la misma página que su caja de total
        lugar(alto + (iMod === estado.modificaciones.length - 1 ? 92 : 0))
        caja(M + 2, y + 9, 17, 17, { fondo: m.importe < 0 ? VERDE_SUAVE : NARANJA_SUAVE, r: 4.5 })
        const signo = m.importe < 0 ? '-' : '+'
        texto(signo, M + 2 + (17 - ancho(signo, F_NORMAL, bold)) / 2, y - 3.5, F_NORMAL, bold, m.importe < 0 ? VERDE : NARANJA_OSC)
        derecha(m.importe === 0 ? moneda(0) : conSigno(m.importe), xImp, y, F_NORMAL + 0.5, bold, m.importe < 0 ? VERDE : OSCURO)
        let yy = y
        for (const r of renglones) { texto(r.t, xDescr, yy, r.size, r.f, r.color); yy -= r.size + 3 }
        y -= alto
        linea(M, y + 11, M + CW, 0.6, LINEA_SUAVE)
      })
      y -= 8
      cajaNegra([
        { t: 'Total original aceptado', v: moneda(estado.totalOriginal) },
        { t: 'Modificaciones', v: conSigno(estado.totalCambios), verde: estado.totalCambios < 0 },
      ], 'TOTAL ACTUALIZADO', moneda(estado.totalActualizado))
      y -= 6
    }

    // ---------- Pagos recibidos ----------
    lugar(60)
    titulo('Pagos recibidos')
    if (estado.pagos.length === 0) {
      texto('Todavía no registramos pagos.', M, y, F_NORMAL, font, GRIS); y -= 24
    } else {
      for (const p of estado.pagos) {
        lugar(26)
        icono(M + 10, y + 0.5, 'ok', 6.5)
        const medio = (p.medio ?? '').replace('_', ' ').replace(/^./, (c) => c.toUpperCase())
        texto(`Pago recibido${medio ? ` · ${medio}` : ''}`, M + 24, y + 3, F_NORMAL, bold, OSCURO)
        texto(partir([fechaCorta(p.fecha), p.referencia].filter(Boolean).join(' · '), F_CHICO, CW - 170)[0] ?? '', M + 24, y - 8, F_CHICO, font, GRIS)
        derecha(moneda(p.monto), xImp, y - 2, F_NORMAL + 0.5, bold, VERDE)
        y -= 26
        linea(M, y + 11, M + CW, 0.6, LINEA_SUAVE)
      }
      y -= 2
      derecha(`Total pagado  ${moneda(estado.cobrado)}`, xImp, y, F_NORMAL, bold, VERDE); y -= 26
    }

    // ---------- Estado de cuenta ----------
    const msg = mensajeEstado(estado, moneda)
    lugar(170)
    titulo('Estado de cuenta')
    const nPend = estado.gastosExtra.filter((g) => !g.devuelto).length
    tarjetas([
      { e: 'PENDIENTE DE LA OBRA', v: moneda(estado.pendienteHoy), s: `Según el avance (${estado.avance}%)`, color: estado.pendienteHoy > 0.5 ? OSCURO : VERDE },
      { e: 'GASTOS A REINTEGRAR', v: moneda(estado.gastoExtraPendiente), s: nPend ? `${nPend} ${nPend === 1 ? 'gasto pendiente' : 'gastos pendientes'}` : 'Sin gastos pendientes' },
      aPagarHoy > 0.5
        ? { e: 'TOTAL A PAGAR HOY', v: moneda(aPagarHoy), s: estado.gastoExtraPendiente > 0.5 ? 'Obra + gastos' : 'Según el avance', destacada: 'naranja' }
        : { e: 'TOTAL A PAGAR HOY', v: moneda(0), s: 'Estás al día', destacada: 'verde' },
    ])
    // Mensaje (aviso naranja o verde)
    const ok = msg.tono === 'ok'
    const rMsg = partir(`${msg.titulo}. ${msg.detalle}`.replace(/\.\.\s/, '. '), F_CHICO + 0.5, CW - 44)
    const altoMsg = 16 + rMsg.length * 10.5
    lugar(altoMsg + 8)
    caja(M, y, CW, altoMsg, { fondo: ok ? VERDE_SUAVE : AVISO_FONDO, borde: ok ? rgb(0.78, 0.89, 0.83) : AVISO_BORDE, r: 8 })
    icono(M + 17, y - 13, ok ? 'ok' : 'pendiente')
    let ym = y - 15.5
    rMsg.forEach((r, i) => {
      // el título (primera frase) va en negrita
      if (i === 0 && r.startsWith(win(msg.titulo))) {
        const t1 = win(msg.titulo) + '.'
        texto(t1, M + 32, ym, F_CHICO + 0.5, bold, ok ? VERDE : NARANJA_OSC)
        texto(r.slice(t1.length), M + 32 + ancho(t1, F_CHICO + 0.5, bold), ym, F_CHICO + 0.5, font, ok ? VERDE : NARANJA_OSC)
      } else texto(r, M + 32, ym, F_CHICO + 0.5, font, ok ? VERDE : NARANJA_OSC)
      ym -= 10.5
    })
    y -= altoMsg + 22

    // ---------- Línea de tiempo de pagos ----------
    lugar(190)
    titulo('Línea de tiempo de pagos')
    // Franja destacada: los pasos de pago unidos de izquierda a derecha.
    {
      // Sin el paso final cuando ya no suma nada (el avance llegó al 100%).
      const todos = estado.linea.filter((p) => !(p.tipo === 'final' && p.importe <= 0.5 && estado.linea.length > 1))
      const pasos = todos.length > 6 ? [todos[0], ...todos.slice(-5)] : todos
      const n = pasos.length
      const altoCaja = 128
      caja(M, y + 4, CW, altoCaja, { fondo: AVISO_FONDO, borde: AVISO_BORDE, r: 10 })
      const yNodo = y - 26
      const margen = 46
      const paso = n > 1 ? (CW - 2 * margen) / (n - 1) : 0
      const xDe = (i: number) => (n > 1 ? M + margen + i * paso : M + CW / 2)
      const colorDe = (e: string) => (e === 'ok' ? VERDE : e === 'pendiente' ? NARANJA : GRIS_CAJA)
      // pista gris y tramos de color hasta cada paso
      if (n > 1) {
        page.drawLine({ start: { x: xDe(0), y: yNodo }, end: { x: xDe(n - 1), y: yNodo }, thickness: 3, color: LINEA })
        for (let i = 1; i < n; i++) {
          if (pasos[i].estado !== 'futuro') page.drawLine({ start: { x: xDe(i - 1), y: yNodo }, end: { x: xDe(i), y: yNodo }, thickness: 3, color: colorDe(pasos[i].estado) })
        }
      }
      const anchoEt = Math.min(110, n > 1 ? paso - 6 : CW)
      pasos.forEach((p, i) => {
        const x = xDe(i)
        if (p.estado === 'futuro') page.drawCircle({ x, y: yNodo, size: 10, color: BLANCO, borderColor: GRIS_CAJA, borderWidth: 1.6 })
        else { page.drawCircle({ x, y: yNodo, size: 12.5, color: BLANCO }); icono(x, yNodo, p.estado, 10) }
        const et = p.tipo === 'anticipo' ? `Anticipo ${PCT_ANTICIPO}%` : p.tipo === 'final' ? (estado.terminada ? 'Obra finalizada' : 'Al finalizar') : `Avance ${p.porcentaje ?? 0}%`
        const centro = (t: string, yy: number, size: number, f: PDFFont, color: RGB) => texto(t, x - ancho(t, size, f) / 2, yy, size, f, color)
        let yy = yNodo - 24
        for (const r of partir(et, F_CHICO, anchoEt, bold).slice(0, 2)) { centro(r, yy, F_CHICO, bold, OSCURO); yy -= 9.5 }
        const sub = p.tipo === 'avance' && p.fecha ? diaMes(p.fecha) : p.tipo === 'anticipo' ? 'Al confirmar' : estado.terminada ? '' : 'Saldo final'
        if (sub) { centro(sub, yy, F_MINI, font, GRIS); yy -= 10 }
        centro(p.tipo === 'anticipo' ? moneda(p.importe) : `+ ${moneda(p.importe)}`, yy - 1, F_CHICO, bold, OSCURO); yy -= 11
        const est = p.estado === 'ok' ? (p.tipo === 'anticipo' ? 'Pagado' : 'Al día') : p.estado === 'futuro' ? 'Pendiente' : `Falta ${moneda(p.falta)}`
        centro(est, yy - 1, F_MINI, bold, p.estado === 'ok' ? VERDE : p.estado === 'futuro' ? GRIS : NARANJA_OSC)
      })
      // pie: cuánto se pagó del total
      const yPie = y + 4 - altoCaja + 13
      const pct = estado.totalActualizado > 0 ? Math.min(1, estado.cobrado / estado.totalActualizado) : 0
      texto(`Pagado ${moneda(estado.cobrado)} de ${moneda(estado.totalActualizado)}`, M + 14, yPie, F_CHICO, bold, OSCURO)
      const xb = M + 14 + ancho(`Pagado ${moneda(estado.cobrado)} de ${moneda(estado.totalActualizado)}`, F_CHICO, bold) + 10
      const derTxt = estado.pendienteHoy > 0.5 ? `A pagar hoy (obra): ${moneda(estado.pendienteHoy)}` : 'Obra al día'
      derecha(derTxt, M + CW - 14, yPie, F_CHICO, bold, estado.pendienteHoy > 0.5 ? NARANJA_OSC : VERDE)
      barra(xb, yPie + 0.5, M + CW - 14 - ancho(derTxt, F_CHICO, bold) - 10 - xb, pct, VERDE)
      if (todos.length > n) derecha(`(anticipo y últimos ${n - 1} avances)`, M + CW - 12, y - 6, F_MINI, font, GRIS)
      y -= altoCaja + 18
    }
    y -= 6

    // ---------- Gastos a reintegrar ----------
    if (estado.gastosExtra.length > 0) {
      lugar(70)
      titulo('Gastos a reintegrar')
      for (const r of partir('Materiales que compramos para tu obra y nos devolvés aparte del presupuesto. Los pendientes se suman al total a pagar; los ya reintegrados, no.', F_CHICO + 0.5, CW)) { texto(r, M, y, F_CHICO + 0.5, font, GRIS); y -= 10.5 }
      y -= 8
      const anchoG = CW - 30 - 170
      for (const g of estado.gastosExtra) {
        const rr = partir(g.descripcion || 'Gasto', F_NORMAL, anchoG, bold)
        const nComp = conComprobante.indexOf(g)
        const extra = links[g.id] ? 17 : nComp >= 0 ? 11 : 0
        const alto = Math.max(rr.length * 11.5 + 10 + extra, 22) + 12
        lugar(alto)
        icono(M + 10, y + 0.5, g.devuelto ? 'ok' : 'pendiente')
        let yy = y + 3
        for (const r of rr) { texto(r, M + 24, yy, F_NORMAL, bold, OSCURO); yy -= 11.5 }
        texto(fechaCorta(g.fecha), M + 24, yy + 0.5, F_CHICO, font, GRIS); yy -= 10
        if (nComp >= 0) texto(`Comprobante N.º ${nComp + 1}: adjunto al final del documento`, M + 24, yy, F_CHICO, font, NARANJA_OSC)
        if (links[g.id]) boton('Descargar factura', links[g.id], M + 24, yy - 4)
        derecha(moneda(g.importe), xImp - 84, y + 3, F_NORMAL + 0.5, bold, OSCURO)
        derecha(g.devuelto ? 'Reintegrado' : 'Pendiente', xImp, y + 3, F_CHICO, bold, g.devuelto ? VERDE : NARANJA_OSC)
        derecha(g.devuelto ? 'no suma' : 'suma al total', xImp, y - 7, F_CHICO, font, GRIS)
        y -= alto
        linea(M, y + 11, M + CW, 0.6, LINEA_SUAVE)
      }
      if (estado.gastoExtraPendiente > 0.5) { y -= 2; derecha(`Pendiente de reintegro  ${moneda(estado.gastoExtraPendiente)}`, xImp, y, F_NORMAL, bold, NARANJA_OSC); y -= 14 }
      y -= 14
    }

  }

  // ---------- Formas de uso y recomendaciones (opcional, por presupuesto) ----------
  const recos = lineasRecomendaciones(d.recomendaciones)
  if (recos.length) {
    lugar(70)
    titulo('Formas de uso y recomendaciones')
    for (const item of recos) {
      const rr = partir(item, F_CHICO + 0.8, CW - 18)
      lugar(rr.length * 10.5 + 5)
      page.drawCircle({ x: M + 4, y: y + 2.6, size: 1.9, color: NARANJA })
      for (const r of rr) { texto(r, M + 14, y, F_CHICO + 0.8, font, TEXTO); y -= 10.5 }
      y -= 4
    }
    y -= 14
  }

  // ---------- Notas ----------
  const notas = d.notas?.trim() ?? ''
  if (notas) {
    const rn = partir(notas, F_NORMAL, CW - 24)
    const altoN = 26 + rn.length * 12
    lugar(altoN + 30)
    titulo('Notas')
    caja(M, y + 6, CW, altoN, { fondo: GRIS_CLARO, r: 8 })
    let yn = y - 10
    for (const r of rn) { texto(r, M + 12, yn, F_NORMAL, font, TEXTO); yn -= 12 }
    y -= altoN + 14
  }

  // ---------- Condiciones generales (en dos columnas) ----------
  const condiciones = configActual().presupuestos.condiciones.filter((c) => c.titulo.trim() || c.texto.trim())
  if (condiciones.length) {
    lugar(70)
    titulo('Condiciones generales')
    const colW = (CW - 22) / 2
    const bloques = condiciones.map((c) => ({ t: partir(c.titulo, F_CHICO + 0.5, colW, bold), r: partir(textoCondicion(c, d.validez_dias), F_CHICO, colW) }))
    const altoB = (b: { t: string[]; r: string[] }) => b.t.length * 10 + b.r.length * 9.5 + 8
    for (let i = 0; i < bloques.length; i += 2) {
      const par = bloques.slice(i, i + 2)
      const alto = Math.max(...par.map(altoB))
      lugar(alto)
      par.forEach((b, k) => {
        const x = M + k * (colW + 22)
        let yy = y
        for (const r of b.t) { texto(r, x, yy, F_CHICO + 0.5, bold, OSCURO); yy -= 10 }
        for (const r of b.r) { texto(r, x, yy, F_CHICO, font, TEXTO); yy -= 9.5 }
      })
      y -= alto
    }
  }

  lugar(24)
  y -= 6
  texto(`Documento emitido el ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' })} a las ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })}`, M, y, F_MINI + 0.4, font, GRIS)

  // ---------- Anexo: comprobantes de los gastos a reintegrar ----------
  // Cada comprobante en su página, con encabezado (número, fecha, detalle y
  // monto) y la imagen o el PDF original ajustado al espacio.
  for (let k = 0; k < conComprobante.length; k++) {
    const g = conComprobante[k]
    page = pdf.addPage([W, H]); y = H - M
    if (logo) { const esc = 26 / logo.height; page.drawImage(logo, { x: M, y: y - 22, width: logo.width * esc, height: 26 }) }
    espaciadoDer('ANEXO · COMPROBANTES DE GASTOS', M + CW, y - 6, F_MINI, NARANJA)
    derecha(`Presupuesto ${codigo} · ${d.cliente}`, M + CW, y - 18, F_CHICO, font, GRIS)
    y -= 36
    caja(M, y, CW, 2.2, { fondo: LINEA, r: 1.1 }); caja(M, y, CW * 0.18, 2.2, { fondo: NARANJA, r: 1.1 })
    y -= 22
    espaciado(`COMPROBANTE ${k + 1} DE ${conComprobante.length}`, M, y, F_MINI, NARANJA)
    derecha(moneda(g.importe), M + CW, y - 6, F_GRANDE, bold, OSCURO)
    y -= 15
    for (const r of partir(g.descripcion || 'Gasto', F_NORMAL + 1, CW - 170, bold).slice(0, 2)) { texto(r, M, y, F_NORMAL + 1, bold, OSCURO); y -= 14 }
    texto(`${fechaCorta(g.fecha)} · ${g.devuelto ? 'Reintegrado' : 'Pendiente de reintegro'}`, M, y, F_CHICO + 0.5, bold, g.devuelto ? VERDE : NARANJA_OSC)
    y -= 16
    // Espacio para el comprobante
    const cajaX = M, cajaW = CW, cajaArriba = y, cajaAbajo = PIE + 6
    const cajaH = cajaArriba - cajaAbajo
    const encajar = (w: number, h: number) => {
      const esc = Math.min(cajaW / w, cajaH / h, 1.6)
      return { w: w * esc, h: h * esc, x: cajaX + (cajaW - w * esc) / 2, y: cajaArriba - h * esc }
    }
    try {
      const { data: archivo, error } = await supabase.storage.from('comprobantes').download(g.comprobante!)
      if (error || !archivo) throw error ?? new Error('sin archivo')
      const esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(g.comprobante!)
      if (esPdf) {
        const bytes = await archivo.arrayBuffer()
        const origen = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const paginasOrigen = origen.getPageCount()
        const embebidas = await pdf.embedPdf(bytes, Array.from({ length: Math.min(paginasOrigen, 6) }, (_, i) => i))
        embebidas.forEach((emb, i) => {
          if (i > 0) {
            page = pdf.addPage([W, H])
            texto(`Comprobante ${k + 1} · página ${i + 1} de ${Math.min(paginasOrigen, 6)}`, M, H - M, F_CHICO, bold, NARANJA)
          }
          const top = i > 0 ? H - M - 16 : cajaArriba
          const alto = top - cajaAbajo
          const esc = Math.min(cajaW / emb.width, alto / emb.height)
          page.drawPage(emb, { x: cajaX + (cajaW - emb.width * esc) / 2, y: top - emb.height * esc, width: emb.width * esc, height: emb.height * esc })
          page.drawRectangle({ x: cajaX + (cajaW - emb.width * esc) / 2, y: top - emb.height * esc, width: emb.width * esc, height: emb.height * esc, borderColor: LINEA, borderWidth: 0.8 })
        })
      } else {
        const jpg = await imagenAJpeg(archivo)
        const imagen = await pdf.embedJpg(jpg.bytes)
        const r = encajar(jpg.w, jpg.h)
        page.drawImage(imagen, { x: r.x, y: r.y, width: r.w, height: r.h })
        page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, borderColor: LINEA, borderWidth: 0.8 })
      }
    } catch (e) {
      console.error(e)
      rect(cajaX, cajaArriba - 60, cajaW, 50, GRIS_CLARO)
      texto('No se pudo adjuntar este comprobante. Si lo necesitás, te lo enviamos por separado.', cajaX + 14, cajaArriba - 38, F_NORMAL, font, GRIS)
    }
  }

  // ---------- Pie en todas las páginas ----------
  const paginas = pdf.getPages()
  paginas.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 22 }, end: { x: W - M, y: M + 22 }, thickness: 0.6, color: LINEA })
    p.drawRectangle({ x: M, y: M + 21.3, width: 30, height: 1.6, color: NARANJA })
    p.drawText(win(configActual().empresa.nombre), { x: M, y: M + 9, size: F_CHICO, font: bold, color: OSCURO })
    p.drawText(win(lineaContacto()), { x: M, y: M - 1, size: F_MINI, font, color: GRIS })
    const pag = win(`Página ${i + 1} de ${paginas.length}`)
    p.drawText(pag, { x: W - M - font.widthOfTextAtSize(pag, F_CHICO), y: M + 9, size: F_CHICO, font, color: GRIS })
  })

  const bytes = await pdf.save()
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
}

// Genera el PDF y lo comparte por el menú nativo (WhatsApp, mail, etc.).
// Si el equipo no soporta compartir archivos, lo descarga.
export async function compartirPresupuestoPdf(entrada: DatosPdf): Promise<void> {
  const d = await completarDatosDocumento(entrada)
  const blob = await generarPdfPresupuesto(d)
  const nombre = nombreArchivoPresupuesto(d)
  const file = new File([blob], nombre, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (data?: { files?: File[] }) => boolean }
  if (navigator.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Presupuesto ${codigoPresupuesto(d.id)}`, text: `${d.titulo} — ${d.cliente}` })
    } catch { /* el usuario canceló */ }
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = nombre; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
