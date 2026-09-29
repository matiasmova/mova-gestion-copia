import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB, type PDFPage } from 'pdf-lib'
import logoUrl from './assets/mova-logo.png'
import { supabase } from './supabase'
import { moneda, fechaCorta, hoy } from './gestionFormat'
import { calcularPersona, type CalculoPersona } from './personalCalculos'

// Estado de cuenta de una persona del personal: por cada obra, lo pactado, lo
// que corresponde según el avance (o los jornales), lo pagado y si se le debe
// o está adelantado. Mismo cálculo que Inicio → Personal. Se genera un PDF
// con el estilo de los demás documentos para enviárselo.

const MODALIDADES: Record<string, string> = {
  por_dia: 'Por día', por_hora: 'Por hora', por_obra: 'Por obra', porcentaje: 'Por porcentaje', por_etapa: 'Por etapa',
}

export type ObraCuenta = {
  obraId: number
  obra: string
  estadoObra: string | null
  avance: number
  rol: string | null
  modalidad: string
  calc: CalculoPersona
  corresponde: number
  debe: number
  adelantado: number
}

export type CuentaPersona = {
  personaId: number
  nombre: string
  especialidad: string | null
  telefono: string | null
  obras: ObraCuenta[]
  pagos: { fecha: string | null; obra: string; descripcion: string | null; monto: number }[]
  jornales: { fecha: string; obra: string; jornada: number; horas: number | null; observaciones: string | null }[]
  totales: { pactado: number; corresponde: number; pagado: number; debe: number; adelantado: number; faltaTerminar: number }
}

const redondear = (n: number) => Math.round(n * 100) / 100
const num = (x: unknown) => Number(x) || 0

