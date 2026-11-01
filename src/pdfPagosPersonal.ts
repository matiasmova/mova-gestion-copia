import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB, type PDFPage } from 'pdf-lib'
import logoUrl from './assets/mova-logo.png'
import { moneda, fechaCorta, hoy } from './gestionFormat'
import { configActual, lineaContacto } from './config'

// Resumen en PDF de los pagos al personal de un mes: total del mes, total por
// obra, total por empleado y el detalle de cada pago agrupado por obra.
// Puede ser de todo el equipo o de una sola persona (para mandárselo).

export type PagoResumen = { fecha: string; obraId: number | null; obra: string; persona: string; detalle: string; monto: number }
export type DatosResumenPagos = {
  mes: string            // "2026-10"
  mesNombre: string      // "Octubre de 2026"
  persona?: { nombre: string; subtitulo?: string } | null
  pagos: PagoResumen[]
}

const NARANJA = rgb(0.894, 0.482, 0)
const NARANJA_SUAVE = rgb(1, 0.965, 0.925)
const OSCURO = rgb(0.063, 0.075, 0.094)
const TEXTO = rgb(0.2, 0.23, 0.27)
const GRIS = rgb(0.47, 0.51, 0.56)
const GRIS_CLARO = rgb(0.965, 0.969, 0.976)
const LINEA = rgb(0.9, 0.91, 0.93)
const BLANCO = rgb(1, 1, 1)
const F_GRANDE = 17
const F_NORMAL = 9.5
const F_CHICO = 7.5

function win(s: string): string {
  return (s ?? '')
    .replace(/[  ]/g, ' ')
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\xFF\n]/g, '')
}
const limpiar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

export const nombreArchivoPagos = (d: DatosResumenPagos) => `Pagos_personal_${d.mes}${d.persona ? `_${limpiar(d.persona.nombre)}` : ''}.pdf`

// Agrupa por obra y por persona (lo usa el PDF).
export function agruparPagos(pagos: PagoResumen[]) {
  const porObra = new Map<string, { obra: string; total: number; pagos: PagoResumen[] }>()
  const porPersona = new Map<string, { persona: string; total: number; cantidad: number; obras: Map<string, number> }>()
  for (const p of pagos) {
    const k = String(p.obraId)
    const o = porObra.get(k) ?? { obra: p.obra, total: 0, pagos: [] }
    o.total += p.monto; o.pagos.push(p); porObra.set(k, o)
    const e = porPersona.get(p.persona) ?? { persona: p.persona, total: 0, cantidad: 0, obras: new Map() }
    e.total += p.monto; e.cantidad++; e.obras.set(p.obra, (e.obras.get(p.obra) ?? 0) + p.monto); porPersona.set(p.persona, e)
  }
  const obras = Array.from(porObra.values()).sort((a, b) => b.total - a.total)
  obras.forEach((o) => o.pagos.sort((a, b) => a.fecha.localeCompare(b.fecha)))
  return { obras, personas: Array.from(porPersona.values()).sort((a, b) => b.total - a.total) }
}

