import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import type { ProductoServicio } from './ProductosServicios'
import {
  dos,
  gananciaDesdePrecio,
  precioDesdeGanancia,
  type ModoGanancia,
} from './catalogoCalculos'

// Importación masiva del catálogo desde un archivo CSV o Excel (.xlsx/.xls).
//
//  · Si el producto ya existe (mismo código, o mismo nombre cuando la hoja no
//    trae código) se actualiza SOLO lo que venga completo en la hoja.
//  · Si no existe se crea.
//  · Antes de guardar se arma un plan que se revisa en pantalla.

export type OpcionesImportacion = {
  // Cómo se interpreta la columna de % de ganancia y el % para productos nuevos.
  modo: ModoGanancia
  // Pesos por dólar, para las columnas de costo en dólares.
  cotizacion: number
  // % de ganancia para productos nuevos cuya hoja no trae precio de lista ni %.
  gananciaNuevos: number | null
  // Al cambiar el costo de un producto existente sin precio en la hoja,
  // mantener la relación actual entre precio y costo.
  recalcularPrecio: boolean
  // false si todavía no se corrió el SQL de moneda por producto (no se envían esas columnas).
  conMoneda?: boolean
}

export type AccionFila = 'crear' | 'actualizar' | 'sinCambios' | 'error'

export type FilaPlan = {
  linea: number
  accion: AccionFila
  nombre: string
  codigo: string | null
  motivo?: string
  avisos: string[]
  cambios: string[]
  existente?: ProductoServicio
  // Lo que se guarda: fila completa al crear, solo lo que cambia al actualizar.
  datos?: Record<string, unknown>
}

export type Plan = {
  filas: FilaPlan[]
  columnasReconocidas: string[]
  columnasIgnoradas: string[]
  errorGeneral?: string
}

type Campo =
  | 'codigo' | 'nombre' | 'tipo' | 'categoria' | 'proveedor' | 'unidad'
  | 'costo' | 'costoUsd' | 'ganancia' | 'lista' | 'ventaUsd' | 'stock' | 'stockMinimo'
  | 'iva' | 'link' | 'foto' | 'descripcion' | 'moneda' | 'nombrePresupuesto'

const ETIQUETA_CAMPO: Record<Campo, string> = {
  codigo: 'Código', nombre: 'Nombre', tipo: 'Tipo', categoria: 'Categoría',
  proveedor: 'Proveedor', unidad: 'Unidad', costo: 'Precio de compra',
  costoUsd: 'Precio de compra (USD)', ganancia: '% de ganancia',
  lista: 'Precio de lista', ventaUsd: 'Precio de venta (USD)', stock: 'Stock', stockMinimo: 'Stock mínimo',
  iva: 'IVA', link: 'Link de compra', foto: 'Foto (link)', descripcion: 'Descripción',
  moneda: 'Moneda', nombrePresupuesto: 'Nombre en presupuesto',
}

// Encabezados aceptados (se comparan sin tildes, mayúsculas ni símbolos).
const ALIAS: Record<Campo, string[]> = {
  codigo: ['codigo', 'sku', 'cod', 'codigointerno', 'codigodeproducto', 'codproducto'],
  nombre: ['nombre', 'producto', 'articulo', 'titulo', 'nombredelproducto', 'descripcioncorta'],
  tipo: ['tipo'],
  categoria: ['categoria', 'rubro', 'familia'],
  proveedor: ['proveedor', 'marca'],
  unidad: ['unidad', 'unidaddemedida', 'um'],
  costo: ['preciodecompra', 'preciocompra', 'compra', 'costo', 'costounitario', 'preciocosto', 'costoars', 'preciodecompraars'],
  costoUsd: ['costousd', 'preciousd', 'preciodecomprausd', 'preciocomprausd', 'compra usd', 'comprausd', 'usd', 'dolares', 'preciodolares', 'costodolares', 'siniva', 'preciosiniva'],
  ganancia: ['ganancia', 'deganancia', 'gananciapct', 'porcentajedeganancia', 'margen', 'demargen', 'margenpct', 'recargo', 'derecargo'],
  lista: ['preciodelista', 'lista', 'preciolista', 'precioventa', 'preciodeventa', 'venta', 'pvp', 'precio'],
  ventaUsd: ['ventausd', 'preciodeventausd', 'precioventausd', 'preciodelistausd', 'preciolistausd', 'listausd', 'pvpusd'],
  stock: ['stock', 'cantidad', 'existencia', 'existencias'],
  stockMinimo: ['stockminimo', 'minimo', 'stockminimoalerta'],
  iva: ['iva', 'ivapct', 'alicuota', 'alicuotaiva'],
  link: ['linkdecompra', 'linkcompra', 'link', 'url', 'enlace'],
  foto: ['foto', 'imagen', 'fotourl', 'imagenurl', 'urlfoto', 'urlimagen', 'linkfoto', 'linkdefoto'],
  descripcion: ['descripcion', 'detalle', 'descripciondetallada', 'descripcioninterna', 'detalleinterno'],
  moneda: ['moneda', 'divisa', 'monedadelprecio'],
  nombrePresupuesto: ['nombreenpresupuesto', 'nombrepresupuesto', 'nombreparaelpresupuesto', 'nombrecomercial', 'nombrecliente', 'comoapareceenelpresupuesto', 'enpresupuesto'],
}

