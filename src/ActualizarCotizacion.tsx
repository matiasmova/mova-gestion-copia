import { useState } from 'react'
import { supabase } from './supabase'
import type { ProductoServicio } from './ProductosServicios'
import { dos } from './catalogoCalculos'
import { formatoDinero, formatoDolar, guardarCotizacion, leerCotizacion, traerCotizacionOnline } from './catalogoMoneda'
import { configActual } from './config'

// Cotización del dólar (compartida por todos los usuarios).
//  · Los productos cargados EN DÓLARES se recalculan solos en pesos con la
//    cotización nueva (precio USD × cotización).
//  · Los productos cargados EN PESOS no cambian, salvo que se tilde "ajustar
//    también los productos en pesos", que los multiplica por la variación.

type Props = {
  elementos: ProductoServicio[]
  onCerrar: () => void
  onActualizado: () => void
}

type Fase = 'ingresar' | 'aplicando' | 'listo'
const numero = (n: number) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)

export default function ActualizarCotizacion({ elementos, onCerrar, onActualizado }: Props) {
  const actual = leerCotizacion()
  const info = configActual().cotizacion
  const [nueva, setNueva] = useState(actual > 0 ? String(actual).replace('.', ',') : '')
  const [fuente, setFuente] = useState<string | null>(null)
  const [trayendo, setTrayendo] = useState<string | null>(null)
  const [ajustarPesos, setAjustarPesos] = useState(false)
  const [fase, setFase] = useState<Fase>('ingresar')
  const [error, setError] = useState('')
  const [resumen, setResumen] = useState<string[]>([])

  const nuevaNum = Number(nueva.replace(/\./g, '').replace(',', '.'))
  const valida = Number.isFinite(nuevaNum) && nuevaNum > 0
  const ratio = actual > 0 && valida ? nuevaNum / actual : 1
  const variacion = (ratio - 1) * 100
  const enUsd = elementos.filter((el) => el.moneda === 'USD')
  const enPesos = elementos.filter((el) => el.moneda !== 'USD' && (el.costo_unitario > 0 || el.precio_venta > 0))
  const ejemploUsd = enUsd.find((el) => (el.precio_usd ?? 0) > 0)

  async function traer(casa: 'oficial' | 'blue' | 'bolsa', etiqueta: string) {
    setTrayendo(casa); setError('')
    try {
      const r = await traerCotizacionOnline(casa)
      setNueva(String(r.venta).replace('.', ','))
      setFuente(`Dólar ${etiqueta}`)
    } catch {
      setError('No se pudo traer la cotización de internet. Cargala a mano.')
    } finally { setTrayendo(null) }
  }

  async function aplicar() {
    setError('')
    if (!valida) { setError('Ingresá una cotización válida.'); return }
    setFase('aplicando')
    const lineas: string[] = []
    try {
      await guardarCotizacion(nuevaNum, fuente ?? 'Manual')
      lineas.push(`Cotización guardada: USD 1 = $ ${numero(nuevaNum)}. La ven todos los usuarios.`)
    } catch (e) {
      console.error(e)
      lineas.push('⚠ La cotización quedó solo en este dispositivo: falta correr el SQL de Productos (o el de Configuración) en Supabase.')
    }
    // Productos en dólares: se recalculan en pesos en la base, de una sola vez.
    if (enUsd.length > 0) {
      const { data, error: e } = await supabase.rpc('actualizar_precios_usd', { p_cotizacion: nuevaNum })
      lineas.push(e ? '⚠ No se pudieron recalcular los productos en dólares (falta correr el SQL de Productos).' : `${data ?? enUsd.length} producto(s) en dólares actualizados en pesos.`)
    }
    // Productos en pesos: solo si se pidió, por la variación.
    if (ajustarPesos && actual > 0 && Math.abs(ratio - 1) >= 0.0005) {
      let ok = 0
      let cursor = 0
      const trabajador = async () => {
        while (cursor < enPesos.length) {
          const el = enPesos[cursor++]
          const { error: e } = await supabase.from('productos_servicios').update({
            costo_unitario: el.costo_unitario > 0 ? dos(el.costo_unitario * ratio) : el.costo_unitario,
            precio_venta: el.precio_venta > 0 ? dos(el.precio_venta * ratio) : el.precio_venta,
          }).eq('id', el.id)
          if (!e) ok++
        }
      }
      await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()])
      lineas.push(`${ok} producto(s) en pesos ajustados un ${variacion > 0 ? '+' : ''}${variacion.toFixed(1)}%.`)
    }
    setResumen(lineas)
    setFase('listo')
    onActualizado()
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard catalogoModal" style={{ maxWidth: '600px' }}>
        <div className="modalHeader">
          <div><p className="subtitle">CATÁLOGO MOVA</p><h2>Cotización del dólar</h2></div>
          <button type="button" className="modalClose closeButton" onClick={onCerrar} disabled={fase === 'aplicando'}>×</button>
        </div>

        {fase === 'ingresar' && (
          <div className="catalogoForm">
            <p className="gestionAyuda" style={{ marginTop: 0 }}>
              {actual > 0
                ? <>Cotización actual: <strong>USD 1 = $ {numero(actual)}</strong>{info.fecha ? ` · ${new Date(info.fecha).toLocaleDateString('es-AR')}` : ''}{info.fuente ? ` · ${info.fuente}` : ''}</>
                : 'Todavía no hay una cotización cargada.'}
            </p>
            <div className="ctTraer">
              <span>Traer la de hoy:</span>
              <button type="button" className="editButton" disabled={!!trayendo} onClick={() => void traer('oficial', 'oficial')}>{trayendo === 'oficial' ? '…' : 'Oficial'}</button>
              <button type="button" className="editButton" disabled={!!trayendo} onClick={() => void traer('blue', 'blue')}>{trayendo === 'blue' ? '…' : 'Blue'}</button>
              <button type="button" className="editButton" disabled={!!trayendo} onClick={() => void traer('bolsa', 'MEP')}>{trayendo === 'bolsa' ? '…' : 'MEP'}</button>
            </div>
            <label>Cotización (pesos por dólar)
              <input type="text" inputMode="decimal" value={nueva} onChange={(e) => { setNueva(e.target.value); setFuente(null) }} placeholder="Ej.: 1450" autoFocus />
            </label>
            {fuente && <small className="gestionAyuda">Valor de venta del {fuente.toLowerCase()} (dolarapi.com). Podés corregirlo.</small>}

            {valida && actual > 0 && Math.abs(ratio - 1) >= 0.0005 && (
              <p className="gestionAyuda">Variación: <strong>{variacion > 0 ? '+' : ''}{variacion.toFixed(1)}%</strong> respecto de la actual.</p>
            )}

            <div className="simulacionBox">
              <span className="simulacionTitulo">Qué va a pasar</span>
              <p className="ctLinea">💵 <strong>{enUsd.length}</strong> producto(s) cargados en dólares se recalculan en pesos{ejemploUsd && valida ? ` (ej.: ${ejemploUsd.nombre}: US$ ${formatoDolar(ejemploUsd.precio_usd ?? 0).replace("$", "").trim()} → ${formatoDinero(dos((ejemploUsd.precio_usd ?? 0) * nuevaNum))})` : ''}.</p>
              <p className="ctLinea">$ <strong>{enPesos.length}</strong> producto(s) en pesos {ajustarPesos ? `se ajustan un ${variacion > 0 ? '+' : ''}${variacion.toFixed(1)}%` : 'quedan igual'}.</p>
              {actual > 0 && enPesos.length > 0 && (
                <label className="caCheck"><input type="checkbox" checked={ajustarPesos} onChange={(e) => setAjustarPesos(e.target.checked)} /> Ajustar también los productos en pesos según la variación del dólar</label>
              )}
            </div>
            {error && <p className="loginError">{error}</p>}
            <div className="modalActions formActions">
              <button type="button" className="cancelButton" onClick={onCerrar}>Cancelar</button>
              <button type="button" className="newButton" disabled={!valida} onClick={() => void aplicar()}>Guardar cotización</button>
            </div>
          </div>
        )}

        {fase === 'aplicando' && <div className="catalogoForm"><p role="status">Actualizando precios…</p><p className="gestionAyuda">No cierres esta ventana.</p></div>}

        {fase === 'listo' && (
          <div className="catalogoForm">
            <p><strong>Listo.</strong></p>
            <ul className="ctResumen">{resumen.map((l) => <li key={l}>{l}</li>)}</ul>
            <div className="modalActions formActions"><button type="button" className="newButton" onClick={onCerrar}>Cerrar</button></div>
          </div>
        )}
      </div>
    </div>
  )
}
