import { useMemo, useState } from 'react'
import type { ProductoServicio } from './ProductosServicios'
import type { ModoGanancia } from './catalogoCalculos'
import { guardarCotizacion, leerCotizacion as leerCotizacionGuardada } from './catalogoMoneda'
import {
  descargarPlantillaXlsx,
  ejecutarImportacion,
  filasDesdeTextoPegado,
  leerFilasDesdeArchivo,
  leerFilasDesdePdf,
  planificarDesdeFilas,
  plantillaCsv,
  type FilaCruda,
  type FilaPlan,
  type ResultadoImportacion,
} from './importarCatalogo'
import CampoNumero from './CampoNumero'

// Ventana para cargar o actualizar el catálogo desde una hoja de cálculo
// (CSV o Excel .xlsx/.xls).

type Props = {
  existentes: ProductoServicio[]
  modoInicial: ModoGanancia
  // false si todavía no se corrió el SQL de moneda por producto.
  conMoneda?: boolean
  onCerrar: () => void
  // Se llama al terminar, para que el catálogo se vuelva a cargar.
  onTerminado: () => void
}

const MAX_FILAS_VISIBLES = 300

// Cotización compartida (Configuración); si no hay, la de este navegador.
function leerCotizacion(): string {
  const v = leerCotizacionGuardada()
  return v > 0 ? String(v) : ''
}

const etiquetaAccion: Record<FilaPlan['accion'], string> = {
  crear: 'Nuevo',
  actualizar: 'Actualizar',
  sinCambios: 'Sin cambios',
  error: 'Error',
}

const colorAccion: Record<FilaPlan['accion'], string> = {
  crear: '#1f7a4d',
  actualizar: '#1d4ed8',
  sinCambios: '#78828f',
  error: '#b23b32',
}