export async function generarPdfPagos(d: DatosResumenPagos): Promise<Blob> {
  const pdf = await PDFDocument.create()
  const tituloDoc = `Pagos al personal · ${d.mesNombre}${d.persona ? ` · ${d.persona.nombre}` : ''}`
  pdf.setTitle(win(tituloDoc))
  pdf.setAuthor(configActual().empresa.nombre)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  try { logo = await pdf.embedPng(await fetch(logoUrl).then((r) => r.arrayBuffer())) } catch { logo = null }

  const W = 595.28, H = 841.89, M = 40
  const CW = W - 2 * M
  const PIE = M + 34
  let page: PDFPage = pdf.addPage([W, H])
  let y = H - M

  const texto = (t: string, x: number, yy: number, size: number, f: PDFFont = font, color: RGB = TEXTO) =>
    page.drawText(win(t), { x, y: yy, size, font: f, color })
  const derecha = (t: string, right: number, yy: number, size: number, f: PDFFont = font, color: RGB = TEXTO) => {
    const s = win(t); page.drawText(s, { x: right - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color })
  }
  const rect = (x: number, yy: number, w: number, h: number, color: RGB) => page.drawRectangle({ x, y: yy, width: w, height: h, color })
  const linea = (x1: number, yy: number, x2: number, grosor = 0.6, color: RGB = LINEA) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: grosor, color })
  const cortar = (t: string, size: number, maxW: number, f: PDFFont = font) => {
    let s = win(t)
    if (f.widthOfTextAtSize(s, size) <= maxW) return s
    while (s.length > 1 && f.widthOfTextAtSize(`${s}...`, size) > maxW) s = s.slice(0, -1)
    return `${s}...`
  }
  const partir = (t: string, size: number, maxW: number, f: PDFFont = font, max = 2): string[] => {
    const salida: string[] = []
    let r = ''
    for (const palabra of win(t).split(/\s+/).filter(Boolean)) {
      const prueba = r ? `${r} ${palabra}` : palabra
      if (f.widthOfTextAtSize(prueba, size) > maxW && r) { salida.push(r); r = palabra } else r = prueba
    }
    if (r) salida.push(r)
    if (salida.length > max) { const resto = salida.slice(max - 1).join(' '); return [...salida.slice(0, max - 1), cortar(resto, size, maxW, f)] }
    return salida
  }
  const nuevaPagina = () => {
    page = pdf.addPage([W, H]); y = H - M
    texto(tituloDoc, M, y, F_CHICO, font, GRIS)
    derecha('continuación', M + CW, y, F_CHICO, font, GRIS)
    y -= 10; linea(M, y, M + CW); y -= 20
  }
  const lugar = (alto: number) => { if (y - alto < PIE) { nuevaPagina(); return true } return false }
  const titulo = (t: string) => {
    lugar(50)
    rect(M, y - 2, 3, 12, NARANJA)
    texto(t.toUpperCase(), M + 10, y, F_NORMAL, bold, OSCURO)
    y -= 18
  }
  const encabezadoFila = (celdas: { t: string; x: number; der?: boolean }[]) => {
    rect(M, y - 6, CW, 20, GRIS_CLARO)
    linea(M, y - 6, M + CW, 0.8, NARANJA)
    for (const c of celdas) (c.der ? derecha : texto)(c.t, c.x, y, F_CHICO, bold, GRIS)
    y -= 22
  }

  const { obras, personas } = agruparPagos(d.pagos)
  const total = d.pagos.reduce((s, p) => s + p.monto, 0)

  // ---------- Encabezado ----------
  if (logo) {
    const lw = 150, lh = lw * (logo.height / logo.width)
    page.drawImage(logo, { x: M, y: y - lh + 6, width: lw, height: lh })
  }
  derecha('RESUMEN DE PAGOS AL PERSONAL', M + CW, y, F_CHICO, bold, NARANJA); y -= 20
  derecha(d.mesNombre, M + CW, y, F_GRANDE, bold, OSCURO); y -= 15
  derecha(cortar(d.persona ? d.persona.nombre + (d.persona.subtitulo ? ` · ${d.persona.subtitulo}` : '') : 'Todo el equipo', F_NORMAL, CW / 2), M + CW, y, F_NORMAL, font, TEXTO); y -= 12
  derecha(`Emitido: ${fechaCorta(hoy())}`, M + CW, y, F_CHICO, font, GRIS); y -= 12
  linea(M, y, M + CW, 0.8, LINEA)
  rect(M, y - 0.4, 60, 1.6, NARANJA)
  y -= 24

  // ---------- Cifras ----------
  const cajas = [
    { etq: d.persona ? 'TOTAL COBRADO EN EL MES' : 'TOTAL PAGADO EN EL MES', v: moneda(total), destacada: true },
    { etq: 'PAGOS', v: String(d.pagos.length), s: d.persona ? '' : `${personas.length} persona(s)` },
    { etq: 'OBRAS', v: String(obras.filter((o) => o.pagos[0]?.obraId != null).length), s: obras.some((o) => o.pagos[0]?.obraId == null) ? 'más gastos como empresa' : '' },
  ]
  const cajaW = (CW - 24) / 3
  cajas.forEach((k, i) => {
    const x = M + i * (cajaW + 12)
    rect(x, y - 34, cajaW, 48, k.destacada ? NARANJA : GRIS_CLARO)
    texto(k.etq, x + 12, y, F_CHICO, bold, k.destacada ? BLANCO : GRIS)
    let size = F_GRANDE - 2
    while (size > 9 && bold.widthOfTextAtSize(win(k.v), size) > cajaW - 24) size -= 0.5
    texto(k.v, x + 12, y - 19, size, bold, k.destacada ? BLANCO : OSCURO)
    if (k.s) texto(k.s, x + 12, y - 30, F_CHICO, font, GRIS)
  })
  y -= 58

  if (!d.pagos.length) {
    texto('No hay pagos registrados en este mes.', M, y, F_NORMAL, font, GRIS); y -= 20
  } else {
    // ---------- Total por obra ----------
    titulo('Total por obra')
    const xPag = M + CW - 150, xPct = M + CW - 100, xTot = M + CW - 8
    encabezadoFila([{ t: 'OBRA', x: M + 8 }, { t: 'PAGOS', x: xPag, der: true }, { t: '%', x: xPct, der: true }, { t: 'TOTAL', x: xTot, der: true }])
    for (const o of obras) {
      const renglones = partir(o.obra, F_NORMAL, xPag - M - 50, bold)
      lugar(renglones.length * 12 + 14)
      renglones.forEach((r, i) => texto(r, M + 8, y - i * 11.5, F_NORMAL, i ? font : bold, i ? TEXTO : OSCURO))
      derecha(String(o.pagos.length), xPag, y, F_NORMAL, font, TEXTO)
      derecha(`${total > 0 ? Math.round((o.total / total) * 100) : 0}%`, xPct, y, F_NORMAL, font, GRIS)
      derecha(moneda(o.total), xTot, y, F_NORMAL, bold, OSCURO)
      const yb = y - (renglones.length - 1) * 11.5 - 7
      rect(M + 8, yb, xPag - M - 50, 2.4, LINEA)
      rect(M + 8, yb, Math.max(2, (xPag - M - 50) * (total > 0 ? o.total / total : 0)), 2.4, NARANJA)
      y = yb - 8; linea(M, y, M + CW); y -= 12
    }
    lugar(26)
    rect(M, y - 8, CW, 22, NARANJA_SUAVE)
    texto('TOTAL DEL MES', M + 8, y, F_CHICO + 0.5, bold, NARANJA)
    derecha(moneda(total), xTot, y - 1, F_NORMAL + 1.5, bold, OSCURO)
    y -= 36

    // ---------- Total por empleado ----------
    if (!d.persona) {
      titulo('Total por empleado')
      encabezadoFila([{ t: 'EMPLEADO', x: M + 8 }, { t: 'PAGOS', x: xPag, der: true }, { t: 'TOTAL', x: xTot, der: true }])
      for (const e of personas) {
        const detalle = Array.from(e.obras.entries()).sort((a, b) => b[1] - a[1]).map(([o, m]) => `${o}: ${moneda(m)}`).join('  ·  ')
        const sub = partir(detalle, F_CHICO, xPag - M - 50, font, 3)
        lugar(16 + sub.length * 9.5)
        texto(cortar(e.persona, F_NORMAL, xPag - M - 50, bold), M + 8, y, F_NORMAL, bold, OSCURO)
        derecha(String(e.cantidad), xPag, y, F_NORMAL, font, TEXTO)
        derecha(moneda(e.total), xTot, y, F_NORMAL, bold, OSCURO)
        sub.forEach((r, i) => texto(r, M + 8, y - 11 - i * 9.5, F_CHICO, font, GRIS))
        y -= 11 + sub.length * 9.5
        linea(M, y, M + CW); y -= 12
      }
      y -= 10
    }

    // ---------- Detalle por obra ----------
    titulo(`Detalle de pagos (${d.pagos.length})`)
    const xFecha = M + 8, xPers = M + 70, xDet = M + 200
    for (const o of obras) {
      const cab = partir(o.obra, F_NORMAL, CW - 130, bold)
      lugar(cab.length * 12 + 40)
      const alto = 10 + cab.length * 12
      rect(M, y - alto + 12, CW, alto, GRIS_CLARO)
      rect(M, y - alto + 12, 2.5, alto, NARANJA)
      cab.forEach((r, i) => texto(r, M + 10, y - i * 12, F_NORMAL, bold, OSCURO))
      derecha(`Subtotal ${moneda(o.total)}`, xTot, y, F_NORMAL, bold, OSCURO)
      y -= alto + 6
      for (const p of o.pagos) {
        lugar(16)
        texto(fechaCorta(p.fecha.slice(0, 10)), xFecha, y, F_NORMAL, font, TEXTO)
        texto(cortar(d.persona ? (p.detalle || 'Pago') : p.persona, F_NORMAL, (d.persona ? xTot - 90 : xDet - 8) - xPers, d.persona ? font : bold), xPers, y, F_NORMAL, d.persona ? font : bold, d.persona ? TEXTO : OSCURO)
        if (!d.persona) texto(cortar(p.detalle || '-', F_CHICO + 0.5, xTot - 90 - xDet), xDet, y, F_CHICO + 0.5, font, GRIS)
        derecha(moneda(p.monto), xTot, y, F_NORMAL, bold, OSCURO)
        y -= 8; linea(M, y, M + CW); y -= 10
      }
      y -= 8
    }
  }

  // ---------- Conformidad (resumen de una persona) ----------
  if (d.persona && d.pagos.length) {
    lugar(60)
    y -= 26
    const firmaW = (CW - 24) / 3
    ;['Recibí conforme · Firma', 'Aclaración y DNI', 'Fecha'].forEach((etq, i) => {
      const x = M + i * (firmaW + 12)
      linea(x, y, x + firmaW, 0.7, GRIS)
      texto(etq, x, y - 11, F_CHICO, font, GRIS)
    })
    y -= 24
  }

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

export async function armarPdfPagos(d: DatosResumenPagos): Promise<{ blob: Blob; nombre: string }> {
  return { blob: await generarPdfPagos(d), nombre: nombreArchivoPagos(d) }
}
