import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { avisoGuardado } from './Animados'
import { moneda, fechaCorta, hoy } from './gestionFormat'
import { calcularPersona, MODALIDADES_PRINCIPALES, modalidadDePersona } from './personalCalculos'
import { confirmarEliminacion } from './confirmar'
import CampoNumero from './CampoNumero'

type Persona = {
  id: number
  nombre: string
  apellido: string | null
  tipo: string
  especialidad: string | null
  costo_dia: number | null
  modalidad_pago: string | null
}

// Cuenta de una persona en esta obra, para mostrarla al registrar un pago.
type ResumenPago = { texto: string; falta: number }
type Asignacion = {
  id: number
  obra_id: number
  personal_id: number | null
  rol_en_obra: string | null
  modalidad: string | null
  valor_acordado: number | null
  notas: string | null
}
type CostoPersonal = { id: number; personal_id: number | null; monto: number; fecha: string; descripcion: string | null }
type Jornal = { id: number; personal_id: number | null; fecha: string; jornada: number; horas: number | null; observaciones: string | null }

const MODALIDADES: Record<string, string> = {
  por_dia: 'Por día', por_hora: 'Por hora', por_obra: 'Por obra', porcentaje: 'Por porcentaje', por_etapa: 'Por etapa',
}

// Qué significa "valor acordado" según la modalidad.
const ETIQUETA_VALOR: Record<string, string> = {
  por_dia: 'Valor por día',
  por_hora: 'Valor por hora',
  por_obra: 'Valor total de la obra',
  por_etapa: 'Valor total (se paga según el avance)',
  porcentaje: 'Porcentaje del valor de la obra (%)',
}
const AYUDA_MODALIDAD: Record<string, string> = {
  por_dia: 'Le corresponde lo que cargues día a día (📅 Jornal) × el valor por día.',
  por_hora: 'Se calcula con las horas cargadas en los jornales × el valor por hora.',
  por_obra: 'Le corresponde el monto acordado × el % de avance de la obra.',
  por_etapa: 'Le corresponde el valor total × el % de avance de la obra.',
  porcentaje: 'Le corresponde ese % del valor de la obra × el % de avance.',
}
const nombreDe = (p?: Persona) => (p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : 'Persona')

// Texto corto con la condición pactada.
function textoCondicion(modalidad: string, valor: number, total: number | null, valorObra: number) {
  if (modalidad === 'por_dia') return valor > 0 ? `${moneda(valor)} por día` : 'Valor por día de la ficha'
  if (modalidad === 'por_hora') return valor > 0 ? `${moneda(valor)} por hora` : 'Sin valor por hora'
  if (modalidad === 'porcentaje') return `${valor.toLocaleString('es-AR')}% de ${moneda(valorObra)} = ${moneda(total ?? 0)}`
  return `${moneda(total ?? valor)} total`
}

