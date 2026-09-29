import { supabase } from './supabase'
import { CONDICIONES_GENERALES } from './condicionesGenerales'

// Configuración de la app (tabla "configuracion": clave → valor json).
// Se carga una vez al iniciar sesión y queda en memoria para los PDF y
// documentos. Si la tabla no existe o falta un dato, se usan los valores de
// siempre (DEFAULTS), así nada se rompe.

export type Condicion = { titulo: string; texto: string }

export type Empresa = {
  nombre: string
  lema: string
  cuit: string
  direccion: string
  telefono: string
  email: string
  web: string
  instagram: string
}

export type ConfigApp = {
  empresa: Empresa
  presupuestos: { validezDias: number; condiciones: Condicion[] }
  accesos: { aviso: string[] }
  // Pesos por dólar, compartida por todos los usuarios (la usa el catálogo).
  cotizacion: { usd: number; fecha: string | null; fuente: string | null }
}

export const DEFAULTS: ConfigApp = {
  empresa: {
    nombre: 'MOVA Tecnología Smart',
    lema: 'Espacios inteligentes',
    cuit: '',
    direccion: '',
    telefono: '+54 9 261 555 7970',
    email: '',
    web: 'www.movaelectronica.com.ar',
    instagram: '@mova.smart',
  },
  cotizacion: { usd: 0, fecha: null, fuente: null },
  presupuestos: { validezDias: 15, condiciones: CONDICIONES_GENERALES.map((c) => ({ ...c })) },
  accesos: {
    aviso: [
      'Las contraseñas de este documento fueron creadas por el instalador durante la puesta en marcha de los equipos. Por seguridad, recomendamos modificarlas desde cada aplicación para proteger sus datos y su privacidad.',
      'Si lo prefiere, puede conservarlas tal como están. MOVA es una empresa confiable que resguarda la integridad de sus clientes y no utiliza estos datos con otro fin que la instalación y el soporte técnico solicitado.',
      'Una vez entregado este documento, el cliente es el único responsable de su custodia y del uso de las cuentas. MOVA no se responsabiliza por accesos no autorizados, pérdidas, daños o inconvenientes derivados del uso, divulgación o falta de modificación de estas credenciales.',
    ],
  },
}

let actual: ConfigApp = DEFAULTS
let tablaOk: boolean | null = null

export const configActual = () => actual
export const configTablaDisponible = () => tablaOk

export async function cargarConfig(): Promise<ConfigApp> {
  const { data, error } = await supabase.from('configuracion').select('clave, valor')
  if (error) { tablaOk = false; return actual }
  tablaOk = true
  const filas = Object.fromEntries((data ?? []).map((f: { clave: string; valor: unknown }) => [f.clave, f.valor])) as Partial<ConfigApp>
  actual = {
    empresa: { ...DEFAULTS.empresa, ...(filas.empresa ?? {}) },
    presupuestos: { ...DEFAULTS.presupuestos, ...(filas.presupuestos ?? {}) },
    accesos: { ...DEFAULTS.accesos, ...(filas.accesos ?? {}) },
    cotizacion: { ...DEFAULTS.cotizacion, ...(filas.cotizacion ?? {}) },
  }
  return actual
}

export async function guardarConfig<K extends keyof ConfigApp>(clave: K, valor: ConfigApp[K]) {
  const { error } = await supabase.from('configuracion').upsert({ clave, valor, updated_at: new Date().toISOString() })
  if (error) throw error
  actual = { ...actual, [clave]: valor }
}

// Línea de contacto del pie de los documentos: web · IG · teléfono (lo que esté cargado).
export function lineaContacto(e: Empresa = actual.empresa) {
  return [e.web, e.instagram ? `IG ${e.instagram}` : '', e.telefono, e.email].filter(Boolean).join(' · ')
}

// Texto de una condición: "Variaciones de precios" usa la validez del presupuesto.
export function textoCondicion(c: Condicion, validezDias: number | null | undefined) {
  if (c.titulo.trim().toLowerCase() === 'variaciones de precios') {
    return c.texto.replace(/\d+\s+días/, `${validezDias ?? actual.presupuestos.validezDias} días`)
  }
  return c.texto
}
