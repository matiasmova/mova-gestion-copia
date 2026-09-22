import { useState } from 'react'
import { supabase } from './supabase'
import type { ProductoServicio } from './ProductosServicios'
import { dos } from './catalogoCalculos'
import { CLAVE_COTIZACION, formatoDinero, leerCotizacion } from './catalogoMoneda'

// Ventana para cargar la cotización del dólar del día. Si ya había una
// cotización guardada y cambió, se ofrece recalcular y guardar el costo y el
// precio de lista de TODO el catálogo (en pesos), multiplicando por la
// variación entre la cotización vieja y la nueva.

type Props = {
  elementos: ProductoServicio[]
  onCerrar: () => void
  onActualizado: () => void
}

type Fase = 'ingresar' | 'confirmar' | 'aplicando' | 'listo'

function formatoNumero(n: number) {
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)
}

export default function ActualizarCotizacion({ elementos, onCerrar, onActualizado }: Props) {
  const cotizacionActual = leerCotizacion()
  const [nueva, setNueva] = useState(cotizacionActual > 0 ? String(cotizacionActual).replace('.', ',') : '')
  const [fase, setFase] = useState<Fase>('ingresar')
  const [error, setError] = useState('')
  const [progreso, setProgreso] = useState({ hechos: 0, total: 0 })
  const [resumen, setResumen] = useState('')
  const [fallidos, setFallidos] = useState(0)

  const nuevaNum = Number(nueva.replace(',', '.'))
  const afectados = elementos.filter((el) => el.costo_unitario > 0 || el.precio_venta > 0)
  const ratio = cotizacionActual > 0 ? nuevaNum / cotizacionActual : 1
  const variacionPct = (ratio - 1) * 100
  const ejemplo = afectados[0]

  function guardarCotizacionLocal(valor: number) {
    try {
      localStorage.setItem(CLAVE_COTIZACION, String(valor))
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }

  function continuar() {
    setError('')
    if (!Number.isFinite(nuevaNum) || nuevaNum <= 0) {
      setError('Ingresá un valor de cotización válido.')
      return
    }
    if (cotizacionActual <= 0) {
      // Primera vez: se guarda como base. Recién la próxima actualización recalcula precios.
      guardarCotizacionLocal(nuevaNum)
      setResumen(`Se guardó la cotización (USD 1 = $ ${formatoNumero(nuevaNum)}). La próxima vez que la actualices, el costo y el precio de lista del catálogo se van a recalcular según cuánto haya variado.`)
      setFase('listo')
      onActualizado()
      return
    }
    if (Math.abs(ratio - 1) < 0.0005) {
      setResumen('La cotización no cambió respecto de la guardada: no hay nada para recalcular.')
      setFase('listo')
      return
    }
    setFase('confirmar')
  }

  async function confirmar() {
    setFase('aplicando')
    const total = afectados.length
    setProgreso({ hechos: 0, total })
    let hechos = 0
    let fallos = 0
    let cursor = 0
    const trabajador = async () => {
      while (cursor < afectados.length) {
        const el = afectados[cursor++]
        const nuevoCosto = el.costo_unitario > 0 ? dos(el.costo_unitario * ratio) : el.costo_unitario
        const nuevoPrecio = el.precio_venta > 0 ? dos(el.precio_venta * ratio) : el.precio_venta
        const { error: err } = await supabase.from('productos_servicios').update({ costo_unitario: nuevoCosto, precio_venta: nuevoPrecio }).eq('id', el.id)
        if (err) { console.error(err); fallos++ } else hechos++
        setProgreso({ hechos: hechos + fallos, total })
      }
    }
    await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()])
    guardarCotizacionLocal(nuevaNum)
    setFallidos(fallos)
    setResumen(`Se actualizaron ${hechos} de ${total} producto(s) con la nueva cotización (USD 1 = $ ${formatoNumero(nuevaNum)}).`)
    setFase('listo')
    onActualizado()
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard catalogoModal" style={{ maxWidth: '560px' }}>
        <div className="modalHeader">
          <div><p className="subtitle">CATÁLOGO MOVA</p><h2>Cotización del dólar</h2></div>
          <button type="button" className="modalClose closeButton" onClick={onCerrar} disabled={fase === 'aplicando'}>×</button>
        </div>

        {fase === 'ingresar' && (
          <div className="catalogoForm">
            <p className="gestionAyuda" style={{ marginTop: 0 }}>
              {cotizacionActual > 0
                ? `Cotización guardada: USD 1 = $ ${formatoNumero(cotizacionActual)}. Si cargás una nueva, el costo y el precio de lista de todo el catálogo se multiplican por la variación entre las dos.`
                : 'Todavía no cargaste una cotización. La primera vez solo se guarda como base, sin tocar ningún precio.'}
            </p>
            <label>Cotización de hoy (pesos por dólar)
              <input type="text" inputMode="decimal" value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Ej.: 1.450" autoFocus />
            </label>
            {error && <p className="loginError">{error}</p>}
            <div className="modalActions formActions">
              <button type="button" className="cancelButton" onClick={onCerrar}>Cancelar</button>
              <button type="button" className="newButton" onClick={continuar}>Continuar</button>
            </div>
          </div>
        )}

        {fase === 'confirmar' && (
          <div className="catalogoForm">
            <p className="gestionAyuda" style={{ marginTop: 0 }}>
              La cotización pasa de <strong>USD 1 = $ {formatoNumero(cotizacionActual)}</strong> a <strong>USD 1 = $ {formatoNumero(nuevaNum)}</strong>
              {' '}({variacionPct > 0 ? '+' : ''}{variacionPct.toFixed(1)}%).
            </p>
            <p className="gestionAyuda">
              Se van a actualizar <strong>{afectados.length}</strong> producto(s) con costo o precio de lista cargado, multiplicando cada valor por {ratio.toFixed(4)}.
              Esta acción no se puede deshacer.
            </p>
            {ejemplo && (
              <div className="simulacionBox">
                <span className="simulacionTitulo">Ejemplo: {ejemplo.nombre}</span>
                <div className="simulacionGrid">
                  <div><small>Compra antes → después</small><strong>{formatoDinero(ejemplo.costo_unitario)} → {formatoDinero(dos(ejemplo.costo_unitario * ratio))}</strong></div>
                  <div><small>Lista antes → después</small><strong>{formatoDinero(ejemplo.precio_venta)} → {formatoDinero(dos(ejemplo.precio_venta * ratio))}</strong></div>
                </div>
              </div>
            )}
            <div className="modalActions formActions">
              <button type="button" className="cancelButton" onClick={() => setFase('ingresar')}>Volver</button>
              <button type="button" className="newButton" onClick={() => void confirmar()}>Actualizar {afectados.length} producto(s)</button>
            </div>
          </div>
        )}

        {fase === 'aplicando' && (
          <div className="catalogoForm">
            <p role="status">Actualizando precios... {progreso.hechos} de {progreso.total}</p>
            <div className="crmBarra"><span style={{ width: `${progreso.total ? (progreso.hechos / progreso.total) * 100 : 0}%` }} /></div>
            <p className="gestionAyuda">No cierres esta ventana hasta que termine.</p>
          </div>
        )}

        {fase === 'listo' && (
          <div className="catalogoForm">
            <p><strong>Listo.</strong> {resumen}</p>
            {fallidos > 0 && <p className="loginError">{fallidos} producto(s) no se pudieron actualizar.</p>}
            <div className="modalActions formActions"><button type="button" className="newButton" onClick={onCerrar}>Cerrar</button></div>
          </div>
        )}
      </div>
    </div>
  )
}
