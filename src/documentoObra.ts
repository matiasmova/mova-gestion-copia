import { supabase } from './supabase'
import { completarDatosDocumento, type DatosPdf } from './pdfPresupuesto'
import { normalizarSoluciones } from './presupuestoSoluciones'
import { importeNeto } from './presupuestoCalculos'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import type { ProductoAComparar } from './CompararMercado'

// Datos completos del documento del cliente de una obra (presupuesto aceptado
// + estado de obra). Lo usan el panel de la obra y la vista del documento.
export async function cargarDocumentoObra(obra: { id: number; nombre_obra: string }, cliente: string): Promise<DatosPdf> {
  const r = await supabase.from('presupuestos').select('*').eq('obra_id', obra.id).eq('estado', 'aceptado').order('id')
  if (r.error) throw r.error
  const p = r.data?.find((x) => x.activo !== false)
  if (!p) throw new Error('Esta obra no tiene un presupuesto aceptado activo. Vinculá uno para generar el documento.')
  const it = await supabase.from('presupuesto_items').select('*').eq('presupuesto_id', p.id).order('orden')
  if (it.error) throw it.error
  const base: DatosPdf = {
    id: Number(p.id), titulo: p.titulo, descripcion: p.descripcion ?? null, fecha: p.fecha,
    validez_dias: p.validez_dias ?? null, notas: p.notas ?? null, total: Number(p.total), subtotal: Number(p.subtotal), descuento: Number(p.descuento),
    items: (it.data ?? []).map((i) => ({ ...i, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario), costo_unitario: Number(i.costo_unitario || 0), descuento_pct: Number(i.descuento_pct || 0) })) as ItemPresupuesto[],
    cliente, obra: obra.nombre_obra, soluciones: normalizarSoluciones(p.soluciones),
  }
  return completarDatosDocumento(base)
}

// Ítems del presupuesto con el precio por unidad que paga el cliente (para comparar con el mercado).
export function itemsParaMercado(d: DatosPdf): ProductoAComparar[] {
  const neto = d.items.reduce((t, it) => t + importeNeto(it), 0)
  const factor = neto > 0 ? Number(d.total) / neto : 1
  return d.items.filter((it) => it.descripcion.trim() && Number(it.cantidad) > 0).slice(0, 24).map((it) => ({
    id: it.catalogo_id ? Number(it.catalogo_id) : null, nombre: it.descripcion.split('\n')[0].trim(), tipo: it.tipo,
    cantidad: Number(it.cantidad), costo: Number(it.costo_unitario) || 0,
    precio: Math.round((importeNeto(it) / Number(it.cantidad)) * factor * 100) / 100,
  }))
}