function descargar(nombre: string, contenido: string) {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

export default function ImportarCatalogo({ existentes, modoInicial, conMoneda = true, onCerrar, onTerminado }: Props) {
  const [pegando, setPegando] = useState(false)
  const [textoPegado, setTextoPegado] = useState('')
  const [leyendo, setLeyendo] = useState(false)
  const [filas, setFilas] = useState<FilaCruda[] | null>(null)
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [errorLectura, setErrorLectura] = useState('')
  const [modo, setModo] = useState<ModoGanancia>(modoInicial)
  const [cotizacion, setCotizacion] = useState(leerCotizacion)
  const [gananciaNuevos, setGananciaNuevos] = useState('50')
  const [recalcular, setRecalcular] = useState(true)
  const [filtro, setFiltro] = useState<'todas' | FilaPlan['accion']>('todas')
  const [fase, setFase] = useState<'elegir' | 'revisar' | 'importando' | 'listo'>('elegir')
  const [progreso, setProgreso] = useState({ hechas: 0, total: 0 })
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null)

  const plan = useMemo(() => {
    if (!filas) return null
    return planificarDesdeFilas(filas, existentes, {
      modo,
      cotizacion: Number(cotizacion.replace(',', '.')) || 0,
      gananciaNuevos: gananciaNuevos.trim() === '' ? null : Number(gananciaNuevos.replace(',', '.')),
      recalcularPrecio: recalcular,
      conMoneda,
    })
  }, [filas, existentes, modo, cotizacion, gananciaNuevos, recalcular])

  const cuenta = (accion: FilaPlan['accion']) => plan?.filas.filter((f) => f.accion === accion).length ?? 0
  const aGuardar = cuenta('crear') + cuenta('actualizar')
  const filasVisibles = (plan?.filas ?? []).filter((f) => filtro === 'todas' || f.accion === filtro)

  async function elegirArchivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0]
    if (!archivo) return
    setErrorLectura('')
    setLeyendo(true)
    try {
      const esPdf = archivo.name.toLowerCase().endsWith('.pdf')
      setFilas(esPdf ? await leerFilasDesdePdf(archivo) : await leerFilasDesdeArchivo(archivo))
      setNombreArchivo(archivo.name)
      setFiltro('todas')
      setFase('revisar')
    } catch (fallo) {
      console.error(fallo)
      setErrorLectura('No se pudo leer el archivo. Probá guardarlo de nuevo como Excel (.xlsx) o CSV, o copiá la tabla y usá "Pegar tabla".')
    } finally { setLeyendo(false) }
  }

  function usarTextoPegado() {
    const f = filasDesdeTextoPegado(textoPegado)
    if (f.length < 2) { setErrorLectura('Pegá la tabla con la fila de títulos arriba (Código, Nombre, Precio…).'); return }
    setErrorLectura('')
    setFilas(f)
    setNombreArchivo('Tabla pegada')
    setFiltro('todas')
    setFase('revisar')
  }

  async function confirmar() {
    if (!plan || aGuardar === 0) return
    const cot = Number(cotizacion.replace(',', '.')) || 0
    if (cot > 0 && Math.abs(cot - leerCotizacionGuardada()) >= 0.005) {
      try { await guardarCotizacion(cot, 'Importación') } catch { /* queda solo en este navegador */ }
    }
    setFase('importando')
    const r = await ejecutarImportacion(plan, (hechas, total) => setProgreso({ hechas, total }))
    setResultado(r)
    setFase('listo')
    onTerminado()
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard catalogoModal" style={{ maxWidth: '980px' }}>
        <div className="modalHeader">
          <div>
            <p className="subtitle">CATÁLOGO MOVA</p>
            <h2>Importar productos desde una hoja de cálculo</h2>
          </div>
          <button type="button" className="modalClose closeButton" onClick={onCerrar} disabled={fase === 'importando'}>×</button>
        </div>

        {fase === 'elegir' && (
          <div className="catalogoForm">
            <p className="gestionAyuda">
              Subí un archivo <strong>Excel (.xlsx)</strong>, <strong>.csv</strong> o una <strong>lista de precios en PDF</strong>, o pegá una tabla copiada. Lo más seguro es usar la plantilla.
              Cada fila es un producto. Si ya existe (mismo <strong>código</strong>) se actualiza solo lo que completes en la hoja; si no existe se crea.
              Antes de guardar vas a ver un resumen para revisar.
            </p>
            <div className="formActions" style={{ justifyContent: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" className="newButton" onClick={descargarPlantillaXlsx}>⬇ Descargar plantilla Excel</button>
              <button type="button" className="editButton" onClick={() => descargar('plantilla-catalogo.csv', plantillaCsv())}>Plantilla CSV</button>
              <button type="button" className="editButton" onClick={() => setPegando((v) => !v)}>📋 Pegar tabla</button>
            </div>
            <p className="gestionAyuda">
              Columnas que reconozco: <em>código, nombre, nombre en presupuesto, tipo, categoría, proveedor, unidad, moneda (ARS/USD), precio de compra, % de ganancia, precio de lista, stock, stock mínimo, IVA, link de compra, foto (link), descripción</em>.
              Con <strong>Moneda = USD</strong> los precios de esa fila van en dólares y el producto sigue al dólar.
              Solo <strong>código o nombre</strong> son obligatorias; el resto es opcional. Si el Excel tiene varias hojas, uso la que tenga los productos.
            </p>
            {pegando && (
              <div className="imPegar">
                <label>Pegá acá la tabla (copiada de Excel, de una web o de un PDF), con los títulos en la primera línea
                  <textarea rows={7} value={textoPegado} onChange={(e) => setTextoPegado(e.target.value)} placeholder={'Código\tNombre\tMoneda\tPrecio de compra\nSON-4CH\tSonoff 4CH R3\tUSD\t18,5'} />
                </label>
                <button type="button" className="newButton" disabled={!textoPegado.trim()} onClick={usarTextoPegado}>Revisar tabla pegada</button>
              </div>
            )}
            <label>Archivo (.xlsx, .csv o .pdf)<input type="file" accept=".csv,.txt,.xlsx,.xls,.xlsm,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={elegirArchivo} disabled={leyendo} /></label>
            {leyendo && <p role="status">Leyendo el archivo…</p>}
            <p className="gestionAyuda">📄 PDF: se lee la tabla por posición del texto. Funciona bien con listas de precios simples; siempre revisá el resultado antes de importar. Si el PDF es una foto escaneada, no se puede leer.</p>
            {errorLectura && <p className="loginError">{errorLectura}</p>}
          </div>
        )}

        {fase === 'revisar' && plan && (
          <div className="catalogoForm">
            <p className="gestionAyuda" style={{ marginTop: 0 }}>Archivo: <strong>{nombreArchivo}</strong></p>

            {plan.errorGeneral ? (
              <>
                <p className="loginError">{plan.errorGeneral}</p>
                <div className="formActions"><button type="button" className="cancelButton" onClick={() => setFase('elegir')}>Elegir otro archivo</button></div>
              </>
            ) : (
              <>
                <div className="formGrid">
                  <label>Cotización del dólar (pesos por USD)
                    <CampoNumero min="0" value={cotizacion} onChange={(e) => setCotizacion(e.target.value)} placeholder="Ej.: 1250" />
                  </label>
                  <label>El % de ganancia es un
                    <select value={modo} onChange={(e) => setModo(e.target.value as ModoGanancia)}>
                      <option value="margen">Margen sobre la venta</option>
                      <option value="recargo">Recargo sobre el costo</option>
                    </select>
                  </label>
                  <label>Ganancia para productos nuevos sin precio (%)
                    <CampoNumero min="0" value={gananciaNuevos} onChange={(e) => setGananciaNuevos(e.target.value)} placeholder="Vacío = precio 0" />
                  </label>
                  <label style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                    <input type="checkbox" checked={recalcular} onChange={(e) => setRecalcular(e.target.checked)} style={{ width: 'auto' }} />
                    <span>Si cambia el costo de un producto existente y la hoja no trae precio, recalcular el precio de lista manteniendo su ganancia actual</span>
                  </label>
                </div>

                <p className="gestionAyuda">
                  Columnas reconocidas: {plan.columnasReconocidas.join(' · ') || 'ninguna'}
                  {plan.columnasIgnoradas.length > 0 && <><br />Se ignoran: {plan.columnasIgnoradas.join(', ')}</>}
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '4px 0 12px' }}>
                  {(['todas', 'crear', 'actualizar', 'sinCambios', 'error'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={filtro === k ? 'newButton' : 'editButton'}
                      onClick={() => setFiltro(k)}
                    >
                      {k === 'todas' ? `Todas (${plan.filas.length})` : `${etiquetaAccion[k]} (${cuenta(k)})`}
                    </button>
                  ))}
                </div>

                <div className="crmListaWrap" style={{ maxHeight: '340px', overflow: 'auto' }}>
                  <table className="crmLista">
                    <thead><tr><th>Línea</th><th>Acción</th><th>Producto</th><th>Detalle</th></tr></thead>
                    <tbody>
                      {filasVisibles.slice(0, MAX_FILAS_VISIBLES).map((f) => (
                        <tr key={f.linea}>
                          <td>{f.linea}</td>
                          <td><strong style={{ color: colorAccion[f.accion] }}>{etiquetaAccion[f.accion]}</strong></td>
                          <td>
                            <strong>{f.nombre || '—'}</strong>
                            {f.codigo && <><br /><small>{f.codigo}</small></>}
                          </td>
                          <td>
                            {f.motivo && <span style={{ color: '#b23b32' }}>{f.motivo}</span>}
                            {f.cambios.length > 0 && <span>{f.cambios.join(' · ')}</span>}
                            {f.avisos.length > 0 && <><br /><small style={{ color: '#b86608' }}>{f.avisos.join(' ')}</small></>}
                          </td>
                        </tr>
                      ))}
                      {filasVisibles.length === 0 && <tr><td colSpan={4}>No hay filas en esta categoría.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {filasVisibles.length > MAX_FILAS_VISIBLES && (
                  <p className="gestionAyuda">Se muestran las primeras {MAX_FILAS_VISIBLES} filas. Se importan todas.</p>
                )}

                {cuenta('error') > 0 && (
                  <p className="gestionAyuda">Las filas con error no se importan: corregilas en la hoja y volvé a subirla, o seguí y cargalas a mano.</p>
                )}

                <div className="modalActions formActions">
                  <button type="button" className="cancelButton" onClick={() => setFase('elegir')}>Elegir otro archivo</button>
                  <button type="button" className="newButton" disabled={aGuardar === 0} onClick={() => void confirmar()}>
                    {aGuardar === 0 ? 'Nada para importar' : `Importar (${cuenta('crear')} nuevos, ${cuenta('actualizar')} a actualizar)`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {fase === 'importando' && (
          <div className="catalogoForm">
            <p role="status">Importando... {progreso.hechas} de {progreso.total}</p>
            <div className="crmBarra"><span style={{ width: `${progreso.total ? (progreso.hechas / progreso.total) * 100 : 0}%` }} /></div>
            <p className="gestionAyuda">No cierres esta ventana hasta que termine.</p>
          </div>
        )}

        {fase === 'listo' && resultado && (
          <div className="catalogoForm">
            <p><strong>Listo.</strong> Se crearon {resultado.creados} productos y se actualizaron {resultado.actualizados}.</p>
            {resultado.fallidos.length > 0 && (
              <>
                <p className="loginError">No se pudieron guardar {resultado.fallidos.length} filas:</p>
                <ul>
                  {resultado.fallidos.slice(0, 50).map((f) => <li key={f.linea}>Línea {f.linea} · {f.nombre}: {f.mensaje}</li>)}
                </ul>
              </>
            )}
            <div className="modalActions formActions"><button type="button" className="newButton" onClick={onCerrar}>Cerrar</button></div>
          </div>
        )}
      </div>
    </div>
  )
}
