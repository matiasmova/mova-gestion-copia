import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB, type PDFPage } from 'pdf-lib'
import logoUrl from './assets/mova-logo.png'
import { configActual, lineaContacto } from './config'
import { imagenAJpeg } from './pdfPresupuesto'

// Informe de avance de obra con fotos, para entregarle al cliente: título,
// introducción, cada foto con su texto y un cierre (próximos pasos).

export type FotoInforme = { blob: Blob; texto: string }
export type DatosInforme = {
  titulo: string
  obra: string
  cliente: string
  fecha: string // "19/11/2026"
  avance: number | null
  introduccion: string
  fotos: FotoInforme[]
  cierre: string
}

const NARANJA = rgb(0.894, 0.482, 0)
const OSCURO = rgb(0.063, 0.075, 0.094)
const TEXTO = rgb(0.2, 0.23, 0.27)
const GRIS = rgb(0.47, 0.51, 0.56)
const GRIS_CLARO = rgb(0.965, 0.969, 0.976)
const LINEA = rgb(0.9, 0.91, 0.93)
const F_TIT = 18
const F_NORMAL = 10.5
const F_CHICO = 7.5

function win(s: string): string {
  return (s ?? '')
    .replace(/[  ]/g, ' ')
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\xFF\n]/g, '')
}
const limpiar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
export const nombreArchivoInforme = (d: DatosInforme) => `Informe_${limpiar(d.obra) || 'Obra'}_${d.fecha.split('/').reverse().join('-')}.pdf`

export async function generarPdfInforme(d: DatosInforme): Promise<Blob> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(win(d.titulo || `Informe de avance · ${d.obra}`))
  pdf.setAuthor(configActual().empresa.nombre)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  try { logo = await pdf.embedPng(await fetch(logoUrl).then((r) => r.arrayBuffer())) } catch { logo = null }

  const W = 595.28, H = 841.89, M = 44
  const CW = W - 2 * M
  const PIE = M + 34
  let page: PDFPage = pdf.addPage([W, H])
  let y = H - M

  const texto = (t: string, x: number, yy: number, size: number, f: PDFFont = font, color: RGB = TEXTO) => page.drawText(win(t), { x, y: yy, size, font: f, color })
  const derecha = (t: string, right: number, yy: number, size: number, f: PDFFont = font, color: RGB = TEXTO) => { const s = win(t); page.drawText(s, { x: right - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color }) }
  const partir = (t: string, size: number, maxW: number, f: PDFFont = font): string[] => {
    const out: string[] = []
    for (const parrafo of win(t).split('\n')) {
      let r = ''
      for (const p of parrafo.split(/\s+/).filter(Boolean)) {
        const prueba = r ? `${r} ${p}` : p
        if (f.widthOfTextAtSize(prueba, size) > maxW && r) { out.push(r); r = p } else r = prueba
      }
      out.push(r)
    }
    return out
  }
  const nuevaPagina = () => {
    page = pdf.addPage([W, H]); y = H - M
    texto(`${d.titulo || 'Informe de avance'} · ${d.obra}`, M, y, F_CHICO, font, GRIS)
    derecha('continuación', M + CW, y, F_CHICO, font, GRIS)
    y -= 10; page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.6, color: LINEA }); y -= 20
  }
  const lugar = (alto: number) => { if (y - alto < PIE) nuevaPagina() }
  const parrafo = (t: string, size = F_NORMAL, color: RGB = TEXTO, interlineado = 1.45) => {
    for (const r of partir(t, size, CW)) { lugar(size * interlineado); texto(r, M, y, size, font, color); y -= size * interlineado }
  }
  const tituloSeccion = (t: string) => {
    lugar(40)
    page.drawRectangle({ x: M, y: y - 2, width: 3, height: 12, color: NARANJA })
    texto(t.toUpperCase(), M + 10, y, F_NORMAL - 0.5, bold, OSCURO)
    y -= 20
  }

  // ---------- Encabezado ----------
  if (logo) { const lw = 150, lh = lw * (logo.height / logo.width); page.drawImage(logo, { x: M, y: y - lh + 6, width: lw, height: lh }) }
  derecha('INFORME DE AVANCE DE OBRA', M + CW, y, F_CHICO, bold, NARANJA); y -= 16
  derecha(`Fecha: ${d.fecha}`, M + CW, y, F_CHICO + 0.5, font, GRIS); y -= 34
  for (const r of partir(d.titulo || 'Informe de avance', F_TIT, CW, bold)) { texto(r, M, y, F_TIT, bold, OSCURO); y -= F_TIT * 1.25 }
  y -= 4
  const datos = [`Cliente: ${d.cliente || '-'}`, `Obra: ${d.obra}`, ...(d.avance != null ? [`Avance: ${Math.round(d.avance)}%`] : [])]
  texto(datos.join('   ·   '), M, y, F_NORMAL - 0.5, font, GRIS); y -= 12
  page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.8, color: LINEA })
  page.drawRectangle({ x: M, y: y - 0.4, width: 60, height: 1.6, color: NARANJA })
  y -= 24

  if (d.introduccion.trim()) { parrafo(d.introduccion.trim()); y -= 10 }

  // ---------- Fotos ----------
  if (d.fotos.length) {
    tituloSeccion(`Registro fotográfico (${d.fotos.length})`)
    for (let i = 0; i < d.fotos.length; i++) {
      const f = d.fotos[i]
      let img: Awaited<ReturnType<typeof pdf.embedJpg>> | null = null
      try { const j = await imagenAJpeg(f.blob); img = await pdf.embedJpg(j.bytes) } catch { img = null }
      const lineas = partir(`${i + 1}. ${f.texto.trim() || 'Foto de la obra.'}`, F_NORMAL, CW - 20)
      const altoTexto = lineas.length * F_NORMAL * 1.4 + 16
      // Foto: a lo ancho, hasta 215 pt de alto (proporcional): entran dos por hoja.
      let iw = CW, ih = 0
      if (img) { ih = iw * (img.height / img.width); if (ih > 215) { ih = 215; iw = ih * (img.width / img.height) } }
      lugar(ih + altoTexto + 16)
      if (img) {
        page.drawRectangle({ x: M, y: y - ih - 8, width: CW, height: ih + 8, color: GRIS_CLARO })
        page.drawImage(img, { x: M + (CW - iw) / 2, y: y - ih - 4, width: iw, height: ih })
        y -= ih + 19
      }
      // Texto de la foto, con una rayita naranja a la izquierda.
      const arriba = y + F_NORMAL
      let yy = y
      for (const r of lineas) { texto(r, M + 10, yy, F_NORMAL, font, TEXTO); yy -= F_NORMAL * 1.4 }
      const abajo = yy + F_NORMAL * 1.4 - 3
      page.drawRectangle({ x: M, y: abajo, width: 2.5, height: arriba - abajo, color: NARANJA })
      y = yy - 14
    }
  }

  // ---------- Cierre ----------
  if (d.cierre.trim()) { tituloSeccion('Próximos pasos'); parrafo(d.cierre.trim()); y -= 10 }

  // ---------- Pie ----------
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
