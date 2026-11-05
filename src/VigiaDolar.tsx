import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { configActual } from './config'
import { leerCotizacion, traerCotizacionOnline } from './catalogoMoneda'
import ActualizarCotizacion from './ActualizarCotizacion'
import type { ProductoServicio } from './ProductosServicios'

// Dólar oficial arriba de cada página: el valor que usa la app (el que
// guardaste) y, si el oficial del día cambió, un aviso para ver los cambios y
// aceptarlos. Al aceptar se guarda la cotización nueva y se actualizan los
// precios (los cargados en dólares y, si lo dejás tildado, los en pesos).
// Se revisa al abrir la app, al volver a ella y cada 30 minutos.

const CLAVE_IGNORADA = 'mova_dolar_ignorado'
const pesos = (n: number) => `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
const leerIgnorada = () => { try { return localStorage.getItem(CLAVE_IGNORADA) ?? '' } catch { return '' } }

export default function VigiaDolar({ puedeAceptar }: { puedeAceptar: boolean }) {
  const [guardada, setGuardada] = useState(() => leerCotizacion())
  const [fecha, setFecha] = useState(() => configActual().cotizacion.fecha)
  const [hoy, setHoy] = useState<number | null>(null)
  const [ignorada, setIgnorada] = useState(leerIgnorada)
  const [abierta, setAbierta] = useState(false)
  const [elementos, setElementos] = useState<ProductoServicio[] | null>(null)

  useEffect(() => {
    let ultima = 0
    const revisar = async () => {
      setGuardada(leerCotizacion()); setFecha(configActual().cotizacion.fecha)
      if (Date.now() - ultima < 60_000) return
      ultima = Date.now()
      try { setHoy((await traerCotizacionOnline('oficial')).venta) } catch { /* sin internet: se revisa la próxima vez */ }
    }
    // La configuración (cotización guardada) se carga al entrar: se relee en un momento.
    const t1 = window.setTimeout(() => void revisar(), 1500)
    const t2 = window.setTimeout(() => { setGuardada(leerCotizacion()); setFecha(configActual().cotizacion.fecha) }, 5000)
    const iv = window.setInterval(() => void revisar(), 30 * 60_000)
    const vis = () => { if (document.visibilityState === 'visible') void revisar() }
    document.addEventListener('visibilitychange', vis)
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.clearInterval(iv); document.removeEventListener('visibilitychange', vis) }
  }, [])

  async function abrir() {
    setAbierta(true)
    if (elementos) return
    const cols = 'id,nombre,tipo,costo_unitario,precio_venta,activo'
    let r = await supabase.from('productos_servicios').select(`${cols},moneda,precio_usd,costo_usd`).order('nombre')
    if (r.error) r = await supabase.from('productos_servicios').select(cols).order('nombre') as typeof r
    setElementos(((r.data ?? []) as unknown as ProductoServicio[]).map((p) => ({ ...p, costo_unitario: Number(p.costo_unitario) || 0, precio_venta: Number(p.precio_venta) || 0, precio_usd: p.precio_usd == null ? p.precio_usd : Number(p.precio_usd) })))
  }
  function ahoraNo() {
    if (hoy == null) return
    try { localStorage.setItem(CLAVE_IGNORADA, String(hoy)) } catch { /* sin almacenamiento */ }
    setIgnorada(String(hoy))
  }

  const cambio = hoy != null && Math.abs(hoy - guardada) >= 0.5
  const variacion = cambio && guardada > 0 ? ((hoy - guardada) / guardada) * 100 : 0
  const avisar = cambio && puedeAceptar && String(hoy) !== ignorada
  if (!(guardada > 0) && hoy == null) return null

  return <>
    <div className="vdFila">
      <span className={`vdChip${cambio ? ' cambio' : ''}`} title="Cotización del dólar que usa la app para los precios">
        <span aria-hidden>💵</span>Dólar oficial <b>{guardada > 0 ? pesos(guardada) : 'sin cargar'}</b>
        {guardada > 0 && fecha && <small>· {new Date(fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })}</small>}
        {cambio && !avisar && <small>· hoy {pesos(hoy)}</small>}
        {cambio && !avisar && puedeAceptar && <button type="button" onClick={() => void abrir()}>Actualizar</button>}
      </span>
    </div>
    {avisar && <div className="vdAviso" role="status">
      <span aria-hidden>💵</span>
      <p>{guardada > 0
        ? <>Parece que el dólar oficial cambió: <b>{pesos(guardada)} → {pesos(hoy)}</b> ({variacion > 0 ? '+' : ''}{variacion.toFixed(1)}%). ¿Querés ver los cambios para aceptarlos?</>
        : <>Todavía no cargaste la cotización. Hoy el dólar oficial está <b>{pesos(hoy)}</b>. ¿Querés usarla?</>}</p>
      <div><button type="button" className="si" onClick={() => void abrir()}>Ver cambios</button><button type="button" onClick={ahoraNo}>Ahora no</button></div>
    </div>}
    {abierta && (elementos
      ? <ActualizarCotizacion elementos={elementos} valorInicial={hoy ?? undefined} fuenteInicial="Dólar oficial" ajustarInicial={guardada > 0}
          onCerrar={() => { setAbierta(false); setElementos(null) }} onActualizado={() => { setGuardada(leerCotizacion()); setFecha(configActual().cotizacion.fecha) }} />
      : <div className="modalOverlay"><div className="modalCard"><p role="status">Cargando productos y servicios…</p></div></div>)}
  </>
}
