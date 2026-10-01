import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type RGB, type PDFPage } from 'pdf-lib'
import logoUrl from './assets/mova-logo.png'
import { moneda, fechaCorta } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import { importeNeto, partirDescripcion, pctItem, formatoPct } from './presupuestoCalculos'
import { antesYAhora, etiquetaModificacion } from './presupuestoModificaciones'
import { cargarSolucionesPresupuesto, type SolucionPresupuesto } from './presupuestoSoluciones'
import { configActual, lineaContacto, textoCondicion } from './config'
import { cargarEstadoPresupuesto, mensajeEstado, PCT_ANTICIPO, totalAPagarHoy, type EstadoPresupuesto } from './estadoObra'
import { cargarDatosContacto, type DatosContacto } from './presupuestoContacto'
import { codigoPresupuesto, nombreArchivo } from './codigoPresupuesto'
import { supabase } from './supabase'

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
  // Campo viejo, ya no se usa (se deja para no romper llamadas anteriores).
  resumen?: unknown
}

// Carga todo lo que el documento necesita (estado de obra, soluciones y contacto).
export async function completarDatosDocumento(d: DatosPdf): Promise<DatosPdf> {
  // Ojo: la fila de "presupuestos" trae una columna "estado" ('aceptado', 'borrador'…) que NO es
  // el estado de obra. Solo se reutiliza si es un estado de obra ya calculado.
  const estadoValido = (x: unknown): x is EstadoPresupuesto | null =>
    x === null || (typeof x === 'object' && x !== null && Array.isArray((x as EstadoPresupuesto).linea))
  const [estado, soluciones, contacto] = await Promise.all([
    estadoValido(d.estado) ? Promise.resolve(d.estado) : cargarEstadoPresupuesto(d.id, Number(d.total) || 0),
    d.soluciones ? Promise.resolve(d.soluciones) : cargarSolucionesPresupuesto(d.id).catch(() => [] as SolucionPresupuesto[]),
    d.contacto !== undefined ? Promise.resolve(d.contacto) : cargarDatosContacto(d.id).catch(() => null),
  ])
  return { ...d, estado, soluciones, contacto }
}

// Nombre del archivo: Cliente_Obra_fecha_código.pdf
export const nombreArchivoPresupuesto = (d: Pick<DatosPdf, 'id' | 'cliente' | 'obra'>) => nombreArchivo(d.cliente, d.obra, d.id)

// Color de marca en hex, usado también en la vista en pantalla.
export const COLOR_MARCA_HEX = '#E47B00'

// Paleta
const NARANJA = rgb(0.894, 0.482, 0)
const NARANJA_SUAVE = rgb(1, 0.965, 0.925)
const OSCURO = rgb(0.063, 0.075, 0.094)
const TEXTO = rgb(0.2, 0.23, 0.27)
const GRIS = rgb(0.47, 0.51, 0.56)
const GRIS_CLARO = rgb(0.965, 0.969, 0.976)
const LINEA = rgb(0.9, 0.91, 0.93)
const VERDE = rgb(0.137, 0.463, 0.306)
const VERDE_SUAVE = rgb(0.925, 0.965, 0.945)
const BLANCO = rgb(1, 1, 1)

// Solo tres tamaños de letra en todo el documento.
const F_GRANDE = 17
const F_NORMAL = 9.5
const F_CHICO = 7.5

