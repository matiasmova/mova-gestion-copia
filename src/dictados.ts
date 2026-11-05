import { supabase } from './supabase'
import { pedirAsistente } from './asistenteIA'
import { entenderFrase, isoLocal } from './agendaFrase'
import { crearEvento } from './agendaEventos'

// Dictado rápido de "Para hacer": lo que dictás (o escribís) va a un destino
// (recordatorio, pendiente de obra, cambio en la obra, pago, compra o nota).
// Queda "para revisar" en la tabla "dictados" (SQL fase 44) hasta que lo
// cargás definitivo o lo descartás.

export type Destino = 'recordatorio' | 'pendObra' | 'modObra' | 'pago' | 'compra' | 'nota'
export type ItemDictado = { descripcion: string; cantidad: number; precio: number; catalogo_id?: number | null }
export type DatosDictado = {
  titulo: string
  obra_id: number | null
  fecha: string | null
  hora: string | null
  personal_id: number | null
  monto: number
  items: ItemDictado[]
  resumen?: string
  aprobado?: boolean // cambio en la obra: el cliente ya lo aprobó
  sugerido?: Destino // lo que propuso la IA
}
export type Dictado = { id: number; texto: string; destino: Destino; datos: DatosDictado; created_at: string }

export const DESTINOS: Record<Destino, { icono: string; nombre: string; ayuda: string }> = {
  recordatorio: { icono: '🔔', nombre: 'Recordatorio', ayuda: 'a la agenda, con día y hora' },
  pendObra: { icono: '🏗️', nombre: 'Pendiente de obra', ayuda: 'algo para hacer en una obra' },
  modObra: { icono: '✏️', nombre: 'Cambio en la obra', ayuda: 'agrega o quita ítems (extra)' },
  pago: { icono: '👷', nombre: 'Pago al personal', ayuda: 'a quién, cuánto y qué obra' },
  compra: { icono: '🛒', nombre: 'Compra', ayuda: 'lista de materiales a comprar' },
  nota: { icono: '📝', nombre: 'Nota', ayuda: 'una idea suelta' },
}

export const datosVacios = (texto = ''): DatosDictado => ({ titulo: texto.slice(0, 160), obra_id: null, fecha: null, hora: null, personal_id: null, monto: 0, items: [] })
const hoy = () => isoLocal(new Date())

// La IA decide a dónde va y saca los datos. Sin IA, se arma lo básico con la frase.
export async function interpretar(texto: string, obras: { id: number; etiqueta: string }[], personas: { id: number; nombre: string }[]): Promise<{ destino: Destino; datos: DatosDictado; conIA: boolean }> {
  try {
    const dia = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const r = await pedirAsistente<{ destino: Destino; titulo: string; obra_id: number | null; fecha: string | null; hora: string | null; personal_id: number | null; monto: number; items: ItemDictado[]; resumen: string }>({ accion: 'dictado', texto, hoy: `${hoy()} (${dia})`, obras, personas })
    return { destino: r.destino, conIA: true, datos: { titulo: r.titulo, obra_id: r.obra_id, fecha: r.fecha, hora: r.hora, personal_id: r.personal_id, monto: Number(r.monto) || 0, items: r.items ?? [], resumen: r.resumen, sugerido: r.destino } }
  } catch (e) {
    console.error(e)
    const f = entenderFrase(texto, [], obras.map((o) => ({ id: o.id, nombre: o.etiqueta })))
    const conDia = !!f.hora || f.fecha !== hoy()
    const destino: Destino = conDia ? 'recordatorio' : f.obra_id ? 'pendObra' : 'nota'
    return { destino, conIA: false, datos: { ...datosVacios(f.titulo || texto), obra_id: f.obra_id, fecha: conDia ? f.fecha : null, hora: f.hora, sugerido: destino } }
  }
}

// ---------- Para revisar ----------
export async function cargarParaRevisar(): Promise<{ lista: Dictado[]; falta: boolean }> {
  const { data, error } = await supabase.from('dictados').select('id,texto,destino,datos,created_at').eq('estado', 'revisar').order('created_at', { ascending: false })
  if (error) return { lista: [], falta: true }
  return { lista: ((data ?? []) as Dictado[]).map((d) => ({ ...d, datos: { ...datosVacios(d.texto), ...d.datos } })), falta: false }
}
export async function guardarParaRevisar(d: { id?: number; texto: string; destino: Destino; datos: DatosDictado }): Promise<string | null> {
  const fila = { texto: d.texto, destino: d.destino, datos: d.datos, estado: 'revisar' }
  const r = d.id ? await supabase.from('dictados').update(fila).eq('id', d.id) : await supabase.from('dictados').insert(fila)
  if (r.error) { console.error(r.error); return /dictados/.test(r.error.message) ? 'Falta correr en Supabase el SQL supabase-dictados-fase-44.sql para guardar dictados para revisar. Mientras tanto usá "Cargar ahora".' : 'No se pudo guardar. Probá de nuevo.' }
  return null
}
export async function cambiarEstado(id: number, estado: 'revisar' | 'cargado' | 'descartado') {
  const { error } = await supabase.from('dictados').update({ estado }).eq('id', id)
  return error ? 'No se pudo actualizar.' : null
}

