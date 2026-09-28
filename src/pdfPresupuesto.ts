import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB, type PDFPage } from 'pdf-lib'
import logoUrl from './assets/mova-logo.png'
import { moneda, fechaCorta } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import { importeNeto, partirDescripcion, pctItem, formatoPct } from './presupuestoCalculos'
import { antesYAhora, cargarResumenModificaciones, etiquetaModificacion } from './presupuestoModificaciones'
import { CONDICIONES_GENERALES } from './condicionesGenerales'

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
}

// Color de marca en hex, usado también fuera del PDF (por ejemplo en
// DocumentoPresupuesto.tsx, la vista previa en pantalla) para que ambos
// coincidan exactamente.
export const COLOR_MARCA_HEX = '#E47B00'

// Paleta
const NARANJA = rgb(0.894, 0.482, 0)
const NARANJA_SUAVE = rgb(1, 0.957, 0.902)
const OSCURO = rgb(0.063, 0.075, 0.094)
const TEXTO = rgb(0.2, 0.23, 0.27)
const GRIS = rgb(0.47, 0.51, 0.56)
const GRIS_CLARO = rgb(0.957, 0.961, 0.969)
const CEBRA = rgb(0.98, 0.98, 0.985)
const LINEA = rgb(0.88, 0.89, 0.91)
const VERDE = rgb(0.137, 0.463, 0.306)
const BLANCO = rgb(1, 1, 1)

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

