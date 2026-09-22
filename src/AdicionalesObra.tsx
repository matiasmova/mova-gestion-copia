import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta, hoy } from './gestionFormat'

type Adicional = {
  id: number
  obra_id: number
  tipo: string
  descripcion: string
  motivo: string | null
  importe: number
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'pagado'
  fecha: string
  observaciones: string | null
  medio_pago: string | null
  proveedor: string | null
  comprobante_path: string | null
  costo_id: number | null
  created_at: string
}

type Props = {
  obraId: number
  /** Solo admin/encargado pueden aprobar o cargar. */
  puedeEditar?: boolean
  /** Avisa al padre que la economía cambió (para refrescar valor actualizado). */
  onCambio?: () => void
}

// Todas las etiquetas conocidas, para mostrar en la lista (incluye tipos viejos
// que ya no se pueden elegir al cargar uno nuevo, por si quedó algún registro).
const TIPOS: Record<string, string> = {
  adicional: 'Adicional',
  producto: 'Producto extra',
  servicio: 'Servicio extra',
  cambio: 'Cambio de alcance',
  gasto_extra: 'Gasto extra',
  ajuste: 'Ajuste',
  bonificacion: 'Bonificación',
}

// Los que se pueden elegir al cargar un adicional nuevo.
const TIPOS_SELECCIONABLES: Array<[string, string]> = [
  ['producto', TIPOS.producto],
  ['servicio', TIPOS.servicio],
  ['gasto_extra', TIPOS.gasto_extra],
  ['ajuste', TIPOS.ajuste],
  ['bonificacion', TIPOS.bonificacion],
]

const MEDIOS_PAGO: Record<string, string> = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  cheque: 'Cheque',
  otro: 'Otro',
}

const formInicial = {
  tipo: 'producto',
  descripcion: '',
  motivo: '',
  importe: '',
  fecha: hoy(),
  observaciones: '',
  medioPago: 'transferencia',
  proveedor: '',
  tieneComprobante: false,
  comprobante: null as File | null,
}

function placeholderImporte(tipo: string) {
  if (tipo === 'bonificacion') return 'Monto del descuento (se guarda como negativo solo)'
  if (tipo === 'gasto_extra') return 'Lo que costó el gasto'
  return 'Negativo = resta al valor de la obra'
}