// Sanitiza a caracteres que las fuentes estándar (WinAnsi) pueden dibujar.
function win(s: string): string {
  return (s ?? '')
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/[\u2012-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2192/g, '->')
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

export async function generarPdfPresupuesto(entrada: DatosPdf, opciones: { comprobantes?: ModoComprobantes; onAviso?: (msg: string) => void } = {}): Promise<Blob> {
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
  // Comprobantes de los gastos: botón con link permanente o anexo al final.
  let modo: ModoComprobantes = opciones.comprobantes ?? 'boton'
  const gastosCon = !estado ? [] : estado.gastosExtra.filter((g) => g.comprobante)
  let links: Record<number, string> = {}
  if (modo === 'boton' && gastosCon.length) {
    const r = await linksComprobantes(gastosCon.map((g) => g.id))
    if (r) links = r
    else { modo = 'anexo'; opciones.onAviso?.('Falta instalar la función "comprobante" en Supabase: por ahora los comprobantes van adjuntos al final.') }
  }
  const conComprobante = modo === 'anexo' ? gastosCon : []
  // Botón con link (anotación del PDF que abre la dirección al tocarla).
  const boton = (etiqueta: string, url: string, x: number, yy: number) => {
    const s2 = win(etiqueta)
    const w = bold.widthOfTextAtSize(s2, F_CHICO) + 16, h = 13
    page.drawRectangle({ x, y: yy - 3.5, width: w, height: h, color: NARANJA })
    page.drawText(s2, { x: x + 8, y: yy, size: F_CHICO, font: bold, color: BLANCO })
    const anotacion = pdf.context.register(pdf.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [x, yy - 3.5, x + w, yy - 3.5 + h], Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    }))
    page.node.addAnnot(anotacion)
  }
  let page: PDFPage = pdf.addPage([W, H])
  let y = H - M

  // ---------- Utilidades ----------
  const texto = (t: string, x: number, yy: number, size: number, f: PDFFont = font, color: RGB = TEXTO) =>
    page.drawText(win(t), { x, y: yy, size, font: f, color })
  const derecha = (t: string, right: number, yy: number, size: number, f: PDFFont = font, color: RGB = TEXTO) => {
    const s = win(t); page.drawText(s, { x: right - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color })
  }
  const rect = (x: number, yy: number, w: number, h: number, color: RGB, borde?: RGB) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color, ...(borde ? { borderColor: borde, borderWidth: 0.7 } : {}) })
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
  const titulo = (t: string) => {
    rect(M, y - 2, 3, 12, NARANJA)
    texto(t.toUpperCase(), M + 10, y, F_NORMAL, bold, OSCURO)
    y -= 18
  }
  const nuevaPagina = () => {
    page = pdf.addPage([W, H]); y = H - M
    texto(`Presupuesto ${codigo} · ${d.cliente}`, M, y, F_CHICO, font, GRIS)
    derecha('continuación', M + CW, y, F_CHICO, font, GRIS)
    y -= 10; linea(M, y, M + CW); y -= 20
  }
  const lugar = (alto: number) => { if (y - alto < PIE) { nuevaPagina(); return true } return false }
  const cajaTotal = (x: number, w: number, etiqueta: string, monto: string) => {
    rect(x, y - 16, w, 34, NARANJA_SUAVE)
    rect(x, y - 16, 2.5, 34, NARANJA)
    texto(etiqueta, x + 12, y - 5, F_CHICO, bold, NARANJA)
    derecha(monto, x + w - 10, y - 7, F_GRANDE, bold, OSCURO)
    y -= 34
  }
  const encabezadoFila = (celdas: { t: string; x: number; der?: boolean }[]) => {
    rect(M, y - 6, CW, 20, GRIS_CLARO)
    linea(M, y - 6, M + CW, 0.8, NARANJA)
    for (const c of celdas) {
      if (c.der) derecha(c.t, c.x, y, F_CHICO, bold, GRIS)
      else texto(c.t, c.x, y, F_CHICO, bold, GRIS)
    }
    y -= 22
  }
  const tilde = (x: number, yy: number, ok: boolean) => {
    page.drawCircle({ x, y: yy, size: 6.5, color: ok ? VERDE : NARANJA })
    if (ok) {
      page.drawLine({ start: { x: x - 3, y: yy }, end: { x: x - 0.8, y: yy - 2.4 }, thickness: 1.3, color: BLANCO })
      page.drawLine({ start: { x: x - 0.8, y: yy - 2.4 }, end: { x: x + 3.2, y: yy + 2.6 }, thickness: 1.3, color: BLANCO })
    } else {
      page.drawLine({ start: { x, y: yy + 3 }, end: { x, y: yy - 0.5 }, thickness: 1.4, color: BLANCO })
      page.drawCircle({ x, y: yy - 2.6, size: 0.8, color: BLANCO })
    }
  }

  // ---------- Encabezado ----------
  if (logo) {
    const lw = 150, lh = lw * (logo.height / logo.width)
    page.drawImage(logo, { x: M, y: y - lh + 6, width: lw, height: lh })
  }
  derecha(estado ? 'PRESUPUESTO Y ESTADO DE OBRA' : 'PRESUPUESTO', M + CW, y, F_CHICO, bold, NARANJA); y -= 20
  derecha(codigo, M + CW, y, F_GRANDE, bold, OSCURO); y -= 15
  derecha(`Fecha: ${fechaCorta(d.fecha)}`, M + CW, y, F_CHICO, font, GRIS); y -= 11
  if (estado) {
    derecha(`Última actualización: ${fechaCorta(estado.ultimaActualizacion)}`, M + CW, y, F_CHICO, bold, NARANJA); y -= 11
  } else if (d.validez_dias) { derecha(`Validez: ${d.validez_dias} ${d.validez_dias === 1 ? 'día' : 'días'}`, M + CW, y, F_CHICO, font, GRIS); y -= 11 }
  y -= 8
  linea(M, y, M + CW, 0.8, LINEA)
  rect(M, y - 0.4, 60, 1.6, NARANJA)
  y -= 22

  // ---------- Cliente y obra (con datos de contacto) ----------
  const cajaW = (CW - 12) / 2
  const hayObra = !!d.obra && d.obra !== 'Sin obra asociada'
  const lineasCliente = [
    contacto?.telefono ? `Tel.: ${contacto.telefono}` : null,
    contacto?.email ? `Email: ${contacto.email}` : null,
    contacto?.documento ? `${contacto.documento.etiqueta}: ${contacto.documento.valor}` : null,
    contacto?.direccionCliente ? `Domicilio: ${contacto.direccionCliente}` : null,
  ].filter((l): l is string => !!l).flatMap((l) => partir(l, F_CHICO + 0.5, cajaW - 24))
  const etapa = !estado ? null : estado.terminada ? 'Obra finalizada' : estado.enObra ? `En obra · avance ${estado.avance}%` : 'Presupuesto aceptado'
  const lineasObra = [
    hayObra && (contacto?.direccionObra || contacto?.direccionCliente) ? `Ubicación: ${contacto?.direccionObra || contacto?.direccionCliente}` : null,
    etapa ? `Estado: ${etapa}` : null,
    estado ? null : `Presupuesto válido hasta el ${fechaCorta(new Date(new Date(`${d.fecha.slice(0, 10)}T12:00:00`).getTime() + (d.validez_dias ?? configActual().presupuestos.validezDias) * 86400000).toISOString().slice(0, 10))}`,
  ].filter((l): l is string => !!l).flatMap((l) => partir(l, F_CHICO + 0.5, cajaW - 24))
  const altoCaja = 34 + Math.max(lineasCliente.length, lineasObra.length) * 10.5
  rect(M, y - altoCaja + 12, cajaW, altoCaja, GRIS_CLARO)
  rect(M + cajaW + 12, y - altoCaja + 12, cajaW, altoCaja, GRIS_CLARO)
  texto('CLIENTE', M + 12, y, F_CHICO, bold, GRIS)
  texto(hayObra ? 'OBRA' : 'PRESUPUESTO', M + cajaW + 24, y, F_CHICO, bold, GRIS)
  let yCaja = y - 15
  texto(partir(d.cliente, F_NORMAL, cajaW - 24, bold)[0] ?? '', M + 12, yCaja, F_NORMAL, bold, OSCURO)
  texto(partir(hayObra ? d.obra : codigo, F_NORMAL, cajaW - 24, bold)[0] ?? '', M + cajaW + 24, yCaja, F_NORMAL, bold, OSCURO)
  yCaja -= 13
  let yl = yCaja
  for (const l of lineasCliente) { texto(l, M + 12, yl, F_CHICO + 0.5, font, TEXTO); yl -= 10.5 }
  yl = yCaja
  for (const l of lineasObra) { texto(l, M + cajaW + 24, yl, F_CHICO + 0.5, font, TEXTO); yl -= 10.5 }
  y -= altoCaja + 22

  // ---------- Título y descripción ----------
  for (const r of partir(d.titulo, F_GRANDE, CW, bold)) { texto(r, M, y, F_GRANDE, bold, OSCURO); y -= 21 }
  if (d.descripcion) for (const r of partir(d.descripcion, F_NORMAL, CW)) { lugar(13); texto(r, M, y, F_NORMAL, font, GRIS); y -= 13 }
  y -= 14

  // ---------- Qué vas a disfrutar (soluciones), a todo el ancho ----------
  if (soluciones.length) {
    lugar(70)
    titulo('Qué vas a disfrutar con este proyecto')
    for (const sol of soluciones) {
      const tit = partir(sol.titulo, F_NORMAL, CW - 40, bold)
      const desc = partir(sol.descripcion, F_CHICO + 1, CW - 40)
      const alto = tit.length * 12 + desc.length * 11.5 + 16
      lugar(alto + 6)
      rect(M, y - alto + 12, CW, alto, BLANCO, LINEA)
      rect(M, y - alto + 12, 2.5, alto, NARANJA)
      tilde(M + 18, y - 1, true)
      let yy = y - 2
      for (const r of tit) { texto(r, M + 32, yy, F_NORMAL, bold, OSCURO); yy -= 12 }
      yy -= 1
      for (const r of desc) { texto(r, M + 32, yy, F_CHICO + 1, font, TEXTO); yy -= 11.5 }
      y -= alto + 6
    }
    y -= 12
  }

  // ---------- Tabla de ítems ----------
  const hayDescuento = d.items.some((it) => pctItem(it) > 0)
  const xImp = M + CW - 10
  const xDesc = xImp - 92
  const xPU = hayDescuento ? xDesc - 46 : xImp - 92
  const xCant = xPU - 86
  const xDescr = M + 30
  const anchoDescr = xCant - 38 - xDescr
  const encabezadoTabla = () => encabezadoFila([
    { t: '#', x: M + 10 }, { t: 'DESCRIPCIÓN', x: xDescr }, { t: 'CANT.', x: xCant, der: true },
    { t: 'P. UNITARIO', x: xPU, der: true }, ...(hayDescuento ? [{ t: 'DESC.', x: xDesc, der: true }] : []), { t: 'IMPORTE', x: xImp, der: true },
  ])

  lugar(60)
  titulo(estado ? 'Presupuesto aceptado' : 'Detalle del presupuesto')
  encabezadoTabla()
  let numero = 0
  let sumaNeta = 0
  for (const g of agruparPorTipo(d.items)) {
    if (lugar(40)) encabezadoTabla()
    texto(g.titulo.toUpperCase(), M + 10, y, F_CHICO, bold, NARANJA)
    y -= 16
    for (const it of g.items) {
      numero++
      const { titulo: tit, detalle } = partirDescripcion(it.descripcion)
      const renglonesTit = partir(tit, F_NORMAL, anchoDescr, bold)
      const renglonesDet = detalle ? partir(detalle, F_CHICO, anchoDescr) : []
      const alto = renglonesTit.length * 12 + renglonesDet.length * 10 + 10
      if (lugar(alto)) encabezadoTabla()
      const neto = importeNeto(it)
      sumaNeta += neto
      texto(String(numero).padStart(2, '0'), M + 10, y, F_NORMAL, font, GRIS)
      derecha(`${Number(it.cantidad)}`, xCant, y, F_NORMAL, font, TEXTO)
      derecha(moneda(it.precio_unitario), xPU, y, F_NORMAL, font, TEXTO)
      if (hayDescuento) derecha(pctItem(it) > 0 ? `${formatoPct(pctItem(it))}%` : '—', xDesc, y, F_NORMAL, font, pctItem(it) > 0 ? NARANJA : GRIS)
      derecha(moneda(neto), xImp, y, F_NORMAL, bold, OSCURO)
      let yy = y
      for (const r of renglonesTit) { texto(r, xDescr, yy, F_NORMAL, bold, OSCURO); yy -= 12 }
      for (const r of renglonesDet) { texto(r, xDescr, yy + 1, F_CHICO, font, GRIS); yy -= 10 }
      y -= alto
      linea(M, y + 11, M + CW, 0.5)
    }
  }
  y -= 8

  // ---------- Totales ----------
  const bonificacion = Math.round((sumaNeta - d.total) * 100) / 100
  const totW = 250, totX = M + CW - totW
  lugar(80)
  texto('Subtotal', totX + 12, y, F_NORMAL, font, GRIS); derecha(moneda(sumaNeta), xImp, y, F_NORMAL, font, TEXTO); y -= 15
  if (bonificacion > 0.5) {
    texto('Bonificación', totX + 12, y, F_NORMAL, font, NARANJA); derecha(`- ${moneda(bonificacion)}`, xImp, y, F_NORMAL, font, NARANJA); y -= 15
  }
  y -= 8
  cajaTotal(totX, totW, estado ? 'TOTAL ACEPTADO' : 'TOTAL', moneda(d.total))
  y -= 14

  if (estado) {
    // ---------- Modificaciones durante la obra ----------
    if (estado.modificaciones.length > 0) {
      lugar(90)
      titulo('Modificaciones durante la obra')
      for (const r of partir('El presupuesto de arriba se mantiene tal como fue aceptado. Estos son los cambios registrados después:', F_CHICO, CW)) { texto(r, M, y, F_CHICO, font, GRIS); y -= 10 }
      y -= 8
      const xFecha = M + 10
      const xConc = M + 78
      const anchoConc = xImp - 100 - xConc
      const encabezadoMods = () => encabezadoFila([{ t: 'FECHA', x: xFecha }, { t: 'CONCEPTO', x: xConc }, { t: 'IMPORTE', x: xImp, der: true }])
      encabezadoMods()
      for (const m of estado.modificaciones) {
        const { antes, ahora } = antesYAhora(m, moneda)
        const renglones: { t: string; size: number; f: PDFFont; color: RGB }[] = [
          { t: etiquetaModificacion(m).toUpperCase(), size: F_CHICO, f: bold, color: GRIS },
          ...partir(m.descripcion, F_NORMAL, anchoConc, bold).map((t) => ({ t, size: F_NORMAL, f: bold, color: OSCURO })),
          ...(antes ? partir(`Antes: ${antes}`, F_CHICO, anchoConc).map((t) => ({ t, size: F_CHICO, f: font, color: GRIS })) : []),
          ...(ahora ? partir(`Ahora: ${ahora}`, F_CHICO, anchoConc).map((t) => ({ t, size: F_CHICO, f: font, color: TEXTO })) : []),
          ...(m.motivo ? partir(`Motivo: ${m.motivo}`, F_CHICO, anchoConc).map((t) => ({ t, size: F_CHICO, f: font, color: GRIS })) : []),
        ]
        const alto = renglones.reduce((s, r) => s + r.size + 3, 0) + 10
        if (lugar(alto)) encabezadoMods()
        texto(fechaCorta(m.fecha), xFecha, y, F_NORMAL, font, TEXTO)
        derecha(m.importe === 0 ? moneda(0) : conSigno(m.importe), xImp, y, F_NORMAL, bold, m.importe < 0 ? VERDE : OSCURO)
        let yy = y
        for (const r of renglones) { texto(r.t, xConc, yy, r.size, r.f, r.color); yy -= r.size + 3 }
        y -= alto
        linea(M, y + 11, M + CW, 0.5)
      }
      y -= 8
      lugar(80)
      texto('Total original aceptado', totX + 12, y, F_NORMAL, font, GRIS); derecha(moneda(estado.totalOriginal), xImp, y, F_NORMAL, font, TEXTO); y -= 15
      texto('Modificaciones', totX + 12, y, F_NORMAL, font, GRIS); derecha(conSigno(estado.totalCambios), xImp, y, F_NORMAL, font, estado.totalCambios < 0 ? VERDE : OSCURO); y -= 23
      cajaTotal(totX, totW, 'TOTAL ACTUALIZADO', moneda(estado.totalActualizado))
      y -= 14
    }

    // ---------- Pagos recibidos ----------
    lugar(70)
    titulo('Pagos recibidos')
    if (estado.pagos.length === 0) {
      texto('Todavía no registramos pagos.', M, y, F_NORMAL, font, GRIS); y -= 22
    } else {
      encabezadoFila([{ t: 'FECHA', x: M + 10 }, { t: 'MEDIO', x: M + 90 }, { t: 'REFERENCIA', x: M + 200 }, { t: 'MONTO', x: xImp, der: true }])
      for (const p of estado.pagos) {
        lugar(18)
        texto(fechaCorta(p.fecha), M + 10, y, F_NORMAL, font, TEXTO)
        texto((p.medio ?? '—').replace('_', ' ').replace(/^./, (c) => c.toUpperCase()), M + 90, y, F_NORMAL, font, TEXTO)
        texto(partir(p.referencia || '—', F_NORMAL, xImp - 120 - (M + 200))[0] ?? '', M + 200, y, F_NORMAL, font, GRIS)
        derecha(moneda(p.monto), xImp, y, F_NORMAL, bold, OSCURO)
        y -= 18
        linea(M, y + 11, M + CW, 0.5)
      }
      y -= 4
      texto('Total pagado', totX + 12, y, F_NORMAL, bold, OSCURO); derecha(moneda(estado.cobrado), xImp, y, F_NORMAL, bold, VERDE); y -= 22
    }

    // ---------- Estado de tu obra (después de los pagos) ----------
  if (estado) {
    const msg = mensajeEstado(estado, moneda)
    lugar(150)
    titulo('Estado de tu obra')
    // Tres cifras
    const col = CW / 3
    rect(M, y - 34, CW, 48, GRIS_CLARO)
    const cifras = [
      { e: 'TOTAL DE LA OBRA', v: moneda(estado.totalActualizado), c: OSCURO },
      { e: 'YA PAGASTE', v: moneda(estado.cobrado), c: VERDE },
      { e: 'PENDIENTE A HOY', v: moneda(estado.pendienteHoy), c: estado.pendienteHoy > 0.5 ? NARANJA : VERDE },
    ]
    if (estado.gastoExtraPendiente > 0.5) cifras[2].e = 'PENDIENTE DE LA OBRA'
    cifras.forEach((c, i) => { texto(c.e, M + 14 + i * col, y - 2, F_CHICO, bold, GRIS); texto(c.v, M + 14 + i * col, y - 22, F_GRANDE, bold, c.c) })
    y -= 52
    // Total a pagar hoy = obra + gastos a reintegrar que todavía no se devolvieron.
    if (estado.gastoExtraPendiente > 0.5) {
      lugar(44)
      rect(M, y - 26, CW, 38, NARANJA_SUAVE)
      rect(M, y - 26, 2.5, 38, NARANJA)
      texto('TOTAL A PAGAR HOY', M + 14, y - 2, F_CHICO, bold, NARANJA)
      texto(`Obra ${moneda(Math.max(0, estado.pendienteHoy))} + gastos a reintegrar ${moneda(estado.gastoExtraPendiente)}`, M + 14, y - 16, F_CHICO, font, GRIS)
      derecha(moneda(totalAPagarHoy(estado)), M + CW - 14, y - 14, F_GRANDE, bold, OSCURO)
      y -= 46
    }
    // ---- Avance de la obra: "Hoy vamos por acá" según el último informe ----
    const bx = M, bw = CW
    const total = Math.max(estado.totalActualizado, 1)
    const ultimo = estado.avances.length ? estado.avances[estado.avances.length - 1] : null
    const xAv = bx + bw * Math.min(1, estado.avance / 100)
    lugar(120)
    texto('AVANCE DE LA OBRA', bx, y, F_CHICO, bold, GRIS)
    derecha(`${estado.avance}%`, bx + bw, y, F_NORMAL, bold, NARANJA)
    y -= 26
    // globito "Hoy vamos por acá"
    const etHoy = 'Hoy vamos por acá'
    const anchoEt = bold.widthOfTextAtSize(win(etHoy), F_CHICO) + 12
    const xEt = Math.min(Math.max(xAv - anchoEt / 2, bx), bx + bw - anchoEt)
    rect(xEt, y + 2, anchoEt, 13, NARANJA)
    texto(etHoy, xEt + 6, y + 6, F_CHICO, bold, BLANCO)
    page.drawSvgPath('M -4 0 L 4 0 L 0 5 Z', { x: xAv, y: y + 2, color: NARANJA })
    y -= 10
    rect(bx, y, bw, 8, rgb(0.93, 0.94, 0.95))
    if (estado.avance > 0) rect(bx, y, bw * Math.min(1, estado.avance / 100), 8, NARANJA)
    y -= 12
    texto(ultimo ? `Último informe: ${fechaCorta(ultimo.fecha)} · ${ultimo.titulo}` : 'Todavía no hay informes de avance cargados.', bx, y, F_CHICO, font, GRIS)
    y -= 22

    // ---- Pagos: pagado vs. lo que corresponde a hoy, con el anticipo marcado ----
    const pctPag = Math.min(1, estado.cobrado / total)
    const pctCorr = Math.min(1, estado.corresponde / total)
    const pctAnt = Math.min(1, estado.anticipo / total)
    texto('PAGOS', bx, y, F_CHICO, bold, GRIS)
    derecha(estado.cobrado > total + 0.5 ? `Pagado 100% · saldo a favor ${moneda(estado.cobrado - total)}` : `Pagado ${Math.round(pctPag * 100)}% del total`, bx + bw, y, F_CHICO, bold, VERDE)
    y -= 14
    rect(bx, y, bw, 8, rgb(0.93, 0.94, 0.95))
    if (pctPag > 0) rect(bx, y, bw * pctPag, 8, VERDE)
    rect(bx + bw * pctAnt - 0.8, y - 3, 1.6, 14, NARANJA)
    rect(bx + bw * pctCorr - 0.8, y - 3, 1.6, 14, OSCURO)
    y -= 13
    rect(bx, y + 1, 6, 6, NARANJA); texto(`Anticipo (${PCT_ANTICIPO}%): ${moneda(estado.anticipo)}`, bx + 10, y + 1, F_CHICO, font, TEXTO)
    const etCorr = `A pagar a hoy: ${moneda(estado.corresponde)}`
    const xCorrEt = bx + bw - bold.widthOfTextAtSize(win(etCorr), F_CHICO)
    rect(xCorrEt - 10, y + 1, 6, 6, OSCURO); texto(etCorr, xCorrEt, y + 1, F_CHICO, bold, OSCURO)
    y -= 20
    // Mensaje
    const rMsg = partir(msg.detalle, F_NORMAL, CW - 36)
    const altoMsg = 22 + rMsg.length * 12
    lugar(altoMsg + 8)
    rect(M, y - altoMsg + 12, CW, altoMsg, msg.tono === 'ok' ? VERDE_SUAVE : NARANJA_SUAVE)
    rect(M, y - altoMsg + 12, 2.5, altoMsg, msg.tono === 'ok' ? VERDE : NARANJA)
    tilde(M + 16, y + 2, msg.tono === 'ok')
    texto(msg.titulo, M + 30, y - 1, F_NORMAL, bold, msg.tono === 'ok' ? VERDE : NARANJA)
    let ym = y - 14
    for (const r of rMsg) { texto(r, M + 30, ym, F_NORMAL, font, TEXTO); ym -= 12 }
    y -= altoMsg + 14

    // Línea de tiempo
    lugar(60)
    titulo('Línea de tiempo de pagos y avances')
    const xTexto = M + 30
    const anchoTexto = CW - 200
    for (let i = 0; i < estado.linea.length; i++) {
      const p = estado.linea[i]
      const tit = partir(`${p.fecha && p.tipo !== 'anticipo' ? `${fechaCorta(p.fecha)} · ` : ''}${p.titulo}${p.porcentaje != null && p.tipo === 'avance' ? ` · ${p.porcentaje}%` : ''}`, F_NORMAL, anchoTexto, bold)
      const det = p.detalle ? partir(p.detalle, F_CHICO + 0.5, anchoTexto) : []
      const estadoTxt = p.estado === 'ok' ? (p.tipo === 'anticipo' ? 'Recibido' : 'Al día') : p.estado === 'futuro' ? 'Al finalizar' : `Falta ${moneda(p.falta)}`
      const resumenTxt = p.tipo === 'anticipo' ? null : `A pagar hasta acá: ${moneda(p.acumulado)}`
      const alto = Math.max(tit.length * 12 + det.length * 10.5 + (resumenTxt ? 11 : 0), 24) + 12
      lugar(alto)
      // conector vertical
      if (i < estado.linea.length - 1) rect(M + 15.4, y - alto + 4, 1.2, alto, LINEA)
      if (p.estado === 'futuro') { page.drawCircle({ x: M + 16, y: y + 3, size: 6.5, color: BLANCO, borderColor: GRIS, borderWidth: 1 }) }
      else tilde(M + 16, y + 3, p.estado === 'ok')
      let yy = y
      for (const r of tit) { texto(r, xTexto, yy, F_NORMAL, bold, OSCURO); yy -= 12 }
      for (const r of det) { texto(r, xTexto, yy, F_CHICO + 0.5, font, GRIS); yy -= 10.5 }
      if (resumenTxt) texto(resumenTxt, xTexto, yy, F_CHICO + 0.5, font, GRIS)
      derecha(p.tipo === 'anticipo' ? moneda(p.importe) : `+ ${moneda(p.importe)}`, M + CW, y, F_NORMAL, bold, OSCURO)
      derecha(estadoTxt, M + CW, y - 13, F_CHICO + 0.5, bold, p.estado === 'ok' ? VERDE : p.estado === 'futuro' ? GRIS : NARANJA)
      y -= alto
    }
    y -= 6

    // Gastos a reintegrar
    if (estado.gastosExtra.length > 0) {
      lugar(60)
      titulo('Gastos a reintegrar')
      for (const r of partir('Materiales y gastos que compramos para tu obra y nos devolvés aparte del presupuesto. Los pendientes se suman al total a pagar; los ya reintegrados, no.', F_CHICO + 0.5, CW)) { texto(r, M, y, F_CHICO + 0.5, font, GRIS); y -= 10.5 }
      y -= 6
      for (const g of estado.gastosExtra) {
        const rr = partir(`${fechaCorta(g.fecha)} · ${g.descripcion}`, F_NORMAL, CW - 200)
        const alto = Math.max(rr.length * 12 + (conComprobante.includes(g) ? 10 : 0) + (links[g.id] ? 16 : 0), 20) + 8
        lugar(alto)
        tilde(M + 16, y + 3, g.devuelto)
        let yy = y
        for (const r of rr) { texto(r, M + 30, yy, F_NORMAL, font, TEXTO); yy -= 12 }
        const nComp = conComprobante.indexOf(g)
        if (nComp >= 0) texto(`Comprobante N.º ${nComp + 1}: adjunto al final del documento`, M + 30, yy + 1, F_CHICO, font, NARANJA)
        if (links[g.id]) boton('Descargar factura', links[g.id], M + 30, yy - 1)
        derecha(moneda(g.importe), M + CW - 90, y, F_NORMAL, bold, OSCURO)
        derecha(g.devuelto ? 'Reintegrado' : 'Pendiente', M + CW, y, F_CHICO + 0.5, bold, g.devuelto ? VERDE : NARANJA)
        derecha(g.devuelto ? 'no suma' : 'suma al total', M + CW, y - 10, F_CHICO, font, GRIS)
        y -= alto
      }
      if (estado.gastoExtraPendiente > 0.5) { texto(`Pendiente de reintegro: ${moneda(estado.gastoExtraPendiente)} (incluido en el total a pagar)`, M + 30, y, F_NORMAL, bold, NARANJA); y -= 16 }
      y -= 10
    }
  }

    // ---------- Formas de uso y garantía (al finalizar) ----------
    if (estado.terminada) {
      lugar(120)
      titulo('Formas de uso y recomendaciones')
      for (const item of [
        'Control desde el celular con la app correspondiente (Tuya / SmartLife o eWeLink / Sonoff según los equipos).',
        'Creación de escenas y automatizaciones (horarios, sensores, riego programado).',
        'Control por voz con asistentes compatibles (Alexa / Google / Siri) al vincular la cuenta.',
        'Ante cortes de energía o internet, los equipos se reconectan solos al volver el servicio.',
        'Mantené buena señal de WiFi en las zonas con dispositivos smart.',
      ]) {
        const rr = partir(item, F_NORMAL, CW - 16)
        lugar(rr.length * 12 + 4)
        page.drawCircle({ x: M + 4, y: y + 3, size: 1.8, color: NARANJA })
        for (const r of rr) { texto(r, M + 14, y, F_NORMAL, font, TEXTO); y -= 12 }
        y -= 3
      }
      y -= 12
    }
  }

  // ---------- Notas y vigencia ----------
  const notas = d.notas?.trim() ?? ''
  const vigencia = `Este presupuesto tiene una validez de ${d.validez_dias ?? configActual().presupuestos.validezDias} días corridos desde su emisión.`
  const cajas = [...(notas ? [{ t: 'NOTAS', texto: notas }] : []), ...(estado ? [] : [{ t: 'VIGENCIA', texto: vigencia }])]
  if (cajas.length) {
    const colW = cajas.length === 2 ? (CW - 12) / 2 : CW
    const renglonesCajas = cajas.map((c) => partir(c.texto, F_NORMAL, colW - 24))
    const altoCajas = Math.max(...renglonesCajas.map((r) => r.length)) * 12.5 + 32
    lugar(altoCajas + 10)
    cajas.forEach((c, i) => {
      const x = M + i * (colW + 12)
      rect(x, y - altoCajas + 12, colW, altoCajas, GRIS_CLARO)
      texto(c.t, x + 12, y - 2, F_CHICO, bold, NARANJA)
      let yc = y - 18
      for (const r of renglonesCajas[i]) { texto(r, x + 12, yc, F_NORMAL, font, TEXTO); yc -= 12.5 }
    })
    y -= altoCajas + 16
  }

  // ---------- Condiciones generales ----------
  const condiciones = configActual().presupuestos.condiciones.filter((c) => c.titulo.trim() || c.texto.trim())
  if (condiciones.length) {
    lugar(60)
    titulo('Condiciones generales')
    for (const cond of condiciones) {
      const textoCond = textoCondicion(cond, d.validez_dias)
      const renglones = partir(textoCond, F_CHICO + 0.5, CW)
      lugar(14 + renglones.length * 10.5)
      texto(cond.titulo, M, y, F_NORMAL, bold, OSCURO); y -= 12
      for (const r of renglones) { texto(r, M, y, F_CHICO + 0.5, font, GRIS); y -= 10.5 }
      y -= 6
    }
  }

  lugar(24)
  texto(`Documento emitido: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`, M, y, F_CHICO, font, GRIS)

  // ---------- Anexo: comprobantes de los gastos a reintegrar ----------
  // Cada comprobante en su página, con encabezado (número, fecha, detalle y
  // monto) y la imagen o el PDF original ajustado al espacio.
  for (let k = 0; k < conComprobante.length; k++) {
    const g = conComprobante[k]
    page = pdf.addPage([W, H]); y = H - M
    if (logo) { const esc = 26 / logo.height; page.drawImage(logo, { x: M, y: y - 22, width: logo.width * esc, height: 26 }) }
    derecha('ANEXO · COMPROBANTES DE GASTOS', M + CW, y - 6, F_CHICO, bold, NARANJA)
    derecha(`Presupuesto ${codigo} · ${d.cliente}`, M + CW, y - 18, F_CHICO, font, GRIS)
    y -= 36; linea(M, y, M + CW); y -= 22
    texto(`COMPROBANTE ${k + 1} DE ${conComprobante.length}`, M, y, F_CHICO, bold, NARANJA)
    derecha(moneda(g.importe), M + CW, y - 6, F_GRANDE, bold, OSCURO)
    y -= 15
    for (const r of partir(g.descripcion || 'Gasto', F_NORMAL + 1, CW - 170, bold).slice(0, 2)) { texto(r, M, y, F_NORMAL + 1, bold, OSCURO); y -= 14 }
    texto(`${fechaCorta(g.fecha)} · ${g.devuelto ? 'Reintegrado' : 'Pendiente de reintegro'}`, M, y, F_CHICO + 0.5, bold, g.devuelto ? VERDE : NARANJA)
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
    p.drawRectangle({ x: M, y: M + 21.4, width: 40, height: 1.4, color: NARANJA })
    p.drawText(win(configActual().empresa.nombre), { x: M, y: M + 9, size: F_CHICO, font: bold, color: OSCURO })
    p.drawText(win(lineaContacto()), { x: M, y: M - 1, size: F_CHICO, font, color: GRIS })
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
