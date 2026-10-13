import { supabase } from './supabase'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import { importeNeto, partirDescripcion } from './presupuestoCalculos'

// "Cómo lo ve el cliente": el presupuesto puede ir Detallado (ítem por ítem, con
// precios) o Resumido (un texto por sección y su total, sin precio por ítem).
// Cada sección (Materiales, Mano de obra…) se puede dividir en partes, por
// ejemplo "Planta baja" y "Planta alta", cada una con su texto.
// Los ítems se asignan a una parte por su posición en el presupuesto.

export type ParteResumen = { id: string; nombre: string; texto: string; incluye: string[] }
export type ResumenDoc = {
  modo: 'detallado' | 'resumido'
  cantidades: boolean
  marca: boolean
  subtotales: boolean
  grupos: Record<string, ParteResumen[]>
  asignacion: Record<string, string>
}

export const PARTE_UNICA = 'Todo'

export const resumenVacio = (): ResumenDoc => ({ modo: 'detallado', cantidades: true, marca: false, subtotales: true, grupos: {}, asignacion: {} })

// Lo guardado puede venir incompleto o de una versión anterior: se completa.
export function normalizarResumen(x: unknown): ResumenDoc {
  const base = resumenVacio()
  if (!x || typeof x !== 'object') return base
  const o = x as Partial<ResumenDoc>
  const grupos: Record<string, ParteResumen[]> = {}
  for (const [k, v] of Object.entries(o.grupos ?? {})) {
    if (!Array.isArray(v)) continue
    grupos[k] = v.filter((p) => p && typeof p.id === 'string').map((p) => ({
      id: p.id, nombre: String(p.nombre ?? ''), texto: String(p.texto ?? ''),
      incluye: Array.isArray(p.incluye) ? p.incluye.map(String).filter((s) => s.trim()) : [],
    }))
  }
  return {
    modo: o.modo === 'resumido' ? 'resumido' : 'detallado',
    cantidades: o.cantidades !== false, marca: o.marca === true, subtotales: o.subtotales !== false,
    grupos, asignacion: o.asignacion && typeof o.asignacion === 'object' ? { ...o.asignacion } : {},
  }
}

// Lee el resumen guardado del presupuesto (null si no hay o falta el SQL).
export async function cargarResumenDoc(id: number): Promise<ResumenDoc | null> {
  try {
    const { data, error } = await supabase.from('presupuestos').select('resumen_doc').eq('id', id).maybeSingle()
    if (error || !data?.resumen_doc) return null
    return normalizarResumen(data.resumen_doc)
  } catch { return null }
}

// Las partes de una sección, con sus ítems. Siempre hay al menos una.
export function partesConItems(r: ResumenDoc, clave: string, itemsGrupo: ItemPresupuesto[], todos: ItemPresupuesto[]) {
  const partes = r.grupos[clave]?.length ? r.grupos[clave] : [{ id: `${clave}-1`, nombre: PARTE_UNICA, texto: '', incluye: [] }]
  const salida = partes.map((p) => ({ ...p, items: [] as ItemPresupuesto[] }))
  for (const it of itemsGrupo) {
    const pid = r.asignacion[String(todos.indexOf(it))]
    ;(salida.find((p) => p.id === pid) ?? salida[0]).items.push(it)
  }
  return salida
}

export const totalItems = (items: ItemPresupuesto[]) => items.reduce((s, it) => s + importeNeto(it), 0)

// Lo que se lista en "Incluye" cuando todavía no hay un texto escrito.
// Sin marca ni modelo y con texto escrito, no se listan los nombres exactos.
export function incluyeDe(p: { incluye: string[]; texto: string; items: ItemPresupuesto[] }, r: ResumenDoc): string[] {
  if (p.incluye.length) return p.incluye
  if (!r.marca && p.texto.trim()) return []
  return p.items.map((it) => {
    const t = partirDescripcion(it.descripcion).titulo
    return r.cantidades ? `${Number(it.cantidad).toLocaleString('es-AR')} × ${t}` : t
  })
}
