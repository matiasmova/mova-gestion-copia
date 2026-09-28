import { supabase } from './supabase'

// Datos de contacto del cliente y ubicación de la obra para el encabezado del
// presupuesto. Se leen con select('*') y se toma el primer campo que exista,
// así funciona aunque las columnas se llamen distinto (telefono / celular, etc.).

export type DatosContacto = {
  telefono: string | null
  email: string | null
  documento: { etiqueta: string; valor: string } | null
  direccionCliente: string | null
  direccionObra: string | null
}

type Fila = Record<string, unknown>

const primero = (fila: Fila | null | undefined, claves: string[]): string | null => {
  if (!fila) return null
  for (const c of claves) {
    const v = fila[c]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return null
}

const unir = (...partes: (string | null)[]) => {
  const lista = partes.filter((p): p is string => !!p && p.trim() !== '')
  return lista.length ? lista.join(', ') : null
}

export async function cargarDatosContacto(presupuestoId: number): Promise<DatosContacto | null> {
  if (!presupuestoId) return null
  const { data: pres, error } = await supabase.from('presupuestos').select('cliente_id, obra_id').eq('id', presupuestoId).maybeSingle()
  if (error || !pres) return null
  const [rCli, rObra] = await Promise.all([
    supabase.from('Clientes').select('*').eq('id', pres.cliente_id).maybeSingle(),
    pres.obra_id != null ? supabase.from('obras').select('*').eq('id', pres.obra_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  const cli = (rCli.data ?? null) as Fila | null
  const obra = (rObra.data ?? null) as Fila | null

  const cuit = primero(cli, ['cuit', 'cuil', 'cuit_cuil'])
  const dni = primero(cli, ['dni', 'documento', 'nro_documento'])
  return {
    telefono: primero(cli, ['telefono', 'celular', 'whatsapp', 'tel', 'telefono_celular']),
    email: primero(cli, ['email', 'correo', 'mail']),
    documento: cuit ? { etiqueta: 'CUIT', valor: cuit } : dni ? { etiqueta: 'DNI', valor: dni } : null,
    direccionCliente: unir(primero(cli, ['direccion', 'domicilio']), primero(cli, ['localidad', 'ciudad']), primero(cli, ['provincia'])),
    direccionObra: unir(primero(obra, ['direccion']), primero(obra, ['localidad'])),
  }
}
