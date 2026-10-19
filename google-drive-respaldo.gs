/**
 * MOVA Gestión — Respaldo automático en Google Drive
 * ---------------------------------------------------
 * Este programa corre en TU cuenta de Google (script.google.com) y guarda en
 * tu Drive, en la carpeta "MOVA Respaldos":
 *   · Datos/      → el respaldo completo (.json, sirve para restaurar)
 *   · Planillas/  → los mismos datos en una planilla de Google (para mirar)
 *   · Fotos/      → todas las fotos y archivos (solo baja los nuevos)
 *
 * Cómo se usa (una sola vez):
 *   1. Pegá este código en un proyecto nuevo de script.google.com.
 *   2. Completá CLAVE con la misma clave que pusiste en el secret DRIVE_TOKEN
 *      de Supabase.
 *   3. Elegí la función "activar" y tocá ▶ Ejecutar (te pide permiso para usar
 *      tu Drive: aceptá). Eso hace el primer respaldo y lo deja programado
 *      todos los domingos a la madrugada.
 * Para hacer un respaldo en el momento: elegí "respaldarAhora" y ▶ Ejecutar.
 */

const URL_FUNCION = 'https://aceukzftfkjhmponaktd.supabase.co/functions/v1/respaldo-semanal'
const CLAVE = 'PEGÁ_ACÁ_TU_DRIVE_TOKEN'
const CARPETA = 'MOVA Respaldos'

// Programa el respaldo todos los domingos (4 a 5 AM) y hace el primero ya.
function activar() {
  ScriptApp.getProjectTriggers().forEach((t) => { if (t.getHandlerFunction() === 'respaldarAhora') ScriptApp.deleteTrigger(t) })
  ScriptApp.newTrigger('respaldarAhora').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).create()
  respaldarAhora()
}

function respaldarAhora() {
  const inicio = Date.now()
  const raiz = carpeta_(DriveApp.getRootFolder(), CARPETA)
  const fecha = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd')

  // 1) Datos completos (.json)
  const texto = llamar_('exportar').getContentText()
  const datosDir = carpeta_(raiz, 'Datos')
  borrar_(datosDir, `MOVA-respaldo-${fecha}.json`)
  datosDir.createFile(`MOVA-respaldo-${fecha}.json`, texto, 'application/json')
  const respaldo = JSON.parse(texto)

  // 2) Planilla de Google con una hoja por tabla
  const planillas = carpeta_(raiz, 'Planillas')
  borrar_(planillas, `MOVA respaldo ${fecha}`)
  const libro = SpreadsheetApp.create(`MOVA respaldo ${fecha}`)
  let primera = true
  Object.keys(respaldo.datos).forEach((tabla) => {
    const filas = respaldo.datos[tabla]
    const hoja = primera ? libro.getSheets()[0].setName(tabla) : libro.insertSheet(tabla)
    primera = false
    if (!filas.length) { hoja.getRange(1, 1).setValue('Sin datos'); return }
    const cols = Object.keys(filas[0])
    const valores = [cols].concat(filas.map((f) => cols.map((c) => {
      const v = f[c]
      if (v === null || v === undefined) return ''
      const t = typeof v === 'object' ? JSON.stringify(v) : v
      return typeof t === 'string' && t.length > 49000 ? t.slice(0, 49000) : t
    })))
    hoja.getRange(1, 1, valores.length, cols.length).setValues(valores)
    hoja.setFrozenRows(1)
  })
  DriveApp.getFileById(libro.getId()).moveTo(planillas)

  // 3) Fotos y archivos: solo los que todavía no están en Drive
  const fotos = carpeta_(raiz, 'Fotos')
  const archivos = JSON.parse(llamar_('archivos').getContentText()).archivos || []
  let nuevos = 0
  for (const a of archivos) {
    if (Date.now() - inicio > 5 * 60 * 1000) break // Google corta a los 6 minutos: el resto sigue la próxima vez
    if (!a.url) continue
    const partes = `${a.bucket}/${a.ruta}`.split('/')
    const nombre = partes.pop()
    let dir = fotos
    partes.forEach((p) => { dir = carpeta_(dir, p) })
    if (dir.getFilesByName(nombre).hasNext()) continue
    try {
      dir.createFile(UrlFetchApp.fetch(a.url).getBlob().setName(nombre))
      nuevos++
    } catch (e) { console.log(`No se pudo bajar ${a.ruta}: ${e}`) }
  }
  console.log(`Respaldo ${fecha} listo · ${Object.keys(respaldo.datos).length} tablas · ${nuevos} archivos nuevos`)
}

function llamar_(accion) {
  const r = UrlFetchApp.fetch(URL_FUNCION, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-drive-token': CLAVE }, payload: JSON.stringify({ accion }),
  })
  if (r.getResponseCode() !== 200) throw new Error(`El sistema respondió ${r.getResponseCode()}: ${r.getContentText().slice(0, 200)}. Revisá que la CLAVE sea igual al secret DRIVE_TOKEN.`)
  return r
}

function carpeta_(padre, nombre) {
  const it = padre.getFoldersByName(nombre)
  return it.hasNext() ? it.next() : padre.createFolder(nombre)
}

function borrar_(dir, nombre) {
  const it = dir.getFilesByName(nombre)
  while (it.hasNext()) it.next().setTrashed(true)
}
