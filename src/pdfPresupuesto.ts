import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from 'pdf-lib'
import logoUrl from './assets/mova-logo.png'
import { moneda, fechaCorta } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'

const GRUPOS: Record<string, string> = {
  producto: 'Productos y equipos', servicio: 'Servicios', material: 'Materiales',
  mano_obra: 'Mano de obra e instalación', otro: 'Otros',
}

export type DatosPdf = {
  id: number; titulo: string; descripcion?: string | null; fecha: string; validez_dias?: number | null
  subtotal: number; descuento: number; total: number; notas?: string | null
  items: ItemPresupuesto[]; cliente: string; obra: string
}

const ORANGE = rgb(0.894, 0.482, 0)
const DARK = rgb(0.063, 0.075, 0.094)
const GRAY = rgb(0.47, 0.51, 0.56)
const LINE = rgb(0.88, 0.89, 0.91)

// Sanitiza a caracteres que las fuentes estándar (WinAnsi) pueden dibujar.
function win(s: string): string {
  return (s ?? '')
    .replace(/[  ]/g, ' ')
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x00-\xFF]/g, '')
}

export async function generarPdfPresupuesto(d: DatosPdf): Promise<Blob> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  try { logo = await pdf.embedPng(await fetch(logoUrl).then((r) => r.arrayBuffer())) } catch { logo = null }

  const W = 595.28, H = 841.89, M = 42
  let page = pdf.addPage([W, H])
  let y = H - M
  const codigo = `#${String(d.id).padStart(4, '0')}`

  const nueva = () => { page = pdf.addPage([W, H]); y = H - M }
  const room = (n: number) => { if (y - n < M + 40) nueva() }
  const T = (t: string, x: number, size: number, f: PDFFont = font, color: RGB = DARK) =>
    page.drawText(win(t), { x, y, size, font: f, color })
  const Tright = (t: string, right: number, size: number, f: PDFFont = font, color: RGB = DARK) => {
    const s = win(t); page.drawText(s, { x: right - f.widthOfTextAtSize(s, size), y, size, font: f, color })
  }
  const wrap = (t: string, x: number, size: number, color: RGB, maxW: number) => {
    for (const raw of win(t).split('\n')) {
      let line = ''
      for (const w of raw.split(/\s+/)) {
        const test = line ? line + ' ' + w : w
        if (font.widthOfTextAtSize(test, size) > maxW) { room(size + 4); page.drawText(line, { x, y, size, font, color }); y -= size + 4; line = w }
        else line = test
      }
      if (line) { room(size + 4); page.drawText(line, { x, y, size, font, color }); y -= size + 4 }
    }
  }

  // Encabezado
  if (logo) { const lw = 130, lh = lw * (logo.height / logo.width); page.drawImage(logo, { x: M, y: y - lh + 10, width: lw, height: lh }) }
  Tright('COTIZACIÓN', W - M, 9, bold, ORANGE); y -= 18
  Tright(codigo, W - M, 16, bold, DARK); y -= 16
  Tright(fechaCorta(d.fecha), W - M, 9, font, GRAY)
  y -= 34
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: LINE }); y -= 24

  // Cliente
  T('PREPARADO PARA', M, 8, bold, GRAY); y -= 15
  T(d.cliente, M, 13, bold, DARK); y -= 16
  if (d.obra && d.obra !== 'Sin obra asociada') { T('Obra: ' + d.obra, M, 9, font, GRAY); y -= 14 }
  y -= 8

  // Título + descripción
  T(d.titulo, M, 15, bold, DARK); y -= 20
  if (d.descripcion) wrap(d.descripcion, M, 10, GRAY, W - 2 * M)
  y -= 6

  // Ítems agrupados por tipo
  const grupos: { clave: string; titulo: string; items: ItemPresupuesto[]; sub: number }[] = []
  for (const it of d.items) {
    const c = it.tipo || 'otro'
    let g = grupos.find((x) => x.clave === c)
    if (!g) { g = { clave: c, titulo: GRUPOS[c] ?? c, items: [], sub: 0 }; grupos.push(g) }
    g.items.push(it); g.sub += it.cantidad * it.precio_unitario
  }
  for (const g of grupos) {
    room(46); y -= 4
    T(g.titulo.toUpperCase(), M, 10, bold, ORANGE); y -= 16
    g.items.forEach((it, i) => {
      room(30)
      T(`${String(i + 1).padStart(2, '0')}  ${it.descripcion}`, M, 10, font, DARK)
      Tright(moneda(it.cantidad * it.precio_unitario), W - M, 10, bold, DARK); y -= 13
      T(`${it.cantidad} x ${moneda(it.precio_unitario)}`, M + 22, 8, font, GRAY); y -= 16
    })
    T('Subtotal ' + g.titulo.toLowerCase(), M, 8, font, GRAY)
    Tright(moneda(g.sub), W - M, 8, bold, GRAY); y -= 18
  }

  // Totales
  room(70); y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: LINE }); y -= 20
  T('Subtotal', M, 10, font, DARK); Tright(moneda(d.subtotal), W - M, 10, font, DARK); y -= 16
  if (d.descuento > 0) { T('Bonificación', M, 10, font, ORANGE); Tright('- ' + moneda(d.descuento), W - M, 10, font, ORANGE); y -= 16 }
  y -= 4
  T('TOTAL FINAL', M, 13, bold, DARK); Tright(moneda(d.total), W - M, 13, bold, DARK); y -= 26

  // Condiciones
  room(80)
  T('FORMA DE PAGO', M, 8, bold, GRAY); y -= 13
  wrap(d.notas?.trim() || '70% de seña para confirmar fecha y materiales. 30% restante al finalizar los trabajos.', M, 9, DARK, W - 2 * M); y -= 8
  T('VIGENCIA', M, 8, bold, GRAY); y -= 13
  wrap(`Este presupuesto tiene una validez de ${d.validez_dias ?? 10} días corridos desde su emisión.`, M, 9, DARK, W - 2 * M)

  // Pie
  const fy = M + 6
  page.drawLine({ start: { x: M, y: fy + 20 }, end: { x: W - M, y: fy + 20 }, thickness: 0.5, color: LINE })
  page.drawText(win('www.movaelectronica.com.ar  -  IG @mova.smart  -  +54 9 261 555 7970'), { x: M, y: fy + 6, size: 8, font, color: GRAY })
  page.drawText(win('MOVA Tecnologia Smart - Espacios inteligentes'), { x: M, y: fy - 6, size: 7, font, color: GRAY })

  const bytes = await pdf.save()
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
}

// Genera el PDF y lo comparte por el menú nativo (WhatsApp, mail, etc.).
// Si el equipo no soporta compartir archivos, lo descarga.
export async function compartirPresupuestoPdf(d: DatosPdf): Promise<void> {
  const blob = await generarPdfPresupuesto(d)
  const nombre = `Presupuesto-${String(d.id).padStart(4, '0')}.pdf`
  const file = new File([blob], nombre, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (data?: { files?: File[] }) => boolean }
  if (navigator.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Presupuesto #${String(d.id).padStart(4, '0')}`, text: `${d.titulo} — ${d.cliente}` })
    } catch { /* el usuario canceló */ }
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = nombre; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
