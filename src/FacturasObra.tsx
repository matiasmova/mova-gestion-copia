import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'

// Compras y facturas cargadas para una obra (sección Compras), con el
// comprobante para ver. Es un gasto interno: no aparece en el documento del cliente.

type Material = {
  id: number; nombre: string; cantidad: number; unidad: string | null; precio_unitario: number
  proveedor: string | null; fecha: string; numero_comprobante: string | null; comprobante_path: string | null; pagado: boolean | null
}

export default function FacturasObra({ obraId }: { obraId: number }) {
  const [filas, setFilas] = useState<Material[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abriendo, setAbriendo] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    void supabase.from('materiales')
      .select('id, nombre, cantidad, unidad, precio_unitario, proveedor, fecha, numero_comprobante, comprobante_path, pagado')
      .eq('obra_id', obraId).order('fecha', { ascending: false })
      .then(({ data, error: e }) => {
        if (!vigente) return
        if (e) { console.error(e); setError('No se pudieron cargar las compras de la obra.') }
        setFilas(((data ?? []) as Material[]).map((m) => ({ ...m, cantidad: Number(m.cantidad) || 0, precio_unitario: Number(m.precio_unitario) || 0 })))
        setCargando(false)
      })
    return () => { vigente = false }
  }, [obraId])

  async function verComprobante(ruta: string) {
    setAbriendo(ruta)
    const { data, error: e } = await supabase.storage.from('comprobantes').createSignedUrl(ruta, 600)
    setAbriendo(null)
    if (e || !data?.signedUrl) { window.alert('No se pudo abrir el comprobante.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (cargando) return <p className="gestionAyuda">Cargando compras…</p>
  if (error) return <p className="loginError">{error}</p>

  // Una factura con varios renglones se muestra junta.
  const grupos = new Map<string, Material[]>()
  for (const m of filas) {
    const clave = m.comprobante_path || `${m.fecha}|${m.proveedor ?? ''}|${m.numero_comprobante ?? ''}|${m.id}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), m])
  }
  const total = filas.reduce((s, m) => s + m.cantidad * m.precio_unitario, 0)
  const impago = filas.filter((m) => !m.pagado).reduce((s, m) => s + m.cantidad * m.precio_unitario, 0)

  return (
    <div className="facturasObra">
      <p className="gestionAyuda" style={{ marginTop: 0 }}>
        Compras y facturas cargadas en <b>Compras</b> para esta obra. Son gastos internos: no aparecen en el documento del cliente. Para editarlas o borrarlas, entrá a Compras.
      </p>
      {filas.length === 0 ? <p className="homeVacio">Todavía no hay compras cargadas para esta obra.</p> : <>
        <div className="facturasTotales">
          <div><span>Total en compras</span><strong>{moneda(total)}</strong></div>
          <div className={impago > 0.5 ? 'alerta' : ''}><span>Sin pagar al proveedor</span><strong>{moneda(impago)}</strong></div>
        </div>
        {[...grupos.entries()].map(([clave, ms]) => {
          const m0 = ms[0]
          const suma = ms.reduce((s, m) => s + m.cantidad * m.precio_unitario, 0)
          return (
            <div className="facturaCard" key={clave}>
              <div className="facturaCab">
                <div>
                  <strong>{m0.proveedor || 'Sin proveedor'}</strong>
                  <small>{fechaCorta(m0.fecha)}{m0.numero_comprobante ? ` · N.º ${m0.numero_comprobante}` : ''} · <span className={m0.pagado ? 'facturaPagada' : 'facturaImpaga'}>{m0.pagado ? 'Pagada' : 'Sin pagar'}</span></small>
                </div>
                <b>{moneda(suma)}</b>
              </div>
              <ul>
                {ms.map((m) => <li key={m.id}><span>{m.nombre}</span><small>{Number(m.cantidad.toFixed(3))} {m.unidad || 'u.'} × {moneda(m.precio_unitario)}</small></li>)}
              </ul>
              {m0.comprobante_path && (
                <button type="button" className="editButton" disabled={abriendo === m0.comprobante_path} onClick={() => void verComprobante(m0.comprobante_path!)}>
                  {abriendo === m0.comprobante_path ? 'Abriendo…' : '🧾 Ver factura'}
                </button>
              )}
            </div>
          )
        })}
      </>}
    </div>
  )
}
