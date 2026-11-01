import { supabase } from './supabase'

// Nombre claro de cada obra para elegirla o mostrarla: "Cliente · título del
// presupuesto aceptado" (si no hay presupuesto aceptado, el nombre de la obra).
// Sirve para distinguir obras con el mismo nombre ("Casa particular").
export type ObraEtiqueta = { id: number; activo: boolean; cliente: string; titulo: string; etiqueta: string }

export async function cargarEtiquetasObras(): Promise<ObraEtiqueta[]> {
  const [rO, rC, rP] = await Promise.all([
    supabase.from('obras').select('id,nombre_obra,cliente_id,activo'),
    supabase.from('Clientes').select('id,nombre,apellido'),
    supabase.from('presupuestos').select('obra_id,titulo,estado,activo,fecha').not('obra_id', 'is', null),
  ])
  const clientes = (rC.data ?? []) as { id: number; nombre: string | null; apellido: string | null }[]
  const pres = ((rP.data ?? []) as { obra_id: number; titulo: string | null; estado: string; activo: boolean | null; fecha: string | null }[])
    .filter((p) => p.activo !== false).sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
  return ((rO.data ?? []) as { id: number; nombre_obra: string; cliente_id: number | null; activo: boolean | null }[]).map((o) => {
    const c = clientes.find((x) => x.id === o.cliente_id)
    const cliente = c ? `${c.nombre ?? ''} ${c.apellido ?? ''}`.trim() : ''
    const p = pres.find((x) => x.obra_id === o.id && x.estado === 'aceptado') ?? pres.find((x) => x.obra_id === o.id)
    const titulo = (p?.titulo ?? '').trim() || o.nombre_obra
    const sufijo = titulo.toLowerCase() !== o.nombre_obra.toLowerCase() ? ` (${o.nombre_obra})` : ''
    return { id: o.id, activo: o.activo !== false, cliente, titulo, etiqueta: `${cliente ? `${cliente} · ` : ''}${titulo}${sufijo}` }
  }).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta))
}
