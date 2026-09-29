import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB, type PDFPage } from 'pdf-lib'
import logoUrl from './assets/mova-logo.png'
import { fechaCorta, hoy } from './gestionFormat'
import { configActual, lineaContacto } from './config'

// PDF "Resumen de accesos": apps, usuarios y contraseñas que dejó el instalador.
// Mismo estilo que el presupuesto (pdfPresupuesto.ts): logo, barra naranja,
// cajas grises y pie con los datos de MOVA en todas las páginas.

export type AccesoPdf = {
  app: string
  descripcion?: string | null
  detalle?: string | null
  usuario?: string | null
  contrasena?: string | null
}

export type DatosAccesosPdf = {
  cliente: string
  obra: string
  ubicacion?: string | null
  accesos: AccesoPdf[]
}

// El aviso se edita en Configuración → Presupuestos y documentos.
export const avisoAccesos = () => configActual().accesos.aviso.filter((p) => p.trim())

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
    .replace(/→/g, '->')
    .replace(/[^\x00-\xFF]/g, '')
}

const limpiar = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

// Nombre del archivo: Accesos_Cliente_Obra_fecha.pdf
export function nombreArchivoAccesos(cliente: string, obra: string): string {
  return `${['Accesos', limpiar(cliente || 'Cliente'), limpiar(obra || ''), hoy()].filter(Boolean).join('_')}.pdf`
}

