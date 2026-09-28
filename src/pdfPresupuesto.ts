import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB, type PDFPage } from 'pdf-lib'
import logoUrl from './assets/mova-logo.png'
import { moneda, fechaCorta } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import { importeNeto, partirDescripcion, pctItem, formatoPct } from './presupuestoCalculos'
import { antesYAhora, cargarResumenModificaciones, etiquetaModificacion } from './presupuestoModificaciones'
import { cargarSolucionesPresupuesto, type SolucionPresupuesto } from './presupuestoSoluciones'
import { CONDICIONES_GENERALES } from './condicionesGenerales'
import { fechaDocumento, otrosOriginales, seccionesSeguimiento, type SeccionSeguimiento } from './seccionesSeguimiento'
import type { ResumenModificaciones } from './presupuestoModificaciones'

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
  // Opcional: si no se pasan, se leen del presupuesto guardado.
  soluciones?: SolucionPresupuesto[]
  resumen?: ResumenModificaciones | null
}

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

export async function generarPdfPresupuesto(d: DatosPdf): Promise<Blob> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  try { logo = await pdf.embedPng(await fetch(logoUrl).then((r) => r.arrayBuffer())) } catch { logo = null }

  const resumen = d.resumen !== undefined ? d.resumen : await cargarResumenModificaciones(d.id, Number(d.total) || 0)
  let soluciones: SolucionPresupuesto[] = d.soluciones ?? []
  if (!d.soluciones) { try { soluciones = await cargarSolucionesPresupuesto(d.id) } catch (e) { console.error(e) } }

  const W = 595.28, H = 841.89, M = 40
  const CW = W - 2 * M
  const PIE = M + 34
  const codigo = String(d.id).padStart(4, '0')
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
    texto(`Presupuesto N° ${codigo} · ${d.cliente}`, M, y, F_CHICO, font, GRIS)
    derecha('continuación', M + CW, y, F_CHICO, font, GRIS)
    y -= 10; linea(M, y, M + CW); y -= 20
  }
  const lugar = (alto: number) => { if (y - alto < PIE) { nuevaPagina(); return true } return false }
  // Caja de total: fondo suave, acento naranja a la izquierda, etiqueta chica y monto grande.
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

  // ---------- Encabezado ----------
  if (logo) {
    const lw = 150, lh = lw * (logo.height / logo.width)
    page.drawImage(logo, { x: M, y: y - lh + 6, width: lw, height: lh })
  }
  derecha(resumen ? 'PRESUPUESTO Y ESTADO DE OBRA' : 'PRESUPUESTO', M + CW, y, F_CHICO, bold, NARANJA); y -= 20
  derecha(`N° ${codigo}`, M + CW, y, F_GRANDE, bold, OSCURO); y -= 15
  derecha(`Fecha: ${fechaCorta(d.fecha)}`, M + CW, y, F_CHICO, font, GRIS); y -= 11
  if (d.validez_dias) { derecha(`Validez: ${d.validez_dias} ${d.validez_dias === 1 ? 'día' : 'días'}`, M + CW, y, F_CHICO, font, GRIS); y -= 11 }
  if (resumen) { derecha(fechaDocumento(resumen), M + CW, y, F_CHICO, font, GRIS); y -= 12 }
  y -= 8
  linea(M, y, M + CW, 0.8, LINEA)
  rect(M, y - 0.4, 60, 1.6, NARANJA)
  y -= 22

  // ---------- Cliente y obra ----------
  const cajaW = (CW - 12) / 2
  const hayObra = !!d.obra && d.obra !== 'Sin obra asociada'
  rect(M, y - 26, cajaW, 40, GRIS_CLARO)
  rect(M + cajaW + 12, y - 26, cajaW, 40, GRIS_CLARO)
  texto('CLIENTE', M + 12, y, F_CHICO, bold, GRIS)
  texto('OBRA', M + cajaW + 24, y, F_CHICO, bold, GRIS)
  y -= 15
  texto(partir(d.cliente, F_NORMAL, cajaW - 24, bold)[0] ?? '', M + 12, y, F_NORMAL, bold, OSCURO)
  texto(partir(hayObra ? d.obra : '—', F_NORMAL, cajaW - 24, bold)[0] ?? '', M + cajaW + 24, y, F_NORMAL, bold, OSCURO)
  y -= 36

  // ---------- Título y descripción ----------
  for (const r of partir(d.titulo, F_GRANDE, CW, bold)) { texto(r, M, y, F_GRANDE, bold, OSCURO); y -= 21 }
  if (d.descripcion) for (const r of partir(d.descripcion, F_NORMAL, CW)) { lugar(13); texto(r, M, y, F_NORMAL, font, GRIS); y -= 13 }
  y -= 12

  if (resumen) {
    lugar(45)
    texto(`Avance registrado: ${resumen.porcentaje}% · Pendiente de pago hoy: ${moneda(resumen.cuenta.pendienteHoy)}`, M, y, F_NORMAL, bold, OSCURO)
    y -= 18
    if (resumen.cuenta.anticipoPendiente > 0 && !['finalizada', 'observacion'].includes(resumen.estado) && resumen.porcentaje < 100) {
      const aviso = partir(`ANTICIPO PENDIENTE: la obra está en ejecución y el anticipo del 70% no figura cubierto. Falta registrar ${moneda(resumen.cuenta.anticipoPendiente)}. Solicitamos regularizarlo a la brevedad.`, F_NORMAL, CW - 24)
      const alto = aviso.length * 13 + 16
      lugar(alto + 12)
      rect(M, y - alto + 10, CW, alto, NARANJA_SUAVE)
      let yy = y - 3
      for (const r of aviso) { texto(r, M + 12, yy, F_NORMAL, font, TEXTO); yy -= 13 }
      y -= alto + 12
    }
  }

  // ---------- Qué vas a disfrutar (soluciones elegidas) ----------
  if (soluciones.length) {
    lugar(70)
    titulo('Qué vas a disfrutar con este proyecto')
    for (const sol of soluciones) {
      lugar(40)
      for (const r of partir(sol.titulo, F_NORMAL, CW - 20, bold)) { lugar(14); texto(r, M + 10, y, F_NORMAL, bold, OSCURO); y -= 14 }
      for (const r of partir(sol.descripcion, F_NORMAL, CW - 20)) { lugar(13); texto(r, M + 10, y, F_NORMAL, font, GRIS); y -= 13 }
      y -= 10
    }
    y -= 10
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
  titulo('Detalle del presupuesto')
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
  cajaTotal(totX, totW, 'TOTAL', moneda(d.total))
  y -= 14

  const seccionTexto = (seccion: SeccionSeguimiento) => {
    lugar(55); titulo(seccion.titulo)
    for (const parrafo of seccion.lineas) {
      for (const renglon of partir(parrafo, F_NORMAL, CW - 20)) {
        lugar(14); texto(renglon, M + 10, y, F_NORMAL, font, TEXTO); y -= 14
      }
      y -= 6
    }
    y -= 8
  }
  if (resumen) for (const seccion of otrosOriginales(resumen)) seccionTexto(seccion)

  // ---------- Modificaciones durante la obra ----------
  if (resumen) {
    const hayCambios = resumen.modificaciones.length > 0 || resumen.otrosPresupuestos.length > 0
    if (hayCambios) {
      lugar(90)
      titulo('Modificaciones durante la obra')
      for (const r of partir('El presupuesto de arriba se mantiene tal como fue aceptado. Estos son los cambios registrados después:', F_CHICO, CW)) { texto(r, M, y, F_CHICO, font, GRIS); y -= 10 }
      y -= 8
      const xFecha = M + 10
      const xConc = M + 78
      const anchoConc = xImp - 100 - xConc
      const encabezadoMods = () => encabezadoFila([{ t: 'FECHA', x: xFecha }, { t: 'CONCEPTO', x: xConc }, { t: 'IMPORTE', x: xImp, der: true }])
      encabezadoMods()
      for (const m of resumen.modificaciones) {
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
        derecha(m.importe === 0 ? moneda(0) : conSigno(m.importe), xImp, y, F_NORMAL, bold, m.importe < 0 ? VERDE : m.importe > 0 ? NARANJA : TEXTO)
        let yy = y
        for (const r of renglones) { texto(r.t, xConc, yy, r.size, r.f, r.color); yy -= r.size + 3 }
        y -= alto
        linea(M, y + 11, M + CW, 0.5)
      }
      y -= 8
      lugar(80)
      texto('Total original aceptado', totX + 12, y, F_NORMAL, font, GRIS); derecha(moneda(resumen.totalOriginal), xImp, y, F_NORMAL, font, TEXTO); y -= 15
      texto('Modificaciones', totX + 12, y, F_NORMAL, font, GRIS); derecha(conSigno(resumen.totalCambios), xImp, y, F_NORMAL, font, resumen.totalCambios < 0 ? VERDE : NARANJA); y -= 23
      cajaTotal(totX, totW, 'NUEVO TOTAL', moneda(resumen.nuevoTotal))
      y -= 14
    }

    // ---------- Estado de cuenta ----------
    lugar(84)
    titulo('Estado de cuenta')
    const tW = (CW - 20) / 3
    const tH = 46
    const saldoPendiente = resumen.saldo > 0
    const tarjetas = [
      { e: hayCambios ? 'NUEVO TOTAL' : 'TOTAL', v: moneda(resumen.nuevoTotal), fondo: GRIS_CLARO, acento: LINEA, color: OSCURO },
      { e: 'PAGOS REGISTRADOS', v: moneda(resumen.cobrado), fondo: GRIS_CLARO, acento: LINEA, color: VERDE },
      { e: resumen.saldo >= 0 ? 'SALDO TOTAL' : 'SALDO A FAVOR', v: moneda(Math.abs(resumen.saldo)), fondo: saldoPendiente ? NARANJA_SUAVE : VERDE_SUAVE, acento: saldoPendiente ? NARANJA : VERDE, color: saldoPendiente ? NARANJA : VERDE },
    ]
    tarjetas.forEach((t, i) => {
      const x = M + i * (tW + 10)
      rect(x, y - tH + 12, tW, tH, t.fondo)
      rect(x, y - tH + 12, 2.5, tH, t.acento)
      texto(t.e, x + 12, y - 2, F_CHICO, bold, GRIS)
      texto(t.v, x + 12, y - 22, Math.min(F_GRANDE, (tW - 24) / bold.widthOfTextAtSize(win(t.v), 1)), bold, t.color)
    })
    y -= tH + 4
    texto(`Reintegros pendientes incluidos en el saldo: ${moneda(resumen.gastoExtraPendiente)}`, M, y, F_CHICO, font, GRIS)
    y -= 24
    lugar(36)
    texto(`Avance de obra: ${resumen.porcentaje}%`, M, y, F_NORMAL, bold, OSCURO); y -= 15
    rect(M, y, CW, 6, LINEA); rect(M, y, CW * resumen.porcentaje / 100, 6, NARANJA); y -= 26
    for (const seccion of seccionesSeguimiento(resumen)) seccionTexto(seccion)
  }

  // ---------- Notas, vigencia y condiciones generales ----------
  const notas = d.notas?.trim() ?? ''
  const vigencia = `Este presupuesto tiene una validez de ${d.validez_dias ?? 10} días corridos desde su emisión.`
  const cajas = [...(notas ? [{ t: 'NOTAS', texto: notas }] : []), { t: 'VIGENCIA', texto: vigencia }]
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

  if (CONDICIONES_GENERALES.length) {
    const altoCondiciones = 18 + CONDICIONES_GENERALES.reduce((alto, c) => alto + 18 + partir(c.texto, F_CHICO + 0.5, CW).length * 10.5, 0)
    lugar(Math.min(altoCondiciones + 20, H - M - PIE - 35))
    titulo('Condiciones generales')
    for (const cond of CONDICIONES_GENERALES) {
      const renglones = partir(cond.titulo === 'Variaciones de precios' ? `El presupuesto tendrá una vigencia de ${d.validez_dias ?? 10} días corridos desde su emisión. Transcurrido dicho plazo, Mova podrá actualizar los valores antes de la aceptación.` : cond.texto, F_CHICO + 0.5, CW)
      lugar(14 + renglones.length * 10.5)
      texto(cond.titulo, M, y, F_NORMAL, bold, OSCURO); y -= 12
      for (const r of renglones) { texto(r, M, y, F_CHICO + 0.5, font, GRIS); y -= 10.5 }
      y -= 6
    }
  }

  lugar(24)
  texto(`Documento emitido: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`, M, y, F_CHICO, font, GRIS)

  // ---------- Pie en todas las páginas ----------
  const paginas = pdf.getPages()
  paginas.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 22 }, end: { x: W - M, y: M + 22 }, thickness: 0.6, color: LINEA })
    p.drawRectangle({ x: M, y: M + 21.4, width: 40, height: 1.4, color: NARANJA })
    p.drawText(win('MOVA Tecnología Smart'), { x: M, y: M + 9, size: F_CHICO, font: bold, color: OSCURO })
    p.drawText(win('www.movaelectronica.com.ar · IG @mova.smart · +54 9 261 555 7970'), { x: M, y: M - 1, size: F_CHICO, font, color: GRIS })
    const pag = win(`Página ${i + 1} de ${paginas.length}`)
    p.drawText(pag, { x: W - M - font.widthOfTextAtSize(pag, F_CHICO), y: M + 9, size: F_CHICO, font, color: GRIS })
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
