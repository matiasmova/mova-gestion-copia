import { supabase } from './supabase'

// Eliminación completa de una obra y todo lo que cuelga de ella.
// Los avances, fotos, compras, costos, adicionales, jornales, personal y
// notificaciones se borran solos al borrar la obra (cascade). Los cobros
// bloquean el borrado, por eso se eliminan dentro de la función de Supabase
// `eliminar_obra_completa`, que hace todo en una sola transacción.

export type ResumenObra = {
  cobrado: number
  cantidadCobros: number
  avances: number
  fotos: number
  compras: number
  costos: number
  adicionales: number
  jornales: number
  personal: number
  presupuestos: { id: number; estado: string }[]
}

export type ResultadoEliminacion =
  | { ok: true; presupuestosAceptados: number }
  | { ok: false; mensaje: string }

async function contar(tabla: string, obraId: number): Promise<number> {
  const { count, error } = await supabase
    .from(tabla)
    .select('*', { count: 'exact', head: true })
    .eq('obra_id', obraId)

  if (error) throw error

  return count ?? 0
}

async function presupuestosDeObra(obraId: number) {
  const { data, error } = await supabase
    .from('presupuestos')
    .select('id, estado')
    .eq('obra_id', obraId)

  if (error) throw error

  return (data ?? []) as { id: number; estado: string }[]
}

// Cobros de la obra: los registrados en la obra y los registrados
// en sus presupuestos.
function filtroCobros(obraId: number, presupuestoIds: number[]) {
  const filtros = [`obra_id.eq.${obraId}`]

  if (presupuestoIds.length > 0) {
    filtros.push(`presupuesto_id.in.(${presupuestoIds.join(',')})`)
  }

  return filtros.join(',')
}

// Cuenta lo que se va a borrar, para mostrarlo antes de confirmar.
export async function resumenEliminacionObra(
  obraId: number,
): Promise<ResumenObra> {
  const presupuestos = await presupuestosDeObra(obraId)

  const cobros = await supabase
    .from('pagos')
    .select('id, monto')
    .or(
      filtroCobros(
        obraId,
        presupuestos.map((p) => p.id),
      ),
    )

  if (cobros.error) throw cobros.error

  const filasCobros = (cobros.data ?? []) as { id: number; monto: number }[]

  const [avances, fotos, compras, costos, adicionales, jornales, personal] =
    await Promise.all([
      contar('obra_avances', obraId),
      contar('obra_imagenes', obraId),
      contar('materiales', obraId),
      contar('costos', obraId),
      contar('adicionales', obraId),
      contar('jornales', obraId),
      contar('obra_asignaciones', obraId),
    ])

  return {
    cobrado: filasCobros.reduce((suma, c) => suma + Number(c.monto || 0), 0),
    cantidadCobros: filasCobros.length,
    avances,
    fotos,
    compras,
    costos,
    adicionales,
    jornales,
    personal,
    presupuestos,
  }
}

const dinero = (valor: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(valor)

// Texto de la confirmación con el detalle de lo que se elimina.
export function mensajeEliminacionObra(
  nombre: string,
  r: ResumenObra,
  intro?: string,
): string {
  const detalle: string[] = []

  if (r.cantidadCobros > 0) {
    detalle.push(
      `• ${r.cantidadCobros} cobro${r.cantidadCobros === 1 ? '' : 's'} registrado${
        r.cantidadCobros === 1 ? '' : 's'
      } por ${dinero(r.cobrado)}`,
    )
  }
  if (r.avances > 0) detalle.push(`• ${r.avances} avance${r.avances === 1 ? '' : 's'} del seguimiento`)
  if (r.fotos > 0) detalle.push(`• ${r.fotos} foto${r.fotos === 1 ? '' : 's'}`)
  if (r.compras > 0) detalle.push(`• ${r.compras} compra${r.compras === 1 ? '' : 's'} de materiales`)
  if (r.costos > 0) detalle.push(`• ${r.costos} costo${r.costos === 1 ? '' : 's'}`)
  if (r.adicionales > 0) detalle.push(`• ${r.adicionales} adicional${r.adicionales === 1 ? '' : 'es'}`)
  if (r.jornales > 0) detalle.push(`• ${r.jornales} jornal${r.jornales === 1 ? '' : 'es'}`)
  if (r.personal > 0) detalle.push(`• ${r.personal} asignación${r.personal === 1 ? '' : 'es'} de personal`)

  return [
    intro ? `${intro}\n` : '',
    `¿Eliminar definitivamente la obra "${nombre}"?`,
    '',
    detalle.length > 0
      ? `Se borra todo lo cargado en ella:\n${detalle.join('\n')}`
      : 'La obra no tiene datos cargados.',
    '',
    'Los presupuestos vinculados no se borran: quedan sin obra.',
    'Esta acción no se puede deshacer.',
  ]
    .join('\n')
    .trim()
}

export async function eliminarObraCompleta(
  obraId: number,
): Promise<ResultadoEliminacion> {
  try {
    const presupuestos = await presupuestosDeObra(obraId)

    // Rutas de los archivos, para limpiarlos del almacenamiento después.
    const [fotos, comprobantes] = await Promise.all([
      supabase.from('obra_imagenes').select('storage_path').eq('obra_id', obraId),
      supabase.from('materiales').select('comprobante_path').eq('obra_id', obraId),
    ])

    const { error } = await supabase.rpc('eliminar_obra_completa', {
      p_obra_id: obraId,
    })

    if (error) throw error

    // Limpieza de archivos: si falla no importa, la obra ya se eliminó.
    try {
      const rutasFotos = ((fotos.data ?? []) as { storage_path: string | null }[])
        .map((f) => f.storage_path)
        .filter((ruta): ruta is string => Boolean(ruta))

      const rutasComprobantes = (
        (comprobantes.data ?? []) as { comprobante_path: string | null }[]
      )
        .map((c) => c.comprobante_path)
        .filter((ruta): ruta is string => Boolean(ruta))

      if (rutasFotos.length > 0) {
        await supabase.storage.from('obras').remove(rutasFotos)
      }
      if (rutasComprobantes.length > 0) {
        await supabase.storage.from('comprobantes').remove(rutasComprobantes)
      }
    } catch (errorArchivos) {
      console.error(errorArchivos)
    }

    return {
      ok: true,
      presupuestosAceptados: presupuestos.filter((p) => p.estado === 'aceptado')
        .length,
    }
  } catch (error) {
    console.error(error)

    return {
      ok: false,
      mensaje:
        'No se pudo eliminar la obra. No se borró nada. ' +
        'Verificá que hayas ejecutado el SQL "eliminar_obra_completa" en Supabase.',
    }
  }
}