export async function generarPdfAccesos(d: DatosAccesosPdf): Promise<Blob> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(win(`Resumen de accesos · ${d.obra}`))
  pdf.setAuthor(configActual().empresa.nombre)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  // Monoespaciada para usuario y contraseña: no se confunden l/1 u O/0.
  const mono = await pdf.embedFont(StandardFonts.CourierBold)
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
  // Corta por caracteres (para contraseñas largas sin espacios).
  const partirDuro = (t: string, size: number, maxW: number, f: PDFFont): string[] => {
    const s = win(t)
    if (!s) return ['']
    const salida: string[] = []
    let renglon = ''
    for (const c of s) {
      if (f.widthOfTextAtSize(renglon + c, size) > maxW && renglon) { salida.push(renglon); renglon = c }
      else renglon += c
    }
    salida.push(renglon)
    return salida
  }
  const titulo = (t: string) => {
    rect(M, y - 2, 3, 12, NARANJA)
    texto(t.toUpperCase(), M + 10, y, F_NORMAL, bold, OSCURO)
    y -= 18
  }
  const nuevaPagina = () => {
    page = pdf.addPage([W, H]); y = H - M
    texto(`Resumen de accesos · ${d.cliente}`, M, y, F_CHICO, font, GRIS)
    derecha('continuación', M + CW, y, F_CHICO, font, GRIS)
    y -= 10; linea(M, y, M + CW); y -= 20
  }
  const lugar = (alto: number) => { if (y - alto < PIE) { nuevaPagina(); return true } return false }

  // ---------- Encabezado ----------
  if (logo) {
    const lw = 150, lh = lw * (logo.height / logo.width)
    page.drawImage(logo, { x: M, y: y - lh + 6, width: lw, height: lh })
  }
  derecha('RESUMEN DE ACCESOS', M + CW, y, F_CHICO, bold, NARANJA); y -= 20
  derecha('Documento confidencial', M + CW, y, F_GRANDE - 3, bold, OSCURO); y -= 15
  derecha(`Fecha de entrega: ${fechaCorta(hoy())}`, M + CW, y, F_CHICO, font, GRIS); y -= 11
  y -= 8
  linea(M, y, M + CW, 0.8, LINEA)
  rect(M, y - 0.4, 60, 1.6, NARANJA)
  y -= 22

  // ---------- Cliente y obra ----------
  const cajaW = (CW - 12) / 2
  const lineasObra = [
    d.ubicacion ? `Ubicación: ${d.ubicacion}` : null,
    `${d.accesos.length} ${d.accesos.length === 1 ? 'acceso registrado' : 'accesos registrados'}`,
  ].filter((l): l is string => !!l).flatMap((l) => partir(l, F_CHICO + 0.5, cajaW - 24))
  const lineasCliente = partir('Titular de las cuentas y equipos instalados.', F_CHICO + 0.5, cajaW - 24)
  const altoCaja = 34 + Math.max(lineasCliente.length, lineasObra.length) * 10.5
  rect(M, y - altoCaja + 12, cajaW, altoCaja, GRIS_CLARO)
  rect(M + cajaW + 12, y - altoCaja + 12, cajaW, altoCaja, GRIS_CLARO)
  texto('CLIENTE', M + 12, y, F_CHICO, bold, GRIS)
  texto('OBRA', M + cajaW + 24, y, F_CHICO, bold, GRIS)
  let yCaja = y - 15
  texto(partir(d.cliente, F_NORMAL, cajaW - 24, bold)[0] ?? '', M + 12, yCaja, F_NORMAL, bold, OSCURO)
  texto(partir(d.obra, F_NORMAL, cajaW - 24, bold)[0] ?? '', M + cajaW + 24, yCaja, F_NORMAL, bold, OSCURO)
  yCaja -= 13
  let yl = yCaja
  for (const l of lineasCliente) { texto(l, M + 12, yl, F_CHICO + 0.5, font, TEXTO); yl -= 10.5 }
  yl = yCaja
  for (const l of lineasObra) { texto(l, M + cajaW + 24, yl, F_CHICO + 0.5, font, TEXTO); yl -= 10.5 }
  y -= altoCaja + 22

  // ---------- Título e introducción ----------
  texto('Sus aplicaciones y claves de acceso', M, y, F_GRANDE, bold, OSCURO); y -= 21
  for (const r of partir('A continuación se detallan las aplicaciones, cuentas y claves configuradas durante la instalación. Guarde este documento en un lugar seguro y no lo comparta con terceros.', F_NORMAL, CW)) {
    texto(r, M, y, F_NORMAL, font, GRIS); y -= 13
  }
  y -= 14

  // ---------- Accesos ----------
  titulo('Detalle de accesos')
  const colDato = (CW - 32 - 12) / 2
  d.accesos.forEach((a, i) => {
    const tit = partir(a.app || 'Aplicación', F_NORMAL + 1, CW - 60, bold)
    const desc = a.descripcion?.trim() ? partir(a.descripcion, F_CHICO + 1, CW - 32) : []
    const det = a.detalle?.trim() ? partir(a.detalle, F_CHICO + 1, CW - 32) : []
    const usu = partirDuro(a.usuario?.trim() || '—', F_NORMAL, colDato - 20, mono)
    const pas = partirDuro(a.contrasena?.trim() || '—', F_NORMAL, colDato - 20, mono)
    const altoDatos = 22 + Math.max(usu.length, pas.length) * 12
    const alto = 14 + tit.length * 13 + (desc.length ? desc.length * 11.5 + 2 : 0) + (det.length ? det.length * 11.5 + 4 : 0) + altoDatos + 12
    lugar(alto + 8)
    const base = y - alto + 12
    rect(M, base, CW, alto, BLANCO, LINEA)
    rect(M, base, 2.5, alto, NARANJA)
    // Número
    page.drawCircle({ x: M + CW - 20, y: y - 4, size: 9, color: NARANJA_SUAVE })
    const num = String(i + 1).padStart(2, '0')
    texto(num, M + CW - 20 - bold.widthOfTextAtSize(num, F_CHICO) / 2, y - 6.5, F_CHICO, bold, NARANJA)

    let yy = y - 4
    for (const r of tit) { texto(r, M + 16, yy, F_NORMAL + 1, bold, OSCURO); yy -= 13 }
    if (desc.length) { for (const r of desc) { texto(r, M + 16, yy, F_CHICO + 1, font, TEXTO); yy -= 11.5 } yy -= 2 }
    if (det.length) { for (const r of det) { texto(r, M + 16, yy, F_CHICO + 1, font, GRIS); yy -= 11.5 } yy -= 4 }
    yy -= 4
    // Usuario y contraseña, en dos cajas
    const cajas: [string, string[]][] = [['USUARIO', usu], ['CONTRASEÑA', pas]]
    cajas.forEach(([etq, renglones], k) => {
      const x = M + 16 + k * (colDato + 12)
      rect(x, yy - altoDatos + 8, colDato, altoDatos, GRIS_CLARO)
      texto(etq, x + 10, yy - 4, F_CHICO, bold, NARANJA)
      let yd = yy - 18
      for (const r of renglones) { texto(r, x + 10, yd, F_NORMAL, mono, OSCURO); yd -= 12 }
    })
    y -= alto + 8
  })
  if (!d.accesos.length) { texto('No hay accesos cargados.', M, y, F_NORMAL, font, GRIS); y -= 14 }
  y -= 10

  // ---------- Recomendaciones ----------
  const recomendaciones = [
    'Cambie las contraseñas desde la opción "Cuenta" o "Perfil" de cada aplicación.',
    'Use claves de al menos 8 caracteres combinando letras, números y símbolos.',
    'Active la verificación en dos pasos cuando la aplicación lo permita.',
    'Si modifica la clave del WiFi, algunos equipos deberán volver a vincularse: consúltenos.',
  ]
  lugar(40)
  titulo('Recomendaciones')
  for (const item of recomendaciones) {
    const rr = partir(item, F_NORMAL, CW - 16)
    lugar(rr.length * 12 + 4)
    page.drawCircle({ x: M + 4, y: y + 3, size: 1.8, color: NARANJA })
    for (const r of rr) { texto(r, M + 14, y, F_NORMAL, font, TEXTO); y -= 12 }
    y -= 3
  }
  y -= 12

  // ---------- Aviso importante ----------
  const avisos = avisoAccesos().map((p) => partir(p, F_CHICO + 1, CW - 28))
  const altoAviso = 30 + avisos.reduce((s, r) => s + r.length * 11 + 5, 0)
  lugar(altoAviso + 10)
  rect(M, y - altoAviso + 12, CW, altoAviso, NARANJA_SUAVE)
  rect(M, y - altoAviso + 12, 2.5, altoAviso, NARANJA)
  texto('IMPORTANTE · SEGURIDAD DE SUS DATOS', M + 14, y - 2, F_CHICO, bold, NARANJA)
  let ya = y - 18
  for (const renglones of avisos) {
    for (const r of renglones) { texto(r, M + 14, ya, F_CHICO + 1, font, TEXTO); ya -= 11 }
    ya -= 5
  }
  y -= altoAviso + 14

  // ---------- Conformidad ----------
  lugar(60)
  const firmaW = (CW - 24) / 3
  ;['Recibí conforme · Firma', 'Aclaración y DNI', 'Fecha de recepción'].forEach((etq, i) => {
    const x = M + i * (firmaW + 12)
    linea(x, y - 26, x + firmaW, 0.7, GRIS)
    texto(etq, x, y - 37, F_CHICO, font, GRIS)
  })
  y -= 52

  lugar(24)
  texto(`Documento emitido: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`, M, y, F_CHICO, font, GRIS)

  // ---------- Pie en todas las páginas ----------
  const paginas = pdf.getPages()
  paginas.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 22 }, end: { x: W - M, y: M + 22 }, thickness: 0.6, color: LINEA })
    p.drawRectangle({ x: M, y: M + 21.4, width: 40, height: 1.4, color: NARANJA })
    p.drawText(win(configActual().empresa.nombre), { x: M, y: M + 9, size: F_CHICO, font: bold, color: OSCURO })
    p.drawText(win(lineaContacto()), { x: M, y: M - 1, size: F_CHICO, font, color: GRIS })
    const pag = win(`Confidencial · Página ${i + 1} de ${paginas.length}`)
    p.drawText(pag, { x: W - M - font.widthOfTextAtSize(pag, F_CHICO), y: M + 9, size: F_CHICO, font, color: GRIS })
  })

  const bytes = await pdf.save()
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
}