export async function cargarCuentaPersona(personaId: number): Promise<CuentaPersona> {
  const [rPer, rAsig, rCostos, rJorn] = await Promise.all([
    supabase.from('personal').select('*').eq('id', personaId).maybeSingle(),
    supabase.from('obra_asignaciones').select('obra_id,personal_id,rol_en_obra,modalidad,valor_acordado').eq('personal_id', personaId),
    supabase.from('costos').select('monto,fecha,descripcion,obra_id,personal_id').eq('personal_id', personaId).order('fecha', { ascending: true }),
    supabase.from('jornales').select('fecha,obra_id,personal_id,jornada,horas,observaciones').eq('personal_id', personaId).order('fecha', { ascending: true }),
  ])
  if (rPer.error || !rPer.data) throw rPer.error ?? new Error('No se encontró la persona.')
  if (rAsig.error) throw rAsig.error
  const per = rPer.data as { id: number; nombre: string; apellido: string | null; especialidad?: string | null; telefono?: string | null; costo_dia: number | string | null }
  const asignaciones = (rAsig.data ?? []) as { obra_id: number; personal_id: number; rol_en_obra: string | null; modalidad: string | null; valor_acordado: number | string | null }[]
  const costos = ((rCostos.data ?? []) as { monto: number | string; fecha: string | null; descripcion: string | null; obra_id: number | null; personal_id: number }[])
    .map((c) => ({ ...c, monto: num(c.monto) }))
  const jornales = ((rJorn.data ?? []) as { fecha: string; obra_id: number; personal_id: number; jornada: number | string; horas: number | string | null; observaciones: string | null }[])
    .map((j) => ({ ...j, jornada: num(j.jornada), horas: j.horas == null ? null : num(j.horas) }))

  const idsObras = Array.from(new Set([...asignaciones.map((a) => a.obra_id), ...costos.map((c) => c.obra_id), ...jornales.map((j) => j.obra_id)].filter((x): x is number => x != null)))
  const [rObras, rPres, rAdic] = idsObras.length
    ? await Promise.all([
        supabase.from('obras').select('id,nombre_obra,estado,porcentaje_avance').in('id', idsObras),
        supabase.from('presupuestos').select('obra_id,total,estado,activo').in('obra_id', idsObras),
        supabase.from('adicionales').select('obra_id,importe,estado,tipo').in('obra_id', idsObras),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]
  const obras = (rObras.data ?? []) as { id: number; nombre_obra: string; estado: string | null; porcentaje_avance: number | null }[]
  const presupuestos = (rPres.data ?? []) as { obra_id: number; total: number | string; estado: string; activo: boolean }[]
  const adicionales = (rAdic.data ?? []) as { obra_id: number; importe: number | string; estado: string; tipo: string }[]
  const nombreObra = (id: number | null) => (id == null ? 'Sin obra' : obras.find((o) => o.id === id)?.nombre_obra ?? `Obra #${id}`)
  const valorObra = (id: number) =>
    presupuestos.filter((p) => p.obra_id === id && p.activo !== false && p.estado === 'aceptado').reduce((s, p) => s + num(p.total), 0) +
    adicionales.filter((a) => a.obra_id === id && a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + num(a.importe), 0)

  const persona = { id: per.id, costo_dia: per.costo_dia == null ? null : num(per.costo_dia) }
  const filas: ObraCuenta[] = asignaciones.map((a) => {
    const obra = obras.find((o) => o.id === a.obra_id)
    const avanceObra = num(obra?.porcentaje_avance)
    const pagosObra = costos.filter((c) => c.obra_id === a.obra_id).map((c) => ({ personal_id: c.personal_id, monto: c.monto }))
    const calc = calcularPersona(
      { personal_id: a.personal_id, modalidad: a.modalidad, valor_acordado: a.valor_acordado == null ? null : num(a.valor_acordado) },
      persona, pagosObra, jornales.filter((j) => j.obra_id === a.obra_id), valorObra(a.obra_id), avanceObra,
    )
    const terminada = obra?.estado === 'finalizada' || obra?.estado === 'observacion'
    const avance = terminada ? 100 : Math.min(100, Math.max(0, avanceObra))
    // Igual que Inicio → Personal: con total pactado, corresponde = total × avance; por día/hora, lo devengado.
    const corresponde = calc.totalContrato != null ? redondear(calc.totalContrato * avance / 100) : calc.devengado
    return {
      obraId: a.obra_id,
      obra: nombreObra(a.obra_id),
      estadoObra: obra?.estado ?? null,
      avance,
      rol: a.rol_en_obra,
      modalidad: a.modalidad ?? 'por_obra',
      calc,
      corresponde,
      debe: redondear(Math.max(0, corresponde - calc.pagado)),
      adelantado: redondear(Math.max(0, calc.pagado - corresponde)),
    }
  })

  const totales = filas.reduce((t, f) => ({
    pactado: t.pactado + (f.calc.totalContrato ?? f.calc.devengado),
    corresponde: t.corresponde + f.corresponde,
    pagado: t.pagado + f.calc.pagado,
    debe: t.debe + f.debe,
    adelantado: t.adelantado + f.adelantado,
    faltaTerminar: t.faltaTerminar + (f.calc.totalContrato != null ? Math.max(f.calc.totalContrato - f.calc.pagado, 0) : Math.max(f.calc.diferencia, 0)),
  }), { pactado: 0, corresponde: 0, pagado: 0, debe: 0, adelantado: 0, faltaTerminar: 0 })

  return {
    personaId: per.id,
    nombre: `${per.nombre} ${per.apellido ?? ''}`.trim(),
    especialidad: per.especialidad ?? null,
    telefono: per.telefono ?? null,
    obras: filas,
    pagos: costos.map((c) => ({ fecha: c.fecha, obra: nombreObra(c.obra_id), descripcion: c.descripcion, monto: c.monto })),
    jornales: jornales.map((j) => ({ fecha: j.fecha, obra: nombreObra(j.obra_id), jornada: j.jornada, horas: j.horas, observaciones: j.observaciones })),
    totales,
  }
}

// ---------------- PDF ----------------

const NARANJA = rgb(0.894, 0.482, 0)
const NARANJA_SUAVE = rgb(1, 0.965, 0.925)
const OSCURO = rgb(0.063, 0.075, 0.094)
const TEXTO = rgb(0.2, 0.23, 0.27)
const GRIS = rgb(0.47, 0.51, 0.56)
const GRIS_CLARO = rgb(0.965, 0.969, 0.976)
const LINEA = rgb(0.9, 0.91, 0.93)
const VERDE = rgb(0.137, 0.463, 0.306)
const VERDE_SUAVE = rgb(0.925, 0.965, 0.945)
const ROJO = rgb(0.698, 0.231, 0.196)

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
    .replace(/[^\x20-\xFF\n]/g, '')
}

const limpiar = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