function PersonalObra({ obraId, avance = 0, puedeEditar = true, onCambio, abrir }: { obraId: number; avance?: number; puedeEditar?: boolean; onCambio?: () => void; abrir?: { form: 'pago' | 'jornal'; n: number } | null }) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [pagos, setPagos] = useState<CostoPersonal[]>([])
  const [jornales, setJornales] = useState<Jornal[]>([])
  const [valorObra, setValorObra] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [formAbierto, setFormAbierto] = useState<'asignar' | 'pago' | 'jornal' | null>(null)
  const [asigEditar, setAsigEditar] = useState<Asignacion | null>(null)
  const [pagoEditar, setPagoEditar] = useState<CostoPersonal | null>(null)

  async function quitarAsignacion(a: Asignacion, nombre: string) {
    if (!confirmarEliminacion(`¿Quitar a ${nombre} de esta obra? (no borra los pagos ya registrados)`)) return
    const { error: fallo } = await supabase.from('obra_asignaciones').delete().eq('id', a.id)
    if (fallo) { console.error(fallo); window.alert('No se pudo quitar la asignación.'); return }
    setRevision((v) => v + 1); onCambio?.()
  }
  async function eliminarJornal(id: number) {
    if (!confirmarEliminacion('¿Eliminar este jornal?')) return
    const { error: fallo } = await supabase.from('jornales').delete().eq('id', id)
    if (fallo) { console.error(fallo); window.alert('No se pudo eliminar el jornal.'); return }
    setRevision((v) => v + 1); onCambio?.()
  }
  async function eliminarPago(id: number) {
    if (!confirmarEliminacion('¿Eliminar este pago? También desaparece del costo de la obra.')) return
    const { error: fallo } = await supabase.from('costos').delete().eq('id', id)
    if (fallo) { console.error(fallo); window.alert('No se pudo eliminar el pago.'); return }
    setRevision((v) => v + 1); onCambio?.()
  }

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      const [rPers, rAsig, rCostos, rJorn, rPres, rAdic] = await Promise.all([
        supabase.from('personal').select('id,nombre,apellido,tipo,especialidad,costo_dia,modalidad_pago').eq('activo', true).order('nombre'),
        supabase.from('obra_asignaciones').select('id,obra_id,personal_id,rol_en_obra,modalidad,valor_acordado,notas').eq('obra_id', obraId),
        supabase.from('costos').select('id,personal_id,monto,fecha,descripcion').eq('obra_id', obraId).in('tipo', ['mano_obra', 'terciarizado']).order('fecha', { ascending: false }),
        supabase.from('jornales').select('id,personal_id,fecha,jornada,horas,observaciones').eq('obra_id', obraId).order('fecha', { ascending: false }),
        supabase.from('presupuestos').select('total,estado,activo').eq('obra_id', obraId),
        supabase.from('adicionales').select('importe,estado,tipo').eq('obra_id', obraId),
      ])
      if (!vigente) return
      if (rAsig.error || rPers.error) {
        console.error(rAsig.error || rPers.error)
        setError('Falta ejecutar supabase-personal-fase-8.sql en Supabase.')
        setCargando(false)
        return
      }
      setPersonas((rPers.data ?? []).map((p: Persona) => ({ ...p, costo_dia: p.costo_dia == null ? null : Number(p.costo_dia) })) as Persona[])
      setAsignaciones((rAsig.data ?? []).map((a: Asignacion) => ({ ...a, valor_acordado: a.valor_acordado == null ? null : Number(a.valor_acordado) })) as Asignacion[])
      setPagos(rCostos.error ? [] : (rCostos.data ?? []).map((c: CostoPersonal) => ({ ...c, monto: Number(c.monto) })) as CostoPersonal[])
      setJornales(rJorn.error ? [] : (rJorn.data ?? []).map((j: Jornal) => ({ ...j, jornada: Number(j.jornada), horas: j.horas == null ? null : Number(j.horas) })) as Jornal[])

      // Valor de la obra: presupuestos aceptados + adicionales aprobados.
      // El Gasto extra queda afuera: es plata que se le devuelve al cliente, no
      // valor de la obra, y no puede inflar lo que le corresponde cobrar al
      // personal que cobra por porcentaje o por obra/etapa.
      const presupuestos = (rPres.error ? [] : (rPres.data ?? [])) as { total: number | string; estado: string; activo: boolean }[]
      const adicionales = (rAdic.error ? [] : (rAdic.data ?? [])) as { importe: number | string; estado: string; tipo: string }[]
      setValorObra(
        presupuestos.filter((p) => p.activo !== false && p.estado === 'aceptado').reduce((s, p) => s + (Number(p.total) || 0), 0) +
        adicionales.filter((a) => a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + (Number(a.importe) || 0), 0),
      )
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [obraId, revision])

  const personaPorId = (id: number | null) => personas.find((p) => p.id === id)

  const filas = useMemo(() => asignaciones.map((a) => ({
    asig: a,
    persona: personas.find((p) => p.id === a.personal_id),
    calculo: calcularPersona(a, personas.find((p) => p.id === a.personal_id), pagos, jornales, valorObra, avance),
  })), [asignaciones, pagos, jornales, personas, valorObra, avance])

  // "Falta pagar" es sobre el total pactado con cada persona (no sobre el
  // avance): si pactaste 500.000 por toda la obra y ya le pagaste 300.000,
  // faltan 200.000, sin importar si la obra tuvo un adicional que subió su
  // valor. Para quienes cobran por día/hora no hay un total fijo (crece con
  // los jornales), así que ahí se sigue comparando lo devengado vs lo pagado.
  const totales = filas.reduce((acc, f) => {
    const c = f.calculo
    const saldo = c.totalContrato != null ? Math.max(c.totalContrato - c.pagado, 0) : Math.max(c.diferencia, 0)
    const sobrepago = c.totalContrato != null ? Math.max(c.pagado - c.totalContrato, 0) : Math.max(-c.diferencia, 0)
    return {
      devengado: acc.devengado + c.devengado,
      pagado: acc.pagado + c.pagado,
      falta: acc.falta + saldo,
      adelanto: acc.adelanto + sobrepago,
      jornadas: acc.jornadas + c.jornadas,
    }
  }, { devengado: 0, pagado: 0, falta: 0, adelanto: 0, jornadas: 0 })

  function recargar() { setFormAbierto(null); setRevision((v) => v + 1); onCambio?.() }

  // Abierto desde "Registrar" en la ficha: va directo al formulario (si no hay
  // nadie asignado, primero hay que asignar a la persona).
  useEffect(() => {
    if (!abrir || cargando || Date.now() - abrir.n > 15000) return
    setFormAbierto(asignados.length ? abrir.form : 'asignar')
    setTimeout(() => document.querySelector('[data-registrar]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }, [abrir?.n, cargando]) // eslint-disable-line react-hooks/exhaustive-deps

  const asignados = filas.map((f) => f.persona).filter(Boolean) as Persona[]

  // Qué trabajó, qué le corresponde y qué falta pagarle a cada uno (para el formulario de pago).
  const resumenPago: Record<number, ResumenPago> = {}
  for (const f of filas) {
    if (f.asig.personal_id == null) continue
    const c = f.calculo
    if (c.totalContrato == null) {
      const valor = c.jornadas > 0 ? c.devengado / (c.modalidad === 'por_hora' ? (c.horas || 1) : c.jornadas) : c.valorBase || f.persona?.costo_dia || 0
      const cantidad = c.modalidad === 'por_hora' ? `${c.horas.toLocaleString('es-AR')} h` : `${c.jornadas.toLocaleString('es-AR')} ${c.jornadas === 1 ? 'día' : 'días'}`
      resumenPago[f.asig.personal_id] = {
        texto: `Trabajó ${cantidad} × ${moneda(valor)} = ${moneda(c.devengado)} · Pagado ${moneda(c.pagado)} · ${c.diferencia > 0.5 ? `Falta pagar ${moneda(c.diferencia)}` : c.diferencia < -0.5 ? `Adelantado ${moneda(-c.diferencia)}` : 'Al día'}`,
        falta: Math.max(0, c.diferencia),
      }
    } else {
      const falta = Math.max(0, c.devengado - c.pagado)
      resumenPago[f.asig.personal_id] = {
        texto: `Acordado ${moneda(c.totalContrato)} · Avance ${Math.min(Math.max(avance || 0, 0), 100)}% → corresponde hoy ${moneda(c.devengado)} · Pagado ${moneda(c.pagado)} · ${falta > 0.5 ? `Falta pagar hoy ${moneda(falta)}` : c.pagado - c.devengado > 0.5 ? `Adelantado ${moneda(c.pagado - c.devengado)}` : 'Al día'}`,
        falta,
      }
    }
  }
  const sinAsignar = personas.filter((p) => !asignaciones.some((a) => a.personal_id === p.id))
  const avanceOk = Math.min(Math.max(avance || 0, 0), 100)

  return (
    <section className="obraFotosSeccion" aria-label="Personal de la obra">
      <div className="seguimientoAcciones">
        <div>
          <h3>Personal de la obra</h3>
          <p>Lo pactado con cada persona, lo que le corresponde cobrar según el avance o los jornales, y lo que ya se le pagó. Los pagos impactan como egreso de la obra.</p>
        </div>
        {puedeEditar && (
          <div className="adicAcciones">
            <button type="button" className="newButton" onClick={() => setFormAbierto(formAbierto === 'asignar' ? null : 'asignar')}>+ Asignar persona</button>
            {asignados.length > 0 && <button type="button" className="editButton" onClick={() => setFormAbierto(formAbierto === 'pago' ? null : 'pago')}>💵 Pago</button>}
            {asignados.length > 0 && <button type="button" className="editButton" onClick={() => setFormAbierto(formAbierto === 'jornal' ? null : 'jornal')}>📅 Jornal</button>}
          </div>
        )}
      </div>

      {!cargando && !error && (
        <div className="adicResumen">
          <div><span>Corresponde pagar hoy</span><strong>{moneda(totales.devengado)}</strong><small>{asignados.length} persona(s) · avance {avanceOk}%</small></div>
          <div><span>Pagado</span><strong>{moneda(totales.pagado)}</strong><small>Egreso de la obra</small></div>
          <div className="adicDestacado">
            <span>Falta pagar</span><strong>{moneda(totales.falta)}</strong>
            <small>{totales.adelanto > 0 ? `Además hay ${moneda(totales.adelanto)} pagados por adelantado` : 'Sobre el total pactado con cada persona'}</small>
          </div>
          <div><span>Jornales</span><strong>{totales.jornadas.toLocaleString('es-AR')}</strong><small>Días registrados</small></div>
        </div>
      )}

      {formAbierto === 'asignar' && puedeEditar && !asigEditar && (<div data-registrar>
        {abrir && !asignados.length && <p className="gestionAyuda">Primero asigná a la persona a esta obra; después vas a poder cargarle pagos y jornales.</p>}
        <FormAsignar obraId={obraId} personas={sinAsignar} onCancelar={() => setFormAbierto(null)} onGuardado={recargar} />
      </div>)}
      {asigEditar && puedeEditar && (
        <FormAsignar obraId={obraId} personas={personas} asignacion={asigEditar} nombrePersona={nombreDe(personaPorId(asigEditar.personal_id))} onCancelar={() => setAsigEditar(null)} onGuardado={() => { setAsigEditar(null); setRevision((v) => v + 1); onCambio?.() }} />
      )}
      {formAbierto === 'pago' && puedeEditar && (<div data-registrar>
        <FormPago obraId={obraId} personas={asignados} resumen={resumenPago} onCancelar={() => setFormAbierto(null)} onGuardado={recargar} />
      </div>)}
      {pagoEditar && puedeEditar && (
        <FormPago obraId={obraId} personas={asignados} pago={pagoEditar} personaFija={personaPorId(pagoEditar.personal_id)}
          onCancelar={() => setPagoEditar(null)} onGuardado={() => { setPagoEditar(null); recargar() }} />
      )}
      {formAbierto === 'jornal' && puedeEditar && (<div data-registrar>
        <FormJornal obraId={obraId} personas={asignados} porDia={new Set(filas.filter((f) => f.calculo.totalContrato == null).map((f) => f.asig.personal_id as number))} onCancelar={() => setFormAbierto(null)} onGuardado={recargar} />
      </div>)}

      {cargando && <p role="status">Cargando personal...</p>}
      {error && <p className="loginError" role="alert">{error}</p>}

      {!cargando && !error && (
        filas.length === 0 ? (
          <p className="adicVacio">Todavía no hay personal asignado a esta obra.</p>
        ) : (
          <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Persona</th><th>Condición pactada</th><th>Corresponde pagar hoy</th><th>Pagado</th><th>Saldo</th><th>Jornales</th>{puedeEditar && <th>Acción</th>}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const c = f.calculo
                  const saldoContrato = c.totalContrato != null ? c.totalContrato - c.pagado : 0
                  return (
                    <tr key={f.asig.id}>
                      <td>
                        <strong>{nombreDe(f.persona)}</strong>
                        {(f.persona?.especialidad || f.asig.rol_en_obra) && (
                          <><br /><small>{[f.persona?.especialidad, f.asig.rol_en_obra].filter(Boolean).join(' · ')}</small></>
                        )}
                      </td>
                      <td>
                        {MODALIDADES[c.modalidad] ?? c.modalidad}
                        <br /><small>{textoCondicion(c.modalidad, c.valorBase, c.totalContrato, valorObra)}</small>
                        {c.faltaValor && <><br /><small style={{ color: '#b23b32' }}>Falta cargar el valor para calcular</small></>}
                      </td>
                      <td>{moneda(c.devengado)}</td>
                      <td>{moneda(c.pagado)}</td>
                      <td>
                        {c.totalContrato != null ? (
                          <>
                            {saldoContrato > 0
                              ? <><strong style={{ color: '#b86608' }}>{moneda(saldoContrato)}</strong><br /><small>falta pagar (sobre lo pactado)</small></>
                              : saldoContrato < 0
                                ? <><strong style={{ color: '#23764e' }}>{moneda(-saldoContrato)}</strong><br /><small>pagado por adelantado</small></>
                                : <span className="adicBadge aprobado">al día</span>}
                            <br /><small>Según el avance ({avanceOk}%), corresponde hoy: {moneda(c.devengado)}</small>
                          </>
                        ) : (
                          c.diferencia > 0
                            ? <><strong style={{ color: '#b86608' }}>{moneda(c.diferencia)}</strong><br /><small>falta pagar</small></>
                            : c.diferencia < 0
                              ? <><strong style={{ color: '#23764e' }}>{moneda(-c.diferencia)}</strong><br /><small>pagado por adelantado</small></>
                              : <span className="adicBadge aprobado">al día</span>
                        )}
                      </td>
                      <td>
                        {c.jornadas ? c.jornadas.toLocaleString('es-AR') : '—'}
                        {c.modalidad === 'por_hora' && c.horas > 0 && <><br /><small>{c.horas.toLocaleString('es-AR')} h</small></>}
                      </td>
                      {puedeEditar && (
                        <td>
                          <div className="adicAcciones">
                            <button type="button" className="editButton" onClick={() => { setAsigEditar(f.asig); setFormAbierto(null) }}>Editar</button>
                            <button type="button" className="adicNo" onClick={() => quitarAsignacion(f.asig, nombreDe(f.persona))}>Quitar</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {!cargando && !error && pagos.length > 0 && (
        <details className="adicDetalle">
          <summary>Ver pagos al personal ({pagos.length})</summary>
          <div className="gestionTabla" style={{ overflowX: 'auto', marginTop: 10 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Persona</th><th>Detalle</th><th>Monto</th>{puedeEditar && <th>Acción</th>}</tr></thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.fecha ? fechaCorta(p.fecha.slice(0, 10)) : '—'}</td>
                    <td>{p.personal_id != null ? nombreDe(personaPorId(p.personal_id)) : '—'}</td>
                    <td>{p.descripcion || '—'}</td>
                    <td><strong>{moneda(p.monto)}</strong></td>
                    {puedeEditar && (
                      <td>
                        <div className="adicAcciones">
                          <button type="button" className="editButton" onClick={() => { setPagoEditar(p); setFormAbierto(null) }}>Editar</button>
                          <button type="button" className="adicNo" onClick={() => eliminarPago(p.id)}>Eliminar</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {!cargando && !error && jornales.length > 0 && (
        <details className="adicDetalle">
          <summary>Ver jornales registrados ({jornales.length})</summary>
          <div className="gestionTabla" style={{ overflowX: 'auto', marginTop: 10 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Persona</th><th>Jornada</th><th>Horas</th><th>Observaciones</th>{puedeEditar && <th></th>}</tr></thead>
              <tbody>
                {jornales.map((j) => (
                  <tr key={j.id}>
                    <td>{fechaCorta(j.fecha)}</td>
                    <td>{nombreDe(personaPorId(j.personal_id))}</td>
                    <td>{j.jornada.toLocaleString('es-AR')}</td>
                    <td>{j.horas != null ? j.horas.toLocaleString('es-AR') : '—'}</td>
                    <td>{j.observaciones || '—'}</td>
                    {puedeEditar && <td><button type="button" className="adicNo" onClick={() => eliminarJornal(j.id)}>Eliminar</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}

function FormAsignar({ obraId, personas, asignacion, nombrePersona, onCancelar, onGuardado }: { obraId: number; personas: Persona[]; asignacion?: Asignacion; nombrePersona?: string; onCancelar: () => void; onGuardado: () => void }) {
  const editando = !!asignacion
  const [f, setF] = useState({
    personal_id: asignacion ? String(asignacion.personal_id ?? '') : '',
    modalidad: asignacion?.modalidad ?? 'por_obra',
    valor_acordado: asignacion?.valor_acordado ? String(asignacion.valor_acordado) : '',
    rol_en_obra: asignacion?.rol_en_obra ?? '',
    notas: asignacion?.notas ?? '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setF((a) => ({ ...a, [k]: v }))
  // Al elegir la persona se toma cómo cobra según su ficha: por día trae su jornal; por acuerdo pide el monto de esta obra.
  function elegirPersona(id: string) {
    const p = personas.find((x) => x.id === Number(id))
    const modalidad = modalidadDePersona(p?.modalidad_pago)
    setF((a) => ({ ...a, personal_id: id, modalidad, valor_acordado: modalidad !== 'por_obra' && p?.costo_dia ? String(p.costo_dia) : '' }))
  }
  function cambiarModalidad(modalidad: string) {
    const p = personas.find((x) => x.id === Number(f.personal_id))
    setF((a) => ({ ...a, modalidad, valor_acordado: (modalidad === 'por_dia' || modalidad === 'por_hora') && p?.costo_dia ? String(p.costo_dia) : modalidad === a.modalidad ? a.valor_acordado : '' }))
  }
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!f.personal_id) { setError('Elegí una persona.'); return }
    if (!(Number(f.valor_acordado) > 0)) { setError(f.modalidad === 'por_obra' || f.modalidad === 'por_etapa' ? 'Ingresá el monto acordado para esta obra.' : f.modalidad === 'porcentaje' ? 'Ingresá el porcentaje.' : 'Ingresá el valor por día.'); return }
    if (f.modalidad === 'porcentaje' && Number(f.valor_acordado) > 100) { setError('El porcentaje no puede ser mayor que 100.'); return }
    setGuardando(true)
    const datos = {
      obra_id: obraId, personal_id: Number(f.personal_id), modalidad: f.modalidad,
      valor_acordado: f.valor_acordado ? Number(f.valor_acordado) : 0,
      rol_en_obra: f.rol_en_obra.trim() || null, notas: f.notas.trim() || null,
    }
    const { error: fallo } = editando
      ? await supabase.from('obra_asignaciones').update(datos).eq('id', asignacion!.id)
      : await supabase.from('obra_asignaciones').insert(datos)
    if (fallo) { console.error(fallo); setError('No se pudo guardar.'); setGuardando(false); return }
    avisoGuardado(editando ? 'Cambios guardados' : 'Persona asignada')
    onGuardado()
  }
  return (
    <form className="clienteForm adicForm" onSubmit={guardar}>
      <div className="formGrid">
        {editando
          ? <label>Persona<input value={nombrePersona ?? ''} disabled /></label>
          : <label>Persona *<select required value={f.personal_id} onChange={(e) => elegirPersona(e.target.value)}><option value="">Seleccionar</option>{personas.map((p) => <option key={p.id} value={p.id}>{nombreDe(p)}{p.especialidad ? ` · ${p.especialidad}` : ''} · {modalidadDePersona(p.modalidad_pago) === 'por_obra' ? 'por acuerdo' : 'por día'}</option>)}</select></label>}
        <label>Cómo se le paga<select value={f.modalidad} onChange={(e) => cambiarModalidad(e.target.value)}>{MODALIDADES_PRINCIPALES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}{!MODALIDADES_PRINCIPALES.some(([v]) => v === f.modalidad) && <option value={f.modalidad}>{MODALIDADES[f.modalidad] ?? f.modalidad}</option>}</select></label>
        <label>{f.modalidad === 'por_obra' ? 'Monto acordado por esta obra *' : f.modalidad === 'por_dia' ? 'Valor por día (jornal) *' : `${ETIQUETA_VALOR[f.modalidad] ?? 'Valor acordado'} *`}<CampoNumero min="0" max={f.modalidad === 'porcentaje' ? 100 : undefined} value={f.valor_acordado} onChange={(e) => set('valor_acordado', e.target.value)} /></label>
        <label>Función en la obra<input value={f.rol_en_obra} onChange={(e) => set('rol_en_obra', e.target.value)} placeholder="Ej.: Instalador" /></label>
        <label className="adicAncho">Notas<input value={f.notas} onChange={(e) => set('notas', e.target.value)} /></label>
      </div>
      <p className="gestionAyuda">{AYUDA_MODALIDAD[f.modalidad]}</p>
      {personas.length === 0 && <p className="gestionAyuda">Ya están todas las personas activas asignadas. Cargá más en el módulo Personal.</p>}
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando || personas.length === 0}>{guardando ? 'Guardando...' : editando ? 'Guardar' : 'Asignar'}</button></div>
    </form>
  )
}

// Separa el "detalle" libre que se cargó al registrar el pago del prefijo fijo
// "Pago a <nombre>" que arma guardar(). Si la descripción no tiene ese formato
// (pagos viejos, por ejemplo), se muestra completa como detalle.
function detalleDesdePago(descripcion: string | null, nombrePersona: string): string {
  if (!descripcion) return ''
  const prefijoConDetalle = `Pago a ${nombrePersona} · `
  if (descripcion.startsWith(prefijoConDetalle)) return descripcion.slice(prefijoConDetalle.length)
  if (descripcion === `Pago a ${nombrePersona}`) return ''
  return descripcion
}

function FormPago({ obraId, personas, resumen = {}, pago, personaFija, onCancelar, onGuardado }: {
  obraId: number
  personas: Persona[]
  resumen?: Record<number, ResumenPago>
  pago?: CostoPersonal
  personaFija?: Persona
  onCancelar: () => void
  onGuardado: () => void
}) {
  const editando = !!pago
  const [f, setF] = useState({
    // Con una sola persona en la obra, ya queda elegida.
    personal_id: editando ? String(pago!.personal_id ?? '') : personas.length === 1 ? String(personas[0].id) : '',
    monto: editando ? String(pago!.monto) : '',
    fecha: editando ? pago!.fecha.slice(0, 10) : hoy(),
    detalle: editando ? detalleDesdePago(pago!.descripcion, nombreDe(personaFija)) : '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setF((a) => ({ ...a, [k]: v }))
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    const persona = editando ? personaFija : personas.find((p) => p.id === Number(f.personal_id))
    const monto = Number(f.monto)
    if (!persona) { setError('Elegí una persona.'); return }
    if (!(monto > 0)) { setError('Ingresá un monto mayor que cero.'); return }
    setGuardando(true)
    const datos = {
      monto, fecha: f.fecha,
      descripcion: `Pago a ${nombreDe(persona)}${f.detalle.trim() ? ` · ${f.detalle.trim()}` : ''}`,
    }
    const { error: fallo } = editando
      ? await supabase.from('costos').update(datos).eq('id', pago!.id)
      : await supabase.from('costos').insert({
          obra_id: obraId, personal_id: persona.id,
          tipo: persona.tipo === 'terciarizado' ? 'terciarizado' : 'mano_obra',
          ...datos,
        })
    if (fallo) { console.error(fallo); setError('No se pudo guardar el pago.'); setGuardando(false); return }
    avisoGuardado('Pago guardado')
    onGuardado()
  }
  return (
    <form className="clienteForm adicForm" onSubmit={guardar}>
      <div className="formGrid">
        {editando
          ? <label>Persona<input value={nombreDe(personaFija)} disabled /></label>
          : <label>Persona *<select required value={f.personal_id} onChange={(e) => {
              const id = e.target.value
              const sugerido = resumen[Number(id)]?.falta ?? 0
              // Se propone lo que falta pagar; se puede cambiar (por ejemplo, un adelanto).
              setF((a) => ({ ...a, personal_id: id, monto: sugerido > 0.5 ? String(Math.round(sugerido * 100) / 100) : a.monto }))
            }}><option value="">Seleccionar</option>{personas.map((p) => <option key={p.id} value={p.id}>{nombreDe(p)}</option>)}</select></label>}
        {!editando && resumen[Number(f.personal_id)] && <p className="pagoResumen adicAncho">{resumen[Number(f.personal_id)].texto}</p>}
        <label>Monto *<CampoNumero min="0.01" required value={f.monto} onChange={(e) => set('monto', e.target.value)} /></label>
        <label>Fecha *<input type="date" required value={f.fecha} onChange={(e) => set('fecha', e.target.value)} /></label>
        <label className="adicAncho">Detalle<input value={f.detalle} onChange={(e) => set('detalle', e.target.value)} placeholder="Ej.: adelanto, liquidación semana 2" /></label>
      </div>
      <p className="gestionAyuda">El pago se registra como egreso de la obra (mano de obra) y se ve en Finanzas.</p>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Registrar pago'}</button></div>
    </form>
  )
}

function FormJornal({ obraId, personas, porDia = new Set<number>(), onCancelar, onGuardado }: { obraId: number; personas: Persona[]; porDia?: Set<number>; onCancelar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ personal_id: personas.length === 1 ? String(personas[0].id) : '', fecha: hoy(), jornada: '1', horas: '', observaciones: '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setF((a) => ({ ...a, [k]: v }))
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!f.personal_id) { setError('Elegí una persona.'); return }
    if (!(Number(f.jornada) > 0)) { setError('La jornada debe ser mayor que cero (usá 0,5 para media).'); return }
    setGuardando(true)
    const { error: fallo } = await supabase.from('jornales').insert({
      obra_id: obraId, personal_id: Number(f.personal_id), fecha: f.fecha,
      jornada: Number(f.jornada), horas: f.horas ? Number(f.horas) : null,
      observaciones: f.observaciones.trim() || null,
    })
    if (fallo) { console.error(fallo); setError('No se pudo registrar el jornal.'); setGuardando(false); return }
    avisoGuardado('Jornal registrado')
    onGuardado()
  }
  return (
    <form className="clienteForm adicForm" onSubmit={guardar}>
      <div className="formGrid">
        <label>Persona *<select required value={f.personal_id} onChange={(e) => set('personal_id', e.target.value)}><option value="">Seleccionar</option>
          {personas.some((p) => porDia.has(p.id)) && <optgroup label="Cobran por día">{personas.filter((p) => porDia.has(p.id)).map((p) => <option key={p.id} value={p.id}>{nombreDe(p)}</option>)}</optgroup>}
          {personas.some((p) => !porDia.has(p.id)) && <optgroup label="Por acuerdo (solo asistencia, no suma a cobrar)">{personas.filter((p) => !porDia.has(p.id)).map((p) => <option key={p.id} value={p.id}>{nombreDe(p)}</option>)}</optgroup>}
        </select></label>
        <label>Fecha *<input type="date" required value={f.fecha} onChange={(e) => set('fecha', e.target.value)} /></label>
        <label>Jornada *<CampoNumero min="0.25" required value={f.jornada} onChange={(e) => set('jornada', e.target.value)} placeholder="1 = día, 0,5 = medio" /></label>
        <label>Horas (opcional)<CampoNumero min="0" value={f.horas} onChange={(e) => set('horas', e.target.value)} /></label>
        <label className="adicAncho">Observaciones<input value={f.observaciones} onChange={(e) => set('observaciones', e.target.value)} /></label>
      </div>
      <p className="gestionAyuda">El jornal registra asistencia y, si la persona cobra por día u hora, suma a lo que le corresponde cobrar. No genera un pago automático: el pago se registra aparte con el botón Pago.</p>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Registrar jornal'}</button></div>
    </form>
  )
}

export default PersonalObra