const UNIDADES = ['unidad', 'metro', 'hora', 'servicio', 'kit', 'boca', 'circuito']
const IVAS = [0, 10.5, 21, 27]

const normalizar = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')

const normalizarNombre = (s: string) =>
  s.normalize('NFKC').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

const dinero = (valor: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(valor)

// ─────────────────────────── Lectura del archivo ───────────────────────────

// Excel en español guarda los CSV en Windows-1252; Google Sheets en UTF-8.
export async function leerArchivoTexto(archivo: File): Promise<string> {
  const bytes = await archivo.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export type FilaCruda = { celdas: string[]; linea: number }

const EXTENSIONES_EXCEL = ['.xlsx', '.xlsm', '.xls']

// Lee un CSV o un Excel (.xlsx/.xls/.xlsm) y devuelve las filas ya separadas
// en celdas, sea cual sea el formato: a partir de acá el resto del importador
// no necesita saber de qué tipo de archivo vinieron.
export async function leerFilasDesdeArchivo(archivo: File): Promise<FilaCruda[]> {
  const nombre = archivo.name.toLowerCase()
  if (EXTENSIONES_EXCEL.some((ext) => nombre.endsWith(ext))) return leerFilasDesdeExcel(archivo)
  return parsearCsv(await leerArchivoTexto(archivo))
}

async function leerFilasDesdeExcel(archivo: File): Promise<FilaCruda[]> {
  const datos = new Uint8Array(await archivo.arrayBuffer())
  const libro = XLSX.read(datos, { type: 'array' })
  const hojas = libro.SheetNames.map((nombreHoja) => {
    const hoja = libro.Sheets[nombreHoja]
    const crudas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: true, blankrows: true }) as unknown[][]
    const filas: FilaCruda[] = []
    crudas.forEach((fila, i) => {
      const celdas = fila.map((v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v).trim()))
      if (celdas.some((c) => c.trim() !== '')) filas.push({ celdas, linea: i + 1 })
    })
    return filas
  })
  return elegirHojaDeDatos(hojas)
}

// Un Excel puede traer varias hojas (por ejemplo, una de "Instrucciones").
// Se usa la primera cuyo encabezado tenga una columna de código o de nombre
// reconocible; si ninguna la tiene, la que tenga más filas cargadas.
function elegirHojaDeDatos(hojas: FilaCruda[][]): FilaCruda[] {
  const clave = new Set([...ALIAS.codigo, ...ALIAS.nombre].map(normalizar))
  const conColumnaClave = hojas.filter((filas) => filas[0]?.celdas.some((c) => clave.has(normalizar(c))))
  const candidatas = conColumnaClave.length > 0 ? conColumnaClave : hojas
  return candidatas.reduce((mejor, actual) => (actual.length > mejor.length ? actual : mejor), candidatas[0] ?? [])
}

// Separa el texto en filas y celdas. Detecta el separador (; , o tab)
// y respeta las comillas.
export function parsearCsv(textoOriginal: string): FilaCruda[] {
  let texto = textoOriginal
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1)

  const primera = texto.split(/\r?\n/, 1)[0] ?? ''
  const cuenta = (c: string) => primera.split(c).length - 1
  const opciones: Array<[string, number]> = [[';', cuenta(';')], [',', cuenta(',')], ['\t', cuenta('\t')]]
  opciones.sort((a, b) => b[1] - a[1])
  const separador = opciones[0][1] > 0 ? opciones[0][0] : ','

  const filas: FilaCruda[] = []
  let celdas: string[] = []
  let actual = ''
  let entreComillas = false
  let linea = 1
  let lineaInicio = 1

  const cerrarFila = () => {
    celdas.push(actual)
    actual = ''
    if (celdas.some((c) => c.trim() !== '')) filas.push({ celdas, linea: lineaInicio })
    celdas = []
  }

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { actual += '"'; i++ } else entreComillas = false
      } else {
        if (c === '\n') linea++
        actual += c
      }
    } else if (c === '"') {
      entreComillas = true
    } else if (c === separador) {
      celdas.push(actual)
      actual = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      cerrarFila()
      linea++
      lineaInicio = linea
    } else {
      actual += c
    }
  }
  if (actual !== '' || celdas.length > 0) cerrarFila()

  return filas
}