// ---------- Cargar definitivo ----------
// Devuelve el texto para avisar qué se hizo, o lanza un Error con lo que falta.
export async function cargarDefinitivo(texto: string, destino: Destino, d: DatosDictado): Promise<string> {
  const titulo = (d.titulo || texto).trim()
  if (destino === 'recordatorio' || destino === 'pendObra') {
    if (destino === 'pendObra' && !d.obra_id) throw new Error('Elegí la obra.')
    const fecha = d.fecha || hoy()
    const fallo = await crearEvento({ titulo, fecha, hora: d.hora || null, tipo: 'recordatorio', cliente_id: null, obra_id: d.obra_id, aviso_min: destino === 'recordatorio' ? 60 : null, detalle: destino === 'pendObra' ? `Pendiente de obra. ${texto}` : texto })
    if (fallo) throw new Error(fallo)
    return destino === 'recordatorio' ? `Agendado para el ${fecha.split('-').reverse().join('/')}${d.hora ? ` a las ${d.hora}` : ''}` : 'Quedó como pendiente de la obra en Para hacer'
  }
  if (destino === 'modObra') {
    if (!d.obra_id) throw new Error('Elegí la obra.')
    const items = d.items.filter((it) => it.descripcion.trim() && Number(it.cantidad))
    if (!items.length) throw new Error('Cargá al menos un ítem con cantidad.')
    const { data: pres } = await supabase.from('presupuestos').select('id,estado,activo').eq('obra_id', d.obra_id)
    const aceptado = ((pres ?? []) as { id: number; estado: string; activo: boolean | null }[]).find((p) => p.estado === 'aceptado' && p.activo !== false)
    if (!aceptado) throw new Error('Esa obra no tiene un presupuesto aceptado: el cambio se carga sobre el presupuesto aceptado.')
    const filas = items.map((it) => {
      const cant = Number(it.cantidad), precio = Math.round((Number(it.precio) || 0) * 100) / 100
      return {
        obra_id: d.obra_id, tipo: 'cambio', cambio_tipo: 'agregado', descripcion: it.descripcion.trim(), motivo: 'Dictado rápido', importe: Math.round(cant * precio * 100) / 100,
        fecha: hoy(), observaciones: null, estado: d.aprobado ? 'aprobado' : 'pendiente', presupuesto_id: aceptado.id, item_id: null,
        cantidad_nueva: cant, precio_nuevo: precio,
      }
    })
    const { error } = await supabase.from('adicionales').insert(filas)
    if (error) { console.error(error); throw new Error('No se pudo cargar el cambio en la obra.') }
    return d.aprobado ? 'Cambio cargado en la obra: el total se actualizó' : 'Cambio cargado: espera que el cliente lo apruebe'
  }
  if (destino === 'pago') {
    if (!d.personal_id) throw new Error('Elegí a quién le pagaste.')
    if (!(d.monto > 0)) throw new Error('Poné el monto del pago.')
    const { data: per } = await supabase.from('personal').select('nombre,apellido,tipo').eq('id', d.personal_id).maybeSingle()
    const p = per as { nombre: string; apellido: string | null; tipo: string } | null
    const nombre = p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : 'personal'
    const { error } = await supabase.from('costos').insert({ obra_id: d.obra_id, personal_id: d.personal_id, tipo: p?.tipo === 'terciarizado' ? 'terciarizado' : 'mano_obra', descripcion: `Pago a ${nombre}${d.titulo && !/^pag/i.test(d.titulo) ? ` · ${d.titulo}` : ''}`, monto: d.monto, fecha: d.fecha || hoy() })
    if (error) { console.error(error); throw new Error(d.obra_id == null && /null|obra_id/i.test(error.message) ? 'Para pagos sin obra falta el SQL de la fase 42. Elegí una obra.' : 'No se pudo cargar el pago.') }
    return `Pago a ${nombre} cargado en Personal`
  }
  // Compra o nota: van a Notas.
  const lineas = d.items.filter((it) => it.descripcion.trim()).map((it) => `• ${Number(it.cantidad) || 1} × ${it.descripcion.trim()}`)
  const textoNota = destino === 'compra' ? `🛒 Comprar: ${titulo}${lineas.length ? `\n${lineas.join('\n')}` : ''}` : titulo
  const { error } = await supabase.from('notas').insert({ texto: textoNota, fecha: d.fecha, hora: d.hora, aviso: !!d.fecha })
  if (error) { console.error(error); throw new Error(/notas/.test(error.message) ? 'Falta el SQL de Notas (fase 39) en Supabase.' : 'No se pudo guardar la nota.') }
  return destino === 'compra' ? 'Sumado a Notas como compra' : 'Nota guardada'
}