export const nombreArchivoCuenta = (c: CuentaPersona) => `Cuenta_${limpiar(c.nombre) || 'Personal'}_${hoy()}.pdf`

export async function generarPdfCuentaPersona(c: CuentaPersona): Promise<Blob> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(win(`Estado de cuenta · ${c.nombre}`))
  pdf.setAuthor('MOVA Tecnología Smart')
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
  const rect = (x: number, yy: number, w: number, h: number, color: RGB, borde?: RGB) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color, ...(borde ? { borderColor: borde, borderWidth: 0.7 } : {}) })
  const linea = (x1: number, yy: number, x2: number, grosor = 0.6, color: RGB = LINEA) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: grosor, color })
  const cortar = (t: string, size: number, maxW: number, f: PDFFont = font) => {
    let s = win(t)
    if (f.widthOfTextAtSize(s, size) <= maxW) return s
    while (s.length > 1 && f.widthOfTextAtSize(`${s}...`, size) > maxW) s = s.slice(0, -1)
    return `${s}...`
  }
  const titulo = (t: string) => {
    rect(M, y - 2, 3, 12, NARANJA)
    texto(t.toUpperCase(), M + 10, y, F_NORMAL, bold, OSCURO)
    y -= 18
  }
  const nuevaPagina = () => {
    page = pdf.addPage([W, H]); y = H - M
    texto(`Estado de cuenta · ${c.nombre}`, M, y, F_CHICO, font, GRIS)
    derecha('continuación', M + CW, y, F_CHICO, font, GRIS)
    y -= 10; linea(M, y, M + CW); y -= 20
  }
  const lugar = (alto: number) => { if (y - alto < PIE) { nuevaPagina(); return true } return false }
  const encabezadoFila = (celdas: { t: string; x: number; der?: boolean }[]) => {
    rect(M, y - 6, CW, 20, GRIS_CLARO)
    linea(M, y - 6, M + CW, 0.8, NARANJA)
    for (const cel of celdas) {
      if (cel.der) derecha(cel.t, cel.x, y, F_CHICO, bold, GRIS)
      else texto(cel.t, cel.x, y, F_CHICO, bold, GRIS)
    }
    y -= 22
  }

  // ---------- Encabezado ----------
  if (logo) {
    const lw = 150, lh = lw * (logo.height / logo.width)
    page.drawImage(logo, { x: M, y: y - lh + 6, width: lw, height: lh })
  }
  derecha('ESTADO DE CUENTA DEL PERSONAL', M + CW, y, F_CHICO, bold, NARANJA); y -= 20
  derecha(cortar(c.nombre, F_GRANDE - 2, CW / 2, bold), M + CW, y, F_GRANDE - 2, bold, OSCURO); y -= 15
  derecha(`Fecha: ${fechaCorta(hoy())}`, M + CW, y, F_CHICO, font, GRIS); y -= 11
  y -= 8
  linea(M, y, M + CW, 0.8, LINEA)
  rect(M, y - 0.4, 60, 1.6, NARANJA)
  y -= 22

  // ---------- Resumen en cajas ----------
  const t = c.totales
  // Saldo neto: lo que se le debe en unas obras menos lo adelantado en otras.
  const neto = redondear(t.debe - t.adelantado)
  const situacion = neto > 0.5
    ? { etq: 'SALDO A TU FAVOR', monto: neto, color: ROJO, fondo: NARANJA_SUAVE }
    : neto < -0.5
      ? { etq: 'PAGADO POR ADELANTADO', monto: -neto, color: NARANJA, fondo: NARANJA_SUAVE }
      : { etq: 'CUENTA AL DÍA', monto: 0, color: VERDE, fondo: VERDE_SUAVE }
  const cajas = [
    { etq: 'CORRESPONDE A HOY', v: moneda(t.corresponde), color: OSCURO, fondo: GRIS_CLARO },
    { etq: 'PAGADO', v: moneda(t.pagado), color: OSCURO, fondo: GRIS_CLARO },
    { etq: situacion.etq, v: moneda(situacion.monto), color: situacion.color, fondo: situacion.fondo },
  ]
  const cajaW = (CW - 24) / 3
  cajas.forEach((k, i) => {
    const x = M + i * (cajaW + 12)
    rect(x, y - 30, cajaW, 44, k.fondo)
    if (i === 2) rect(x, y - 30, 2.5, 44, k.color)
    texto(k.etq, x + 12, y, F_CHICO, bold, i === 2 ? k.color : GRIS)
    texto(k.v, x + 12, y - 19, F_GRANDE - 3, bold, k.color)
  })
  y -= 46
  if (t.debe > 0.5 && t.adelantado > 0.5) {
    texto(`Saldo neto: ${moneda(t.debe)} a cobrar en unas obras menos ${moneda(t.adelantado)} ya adelantados en otras.`, M, y, F_CHICO + 0.5, font, GRIS); y -= 12
  }
  if (t.faltaTerminar > 0.5) {
    texto(`Falta pagar hasta terminar las obras (según lo pactado): ${moneda(t.faltaTerminar)}.`, M, y, F_CHICO + 0.5, font, GRIS); y -= 12
  }
  y -= 14

  // ---------- Por obra ----------
  titulo('Detalle por obra')
  const xObra = M + 8, xCond = M + 170, xCorr = M + 330, xPag = M + 410, xSit = M + CW - 8
  encabezadoFila([
    { t: 'OBRA', x: xObra }, { t: 'CONDICIÓN', x: xCond }, { t: 'CORRESPONDE', x: xCorr, der: true }, { t: 'PAGADO', x: xPag, der: true }, { t: 'SITUACIÓN', x: xSit, der: true },
  ])
  if (!c.obras.length) { texto('Sin obras asignadas.', xObra, y, F_NORMAL, font, GRIS); y -= 16 }
  for (const f of c.obras) {
    lugar(30)
    const cond = f.calc.totalContrato != null
      ? `${MODALIDADES[f.modalidad] ?? f.modalidad} · ${moneda(f.calc.totalContrato)}`
      : `${MODALIDADES[f.modalidad] ?? f.modalidad} · ${f.calc.jornadas.toLocaleString('es-AR')} jorn.`
    texto(cortar(f.obra, F_NORMAL, xCond - xObra - 8, bold), xObra, y, F_NORMAL, bold, OSCURO)
    texto(cortar(cond, F_CHICO + 0.5, xCorr - xCond - 70), xCond, y, F_CHICO + 0.5, font, TEXTO)
    derecha(moneda(f.corresponde), xCorr, y, F_NORMAL, font, TEXTO)
    derecha(moneda(f.calc.pagado), xPag, y, F_NORMAL, font, TEXTO)
    if (f.debe > 0.5) derecha(`Te debemos ${moneda(f.debe)}`, xSit, y, F_CHICO + 0.5, bold, ROJO)
    else if (f.adelantado > 0.5) derecha(`Adelantado ${moneda(f.adelantado)}`, xSit, y, F_CHICO + 0.5, bold, NARANJA)
    else derecha('Al día', xSit, y, F_CHICO + 0.5, bold, VERDE)
    const sub = [f.rol, f.calc.totalContrato != null ? `Avance ${f.avance}%` : null, f.calc.faltaValor ? 'Falta cargar el valor' : null].filter(Boolean).join(' · ')
    if (sub) texto(cortar(sub, F_CHICO, xCorr - xObra - 70), xObra, y - 11, F_CHICO, font, GRIS)
    y -= sub ? 20 : 14
    linea(M, y + 6, M + CW)
    y -= 6
  }
  y -= 12

  // ---------- Pagos ----------
  lugar(60)
  titulo(`Pagos recibidos (${c.pagos.length})`)
  if (!c.pagos.length) { texto('Todavía no hay pagos registrados.', M + 8, y, F_NORMAL, font, GRIS); y -= 20 } else {
    encabezadoFila([{ t: 'FECHA', x: M + 8 }, { t: 'OBRA', x: M + 80 }, { t: 'DETALLE', x: M + 230 }, { t: 'MONTO', x: M + CW - 8, der: true }])
    for (const p of c.pagos) {
      lugar(16)
      texto(p.fecha ? fechaCorta(p.fecha.slice(0, 10)) : '-', M + 8, y, F_NORMAL, font, TEXTO)
      texto(cortar(p.obra, F_NORMAL, 140), M + 80, y, F_NORMAL, font, TEXTO)
      texto(cortar(p.descripcion || '-', F_NORMAL, CW - 330), M + 230, y, F_NORMAL, font, GRIS)
      derecha(moneda(p.monto), M + CW - 8, y, F_NORMAL, bold, OSCURO)
      y -= 8; linea(M, y, M + CW); y -= 10
    }
    lugar(18)
    derecha(`Total pagado: ${moneda(t.pagado)}`, M + CW - 8, y, F_NORMAL, bold, OSCURO); y -= 22
  }

  // ---------- Jornales ----------
  if (c.jornales.length) {
    lugar(60)
    const totalJ = c.jornales.reduce((s, j) => s + j.jornada, 0)
    titulo(`Jornales registrados (${totalJ.toLocaleString('es-AR')})`)
    encabezadoFila([{ t: 'FECHA', x: M + 8 }, { t: 'OBRA', x: M + 80 }, { t: 'JORNADA', x: M + 300, der: true }, { t: 'HORAS', x: M + 350, der: true }, { t: 'OBSERVACIONES', x: M + 370 }])
    for (const j of c.jornales) {
      lugar(16)
      texto(fechaCorta(j.fecha), M + 8, y, F_NORMAL, font, TEXTO)
      texto(cortar(j.obra, F_NORMAL, 170), M + 80, y, F_NORMAL, font, TEXTO)
      derecha(j.jornada.toLocaleString('es-AR'), M + 300, y, F_NORMAL, font, TEXTO)
      derecha(j.horas != null ? j.horas.toLocaleString('es-AR') : '-', M + 350, y, F_NORMAL, font, TEXTO)
      texto(cortar(j.observaciones || '-', F_CHICO + 0.5, CW - 378), M + 370, y, F_CHICO + 0.5, font, GRIS)
      y -= 8; linea(M, y, M + CW); y -= 10
    }
    y -= 12
  }

  // ---------- Nota y conformidad ----------
  const nota = 'Lo que corresponde cobrar sale de lo pactado y del avance de cada obra (100% si la obra terminó). Para quienes cobran por día u hora, sale de los jornales registrados. Si ves alguna diferencia, avisanos para revisarla antes de firmar.'
  const renglones: string[] = []
  let r = ''
  for (const palabra of win(nota).split(' ')) {
    const prueba = r ? `${r} ${palabra}` : palabra
    if (font.widthOfTextAtSize(prueba, F_CHICO + 0.5) > CW - 28 && r) { renglones.push(r); r = palabra } else r = prueba
  }
  renglones.push(r)
  const altoNota = 24 + renglones.length * 10.5
  lugar(altoNota + 70)
  rect(M, y - altoNota + 12, CW, altoNota, GRIS_CLARO)
  texto('CÓMO SE CALCULA', M + 14, y - 2, F_CHICO, bold, NARANJA)
  let yn = y - 16
  for (const rr of renglones) { texto(rr, M + 14, yn, F_CHICO + 0.5, font, TEXTO); yn -= 10.5 }
  y -= altoNota + 30

  const firmaW = (CW - 24) / 3
  ;['Conforme · Firma', 'Aclaración y DNI', 'Fecha'].forEach((etq, i) => {
    const x = M + i * (firmaW + 12)
    linea(x, y, x + firmaW, 0.7, GRIS)
    texto(etq, x, y - 11, F_CHICO, font, GRIS)
  })
  y -= 30
  lugar(20)
  texto(`Documento emitido: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`, M, y, F_CHICO, font, GRIS)

  // ---------- Pie ----------
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

// Genera el PDF de la persona (para la vista previa).
export async function armarPdfCuenta(personaId: number): Promise<{ blob: Blob; nombre: string }> {
  const cuenta = await cargarCuentaPersona(personaId)
  return { blob: await generarPdfCuentaPersona(cuenta), nombre: nombreArchivoCuenta(cuenta) }
}

// Genera el PDF de la persona y lo comparte (WhatsApp, mail…) o lo descarga.
export async function compartirCuentaPersona(personaId: number): Promise<void> {
  const cuenta = await cargarCuentaPersona(personaId)
  const blob = await generarPdfCuentaPersona(cuenta)
  const nombre = nombreArchivoCuenta(cuenta)
  const file = new File([blob], nombre, { type: 'application/pdf' })
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try { await navigator.share({ files: [file], title: `Estado de cuenta · ${cuenta.nombre}` }) } catch { /* canceló */ }
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = nombre; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