export async function generarPdfPresupuesto(d: DatosPdf): Promise<Blob> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  try { logo = await pdf.embedPng(await fetch(logoUrl).then((r) => r.arrayBuffer())) } catch { logo = null }

  // Cambios durante la obra y estado de cuenta (solo si el presupuesto está aceptado y hay algo que mostrar).
  let resumen: Awaited<ReturnType<typeof cargarResumenModificaciones>> = null
  try { resumen = await cargarResumenModificaciones(d.id, Number(d.total) || 0) } catch (e) { console.error(e); resumen = null }

  const W = 595.28, H = 841.89, M = 40
  const CW = W - 2 * M // ancho útil
  const PIE = M + 34 // debajo de esto va el pie de página
  const codigo = String(d.id).padStart(4, '0')
  let page: PDFPage = pdf.addPage([W, H])
  let y = H - M

  // ---------- Utilidades de dibujo ----------
  const texto = (t: string, x: number, yy: number, size: number, f: PDFFont = font, color: RGB = TEXTO) =>
    page.drawText(win(t), { x, y: yy, size, font: f, color })
  const derecha = (t: string, right: number, yy: number, size: number, f: PDFFont = font, color: RGB = TEXTO) => {
    const s = win(t); page.drawText(s, { x: right - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color })
  }
  const rect = (x: number, yy: number, w: number, h: number, color: RGB) => page.drawRectangle({ x, y: yy, width: w, height: h, color })
  const linea = (x1: number, yy: number, x2: number, grosor = 0.6, color: RGB = LINEA) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: grosor, color })
  // Parte un texto en renglones que entren en maxW.
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
    rect(M, y - 3, 3, 14, NARANJA)
    texto(t.toUpperCase(), M + 10, y, 10.5, bold, OSCURO)
    y -= 18
  }
  const nuevaPagina = () => {
    page = pdf.addPage([W, H]); y = H - M
    texto(`Presupuesto N° ${codigo} · ${d.cliente}`, M, y, 8, font, GRIS)
    derecha('continuación', M + CW, y, 8, font, GRIS)
    y -= 10; linea(M, y, M + CW); y -= 20
  }
  const lugar = (alto: number) => { if (y - alto < PIE) { nuevaPagina(); return true } return false }

  // ---------- Encabezado ----------
  if (logo) {
    const lw = 150, lh = lw * (logo.height / logo.width)
    page.drawImage(logo, { x: M, y: y - lh + 6, width: lw, height: lh })
  }
  derecha('PRESUPUESTO', M + CW, y, 10, bold, NARANJA); y -= 24
  derecha(`N° ${codigo}`, M + CW, y, 22, bold, OSCURO); y -= 18
  derecha(`Fecha: ${fechaCorta(d.fecha)}`, M + CW, y, 9, font, GRIS); y -= 12
  if (d.validez_dias) { derecha(`Validez: ${d.validez_dias} ${d.validez_dias === 1 ? 'día' : 'días'}`, M + CW, y, 9, font, GRIS); y -= 12 }
  y -= 10
  rect(M, y, CW, 2.5, NARANJA); y -= 22

  // ---------- Cliente y obra ----------
  const cajaW = (CW - 12) / 2
  const hayObra = !!d.obra && d.obra !== 'Sin obra asociada'
  rect(M, y - 34, cajaW, 48, GRIS_CLARO)
  rect(M + cajaW + 12, y - 34, cajaW, 48, GRIS_CLARO)
  texto('CLIENTE', M + 12, y, 7.5, bold, GRIS)
  texto('OBRA', M + cajaW + 24, y, 7.5, bold, GRIS)
  y -= 17
  texto(partir(d.cliente, 12, cajaW - 24, bold)[0] ?? '', M + 12, y, 12, bold, OSCURO)
  texto(partir(hayObra ? d.obra : '—', 12, cajaW - 24, bold)[0] ?? '', M + cajaW + 24, y, 12, bold, OSCURO)
  y -= 42

  // ---------- Título y descripción ----------
  for (const r of partir(d.titulo, 16, CW, bold)) { texto(r, M, y, 16, bold, OSCURO); y -= 20 }
  if (d.descripcion) for (const r of partir(d.descripcion, 9.5, CW)) { lugar(13); texto(r, M, y, 9.5, font, GRIS); y -= 13 }
  y -= 10

  // ---------- Tabla de ítems ----------
  const hayDescuento = d.items.some((it) => pctItem(it) > 0)
  const xImp = M + CW - 10
  const xDesc = xImp - 92
  const xPU = hayDescuento ? xDesc - 46 : xImp - 92
  const xCant = xPU - 86
  const xDescr = M + 30
  const anchoDescr = xCant - 38 - xDescr

  const encabezadoTabla = () => {
    rect(M, y - 7, CW, 22, OSCURO)
    texto('#', M + 10, y, 7.5, bold, BLANCO)
    texto('DESCRIPCIÓN', xDescr, y, 7.5, bold, BLANCO)
    derecha('CANT.', xCant, y, 7.5, bold, BLANCO)
    derecha('P. UNITARIO', xPU, y, 7.5, bold, BLANCO)
    if (hayDescuento) derecha('DESC.', xDesc, y, 7.5, bold, BLANCO)
    derecha('IMPORTE', xImp, y, 7.5, bold, BLANCO)
    y -= 22
  }

  const grupos = agruparPorTipo(d.items)

  lugar(60)
  encabezadoTabla()
  let numero = 0
  let fila = 0
  let sumaNeta = 0
  for (const g of grupos) {
    if (lugar(40)) encabezadoTabla()
    rect(M, y - 6, CW, 18, NARANJA_SUAVE)
    texto(g.titulo.toUpperCase(), M + 10, y, 7.5, bold, NARANJA)
    y -= 18
    for (const it of g.items) {
      numero++
      const { titulo: tit, detalle } = partirDescripcion(it.descripcion)
      const renglonesTit = partir(tit, 9.5, anchoDescr, bold)
      const renglonesDet = detalle ? partir(detalle, 8, anchoDescr) : []
      const alto = renglonesTit.length * 12 + renglonesDet.length * 10.5 + 10
      if (lugar(alto)) encabezadoTabla()
      if (fila % 2 === 1) rect(M, y - alto + 12, CW, alto, CEBRA)
      fila++
      const neto = importeNeto(it)
      sumaNeta += neto
      texto(String(numero).padStart(2, '0'), M + 10, y, 8.5, font, GRIS)
      derecha(`${Number(it.cantidad)}`, xCant, y, 9.5, font, TEXTO)
      derecha(moneda(it.precio_unitario), xPU, y, 9.5, font, TEXTO)
      if (hayDescuento) derecha(pctItem(it) > 0 ? `${formatoPct(pctItem(it))}%` : '—', xDesc, y, 9.5, font, pctItem(it) > 0 ? NARANJA : GRIS)
      derecha(moneda(neto), xImp, y, 9.5, bold, OSCURO)
      let yy = y
      for (const r of renglonesTit) { texto(r, xDescr, yy, 9.5, bold, OSCURO); yy -= 12 }
      for (const r of renglonesDet) { texto(r, xDescr, yy + 1, 8, font, GRIS); yy -= 10.5 }
      y -= alto
      linea(M, y + 11, M + CW, 0.4)
    }
  }
  y -= 6

  // ---------- Totales ----------
  const bonificacion = Math.round((sumaNeta - d.total) * 100) / 100
  const totW = 250, totX = M + CW - totW
  lugar(90)
  texto('Subtotal', totX + 12, y, 9.5, font, TEXTO); derecha(moneda(sumaNeta), xImp, y, 9.5, font, TEXTO); y -= 16
  if (bonificacion > 0.5) {
    texto('Bonificación', totX + 12, y, 9.5, font, NARANJA); derecha(`- ${moneda(bonificacion)}`, xImp, y, 9.5, font, NARANJA); y -= 16
  }
  y -= 4
  rect(totX, y - 10, totW, 28, OSCURO)
  texto('TOTAL', totX + 12, y, 11, bold, BLANCO)
  derecha(moneda(d.total), xImp, y - 1, 14, bold, BLANCO)
  y -= 40

  // ---------- Modificaciones durante la obra ----------
  if (resumen) {
    const hayCambios = resumen.modificaciones.length > 0
    if (hayCambios) {
      lugar(90)
      titulo('Modificaciones durante la obra')
      for (const r of partir('El presupuesto de arriba se mantiene tal como fue aceptado. Estos son los cambios registrados después:', 8.5, CW)) { texto(r, M, y, 8.5, font, GRIS); y -= 11 }
      y -= 6

      const xFecha = M + 10
      const xConc = M + 78
      const anchoConc = xImp - 100 - xConc
      const encabezadoMods = () => {
        rect(M, y - 7, CW, 22, OSCURO)
        texto('FECHA', xFecha, y, 7.5, bold, BLANCO)
        texto('CONCEPTO', xConc, y, 7.5, bold, BLANCO)
        derecha('IMPORTE', xImp, y, 7.5, bold, BLANCO)
        y -= 22
      }
      encabezadoMods()
      resumen.modificaciones.forEach((m, i) => {
        const { antes, ahora } = antesYAhora(m, moneda)
        const renglones: { t: string; size: number; f: PDFFont; color: RGB }[] = [
          { t: etiquetaModificacion(m).toUpperCase(), size: 7, f: bold, color: GRIS },
          ...partir(m.descripcion, 9.5, anchoConc, bold).map((t) => ({ t, size: 9.5, f: bold, color: OSCURO })),
          ...(antes ? partir(`Antes: ${antes}`, 8, anchoConc).map((t) => ({ t, size: 8, f: font, color: GRIS })) : []),
          ...(ahora ? partir(`Ahora: ${ahora}`, 8, anchoConc).map((t) => ({ t, size: 8, f: font, color: TEXTO })) : []),
          ...(m.motivo ? partir(`Motivo: ${m.motivo}`, 8, anchoConc).map((t) => ({ t, size: 8, f: font, color: GRIS })) : []),
        ]
        const alto = renglones.reduce((s, r) => s + r.size + 3, 0) + 10
        if (lugar(alto)) encabezadoMods()
        if (i % 2 === 1) rect(M, y - alto + 12, CW, alto, CEBRA)
        texto(fechaCorta(m.fecha), xFecha, y, 8.5, font, TEXTO)
        const colorImp = m.importe < 0 ? VERDE : m.importe > 0 ? NARANJA : TEXTO
        derecha(m.importe === 0 ? moneda(0) : conSigno(m.importe), xImp, y, 9.5, bold, colorImp)
        let yy = y
        for (const r of renglones) { texto(r.t, xConc, yy, r.size, r.f, r.color); yy -= r.size + 3 }
        y -= alto
        linea(M, y + 11, M + CW, 0.4)
      })
      y -= 6

      lugar(80)
      texto('Total original aceptado', totX + 12, y, 9.5, font, TEXTO); derecha(moneda(resumen.totalOriginal), xImp, y, 9.5, font, TEXTO); y -= 16
      texto('Modificaciones', totX + 12, y, 9.5, font, TEXTO); derecha(conSigno(resumen.totalCambios), xImp, y, 9.5, font, resumen.totalCambios < 0 ? VERDE : NARANJA); y -= 20
      rect(totX, y - 10, totW, 28, OSCURO)
      texto('NUEVO TOTAL', totX + 12, y, 11, bold, BLANCO)
      derecha(moneda(resumen.nuevoTotal), xImp, y - 1, 14, bold, BLANCO)
      y -= 40
    }

    // ---------- Estado de cuenta ----------
    lugar(84)
    titulo('Estado de cuenta')
    const tarjetaW = (CW - 20) / 3
    const tarjetaH = 54
    const tarjetas: { etiqueta: string; valor: string; fondo: RGB; colorTexto: RGB; colorEtiqueta: RGB }[] = [
      { etiqueta: hayCambios ? 'NUEVO TOTAL' : 'TOTAL', valor: moneda(resumen.nuevoTotal), fondo: GRIS_CLARO, colorTexto: OSCURO, colorEtiqueta: GRIS },
      { etiqueta: 'COBRADO HASTA HOY', valor: moneda(resumen.cobrado), fondo: GRIS_CLARO, colorTexto: VERDE, colorEtiqueta: GRIS },
      {
        etiqueta: resumen.saldo >= 0 ? 'SALDO PENDIENTE' : 'SALDO A FAVOR',
        valor: moneda(Math.abs(resumen.saldo)),
        fondo: resumen.saldo > 0 ? NARANJA : VERDE, colorTexto: BLANCO, colorEtiqueta: BLANCO,
      },
    ]
    tarjetas.forEach((t, i) => {
      const x = M + i * (tarjetaW + 10)
      rect(x, y - tarjetaH + 12, tarjetaW, tarjetaH, t.fondo)
      texto(t.etiqueta, x + 12, y - 4, 7.5, bold, t.colorEtiqueta)
      texto(t.valor, x + 12, y - 26, 14, bold, t.colorTexto)
    })
    y -= tarjetaH + 4
    texto(`Actualizado al ${fechaCorta(new Date().toISOString().slice(0, 10))}`, M, y, 7.5, font, GRIS)
    y -= 24
  }

  // ---------- Notas, vigencia y condiciones generales ----------
  const notas = d.notas?.trim() ?? ''
  const vigencia = `Este presupuesto tiene una validez de ${d.validez_dias ?? 10} días corridos desde su emisión.`
  const cajas = [...(notas ? [{ t: 'NOTAS', texto: notas }] : []), { t: 'VIGENCIA', texto: vigencia }]
  const colW = cajas.length === 2 ? (CW - 12) / 2 : CW
  const renglonesCajas = cajas.map((c) => partir(c.texto, 8.5, colW - 24))
  const altoCajas = Math.max(...renglonesCajas.map((r) => r.length)) * 11.5 + 34
  lugar(altoCajas + 10)
  cajas.forEach((c, i) => {
    const x = M + i * (colW + 12)
    rect(x, y - altoCajas + 12, colW, altoCajas, GRIS_CLARO)
    texto(c.t, x + 12, y - 4, 7.5, bold, NARANJA)
    let yc = y - 20
    for (const r of renglonesCajas[i]) { texto(r, x + 12, yc, 8.5, font, TEXTO); yc -= 11.5 }
  })
  y -= altoCajas + 16

  if (CONDICIONES_GENERALES.length) {
    lugar(60)
    titulo('Condiciones generales')
    for (const cond of CONDICIONES_GENERALES) {
      const renglones = partir(cond.texto, 8, CW)
      lugar(14 + renglones.length * 10.5)
      texto(cond.titulo, M, y, 8.5, bold, OSCURO); y -= 12
      for (const r of renglones) { texto(r, M, y, 8, font, GRIS); y -= 10.5 }
      y -= 6
    }
  }

  // ---------- Pie en todas las páginas ----------
  const paginas = pdf.getPages()
  paginas.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 22 }, end: { x: W - M, y: M + 22 }, thickness: 0.6, color: LINEA })
    p.drawRectangle({ x: M, y: M + 21.5, width: 40, height: 1.5, color: NARANJA })
    p.drawText(win('MOVA Tecnología Smart · Espacios inteligentes'), { x: M, y: M + 9, size: 7.5, font: bold, color: OSCURO })
    p.drawText(win('www.movaelectronica.com.ar · IG @mova.smart · +54 9 261 555 7970'), { x: M, y: M - 1, size: 7, font, color: GRIS })
    const pag = win(`Página ${i + 1} de ${paginas.length}`)
    p.drawText(pag, { x: W - M - font.widthOfTextAtSize(pag, 7.5), y: M + 9, size: 7.5, font, color: GRIS })
  })

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