// "1.234,56" · "1234.56" · "$ 45.000" · "10,5%" · "45000"
function parsearNumero(bruto: string): number | null | 'invalido' {
  let t = bruto.replace(/[\s$]/g, '').replace(/ars|usd|u\$s/gi, '').replace(/%$/, '')
  if (t === '') return null
  if (!/^-?[\d.,]+$/.test(t)) return 'invalido'

  const coma = t.lastIndexOf(',')
  const punto = t.lastIndexOf('.')
  if (coma >= 0 && punto >= 0) {
    // El último símbolo es el decimal; el otro separa miles.
    t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (coma >= 0) {
    t = t.split(',').length > 2 ? t.replace(/,/g, '') : t.replace(',', '.')
  } else if (punto >= 0) {
    // 45.000 -> miles; 1.5 -> decimal.
    if (t.split('.').length > 2 || /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : 'invalido'
}

// ─────────────────────────────── Plan ───────────────────────────────

// Wrapper para CSV/texto plano (se usa también en las pruebas). El botón de
// importar en la app usa planificarDesdeFilas directamente, porque el
// archivo puede venir de un CSV o de un Excel.
export function planificarImportacion(
  texto: string,
  existentes: ProductoServicio[],
  opciones: OpcionesImportacion,
): Plan {
  return planificarDesdeFilas(parsearCsv(texto), existentes, opciones)
}

export function planificarDesdeFilas(
  filas: FilaCruda[],
  existentes: ProductoServicio[],
  opciones: OpcionesImportacion,
): Plan {
  if (filas.length < 2) {
    return { filas: [], columnasReconocidas: [], columnasIgnoradas: [], errorGeneral: 'El archivo está vacío o solo tiene la fila de títulos.' }
  }

  // Encabezados -> campos
  const mapaAlias = new Map<string, Campo>()
  for (const campo of Object.keys(ALIAS) as Campo[]) {
    for (const alias of ALIAS[campo]) if (!mapaAlias.has(normalizar(alias))) mapaAlias.set(normalizar(alias), campo)
  }
  const columna: Partial<Record<Campo, number>> = {}
  const reconocidas: string[] = []
  const ignoradas: string[] = []
  filas[0].celdas.forEach((titulo, i) => {
    const t = titulo.trim()
    if (!t) return
    const campo = mapaAlias.get(normalizar(t))
    if (campo && columna[campo] === undefined) {
      columna[campo] = i
      reconocidas.push(`${t} → ${ETIQUETA_CAMPO[campo]}`)
    } else {
      ignoradas.push(t)
    }
  })

  if (columna.nombre === undefined && columna.codigo === undefined) {
    return { filas: [], columnasReconocidas: reconocidas, columnasIgnoradas: ignoradas, errorGeneral: 'No encontré una columna de nombre ni de código. Revisá los títulos de la primera fila (usá la plantilla).' }
  }

  // Catálogo actual, para reconocer lo que ya existe.
  const porCodigo = new Map<string, ProductoServicio>()
  const porNombre = new Map<string, ProductoServicio[]>()
  for (const e of existentes) {
    if (e.codigo) porCodigo.set(e.codigo.trim().toLowerCase(), e)
    const k = normalizarNombre(e.nombre)
    porNombre.set(k, [...(porNombre.get(k) ?? []), e])
  }

  const resultado: FilaPlan[] = []
  const codigosVistos = new Map<string, number>()
  const nombresVistos = new Map<string, number>()
  // El tipo del id se toma de ProductoServicio (sirve tanto si es número como si es texto/uuid).
  const productosUsados = new Map<ProductoServicio['id'], number>()

  for (const { celdas, linea } of filas.slice(1)) {
    const celda = (campo: Campo): string | undefined => {
      const i = columna[campo]
      return i === undefined ? undefined : (celdas[i] ?? '').trim()
    }
    const avisos: string[] = []
    const errores: string[] = []

    const codigoBruto = celda('codigo')
    const codigo = codigoBruto && codigoBruto !== '0' ? codigoBruto : null
    const nombre = (celda('nombre') ?? '').replace(/\s+/g, ' ').trim()
    if (nombre === '0') continue
    if (!nombre && !codigo) {
      // Filas de relleno (todo en cero o vacío) se saltean sin ruido.
      const conDatos = celdas.some((c) => c.trim() !== '' && c.trim() !== '0' && !/^0([.,]0+)?$/.test(c.trim()))
      if (conDatos) resultado.push({ linea, accion: 'error', nombre: '', codigo: null, motivo: 'Falta el código o el nombre.', avisos, cambios: [] })
      continue
    }

    // Números
    const numero = (campo: Campo): number | undefined => {
      const bruto = celda(campo)
      if (bruto === undefined || bruto === '') return undefined
      const n = parsearNumero(bruto)
      if (n === 'invalido') { errores.push(`${ETIQUETA_CAMPO[campo]}: "${bruto}" no es un número.`); return undefined }
      if (n === null) return undefined
      if (n < 0) { errores.push(`${ETIQUETA_CAMPO[campo]} no puede ser negativo.`); return undefined }
      return n
    }
    let costoNuevo = numero('costo')
    const costoUsd = numero('costoUsd')
    let lista = numero('lista')
    const ventaUsd = numero('ventaUsd')
    const gan = numero('ganancia')
    const stock = numero('stock')
    const stockMinimo = numero('stockMinimo')
    const iva = numero('iva')

    // Moneda de la fila: con "USD" en la columna Moneda, los precios de compra y
    // de lista de la fila están en dólares. Sin columna Moneda, una fila con
    // columnas en USD también queda como producto en dólares.
    let costoUsdF = costoUsd
    let ventaUsdF = ventaUsd
    let monedaFila: 'ARS' | 'USD' | undefined
    const monedaBruta = celda('moneda')
    if (monedaBruta) {
      const m = normalizar(monedaBruta)
      if (/^(usd|us|dolar|dolares|u\$s|uss)/.test(m) || m === 'u') monedaFila = 'USD'
      else if (/^(ars|peso|pesos|\$)/.test(m) || m === '') monedaFila = 'ARS'
      else errores.push(`Moneda "${monedaBruta}" no válida (usá ARS o USD).`)
    }
    if (monedaFila === 'USD') {
      if (costoUsdF === undefined && costoNuevo !== undefined) { costoUsdF = costoNuevo; costoNuevo = undefined }
      if (ventaUsdF === undefined && lista !== undefined) { ventaUsdF = lista; lista = undefined }
    } else if (monedaFila === undefined && (costoUsd !== undefined || ventaUsd !== undefined)) {
      monedaFila = 'USD'
    }
    const costoUsdOriginal = costoUsdF
    if (costoUsdF !== undefined) {
      if (costoUsdF === 0) {
        avisos.push('Costo en USD igual a 0: se ignoró.')
      } else if (!(opciones.cotizacion > 0)) {
        errores.push('La hoja tiene costos en dólares: ingresá la cotización del dólar.')
      } else if (costoNuevo === undefined) {
        costoNuevo = dos(costoUsdF * opciones.cotizacion)
      }
    }
    if (ventaUsdF !== undefined) {
      if (ventaUsdF === 0) {
        avisos.push('Precio de venta en USD igual a 0: se ignoró.')
      } else if (!(opciones.cotizacion > 0)) {
        errores.push('La hoja tiene precio de venta en dólares: ingresá la cotización del dólar.')
      } else if (lista === undefined) {
        lista = dos(ventaUsdF * opciones.cotizacion)
      }
    }
    if (costoNuevo === 0) { costoNuevo = undefined; avisos.push('Costo igual a 0: se ignoró.') }
    if (lista === 0) lista = undefined
    if (iva !== undefined && !IVAS.includes(iva)) errores.push(`IVA ${iva}% no válido (usá 0, 10,5, 21 o 27).`)

    // Texto
    let tipoNuevo: 'producto' | 'servicio' | undefined
    const tipoBruto = celda('tipo')
    if (tipoBruto) {
      const t = normalizar(tipoBruto)
      if (t.startsWith('producto') || t === 'articulo' || t === 'material') tipoNuevo = 'producto'
      else if (t.startsWith('servicio') || t === 'manodeobra') tipoNuevo = 'servicio'
      else errores.push(`Tipo "${tipoBruto}" no válido (producto o servicio).`)
    }
    let unidad = celda('unidad') || undefined
    if (unidad) {
      const u = normalizar(unidad)
      if (UNIDADES.includes(u)) unidad = u
      else { avisos.push(`Unidad "${unidad}" no existe: se usa "unidad".`); unidad = 'unidad' }
    }
    const categoria = celda('categoria') || undefined
    const proveedor = celda('proveedor') || undefined
    const descripcion = celda('descripcion') || undefined
    const nombrePresupuesto = celda('nombrePresupuesto') || undefined
    let link = celda('link') || undefined
    if (link && !/^https?:\/\//i.test(link)) { avisos.push('El link no empieza con http: se ignoró.'); link = undefined }
    let foto = celda('foto') || undefined
    if (foto && !/^https?:\/\//i.test(foto)) { avisos.push('La foto no es un link http: se ignoró (subila desde la ficha del producto).'); foto = undefined }

    // ¿Existe ya en el catálogo?
    let existente: ProductoServicio | undefined
    let asignaCodigo = false
    if (codigo) {
      existente = porCodigo.get(codigo.toLowerCase())
      if (!existente && nombre) {
        // Primera importación con códigos: se adopta el producto del mismo nombre que no tiene código.
        const candidatos = (porNombre.get(normalizarNombre(nombre)) ?? []).filter((e) => !e.codigo)
        if (candidatos.length === 1) { existente = candidatos[0]; asignaCodigo = true }
        else if (candidatos.length > 1) errores.push('Hay varios productos sin código con ese nombre: asignales el código a mano.')
      }
    } else if (nombre) {
      const candidatos = porNombre.get(normalizarNombre(nombre)) ?? []
      if (candidatos.length === 1) existente = candidatos[0]
      else if (candidatos.length > 1) errores.push('Hay varios productos con ese nombre: usá el código.')
    }

    // Repetidos dentro del archivo
    if (codigo) {
      const antes = codigosVistos.get(codigo.toLowerCase())
      if (antes !== undefined) errores.push(`El código ya aparece en la línea ${antes}.`)
      else codigosVistos.set(codigo.toLowerCase(), linea)
    } else if (nombre) {
      const antes = nombresVistos.get(normalizarNombre(nombre))
      if (antes !== undefined) errores.push(`El nombre ya aparece en la línea ${antes} (sin código no se pueden distinguir).`)
      else nombresVistos.set(normalizarNombre(nombre), linea)
    }
    if (existente) {
      const antes = productosUsados.get(existente.id)
      if (antes !== undefined) errores.push(`Ese producto ya se actualiza con la línea ${antes}.`)
      else productosUsados.set(existente.id, linea)
    }

    if (errores.length) {
      resultado.push({ linea, accion: 'error', nombre: nombre || codigo || '', codigo, motivo: errores.join(' '), avisos, cambios: [] })
      continue
    }

    // Precio de lista
    const costoBase = costoNuevo ?? existente?.costo_unitario ?? 0
    let listaRecalculada = ''
    if (lista === undefined) {
      if (gan !== undefined) {
        if (costoBase > 0) {
          const p = precioDesdeGanancia(costoBase, gan, opciones.modo)
          if (p == null) { resultado.push({ linea, accion: 'error', nombre, codigo, motivo: 'Un margen de 100% o más no es posible.', avisos, cambios: [] }); continue }
          lista = dos(p)
          listaRecalculada = `${String(gan).replace('.', ',')}% de ${opciones.modo === 'margen' ? 'margen' : 'recargo'}`
        } else avisos.push('Sin costo no se puede calcular el precio con el % de ganancia.')
      } else if (existente) {
        if (opciones.recalcularPrecio && costoNuevo !== undefined && existente.costo_unitario > 0 && existente.precio_venta > 0 && Math.abs(costoNuevo - existente.costo_unitario) >= 0.005) {
          lista = dos((costoNuevo * existente.precio_venta) / existente.costo_unitario)
          const g = gananciaDesdePrecio(existente.costo_unitario, existente.precio_venta, opciones.modo)
          listaRecalculada = `manteniendo ${String(dos(g)).replace('.', ',')}% de ${opciones.modo === 'margen' ? 'margen' : 'recargo'}`
        }
      } else if (costoBase > 0 && opciones.gananciaNuevos != null) {
        const p = precioDesdeGanancia(costoBase, opciones.gananciaNuevos, opciones.modo)
        if (p != null) {
          lista = dos(p)
          listaRecalculada = `${String(opciones.gananciaNuevos).replace('.', ',')}% de ${opciones.modo === 'margen' ? 'margen' : 'recargo'} por defecto`
        }
      }
    }

    // Productos en dólares: se guardan también los valores en USD (así se
    // recalculan solos cuando cambia la cotización).
    const esUsd = monedaFila === 'USD' && opciones.cotizacion > 0
    const precioUsdFinal = esUsd ? (ventaUsdF !== undefined && ventaUsdF > 0 ? ventaUsdF : lista !== undefined ? dos(lista / opciones.cotizacion) : undefined) : undefined
    const costoUsdFinal = esUsd ? (costoUsdOriginal !== undefined && costoUsdOriginal > 0 ? costoUsdOriginal : undefined) : undefined
    const extrasMoneda: Record<string, unknown> = opciones.conMoneda === false ? {} : {
      ...(monedaFila ? { moneda: esUsd ? 'USD' : 'ARS' } : {}),
      ...(esUsd ? { costo_usd: costoUsdFinal ?? null, precio_usd: precioUsdFinal ?? null } : monedaFila === 'ARS' ? { costo_usd: null, precio_usd: null } : {}),
      ...(nombrePresupuesto !== undefined ? { nombre_presupuesto: nombrePresupuesto } : {}),
    }

    // ── Crear
    if (!existente) {
      if (!nombre) {
        resultado.push({ linea, accion: 'error', nombre: codigo ?? '', codigo, motivo: 'Producto nuevo sin nombre.', avisos, cambios: [] })
        continue
      }
      if (costoNuevo === undefined && lista === undefined) {
        resultado.push({ linea, accion: 'error', nombre, codigo, motivo: 'Sin precio: la hoja no trae costo ni precio de lista.', avisos, cambios: [] })
        continue
      }
      if (lista === undefined) avisos.push('Sin precio de lista: se crea con precio 0.')
      const cambios = [
        costoNuevo !== undefined ? `Compra ${dinero(costoNuevo)}` : '',
        lista !== undefined ? `Lista ${dinero(lista)}${listaRecalculada ? ` (${listaRecalculada})` : ''}` : '',
        stock !== undefined ? `Stock ${stock}` : '',
        esUsd ? `En dólares${precioUsdFinal ? ` (lista US$ ${precioUsdFinal})` : ''}` : '',
      ].filter(Boolean)
      resultado.push({
        linea, accion: 'crear', nombre, codigo, avisos, cambios,
        datos: {
          codigo, tipo: tipoNuevo ?? 'producto', nombre, descripcion: descripcion ?? null,
          categoria: categoria ?? null, proveedor: proveedor ?? null, link_compra: link ?? null,
          unidad: unidad ?? 'unidad', precio_venta: lista ?? 0, costo_unitario: costoNuevo ?? 0,
          stock: stock ?? 0, stock_minimo: stockMinimo ?? 5, iva_pct: iva ?? 21,
          foto_url: foto ?? null, aplica_descuento: false, descuento_pct: 0, descuento_monto: 0, activo: true,
          ...extrasMoneda,
        },
      })
      continue
    }

    // ── Actualizar: solo lo que venga completo y sea distinto
    const datos: Record<string, unknown> = {}
    const cambios: string[] = []
    const cambiaNum = (clave: string, etiqueta: string, nuevo: number | undefined, actual: number, formato: (n: number) => string, nota = '') => {
      if (nuevo === undefined || Math.abs(nuevo - actual) < 0.005) return
      datos[clave] = nuevo
      cambios.push(`${etiqueta} ${formato(actual)} → ${formato(nuevo)}${nota ? ` (${nota})` : ''}`)
    }
    const cambiaTxt = (clave: string, etiqueta: string, nuevo: string | undefined, actual: string | null) => {
      if (nuevo === undefined || nuevo === (actual ?? '')) return
      datos[clave] = nuevo
      cambios.push(`${etiqueta}: ${actual ? `${actual} → ` : ''}${nuevo}`)
    }
    if (asignaCodigo && codigo) { datos.codigo = codigo; cambios.push(`Se le asigna el código ${codigo}`) }
    if (nombre && nombre !== existente.nombre && codigo) cambiaTxt('nombre', 'Nombre', nombre, existente.nombre)
    if (tipoNuevo && tipoNuevo !== existente.tipo) { datos.tipo = tipoNuevo; cambios.push(`Tipo → ${tipoNuevo}`) }
    cambiaNum('costo_unitario', 'Compra', costoNuevo, existente.costo_unitario, dinero)
    cambiaNum('precio_venta', 'Lista', lista, existente.precio_venta, dinero, listaRecalculada)
    cambiaNum('stock', 'Stock', stock, existente.stock, (n) => String(n))
    cambiaNum('stock_minimo', 'Stock mín.', stockMinimo, existente.stock_minimo, (n) => String(n))
    cambiaNum('iva_pct', 'IVA', iva, existente.iva_pct, (n) => `${String(n).replace('.', ',')}%`)
    cambiaTxt('categoria', 'Categoría', categoria, existente.categoria)
    cambiaTxt('proveedor', 'Proveedor', proveedor, existente.proveedor)
    cambiaTxt('unidad', 'Unidad', unidad, existente.unidad)
    cambiaTxt('link_compra', 'Link', link, existente.link_compra)
    cambiaTxt('foto_url', 'Foto', foto, existente.foto_url)
    cambiaTxt('descripcion', 'Descripción', descripcion, existente.descripcion)
    cambiaTxt('nombre_presupuesto', 'En presupuesto', nombrePresupuesto, existente.nombre_presupuesto ?? null)
    if (opciones.conMoneda !== false && monedaFila && (esUsd ? 'USD' : 'ARS') !== existente.moneda) { datos.moneda = esUsd ? 'USD' : 'ARS'; cambios.push(`Moneda → ${esUsd ? 'USD' : 'ARS'}`) }
    if (opciones.conMoneda !== false && esUsd) {
      if (costoUsdFinal !== undefined && Math.abs(costoUsdFinal - (existente.costo_usd ?? 0)) >= 0.005) { datos.costo_usd = costoUsdFinal; cambios.push(`Compra US$ ${existente.costo_usd ?? 0} → ${costoUsdFinal}`) }
      if (precioUsdFinal !== undefined && Math.abs(precioUsdFinal - (existente.precio_usd ?? 0)) >= 0.005) { datos.precio_usd = precioUsdFinal; cambios.push(`Lista US$ ${existente.precio_usd ?? 0} → ${precioUsdFinal}`) }
    }

    resultado.push(
      cambios.length === 0
        ? { linea, accion: 'sinCambios', nombre: existente.nombre, codigo: codigo ?? existente.codigo, avisos, cambios, existente }
        : { linea, accion: 'actualizar', nombre: existente.nombre, codigo: codigo ?? existente.codigo, avisos, cambios, existente, datos },
    )
  }

  return { filas: resultado, columnasReconocidas: reconocidas, columnasIgnoradas: ignoradas }
}

// ───────────────────────────── Ejecución ─────────────────────────────

export type ResultadoImportacion = {
  creados: number
  actualizados: number
  fallidos: { linea: number; nombre: string; mensaje: string }[]
}

const mensajeError = (e: { code?: string; message?: string } | null) =>
  e?.code === '23505' ? 'Ya existe otro producto con ese código.' : e?.message || 'No se pudo guardar.'

// Filas que seguro traen datos (y, para actualizar, el producto existente).
// Con estos filtros tipados TypeScript sabe que datos/existente no son undefined.
type FilaConDatos = FilaPlan & { datos: Record<string, unknown> }
type FilaParaActualizar = FilaConDatos & { existente: ProductoServicio }

const esFilaParaCrear = (f: FilaPlan): f is FilaConDatos =>
  f.accion === 'crear' && f.datos !== undefined

const esFilaParaActualizar = (f: FilaPlan): f is FilaParaActualizar =>
  f.accion === 'actualizar' && f.datos !== undefined && f.existente !== undefined

export async function ejecutarImportacion(
  plan: Plan,
  alProgreso: (hechas: number, total: number) => void,
): Promise<ResultadoImportacion> {
  const crear = plan.filas.filter(esFilaParaCrear)
  const actualizar = plan.filas.filter(esFilaParaActualizar)
  const total = crear.length + actualizar.length
  const resultado: ResultadoImportacion = { creados: 0, actualizados: 0, fallidos: [] }
  let hechas = 0
  alProgreso(0, total)

  // Altas en tandas; si una tanda falla se reintenta fila por fila para saber cuál falló.
  // Los datos se arman dinámicamente, por eso se pasan con "as never" (evita que
  // TypeScript los compare contra el esquema tipado de Supabase y rompa el build).
  for (let i = 0; i < crear.length; i += 50) {
    const tanda = crear.slice(i, i + 50)
    const { error } = await supabase.from('productos_servicios').insert(tanda.map((f) => f.datos) as never)
    if (!error) {
      resultado.creados += tanda.length
    } else {
      for (const fila of tanda) {
        const uno = await supabase.from('productos_servicios').insert(fila.datos as never)
        if (uno.error) resultado.fallidos.push({ linea: fila.linea, nombre: fila.nombre, mensaje: mensajeError(uno.error) })
        else resultado.creados++
      }
    }
    hechas += tanda.length
    alProgreso(hechas, total)
  }

  // Cambios: varias a la vez.
  let siguiente = 0
  const trabajador = async () => {
    while (siguiente < actualizar.length) {
      const fila = actualizar[siguiente++]
      const { error } = await supabase.from('productos_servicios').update(fila.datos as never).eq('id', fila.existente.id)
      if (error) resultado.fallidos.push({ linea: fila.linea, nombre: fila.nombre, mensaje: mensajeError(error) })
      else resultado.actualizados++
      hechas++
      alProgreso(hechas, total)
    }
  }
  await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()])

  return resultado
}

// ───────────────────────────── Plantilla ─────────────────────────────

export function plantillaCsv(): string {
  const filas = [
    ['codigo', 'nombre', 'tipo', 'categoria', 'proveedor', 'unidad', 'precio_compra', 'precio_compra_usd', '% de ganancia', 'precio_lista', 'stock', 'stock_minimo', 'iva', 'link_compra', 'descripcion'],
    ['MINI-LN-01W', 'Mini Switch Wifi 1 Canal', 'producto', 'Módulos y llaves', 'Qisfeel', 'unidad', '', '5,01', '50', '', '10', '5', '10,5', '', ''],
    ['INST-001', 'Instalación por boca', 'servicio', 'Mano de obra', '', 'boca', '', '', '', '18000', '', '', '21', '', 'Colocación y configuración'],
  ]
  // "\uFEFF" = marca BOM, para que Excel abra el CSV con tildes correctas.
  return '\uFEFF' + filas.map((f) => f.join(';')).join('\r\n') + '\r\n'
}

// Plantilla en Excel: hoja "Productos" con ejemplos y hoja "Instrucciones".
export function descargarPlantillaXlsx() {
  const encabezados = ['Código', 'Nombre', 'Nombre en presupuesto', 'Tipo', 'Categoría', 'Proveedor', 'Unidad', 'Moneda', 'Precio de compra', '% de ganancia', 'Precio de lista', 'Stock', 'Stock mínimo', 'IVA', 'Link de compra', 'Foto (link)', 'Descripción']
  const ejemplos = [
    ['DECO-X20-3', 'TP-Link Deco X20 AX1800 (pack x3)', 'Red mesh WiFi 6', 'producto', 'Redes', 'TP-Link', 'kit', 'USD', 180, 40, '', 4, 1, 21, '', '', 'Cobertura 550 m². Configurar en modo router.'],
    ['SON-4CH', 'Sonoff 4CH R3', 'Domótica de iluminación', 'producto', 'Domótica', 'Sonoff', 'unidad', 'USD', 18.5, '', 35, 12, 5, 21, '', '', 'Módulo 4 canales WiFi, 10A por canal.'],
    ['RIEGO-8Z', 'Controlador de riego WiFi 8 zonas', 'Domótica para riego', 'producto', 'Riego', 'Tuya', 'unidad', 'ARS', 95000, 45, '', 3, 1, 21, '', '', ''],
    ['INST-BOCA', 'Instalación por boca', 'Instalación y configuración', 'servicio', 'Mano de obra', '', 'boca', 'ARS', '', '', 18000, '', '', 21, '', '', 'Colocación, cableado y puesta en marcha.'],
  ]
  const hoja = XLSX.utils.aoa_to_sheet([encabezados, ...ejemplos])
  hoja['!cols'] = encabezados.map((h) => ({ wch: Math.max(12, h.length + 2) }))
  const instrucciones = [
    ['Cómo completar la plantilla'],
    [''],
    ['• Una fila por producto o servicio. Solo "Código" o "Nombre" son obligatorios.'],
    ['• Si el código ya existe en la app, se actualiza solo lo que completes; si no existe, se crea.'],
    ['• Nombre: nombre interno (marca, modelo). "Nombre en presupuesto": lo único que ve el cliente (ej.: Red mesh WiFi 6).'],
    ['• Tipo: producto o servicio.  Unidad: unidad, metro, hora, servicio, kit, boca o circuito.'],
    ['• Moneda: ARS o USD. Con USD, "Precio de compra" y "Precio de lista" van en dólares y el precio en pesos se actualiza solo con la cotización.'],
    ['• Precio de lista: si lo dejás vacío y ponés "% de ganancia", se calcula desde el precio de compra.'],
    ['• IVA: 0, 10,5, 21 o 27.  Stock mínimo: con cuánto stock te avisa que falta reponer.'],
    ['• Descripción: detalle interno, no sale en el presupuesto. Las fotos se suben desde la ficha de cada producto (o un link en "Foto (link)").'],
    ['• Borrá las filas de ejemplo antes de subir, o cambialas por tus productos.'],
  ]
  const hojaInst = XLSX.utils.aoa_to_sheet(instrucciones)
  hojaInst['!cols'] = [{ wch: 120 }]
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Productos')
  XLSX.utils.book_append_sheet(libro, hojaInst, 'Instrucciones')
  XLSX.writeFile(libro, 'plantilla-productos-mova.xlsx')
}

// Texto pegado (desde Excel, una web o un PDF): filas por línea y columnas por
// tabulación, punto y coma o 2+ espacios.
export function filasDesdeTextoPegado(texto: string): FilaCruda[] {
  if (texto.includes('\t') || texto.includes(';')) return parsearCsv(texto)
  return texto.split(/\r?\n/).map((l, i) => ({ celdas: l.trim().split(/\s{2,}/), linea: i + 1 })).filter((f) => f.celdas.some((c) => c.trim()))
}

// PDF (lista de precios de un proveedor): se extrae el texto de cada página y
// se arma una tabla por posición (misma altura = misma fila; separación grande
// = otra columna). Se busca la fila de títulos para empezar. Es aproximado:
// siempre se revisa el resultado antes de importar.
export async function leerFilasDesdePdf(archivo: File): Promise<FilaCruda[]> {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()), isEvalSupported: false }).promise
  const filas: FilaCruda[] = []
  let linea = 1
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n)
    const contenido = await pagina.getTextContent()
    type Trozo = { x: number; y: number; w: number; t: string }
    const trozos: Trozo[] = (contenido.items as { str: string; transform: number[]; width: number }[])
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, t: it.str.trim() }))
    trozos.sort((a, b) => b.y - a.y || a.x - b.x)
    const renglones: Trozo[][] = []
    for (const t of trozos) {
      const r = renglones.find((g) => Math.abs(g[0].y - t.y) < 3)
      if (r) r.push(t); else renglones.push([t])
    }
    for (const r of renglones) {
      r.sort((a, b) => a.x - b.x)
      const celdas: string[] = []
      let fin = -Infinity
      for (const t of r) {
        if (celdas.length && t.x - fin < 8) celdas[celdas.length - 1] += ` ${t.t}`
        else celdas.push(t.t)
        fin = t.x + t.w
      }
      filas.push({ celdas, linea: linea++ })
    }
  }
  // Empieza en la primera fila que parezca de títulos (tiene nombre/código/producto).
  const clave = new Set([...ALIAS.codigo, ...ALIAS.nombre].map(normalizar))
  const inicio = filas.findIndex((f) => f.celdas.some((c) => clave.has(normalizar(c))))
  return inicio >= 0 ? filas.slice(inicio) : filas
}
