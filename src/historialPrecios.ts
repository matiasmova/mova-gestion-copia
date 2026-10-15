import { supabase } from './supabase'

// Historial de precios del catálogo (SQL fase 31). El registro lo hace la base
// sola en cada cambio; desde la app solo se avisa de dónde vino el cambio.

export type OrigenPrecio = 'alta' | 'catalogo' | 'mercado' | 'manual' | 'importacion' | 'cotizacion'

export const ETIQUETA_ORIGEN: Record<string, string> = {
  alta: '🆕 Alta del producto',
  catalogo: '✏️ Editado en el catálogo',
  mercado: '📈 Precio del mercado',
  manual: '✍️ Cargado a mano al comparar',
  importacion: '📥 Importación de lista',
  cotizacion: '💲 Actualización del dólar',
}

export type CambioPrecio = {
  id: number
  fecha: string
  precio_anterior: number | null
  precio_nuevo: number | null
  costo_anterior: number | null
  costo_nuevo: number | null
  origen: string
  nota: string | null
  usuario: string | null
}

// Actualiza un producto avisando el origen del cambio de precio. Si todavía no
// se corrió el SQL del historial, guarda igual (sin el aviso).
export async function actualizarProducto(id: number, datos: Record<string, unknown>, origen: OrigenPrecio, nota?: string | null) {
  const r = await supabase.from('productos_servicios').update({ ...datos, precio_origen: origen, precio_nota: nota ?? null }).eq('id', id)
  if (r.error && /precio_origen|precio_nota/.test(r.error.message ?? '')) return supabase.from('productos_servicios').update(datos).eq('id', id)
  return r
}

// null = falta correr el SQL de la fase 31.
export async function cargarHistorialPrecios(productoId: number): Promise<CambioPrecio[] | null> {
  const { data, error } = await supabase.from('productos_precios_historial').select('id, fecha, precio_anterior, precio_nuevo, costo_anterior, costo_nuevo, origen, nota, usuario').eq('producto_id', productoId).order('fecha', { ascending: false }).limit(100)
  if (error) { console.error(error); return null }
  const n = (x: unknown) => (x == null ? null : Number(x))
  return ((data ?? []) as CambioPrecio[]).map((c) => ({ ...c, precio_anterior: n(c.precio_anterior), precio_nuevo: n(c.precio_nuevo), costo_anterior: n(c.costo_anterior), costo_nuevo: n(c.costo_nuevo) }))
}
