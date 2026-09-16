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
  estado: 'pendiente' | 'aprobado' | 'rechazado'
  fecha: string
  observaciones: string | null
  created_at: string
}

type Props = {
  obraId: number
  /** Solo admin/encargado pueden aprobar o cargar. */
  puedeEditar?: boolean
  /** Avisa al padre que la economía cambió (para refrescar valor actualizado). */
  onCambio?: () => void
}

const TIPOS: Record<string, string> = {
  adicional: 'Adicional',
  producto: 'Producto extra',
  servicio: 'Servicio extra',
  cambio: 'Cambio de alcance',
  ajuste: 'Ajuste',
  bonificacion: 'Bonificación',
}

const formInicial = {
  tipo: 'adicional',
  descripcion: '',
  motivo: '',
  importe: '',
  fecha: hoy(),
  observaciones: '',
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
        setError('Falta ejecutar supabase-adicionales-fase-7.sql en Supabase.')
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

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    setErrorForm('')
    const importe = Number(form.importe)
    if (!form.descripcion.trim()) {
      setErrorForm('Escribí una descripción del adicional.')
      return
    }
    if (!Number.isFinite(importe) || importe === 0) {
      setErrorForm('Ingresá un importe distinto de cero (usá negativo para bonificaciones).')
      return
    }
    setGuardando(true)
    const { error: fallo } = await supabase.from('adicionales').insert({
      obra_id: obraId,
      tipo: form.tipo,
      descripcion: form.descripcion.trim(),
      motivo: form.motivo.trim() || null,
      importe,
      fecha: form.fecha,
      observaciones: form.observaciones.trim() || null,
      estado: 'pendiente',
    })
    if (fallo) {
      console.error(fallo)
      setErrorForm('No se pudo guardar el adicional. Volvé a intentar.')
      setGuardando(false)
      return
    }
    setGuardando(false)
    setForm(formInicial)
    setMostrarForm(false)
    setRevision((v) => v + 1)
    onCambio?.()
  }

  async function cambiarEstado(id: number, estado: Adicional['estado']) {
    setProcesando(id)
    const { error: fallo } = await supabase
      .from('adicionales')
      .update({ estado })
      .eq('id', id)
    setProcesando(null)
    if (fallo) {
      console.error(fallo)
      setError('No se pudo actualizar el estado del adicional.')
      return
    }
    setRevision((v) => v + 1)
    onCambio?.()
  }

  const badge = (estado: Adicional['estado']) =>
    estado === 'aprobado'
      ? 'adicBadge aprobado'
      : estado === 'rechazado'
        ? 'adicBadge rechazado'
        : 'adicBadge pendiente'

  return (
    <section className="obraFotosSeccion" aria-label="Adicionales y modificaciones de la obra">
      <div className="seguimientoAcciones">
        <div>
          <h3>Adicionales y modificaciones</h3>
          <p>Historial de cambios posteriores al presupuesto. Solo los aprobados afectan el valor de la obra.</p>
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
              <select value={form.tipo} onChange={(e) => cambio('tipo', e.target.value)}>
                {Object.entries(TIPOS).map(([valor, texto]) => (
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
                placeholder="Negativo = bonificación"
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
          {errorForm && <p className="loginError">{errorForm}</p>}
          <div className="formActions">
            <button type="button" className="cancelButton" onClick={() => setMostrarForm(false)}>Cancelar</button>
            <button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar adicional'}</button>
          </div>
        </form>
      )}

      {cargando && <p role="status">Cargando adicionales...</p>}
      {error && <p className="loginError" role="alert">{error}</p>}

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
                  <th>Descripción</th>
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
                    <td className={a.importe < 0 ? 'negativo' : ''}>
                      <strong>{a.importe >= 0 ? '' : '−'}{moneda(Math.abs(a.importe))}</strong>
                    </td>
                    <td><span className={badge(a.estado)}>{a.estado}</span></td>
                    {puedeEditar && (
                      <td>
                        {a.estado === 'pendiente' ? (
                          <div className="adicAcciones">
                            <button type="button" className="adicOk" disabled={procesando === a.id} onClick={() => void cambiarEstado(a.id, 'aprobado')}>Aprobar</button>
                            <button type="button" className="adicNo" disabled={procesando === a.id} onClick={() => void cambiarEstado(a.id, 'rechazado')}>Rechazar</button>
                          </div>
                        ) : (
                          <button type="button" className="editButton" disabled={procesando === a.id} onClick={() => void cambiarEstado(a.id, 'pendiente')}>Volver a pendiente</button>
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