function AdicionalesObra({ obraId, puedeEditar = true, onCambio }: Props) {
  const [adicionales, setAdicionales] = useState<Adicional[]>([])
  const [valorOriginal, setValorOriginal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [form, setForm] = useState(formInicial)
  const [guardando, setGuardando] = useState(false)
  const [errorForm, setErrorForm] = useState('')
  const [procesando, setProcesando] = useState<number | null>(null)
  const [comprobanteAbierto, setComprobanteAbierto] = useState<{ id: number; url: string } | null>(null)
  const [abriendoComprobante, setAbriendoComprobante] = useState<number | null>(null)
  const [errorComprobante, setErrorComprobante] = useState('')

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      const [rAdic, rPres] = await Promise.all([
        supabase
          .from('adicionales')
          .select('*')
          .eq('obra_id', obraId)
          .order('fecha', { ascending: false })
          .order('id', { ascending: false }),
        supabase
          .from('presupuestos')
          .select('total, estado, activo')
          .eq('obra_id', obraId),
      ])
      if (!vigente) return
      if (rAdic.error) {
        console.error(rAdic.error)
        setError('Falta ejecutar supabase-adicionales-fase-7.sql y agregar_gasto_extra_adicionales.sql en Supabase.')
        setCargando(false)
        return
      }
      const base = (rPres.data ?? [])
        .filter((p) => p.activo !== false && p.estado === 'aceptado')
        .reduce((s, p) => s + Number(p.total || 0), 0)
      setValorOriginal(base)
      setAdicionales(
        (rAdic.data ?? []).map((a) => ({ ...a, importe: Number(a.importe) })) as Adicional[],
      )
      setCargando(false)
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [obraId, revision])

  const aprobados = adicionales
    .filter((a) => a.estado === 'aprobado')
    .reduce((s, a) => s + a.importe, 0)
  const pendientes = adicionales
    .filter((a) => a.estado === 'pendiente')
    .reduce((s, a) => s + a.importe, 0)
  const valorActualizado = valorOriginal + aprobados

  const cambio = (campo: string, valor: string) =>
    setForm((actual) => ({ ...actual, [campo]: valor }))

  function cambiarTipo(tipo: string) {
    setForm((actual) => ({
      ...actual,
      tipo,
      // Los campos de pago solo aplican a Gasto extra: los limpiamos al salir de ese tipo.
      ...(tipo !== 'gasto_extra'
        ? { medioPago: 'transferencia', proveedor: '', tieneComprobante: false, comprobante: null }
        : {}),
    }))
  }

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    setErrorForm('')
    const importeIngresado = Number(form.importe)
    if (!form.descripcion.trim()) {
      setErrorForm('Escribí una descripción del adicional.')
      return
    }
    if (!Number.isFinite(importeIngresado) || importeIngresado === 0) {
      setErrorForm('Ingresá un importe distinto de cero.')
      return
    }
    if (form.tipo === 'gasto_extra' && form.tieneComprobante && !form.comprobante) {
      setErrorForm('Adjuntá el comprobante o desmarcá la casilla.')
      return
    }

    setGuardando(true)

    let comprobante_path: string | null = null
    if (form.tipo === 'gasto_extra' && form.tieneComprobante && form.comprobante) {
      const nombreSeguro = form.comprobante.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const ruta = `${obraId}/adicional-${Date.now()}-${nombreSeguro}`
      const subida = await supabase.storage.from('comprobantes').upload(ruta, form.comprobante)
      if (subida.error) {
        console.error(subida.error)
        setErrorForm(`No se pudo subir el comprobante: ${subida.error.message || 'volvé a intentar.'}`)
        setGuardando(false)
        return
      }
      comprobante_path = ruta
    }

    // La bonificación siempre resta del valor de la obra, sin importar el signo que haya tipeado.
    const importe = form.tipo === 'bonificacion' ? -Math.abs(importeIngresado) : importeIngresado

    const { error: fallo } = await supabase.from('adicionales').insert({
      obra_id: obraId,
      tipo: form.tipo,
      descripcion: form.descripcion.trim(),
      motivo: form.motivo.trim() || null,
      importe,
      fecha: form.fecha,
      observaciones: form.observaciones.trim() || null,
      estado: 'pendiente',
      medio_pago: form.tipo === 'gasto_extra' ? form.medioPago : null,
      proveedor: form.tipo === 'gasto_extra' ? form.proveedor.trim() || null : null,
      comprobante_path,
    })
    if (fallo) {
      console.error(fallo)
      setErrorForm(
        fallo.message?.includes('column')
          ? 'Falta ejecutar agregar_gasto_extra_adicionales.sql en Supabase (la tabla todavía no tiene las columnas nuevas).'
          : `No se pudo guardar el adicional: ${fallo.message || 'volvé a intentar.'}`,
      )
      setGuardando(false)
      return
    }
    setGuardando(false)
    setForm(formInicial)
    setMostrarForm(false)
    setRevision((v) => v + 1)
    onCambio?.()
  }

  // Al aprobar un Gasto extra, se refleja también como costo de la obra (impacta
  // Finanzas y Rentabilidad); si se desaprueba, el costo asociado se retira para
  // no dejarlo duplicado. El resto de los tipos solo cambia de estado.
  async function cambiarEstado(a: Adicional, estado: Adicional['estado']) {
    setProcesando(a.id)
    try {
      if (estado === 'aprobado' && a.tipo === 'gasto_extra' && !a.costo_id) {
        const { data: costoCreado, error: errorCosto } = await supabase
          .from('costos')
          .insert({
            obra_id: obraId,
            tipo: 'gasto_extra',
            descripcion: a.proveedor ? `${a.descripcion} (${a.proveedor})` : a.descripcion,
            monto: Math.abs(a.importe),
            fecha: a.fecha,
          })
          .select('id')
          .single()
        if (errorCosto) throw errorCosto

        const { error: errorUpd } = await supabase
          .from('adicionales')
          .update({ estado, costo_id: costoCreado?.id ?? null })
          .eq('id', a.id)
        if (errorUpd) throw errorUpd
      } else if (estado !== 'aprobado' && a.costo_id) {
        const { error: errorDel } = await supabase.from('costos').delete().eq('id', a.costo_id)
        if (errorDel) throw errorDel

        const { error: errorUpd } = await supabase
          .from('adicionales')
          .update({ estado, costo_id: null })
          .eq('id', a.id)
        if (errorUpd) throw errorUpd
      } else {
        const { error: errorUpd } = await supabase.from('adicionales').update({ estado }).eq('id', a.id)
        if (errorUpd) throw errorUpd
      }
    } catch (fallo) {
      console.error(fallo)
      const mensaje = fallo instanceof Error ? fallo.message : String(fallo)
      setError(
        mensaje.includes('check constraint') || mensaje.includes('column')
          ? `No se pudo actualizar el estado: falta correr agregar_gasto_extra_adicionales.sql en Supabase (${mensaje}).`
          : `No se pudo actualizar el estado del adicional: ${mensaje}`,
      )
      setProcesando(null)
      return
    }
    setProcesando(null)
    setRevision((v) => v + 1)
    onCambio?.()
  }

  async function verComprobante(a: Adicional) {
    if (!a.comprobante_path || abriendoComprobante !== null) return
    setAbriendoComprobante(a.id)
    setComprobanteAbierto(null)
    setErrorComprobante('')
    try {
      const resultado = await supabase.storage.from('comprobantes').createSignedUrl(a.comprobante_path, 300)
      if (resultado.error || !resultado.data?.signedUrl) {
        throw resultado.error ?? new Error('No se recibió un enlace al comprobante')
      }
      setComprobanteAbierto({ id: a.id, url: resultado.data.signedUrl })
    } catch (fallo) {
      console.error(fallo)
      setErrorComprobante('No se pudo abrir el comprobante. Volvé a intentar.')
    } finally {
      setAbriendoComprobante(null)
    }
  }

  const badge = (estado: Adicional['estado']) =>
    estado === 'aprobado' || estado === 'pagado'
      ? 'adicBadge aprobado'
      : estado === 'rechazado'
        ? 'adicBadge rechazado'
        : 'adicBadge pendiente'

  return (
    <section className="obraFotosSeccion" aria-label="Adicionales y modificaciones de la obra">
      <div className="seguimientoAcciones">
        <div>
          <h3>Adicionales y modificaciones</h3>
          <p>Historial de cambios posteriores al presupuesto. Solo los aprobados afectan el valor de la obra; los Gastos extra aprobados también se cargan como costo de la obra.</p>
        </div>
        {puedeEditar && (
          <button
            type="button"
            className="newButton"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : '+ Nuevo adicional'}
          </button>
        )}
      </div>

      {!cargando && !error && (
        <div className="adicResumen">
          <div>
            <span>Valor original</span>
            <strong>{moneda(valorOriginal)}</strong>
            <small>Presupuestos aceptados</small>
          </div>
          <div>
            <span>Adicionales aprobados</span>
            <strong className={aprobados >= 0 ? 'positivo' : 'negativo'}>
              {aprobados >= 0 ? '+' : ''}{moneda(aprobados)}
            </strong>
            <small>Suman al valor</small>
          </div>
          <div className="adicDestacado">
            <span>Valor actualizado</span>
            <strong>{moneda(valorActualizado)}</strong>
            <small>Original + aprobados</small>
          </div>
          <div>
            <span>Pendientes de aprobar</span>
            <strong>{moneda(pendientes)}</strong>
            <small>{adicionales.filter((a) => a.estado === 'pendiente').length} sin resolver</small>
          </div>
        </div>
      )}

      {mostrarForm && puedeEditar && (
        <form className="clienteForm adicForm" onSubmit={guardar}>
          <div className="formGrid">
            <label>
              Tipo
              <select value={form.tipo} onChange={(e) => cambiarTipo(e.target.value)}>
                {TIPOS_SELECCIONABLES.map(([valor, texto]) => (
                  <option key={valor} value={valor}>{texto}</option>
                ))}
              </select>
            </label>
            <label>
              Importe *
              <input
                type="number"
                step="0.01"
                required
                value={form.importe}
                onChange={(e) => cambio('importe', e.target.value)}
                placeholder={placeholderImporte(form.tipo)}
              />
            </label>
            <label>
              Fecha
              <input type="date" value={form.fecha} onChange={(e) => cambio('fecha', e.target.value)} />
            </label>
            <label className="adicAncho">
              Descripción *
              <input
                value={form.descripcion}
                onChange={(e) => cambio('descripcion', e.target.value)}
                placeholder="Ej.: 3 tomas adicionales en cocina"
              />
            </label>
            <label className="adicAncho">
              Motivo
              <input
                value={form.motivo}
                onChange={(e) => cambio('motivo', e.target.value)}
                placeholder="Ej.: pedido del cliente / cambio de plano"
              />
            </label>
            <label className="adicAncho">
              Observaciones
              <input value={form.observaciones} onChange={(e) => cambio('observaciones', e.target.value)} />
            </label>
          </div>

          {form.tipo === 'gasto_extra' && (
            <div className="formGrid" style={{ marginTop: '4px', paddingTop: '14px', borderTop: '1px dashed #e2e5e9' }}>
              <label>
                Cómo se pagó
                <select value={form.medioPago} onChange={(e) => cambio('medioPago', e.target.value)}>
                  {Object.entries(MEDIOS_PAGO).map(([valor, texto]) => (
                    <option key={valor} value={valor}>{texto}</option>
                  ))}
                </select>
              </label>
              <label>
                Dónde (proveedor / lugar)
                <input
                  value={form.proveedor}
                  onChange={(e) => cambio('proveedor', e.target.value)}
                  placeholder="Ej.: Ferretería Pérez"
                />
              </label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={form.tieneComprobante}
                  onChange={(e) =>
                    setForm((actual) => ({
                      ...actual,
                      tieneComprobante: e.target.checked,
                      comprobante: e.target.checked ? actual.comprobante : null,
                    }))
                  }
                  style={{ width: 'auto' }}
                />
                <span>Tengo factura / comprobante</span>
              </label>
              {form.tieneComprobante && (
                <label className="adicAncho">
                  Adjuntar comprobante
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) =>
                      setForm((actual) => ({ ...actual, comprobante: e.target.files?.[0] ?? null }))
                    }
                  />
                </label>
              )}
            </div>
          )}

          {errorForm && <p className="loginError">{errorForm}</p>}
          <div className="formActions">
            <button type="button" className="cancelButton" onClick={() => setMostrarForm(false)}>Cancelar</button>
            <button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar adicional'}</button>
          </div>
        </form>
      )}

      {cargando && <p role="status">Cargando adicionales...</p>}
      {error && <p className="loginError" role="alert">{error}</p>}
      {errorComprobante && <p className="loginError" role="alert">{errorComprobante}</p>}

      {!cargando && !error && (
        adicionales.length === 0 ? (
          <p className="adicVacio">Todavía no hay adicionales cargados en esta obra.</p>
        ) : (
          <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Detalle</th>
                  <th>Pago</th>
                  <th>Importe</th>
                  <th>Estado</th>
                  {puedeEditar && <th>Acción</th>}
                </tr>
              </thead>
              <tbody>
                {adicionales.map((a) => (
                  <tr key={a.id}>
                    <td>{fechaCorta(a.fecha)}</td>
                    <td>{TIPOS[a.tipo] ?? a.tipo}</td>
                    <td>
                      <strong>{a.descripcion}</strong>
                      {(a.motivo || a.observaciones) && (
                        <><br /><small>{[a.motivo, a.observaciones].filter(Boolean).join(' · ')}</small></>
                      )}
                    </td>
                    <td>
                      {a.tipo === 'gasto_extra' ? (
                        <>
                          <small>{[a.medio_pago ? MEDIOS_PAGO[a.medio_pago] ?? a.medio_pago : null, a.proveedor].filter(Boolean).join(' · ') || '—'}</small>
                          {a.comprobante_path ? (
                            <div>
                              <button type="button" className="editButton" disabled={abriendoComprobante !== null} onClick={() => void verComprobante(a)}>
                                {abriendoComprobante === a.id ? 'Preparando...' : 'Ver comprobante'}
                              </button>
                              {comprobanteAbierto?.id === a.id && (
                                <div><a href={comprobanteAbierto.url} target="_blank" rel="noopener noreferrer">Abrir archivo (enlace por 5 minutos)</a></div>
                              )}
                            </div>
                          ) : (
                            <div><small>Sin comprobante</small></div>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td className={a.importe < 0 ? 'negativo' : ''}>
                      <strong>{a.importe >= 0 ? '' : '−'}{moneda(Math.abs(a.importe))}</strong>
                    </td>
                    <td><span className={badge(a.estado)}>{a.estado}</span></td>
                    {puedeEditar && (
                      <td>
                        {a.estado === 'pendiente' ? (
                          <div className="adicAcciones">
                            <button type="button" className="adicOk" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'aprobado')}>Aprobar</button>
                            <button type="button" className="adicNo" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'rechazado')}>Rechazar</button>
                          </div>
                        ) : a.estado === 'aprobado' && a.tipo === 'gasto_extra' ? (
                          <div className="adicAcciones">
                            <button type="button" className="adicOk" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'pagado')}>✓ Pagado</button>
                            <button type="button" className="editButton" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'pendiente')}>Volver a pendiente</button>
                          </div>
                        ) : a.estado === 'pagado' ? (
                          <button type="button" className="editButton" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'aprobado')}>Deshacer pago</button>
                        ) : (
                          <button type="button" className="editButton" disabled={procesando === a.id} onClick={() => void cambiarEstado(a, 'pendiente')}>Volver a pendiente</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  )
}

export default AdicionalesObra
