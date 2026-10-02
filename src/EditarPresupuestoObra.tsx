import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import NuevoPresupuesto, { type ClienteOpcion, type ObraOpcion, type PresupuestoEditable, type ItemPresupuesto } from './NuevoPresupuesto'

// Abre el editor del presupuesto directo desde la obra (sin pasar por la ficha del presupuesto).
export default function EditarPresupuestoObra({ presupuestoId, onCerrar, onGuardado }: { presupuestoId: number; onCerrar: () => void; onGuardado: () => void }) {
  const [datos, setDatos] = useState<{ p: PresupuestoEditable; clientes: ClienteOpcion[]; obras: ObraOpcion[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    async function cargar() {
      const [rP, rI, rC, rO] = await Promise.all([
        supabase.from('presupuestos').select('id, cliente_id, obra_id, titulo, descripcion, fecha, validez_dias, estado, etapa_trabajo, descuento, total_pagado, notas').eq('id', presupuestoId).maybeSingle(),
        supabase.from('presupuesto_items').select('id, catalogo_id, tipo, descripcion, cantidad, precio_unitario, costo_unitario, descuento_pct, orden').eq('presupuesto_id', presupuestoId).order('orden', { ascending: true }),
        supabase.from('Clientes').select('id, nombre, apellido, direccion, localidad').order('nombre', { ascending: true }),
        supabase.from('obras').select('id, cliente_id, nombre_obra').order('nombre_obra', { ascending: true }),
      ])
      if (!vigente) return
      if (rP.error || !rP.data || rI.error) { console.error(rP.error || rI.error); setError('No se pudo abrir el presupuesto para editar.'); return }
      const p = rP.data as Record<string, unknown>
      const items = ((rI.data ?? []) as Record<string, unknown>[]).map((it) => ({
        id: Number(it.id), catalogo_id: (it.catalogo_id as number | null) ?? null, tipo: it.tipo as ItemPresupuesto['tipo'], descripcion: String(it.descripcion ?? ''),
        cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), costo_unitario: Number(it.costo_unitario || 0), descuento_pct: Number(it.descuento_pct || 0),
      }))
      setDatos({
        p: { ...(p as unknown as PresupuestoEditable), descuento: Number(p.descuento) || 0, total_pagado: Number(p.total_pagado) || 0, items },
        clientes: (rC.data ?? []) as ClienteOpcion[],
        obras: (rO.data ?? []) as ObraOpcion[],
      })
    }
    void cargar()
    return () => { vigente = false }
  }, [presupuestoId])

  if (error) return <div className="modalOverlay"><div className="modalCard"><p className="loginError">{error}</p><div className="modalActions"><button type="button" className="cancelButton" onClick={onCerrar}>Cerrar</button></div></div></div>
  if (!datos) return <div className="modalOverlay"><div className="modalCard"><p role="status">Abriendo el presupuesto…</p></div></div>
  return <NuevoPresupuesto clientes={datos.clientes} obras={datos.obras} presupuesto={datos.p} onCancelar={onCerrar} onGuardado={onGuardado} />
}
