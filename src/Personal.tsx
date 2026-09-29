import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Pedido } from './BuscadorGlobal'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'
import { calcularPersona, MODALIDADES_PRINCIPALES, modalidadDePersona, type CalculoPersona } from './personalCalculos'
import { armarPdfCuenta } from './pdfPersonal'
import VistaPreviaPdf from './VistaPreviaPdf'
import { linkWhatsApp } from './whatsapp'
import { confirmarEliminacion } from './confirmar'

// Personal: equipo con lo que se le debe a cada uno, parte diario (jornales de
// varios a la vez), liquidación semanal y movimientos. Los pagos se guardan en
// "costos" (mano de obra de cada obra) y los días en "jornales": son los mismos
// datos que usan la ficha de la obra, Finanzas y el PDF de cuenta.

type Persona = {
  id: number; nombre: string; apellido: string | null; tipo: string; telefono: string | null
  costo_dia: number | null; especialidad: string | null; modalidad_pago: string | null; activo: boolean
  // Datos personales (columnas nuevas; si falta el SQL quedan vacías).
  documento?: string | null; cuil?: string | null; contacto_emergencia?: string | null
  seguro?: string | null; seguro_vencimiento?: string | null; notas?: string | null
}
type Obra = { id: number; nombre_obra: string; activo: boolean; porcentaje_avance: number; estado: string | null }
type Asignacion = { id: number; obra_id: number; personal_id: number | null; rol_en_obra: string | null; modalidad: string | null; valor_acordado: number | null }
type Costo = { id: number; obra_id: number; personal_id: number | null; tipo: string; descripcion: string | null; monto: number; fecha: string }
type Jornal = { id: number; obra_id: number; personal_id: number | null; fecha: string; jornada: number; horas: number | null; observaciones: string | null }
type PresupuestoObra = { obra_id: number; total: number; estado: string; activo: boolean }
type AdicionalObra = { obra_id: number; importe: number; estado: string; tipo: string }

type Datos = {
  personas: Persona[]; obras: Obra[]; asignaciones: Asignacion[]; costos: Costo[]; jornales: Jornal[]
  presupuestos: PresupuestoObra[]; adicionales: AdicionalObra[]; conDatosPersonales: boolean
}

// Situación de una persona en una obra (una asignación).
type LineaObra = { asig: Asignacion; obra: Obra | undefined; calc: CalculoPersona; porJornal: boolean }
type Situacion = {
  persona: Persona
  lineas: LineaObra[]
  saldo: number          // + le debés / − pagado de más (neto de todas sus obras)
  saldoJornal: number    // parte del saldo que viene de obras por día/hora
  saldoAcuerdo: number   // parte que viene de obras por acuerdo (según avance)
  sueltos: number        // pagos en obras donde no está asignado (se descuentan)
  diasMes: number
  diasSemana: number
  pagadoMes: number
  ultimoPago: string | null
}

type Pestana = 'equipo' | 'liquidacion' | 'movimientos'

const MODALIDADES: Record<string, string> = {
  por_dia: 'Por día', por_hora: 'Por hora', por_obra: 'Por acuerdo', porcentaje: 'Por porcentaje', por_etapa: 'Por etapa',
}
const TIPOS: Record<string, string> = { obrero: 'Obrero', auxiliar: 'Auxiliar', terciarizado: 'Tercerizado' }
const num = (x: unknown) => Number(x) || 0
const redondear = (n: number) => Math.round(n * 100) / 100
const nombrePersona = (p: Persona | undefined) => (p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : 'Sin persona')
const esJornal = (modalidad: string | null) => modalidad === 'por_dia' || modalidad === 'por_hora'
const aTexto = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hoyTexto = () => aTexto(new Date())
const sumarDias = (f: string, n: number) => { const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() + n); return aTexto(d) }
// La semana va de lunes a domingo; el pago del jornal es al cierre.
const lunesDe = (f: string) => { const d = new Date(`${f}T12:00:00`); const dia = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dia); return aTexto(d) }
const diasHasta = (f: string) => Math.round((new Date(`${f.slice(0, 10)}T12:00:00`).getTime() - new Date(`${hoyTexto()}T12:00:00`).getTime()) / 86400000)
const fechaLarga = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' })

// Lee una tabla completa en tandas de 500 filas (evita el tope por defecto de Supabase).
async function leerTodo<T>(tabla: string, columnas: string, extra?: (q: any) => any): Promise<T[]> {
  const filas: T[] = []
  for (let inicio = 0; ; inicio += 500) {
    let consulta = supabase.from(tabla).select(columnas).order('id').range(inicio, inicio + 499)
    if (extra) consulta = extra(consulta)
    const r = await consulta
    if (r.error) throw r.error
    filas.push(...((r.data ?? []) as T[]))
    if ((r.data ?? []).length < 500) return filas
  }
}

async function cargarDatos(): Promise<Datos> {
  const [personas, obras, asig, costos, jornales, pres, adic, extra] = await Promise.all([
    leerTodo<Persona>('personal', '*'),
    leerTodo<Obra>('obras', 'id,nombre_obra,activo,porcentaje_avance,estado'),
    leerTodo<Asignacion>('obra_asignaciones', 'id,obra_id,personal_id,rol_en_obra,modalidad,valor_acordado'),
    leerTodo<Costo>('costos', 'id,obra_id,personal_id,tipo,descripcion,monto,fecha', (q) => q.in('tipo', ['mano_obra', 'terciarizado'])),
    leerTodo<Jornal>('jornales', 'id,obra_id,personal_id,fecha,jornada,horas,observaciones'),
    leerTodo<PresupuestoObra>('presupuestos', 'obra_id,total,estado,activo'),
    leerTodo<AdicionalObra>('adicionales', 'obra_id,importe,estado,tipo'),
    supabase.from('personal').select('id,seguro_vencimiento').limit(1),
  ])
  return {
    personas: personas.map((p) => ({ ...p, costo_dia: p.costo_dia == null ? null : num(p.costo_dia) })).sort((a, b) => nombrePersona(a).localeCompare(nombrePersona(b))),
    obras: obras.map((o) => ({ ...o, porcentaje_avance: num(o.porcentaje_avance) })),
    asignaciones: asig.map((a) => ({ ...a, valor_acordado: a.valor_acordado == null ? null : num(a.valor_acordado) })),
    costos: costos.map((c) => ({ ...c, monto: num(c.monto) })).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id),
    jornales: jornales.map((j) => ({ ...j, jornada: num(j.jornada), horas: j.horas == null ? null : num(j.horas) })),
    presupuestos: pres.map((p) => ({ ...p, total: num(p.total) })),
    adicionales: adic.map((a) => ({ ...a, importe: num(a.importe) })),
    conDatosPersonales: !extra.error,
  }
}

// Valor de la obra (para quienes cobran por %): presupuestos aceptados +
// adicionales aprobados, sin el Gasto extra. Mismo criterio que la ficha de la obra.
function valorObra(d: Datos, obraId: number) {
  return d.presupuestos.filter((p) => p.obra_id === obraId && p.activo !== false && p.estado === 'aceptado').reduce((s, p) => s + p.total, 0)
    + d.adicionales.filter((a) => a.obra_id === obraId && a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + a.importe, 0)
}

function situacionDe(d: Datos, persona: Persona, desdeSemana: string): Situacion {
  const hoy = hoyTexto()
  const mes = hoy.slice(0, 7)
  const lineas: LineaObra[] = d.asignaciones.filter((a) => a.personal_id === persona.id).map((asig) => {
    const obra = d.obras.find((o) => o.id === asig.obra_id)
    const pagos = d.costos.filter((c) => c.obra_id === asig.obra_id && c.personal_id != null).map((c) => ({ personal_id: c.personal_id, monto: c.monto }))
    const jorn = d.jornales.filter((j) => j.obra_id === asig.obra_id)
    const calc = calcularPersona(asig, persona, pagos, jorn, valorObra(d, asig.obra_id), obra?.porcentaje_avance ?? 0)
    return { asig, obra, calc, porJornal: esJornal(asig.modalidad) }
  })
  const obrasAsignadas = new Set(lineas.map((l) => l.asig.obra_id))
  const suyos = d.costos.filter((c) => c.personal_id === persona.id)
  const sueltos = redondear(suyos.filter((c) => !obrasAsignadas.has(c.obra_id)).reduce((s, c) => s + c.monto, 0))
  const saldoJornal = redondear(lineas.filter((l) => l.porJornal).reduce((s, l) => s + l.calc.diferencia, 0))
  const saldoAcuerdo = redondear(lineas.filter((l) => !l.porJornal).reduce((s, l) => s + l.calc.diferencia, 0))
  const susJornales = d.jornales.filter((j) => j.personal_id === persona.id)
  return {
    persona, lineas, sueltos, saldoJornal, saldoAcuerdo,
    saldo: redondear(saldoJornal + saldoAcuerdo - sueltos),
    diasMes: susJornales.filter((j) => j.fecha.slice(0, 7) === mes).reduce((s, j) => s + j.jornada, 0),
    diasSemana: susJornales.filter((j) => j.fecha >= desdeSemana && j.fecha <= sumarDias(desdeSemana, 6)).reduce((s, j) => s + j.jornada, 0),
    pagadoMes: redondear(suyos.filter((c) => c.fecha.slice(0, 7) === mes).reduce((s, c) => s + c.monto, 0)),
    ultimoPago: suyos[0]?.fecha ?? null,
  }
}

function estadoSeguro(p: Persona): { clase: string; texto: string } | null {
  if (!p.seguro_vencimiento) return null
  const d = diasHasta(p.seguro_vencimiento)
  if (d < 0) return { clase: 'vencido', texto: `${p.seguro || 'Seguro'} vencido hace ${-d} día${d === -1 ? '' : 's'}` }
  if (d <= 15) return { clase: 'porVencer', texto: `${p.seguro || 'Seguro'} vence ${d === 0 ? 'hoy' : `en ${d} día${d === 1 ? '' : 's'}`}` }
  return null
}

function Personal({ pedido, onPedidoAtendido }: { pedido?: Pedido | null; onPedidoAtendido?: () => void } = {}) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [pestana, setPestana] = useState<Pestana>('equipo')
  const [verBajas, setVerBajas] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [semana, setSemana] = useState(() => lunesDe(hoyTexto()))
  const [formPersona, setFormPersona] = useState<Persona | 'nueva' | null>(null)
  const [asignando, setAsignando] = useState<Persona | null>(null)
  const [pagando, setPagando] = useState<{ persona?: Persona; soloJornal?: boolean } | null>(null)
  const [parte, setParte] = useState<{ personaId?: number } | null>(null)
  const [previaPdf, setPreviaPdf] = useState<{ id: number; nombre: string } | null>(null)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    let vigente = true
    cargarDatos().then((d) => { if (vigente) { setDatos(d); setError('') } })
      .catch((e) => { console.error(e); if (vigente) setError('No se pudo cargar el personal. Probá actualizar la página.') })
    return () => { vigente = false }
  }, [revision])
  const recargar = () => setRevision((v) => v + 1)

  // Pedido del botón "+" o del buscador.
  useEffect(() => {
    if (!pedido) return
    if (pedido.accion === 'nuevo') setFormPersona('nueva')
    else if (pedido.accion === 'parte') setParte({})
    else if (pedido.accion === 'pagoPersonal') setPagando({})
    onPedidoAtendido?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido])

  const situaciones = useMemo(() => (datos ? datos.personas.map((p) => situacionDe(datos, p, semana)) : []), [datos, semana])
  const activas = situaciones.filter((s) => s.persona.activo)
  const visibles = situaciones
    .filter((s) => s.persona.activo !== verBajas)
    .filter((s) => { const t = busqueda.trim().toLowerCase(); return !t || `${nombrePersona(s.persona)} ${s.persona.especialidad ?? ''} ${s.persona.telefono ?? ''}`.toLowerCase().includes(t) })

  const deuda = activas.reduce((s, x) => s + Math.max(x.saldo, 0), 0)
  const pagadoMes = situaciones.reduce((s, x) => s + x.pagadoMes, 0)
  const diasSemana = activas.reduce((s, x) => s + x.diasSemana, 0)
  const seguros = activas.filter((s) => estadoSeguro(s.persona))

  async function darDeBaja(p: Persona) {
    if (!confirmarEliminacion(`¿Dar de baja a ${nombrePersona(p)}?\n\nNo se borra nada: sus pagos y jornales quedan guardados. Deja de aparecer para asignar y podés reactivarlo cuando quieras desde "Dados de baja".`)) return
    const { error: e } = await supabase.from('personal').update({ activo: false }).eq('id', p.id)
    if (e) { window.alert('No se pudo dar de baja.'); return }
    recargar()
  }
  async function reactivar(p: Persona) {
    const { error: e } = await supabase.from('personal').update({ activo: true }).eq('id', p.id)
    if (e) { window.alert('No se pudo reactivar.'); return }
    setAviso(`${nombrePersona(p)} está activo otra vez.`)
    recargar()
  }

  function whatsappCuenta(s: Situacion) {
    const lineas = s.lineas.filter((l) => Math.abs(l.calc.diferencia) >= 1)
      .map((l) => `• ${l.obra?.nombre_obra ?? 'Obra'}: ${l.calc.diferencia > 0 ? `te corresponden ${moneda(l.calc.diferencia)}` : `pagado de más ${moneda(-l.calc.diferencia)}`}`)
    const texto = `Hola ${s.persona.nombre}! Te paso cómo está tu cuenta al ${fechaCorta(hoyTexto())}:\n${lineas.join('\n') || '• Sin movimientos pendientes'}\n`
      + `${s.saldo > 0 ? `Total a cobrar: ${moneda(s.saldo)}` : s.saldo < 0 ? `Tenés ${moneda(-s.saldo)} cobrados por adelantado` : 'Estás al día ✅'}`
    const url = linkWhatsApp(s.persona.telefono, texto)
    if (url) window.open(url, '_blank', 'noopener')
  }

  return <div className="gestionPage">
    <div className="pageHeader">
      <div><p className="subtitle">RECURSOS HUMANOS</p><h2>Personal</h2><p className="welcome">Equipo, jornales, pagos y liquidación semanal</p></div>
      <div className="headerActions peHeaderAcc">
        <button type="button" className="editButton" disabled={!datos} onClick={() => setParte({})}>📅 Parte del día</button>
        <button type="button" className="editButton" disabled={!datos} onClick={() => setPagando({})}>💵 Registrar pago</button>
        <button type="button" className="newButton" onClick={() => setFormPersona('nueva')}>+ Nueva persona</button>
      </div>
    </div>

    {error && <p className="loginError">{error}</p>}
    {aviso && <p className="gestionAyuda" role="status">✓ {aviso}</p>}
    {!datos && !error && <p>Cargando personal…</p>}

    {datos && <>
      <div className="peKpis">
        <button type="button" onClick={() => setPestana('liquidacion')} className={deuda > 0 ? 'alerta' : ''}><span>Le debés al personal</span><strong>{moneda(deuda)}</strong><small>{activas.filter((s) => s.saldo > 1).length} persona(s) con saldo</small></button>
        <button type="button" onClick={() => setPestana('movimientos')}><span>Pagado este mes</span><strong>{moneda(pagadoMes)}</strong><small>Mano de obra y terceros</small></button>
        <button type="button" onClick={() => setPestana('liquidacion')}><span>Jornales esta semana</span><strong>{diasSemana.toLocaleString('es-AR')} día{diasSemana === 1 ? '' : 's'}</strong><small>Del lunes {fechaCorta(semana)}</small></button>
        <div className={seguros.length ? 'alerta' : ''}><span>Seguros / ART</span><strong>{seguros.length ? `${seguros.length} para revisar` : 'Al día'}</strong><small>{datos.conDatosPersonales ? 'Vencidos o por vencer (15 días)' : 'Corré el SQL de Personal para cargarlos'}</small></div>
      </div>

      <div className="gestionTabs">
        <button className={pestana === 'equipo' ? 'active' : ''} onClick={() => setPestana('equipo')}>👷 Equipo</button>
        <button className={pestana === 'liquidacion' ? 'active' : ''} onClick={() => setPestana('liquidacion')}>💵 Liquidación</button>
        <button className={pestana === 'movimientos' ? 'active' : ''} onClick={() => setPestana('movimientos')}>📋 Movimientos</button>
      </div>

      {pestana === 'equipo' && <>
        <div className="peFiltros">
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, especialidad o teléfono…" />
          <div className="segTipo">
            <button type="button" className={!verBajas ? 'active' : ''} onClick={() => setVerBajas(false)}>Activos ({situaciones.filter((s) => s.persona.activo).length})</button>
            <button type="button" className={verBajas ? 'active' : ''} onClick={() => setVerBajas(true)}>Dados de baja ({situaciones.filter((s) => !s.persona.activo).length})</button>
          </div>
        </div>
        {visibles.length === 0 ? <div className="agVacio">{verBajas ? 'No hay personas dadas de baja.' : 'Sin personal cargado. Agregá a alguien con "+ Nueva persona".'}</div> : (
          <div className="peGrid">
            {visibles.map((s) => {
              const p = s.persona
              const seguro = estadoSeguro(p)
              const conJornal = s.lineas.some((l) => l.porJornal)
              return <article key={p.id} className={`peCard ${p.activo ? '' : 'baja'}`}>
                <div className="peTop">
                  <div className="peAvatar">{p.nombre.charAt(0).toUpperCase()}</div>
                  <div className="peNombre">
                    <strong>{nombrePersona(p)}</strong>
                    <small>{[p.especialidad, TIPOS[p.tipo] ?? p.tipo].filter(Boolean).join(' · ')}</small>
                    <small>{esJornal(p.modalidad_pago) ? (p.costo_dia ? `${moneda(p.costo_dia)} por ${p.modalidad_pago === 'por_hora' ? 'hora' : 'día'}` : 'Falta el valor por día') : 'Por acuerdo en cada obra'}</small>
                  </div>
                  <div className={`peSaldo ${s.saldo > 1 ? 'debe' : s.saldo < -1 ? 'adelantado' : 'ok'}`}>
                    <span>{s.saldo > 1 ? 'Le debés' : s.saldo < -1 ? 'Pagado de más' : 'Al día'}</span>
                    <strong>{Math.abs(s.saldo) > 1 ? moneda(Math.abs(s.saldo)) : '✓'}</strong>
                  </div>
                </div>
                {seguro && <p className={`peSeguro ${seguro.clase}`}>⚠ {seguro.texto}</p>}
                <div className="peDatos">
                  <span>📅 {s.diasMes.toLocaleString('es-AR')} día{s.diasMes === 1 ? '' : 's'} este mes</span>
                  <span>💵 {s.ultimoPago ? `Último pago ${fechaCorta(s.ultimoPago)}` : 'Sin pagos'}</span>
                </div>
                <div className="peObras">
                  {s.lineas.length === 0 ? <em>Sin obras asignadas</em> : s.lineas.map((l) => (
                    <span key={l.asig.id} className={l.obra?.activo === false ? 'inactiva' : ''} title={`${MODALIDADES[l.asig.modalidad ?? ''] ?? l.asig.modalidad} · ${l.calc.diferencia > 0 ? `le corresponden ${moneda(l.calc.diferencia)}` : 'al día'}`}>
                      {l.obra?.nombre_obra ?? 'Obra'}{l.porJornal ? ' · jornal' : ' · acuerdo'}
                    </span>
                  ))}
                </div>
                {p.activo ? (
                  <div className="peAcciones">
                    <button type="button" className="newButton" onClick={() => setPagando({ persona: p })}>💵 Pagar</button>
                    {conJornal && <button type="button" className="editButton" onClick={() => setParte({ personaId: p.id })}>📅 Jornal</button>}
                    <button type="button" className="editButton peWa" onClick={() => whatsappCuenta(s)}>💬 WhatsApp</button>
                    <button type="button" className="editButton" onClick={() => setPreviaPdf({ id: p.id, nombre: nombrePersona(p) })}>📄 Cuenta</button>
                    <details className="peMas">
                      <summary>⋯</summary>
                      <div>
                        <button type="button" onClick={() => setAsignando(p)}>Asignar a obra</button>
                        <button type="button" onClick={() => setFormPersona(p)}>Editar datos</button>
                        <button type="button" className="peBaja" onClick={() => void darDeBaja(p)}>Dar de baja</button>
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="peAcciones">
                    <button type="button" className="newButton" onClick={() => void reactivar(p)}>↺ Reactivar</button>
                    <button type="button" className="editButton" onClick={() => setPreviaPdf({ id: p.id, nombre: nombrePersona(p) })}>📄 Cuenta</button>
                  </div>
                )}
              </article>
            })}
          </div>
        )}
      </>}

      {pestana === 'liquidacion' && (
        <Liquidacion datos={datos} situaciones={activas} semana={semana} onSemana={setSemana}
          onPagar={(persona, soloJornal) => setPagando({ persona, soloJornal })}
          onPagado={(texto) => { setAviso(texto); recargar() }} />
      )}

      {pestana === 'movimientos' && <Movimientos datos={datos} onCambio={recargar} />}
    </>}

    {previaPdf && <VistaPreviaPdf titulo={`Estado de cuenta · ${previaPdf.nombre}`} generar={() => armarPdfCuenta(previaPdf.id)} onCerrar={() => setPreviaPdf(null)} />}
    {formPersona && <FormularioPersona persona={formPersona === 'nueva' ? undefined : formPersona} conDatosPersonales={datos?.conDatosPersonales ?? false}
      onCancelar={() => setFormPersona(null)} onGuardado={() => { setFormPersona(null); recargar() }} />}
    {asignando && datos && <FormularioAsignacion persona={asignando} obras={datos.obras.filter((o) => o.activo)} asignadas={datos.asignaciones.filter((a) => a.personal_id === asignando.id).map((a) => a.obra_id)}
      onCancelar={() => setAsignando(null)} onGuardado={() => { setAsignando(null); recargar() }} />}
    {pagando && datos && <FormularioPago datos={datos} situaciones={activas} persona={pagando.persona} soloJornal={pagando.soloJornal} semana={semana}
      onCancelar={() => setPagando(null)} onGuardado={(texto) => { setPagando(null); setAviso(texto); recargar() }} />}
    {parte && datos && <ParteDiario datos={datos} personaId={parte.personaId}
      onCancelar={() => setParte(null)} onGuardado={(texto) => { setParte(null); setAviso(texto); recargar() }} />}
  </div>
}

// ---------- Liquidación semanal ----------
function Liquidacion({ datos, situaciones, semana, onSemana, onPagar, onPagado }: {
  datos: Datos; situaciones: Situacion[]; semana: string; onSemana: (s: string) => void
  onPagar: (p: Persona, soloJornal: boolean) => void; onPagado: (texto: string) => void
}) {
  const fin = sumarDias(semana, 6)
  const [pagandoTodo, setPagandoTodo] = useState(false)
  const esEstaSemana = semana === lunesDe(hoyTexto())

  // Personas por jornal: días y monto de la semana, y saldo total pendiente
  // (incluye semanas anteriores sin pagar, menos adelantos).
  const porJornal = situaciones.filter((s) => s.lineas.some((l) => l.porJornal)).map((s) => {
    const jornSemana = datos.jornales.filter((j) => j.personal_id === s.persona.id && j.fecha >= semana && j.fecha <= fin)
    const montoSemana = s.lineas.filter((l) => l.porJornal).reduce((suma, l) => {
      const js = jornSemana.filter((j) => j.obra_id === l.asig.obra_id)
      const valor = num(l.asig.valor_acordado) || num(s.persona.costo_dia)
      return suma + (l.asig.modalidad === 'por_hora' ? js.reduce((x, j) => x + num(j.horas), 0) : js.reduce((x, j) => x + j.jornada, 0)) * valor
    }, 0)
    const dias = jornSemana.reduce((x, j) => x + j.jornada, 0)
    const porDia = Array.from({ length: 7 }, (_, i) => jornSemana.filter((j) => j.fecha === sumarDias(semana, i)).reduce((x, j) => x + j.jornada, 0))
    return { s, dias, porDia, montoSemana: redondear(montoSemana), aPagar: redondear(Math.max(s.saldoJornal, 0)) }
  }).sort((a, b) => b.aPagar - a.aPagar)
  const totalJornal = porJornal.reduce((x, f) => x + f.aPagar, 0)

  // Personas por acuerdo: lo que les corresponde según el avance de cada obra.
  const porAcuerdo = situaciones.filter((s) => s.lineas.some((l) => !l.porJornal)).map((s) => ({
    s, lineas: s.lineas.filter((l) => !l.porJornal),
  }))

  async function pagarTodo() {
    const filas = porJornal.flatMap((f) => f.s.lineas.filter((l) => l.porJornal && l.calc.diferencia > 0.5).map((l) => ({
      obra_id: l.asig.obra_id, personal_id: f.s.persona.id,
      tipo: f.s.persona.tipo === 'terciarizado' ? 'terciarizado' : 'mano_obra',
      descripcion: `Pago a ${nombrePersona(f.s.persona)} · Liquidación semana ${fechaCorta(semana)} al ${fechaCorta(fin)}`,
      monto: redondear(l.calc.diferencia), fecha: hoyTexto(),
    })))
    if (filas.length === 0) return
    if (!window.confirm(`Se van a registrar ${filas.length} pago(s) por un total de ${moneda(totalJornal)} con fecha de hoy.\n\n¿Confirmás que ya les pagaste?`)) return
    setPagandoTodo(true)
    const { error } = await supabase.from('costos').insert(filas)
    setPagandoTodo(false)
    if (error) { console.error(error); window.alert('No se pudieron registrar los pagos. No se guardó ninguno.'); return }
    onPagado(`Liquidación registrada: ${filas.length} pago(s) por ${moneda(totalJornal)}.`)
  }

  function recibo(f: typeof porJornal[number]) {
    const texto = `Hola ${f.s.persona.nombre}! Liquidación de la semana ${fechaCorta(semana)} al ${fechaCorta(fin)}:\n`
      + `• Días trabajados: ${f.dias.toLocaleString('es-AR')}\n• Esta semana: ${moneda(f.montoSemana)}\n`
      + `${f.aPagar > 0 ? `Total a cobrar (incluye lo pendiente y descuenta adelantos): ${moneda(f.aPagar)}` : 'Estás al día ✅'}`
    const url = linkWhatsApp(f.s.persona.telefono, texto)
    if (url) window.open(url, '_blank', 'noopener')
  }

  return <div className="liWrap">
    <div className="liSemana">
      <button type="button" className="editButton" onClick={() => onSemana(sumarDias(semana, -7))}>←</button>
      <div><strong>Semana del {fechaCorta(semana)} al {fechaCorta(fin)}</strong><small>{esEstaSemana ? 'Semana actual · se paga al cierre' : 'Semana anterior o futura'}</small></div>
      <button type="button" className="editButton" onClick={() => onSemana(sumarDias(semana, 7))}>→</button>
      {!esEstaSemana && <button type="button" className="caLink" onClick={() => onSemana(lunesDe(hoyTexto()))}>Ir a esta semana</button>}
    </div>

    <section className="liSeccion">
      <div className="liHead">
        <div><h3>📅 Por jornal</h3><small>Se paga al cierre de la semana. "A pagar" incluye semanas anteriores sin pagar y descuenta adelantos.</small></div>
        {totalJornal > 0 && <button type="button" className="newButton" disabled={pagandoTodo} onClick={() => void pagarTodo()}>{pagandoTodo ? 'Registrando…' : `💵 Pagar a todos · ${moneda(totalJornal)}`}</button>}
      </div>
      {porJornal.length === 0 ? <p className="agVacio">Nadie cobra por jornal en las obras asignadas.</p> : (
        <div className="liTabla">
          <div className="liFila liCab"><span>Persona</span><span className="liDias">{Array.from({ length: 7 }, (_, i) => <i key={i}>{fechaLarga(sumarDias(semana, i)).split(' ')[0].replace('.', '')}</i>)}</span><span>Esta semana</span><span>A pagar</span><span /></div>
          {porJornal.map((f) => (
            <div className="liFila" key={f.s.persona.id}>
              <span className="liNombre"><strong>{nombrePersona(f.s.persona)}</strong><small>{f.dias.toLocaleString('es-AR')} día{f.dias === 1 ? '' : 's'}</small></span>
              <span className="liDias">{f.porDia.map((d, i) => <i key={i} className={d >= 1 ? 'si' : d > 0 ? 'medio' : ''} title={fechaLarga(sumarDias(semana, i))}>{d > 0 ? (d === 1 ? '✓' : d.toLocaleString('es-AR')) : '·'}</i>)}</span>
              <span className="liMonto liEstaSemana">{moneda(f.montoSemana)}</span>
              <span className={`liMonto ${f.aPagar > 0 ? 'debe' : ''}`}><strong>{f.aPagar > 0 ? moneda(f.aPagar) : f.s.saldoJornal < -1 ? `Adelantado ${moneda(-f.s.saldoJornal)}` : 'Al día'}</strong></span>
              <span className="liAcc">
                <button type="button" className="editButton" onClick={() => onPagar(f.s.persona, true)}>Pagar</button>
                <button type="button" className="editButton peWa" onClick={() => recibo(f)} title="Mandar la liquidación por WhatsApp">💬</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>

    <section className="liSeccion">
      <div className="liHead"><div><h3>🤝 Por acuerdo</h3><small>Monto pactado por obra: le corresponde según el avance. Pagás cuando quieras.</small></div></div>
      {porAcuerdo.length === 0 ? <p className="agVacio">Nadie trabaja por acuerdo en las obras asignadas.</p> : porAcuerdo.map(({ s, lineas }) => (
        <div key={s.persona.id} className="liAcuerdo">
          <div className="liAcuerdoHead">
            <strong>{nombrePersona(s.persona)}</strong>
            <span className={s.saldoAcuerdo > 1 ? 'debe' : ''}>{s.saldoAcuerdo > 1 ? `Disponible para pagar ${moneda(s.saldoAcuerdo)}` : s.saldoAcuerdo < -1 ? `Adelantado ${moneda(-s.saldoAcuerdo)}` : 'Al día con el avance'}</span>
            <button type="button" className="editButton" onClick={() => onPagar(s.persona, false)}>Pagar</button>
          </div>
          {lineas.map((l) => (
            <div key={l.asig.id} className="liObra">
              <span>{l.obra?.nombre_obra ?? 'Obra'}</span>
              <div className="liBarra" title={`Avance ${l.obra?.porcentaje_avance ?? 0}% · pagado ${moneda(l.calc.pagado)}`}>
                <div className="liAvance" style={{ width: `${Math.min(100, l.obra?.porcentaje_avance ?? 0)}%` }} />
                <div className="liPagado" style={{ width: `${l.calc.totalContrato ? Math.min(100, (l.calc.pagado / l.calc.totalContrato) * 100) : 0}%` }} />
              </div>
              <small>Acordado {moneda(l.calc.totalContrato ?? 0)} · avance {l.obra?.porcentaje_avance ?? 0}% → corresponde {moneda(l.calc.devengado)} · pagado {moneda(l.calc.pagado)} · falta para terminar {moneda(Math.max((l.calc.totalContrato ?? 0) - l.calc.pagado, 0))}</small>
            </div>
          ))}
        </div>
      ))}
      {porAcuerdo.length > 0 && <p className="gestionAyuda"><i className="liLeyenda av" /> avance de la obra · <i className="liLeyenda pg" /> pagado del total acordado. Si lo pagado supera el avance, está adelantado.</p>}
    </section>
  </div>
}

// ---------- Registrar pago (reparte por obra) ----------
function FormularioPago({ datos, situaciones, persona: personaInicial, soloJornal, semana, onCancelar, onGuardado }: {
  datos: Datos; situaciones: Situacion[]; persona?: Persona; soloJornal?: boolean; semana: string
  onCancelar: () => void; onGuardado: (texto: string) => void
}) {
  const [personaId, setPersonaId] = useState(personaInicial ? String(personaInicial.id) : '')
  const s = situaciones.find((x) => x.persona.id === Number(personaId))
  const lineas = (s?.lineas ?? []).filter((l) => l.obra?.activo !== false || l.calc.diferencia > 0.5).filter((l) => !soloJornal || l.porJornal)
  const sugerido = (l: LineaObra) => (l.calc.diferencia > 0.5 ? String(redondear(l.calc.diferencia)) : '')
  const [montos, setMontos] = useState<Record<number, string>>(() => Object.fromEntries(lineas.map((l) => [l.asig.obra_id, sugerido(l)])))
  const [obraSuelta, setObraSuelta] = useState('')
  const [montoSuelto, setMontoSuelto] = useState('')
  const [fecha, setFecha] = useState(hoyTexto())
  const [detalle, setDetalle] = useState(soloJornal ? `Liquidación semana ${fechaCorta(semana)} al ${fechaCorta(sumarDias(semana, 6))}` : '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [listo, setListo] = useState<{ total: number; detalle: string[] } | null>(null)

  function elegir(id: string) {
    setPersonaId(id)
    const sit = situaciones.find((x) => x.persona.id === Number(id))
    setMontos(Object.fromEntries((sit?.lineas ?? []).filter((l) => !soloJornal || l.porJornal).map((l) => [l.asig.obra_id, sugerido(l)])))
  }

  const total = redondear(lineas.reduce((x, l) => x + num(montos[l.asig.obra_id]), 0) + (lineas.length === 0 ? num(montoSuelto) : 0))

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!s) { setError('Elegí a quién le pagás.'); return }
    const filas = (lineas.length ? lineas.map((l) => ({ obra: l.asig.obra_id, monto: num(montos[l.asig.obra_id]) })) : [{ obra: Number(obraSuelta), monto: num(montoSuelto) }])
      .filter((f) => f.monto > 0 && f.obra > 0)
    if (filas.length === 0) { setError(lineas.length ? 'Ingresá cuánto le pagás en al menos una obra.' : 'Elegí la obra e ingresá el monto.'); return }
    setGuardando(true)
    const { error: fallo } = await supabase.from('costos').insert(filas.map((f) => ({
      obra_id: f.obra, personal_id: s.persona.id, tipo: s.persona.tipo === 'terciarizado' ? 'terciarizado' : 'mano_obra',
      descripcion: `Pago a ${nombrePersona(s.persona)}${detalle.trim() ? ` · ${detalle.trim()}` : ''}`, monto: redondear(f.monto), fecha,
    })))
    setGuardando(false)
    if (fallo) { console.error(fallo); setError('No se pudo registrar el pago.'); return }
    setListo({ total: filas.reduce((x, f) => x + f.monto, 0), detalle: filas.map((f) => `• ${datos.obras.find((o) => o.id === f.obra)?.nombre_obra ?? 'Obra'}: ${moneda(f.monto)}`) })
  }

  function whatsappRecibo() {
    if (!s || !listo) return
    const resto = redondear(s.saldo - listo.total)
    const texto = `Hola ${s.persona.nombre}! Te registré un pago de ${moneda(listo.total)} el ${fechaCorta(fecha)}${detalle.trim() ? ` (${detalle.trim()})` : ''}:\n${listo.detalle.join('\n')}\n`
      + `${resto > 1 ? `Te quedan por cobrar ${moneda(resto)}.` : resto < -1 ? `Quedás con ${moneda(-resto)} cobrados por adelantado.` : 'Quedás al día ✅'}`
    const url = linkWhatsApp(s.persona.telefono, texto)
    if (url) window.open(url, '_blank', 'noopener')
  }

  if (listo && s) return <div className="modalOverlay"><div className="modalCard" style={{ maxWidth: 520 }}>
    <div className="modalHeader"><div><p className="subtitle">PAGO REGISTRADO</p><h2>{moneda(listo.total)} a {nombrePersona(s.persona)}</h2></div><button className="closeButton" onClick={() => onGuardado(`Pago de ${moneda(listo.total)} a ${nombrePersona(s.persona)} registrado.`)}>×</button></div>
    <div className="clienteForm"><ul className="ctResumen">{listo.detalle.map((l) => <li key={l}>{l.replace('• ', '')}</li>)}</ul>
      <p className="gestionAyuda">Se ve en la ficha de cada obra, en Finanzas y en su estado de cuenta.</p>
      <div className="formActions"><button type="button" className="editButton peWa" onClick={whatsappRecibo}>💬 Mandar comprobante por WhatsApp</button><button type="button" className="newButton" onClick={() => onGuardado(`Pago de ${moneda(listo.total)} a ${nombrePersona(s.persona)} registrado.`)}>Listo</button></div>
    </div>
  </div></div>

  return <div className="modalOverlay"><div className="modalCard" style={{ maxWidth: 620 }}>
    <div className="modalHeader"><div><p className="subtitle">PAGO AL PERSONAL</p><h2>💵 Registrar pago</h2></div><button className="closeButton" onClick={onCancelar} disabled={guardando}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}>
      <div className="formGrid">
        <label>¿A quién? *<select required value={personaId} onChange={(e) => elegir(e.target.value)} disabled={!!personaInicial}>
          <option value="">Elegí una persona</option>
          {situaciones.map((x) => <option key={x.persona.id} value={x.persona.id}>{nombrePersona(x.persona)}{x.saldo > 1 ? ` · le debés ${moneda(x.saldo)}` : ''}</option>)}
        </select></label>
        <label>Fecha del pago *<input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      </div>
      {s && lineas.length > 0 && <div className="pgObras">
        <p className="pgTitulo">Cuánto le pagás en cada obra <small>(te propongo lo que le corresponde hoy; podés cambiarlo, por ejemplo para un adelanto)</small></p>
        {lineas.map((l) => (
          <div key={l.asig.id} className="pgObra">
            <div><strong>{l.obra?.nombre_obra ?? 'Obra'}</strong>
              <small>{l.porJornal
                ? `${l.calc.jornadas.toLocaleString('es-AR')} día(s) cargados · ${l.calc.diferencia > 0 ? `le corresponden ${moneda(l.calc.diferencia)}` : l.calc.diferencia < 0 ? `adelantado ${moneda(-l.calc.diferencia)}` : 'al día'}`
                : `Acordado ${moneda(l.calc.totalContrato ?? 0)} · avance ${l.obra?.porcentaje_avance ?? 0}% · ${l.calc.diferencia > 0 ? `corresponde ${moneda(l.calc.diferencia)}` : l.calc.diferencia < 0 ? `adelantado ${moneda(-l.calc.diferencia)}` : 'al día'}`}</small>
            </div>
            <input type="number" min="0" step="0.01" value={montos[l.asig.obra_id] ?? ''} onChange={(e) => setMontos((m) => ({ ...m, [l.asig.obra_id]: e.target.value }))} placeholder="0" aria-label={`Monto en ${l.obra?.nombre_obra}`} />
          </div>
        ))}
      </div>}
      {s && lineas.length === 0 && <div className="formGrid">
        <label>Obra *<select value={obraSuelta} onChange={(e) => setObraSuelta(e.target.value)}><option value="">Elegí la obra</option>{datos.obras.filter((o) => o.activo).map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}</select></label>
        <label>Monto *<input type="number" min="0" step="0.01" value={montoSuelto} onChange={(e) => setMontoSuelto(e.target.value)} /></label>
        <p className="gestionAyuda formFull">{nombrePersona(s.persona)} no está asignado a ninguna obra: el pago queda cargado en la obra que elijas. Para que la app calcule lo que le corresponde, asignalo con "Asignar a obra".</p>
      </div>}
      <label>Detalle<input value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej.: adelanto, liquidación semana, fin de etapa" /></label>
      <p className="pgTotal">Total del pago: <strong>{moneda(total)}</strong></p>
      <p className="gestionAyuda">Es plata que le das al trabajador: queda como costo de mano de obra de cada obra (se ve en Finanzas). Los días trabajados se cargan aparte con 📅 Parte del día.</p>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando || total <= 0}>{guardando ? 'Guardando…' : `Registrar pago de ${moneda(total)}`}</button></div>
    </form>
  </div></div>
}

// ---------- Parte del día (jornales de varios a la vez) ----------
function ParteDiario({ datos, personaId, onCancelar, onGuardado }: { datos: Datos; personaId?: number; onCancelar: () => void; onGuardado: (texto: string) => void }) {
  const obrasConGente = datos.obras.filter((o) => o.activo && datos.asignaciones.some((a) => a.obra_id === o.id && datos.personas.some((p) => p.id === a.personal_id && p.activo)))
  const inicial = personaId ? obrasConGente.find((o) => datos.asignaciones.some((a) => a.obra_id === o.id && a.personal_id === personaId && esJornal(a.modalidad))) ?? obrasConGente.find((o) => datos.asignaciones.some((a) => a.obra_id === o.id && a.personal_id === personaId)) : obrasConGente.length === 1 ? obrasConGente[0] : undefined
  const [fecha, setFecha] = useState(hoyTexto())
  const [obraId, setObraId] = useState(inicial ? String(inicial.id) : '')
  const [marcas, setMarcas] = useState<Record<number, { jornada: string; horas: string }>>(() => (personaId ? { [personaId]: { jornada: '1', horas: '' } } : {}))
  const [obs, setObs] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const asignados = datos.asignaciones.filter((a) => a.obra_id === Number(obraId))
    .map((a) => ({ a, p: datos.personas.find((p) => p.id === a.personal_id && p.activo) }))
    .filter((x): x is { a: Asignacion; p: Persona } => !!x.p)
    .sort((x, y) => Number(esJornal(y.a.modalidad)) - Number(esJornal(x.a.modalidad)) || nombrePersona(x.p).localeCompare(nombrePersona(y.p)))
  const yaCargado = (pid: number) => datos.jornales.find((j) => j.obra_id === Number(obraId) && j.personal_id === pid && j.fecha === fecha)
  const elegidos = Object.entries(marcas).filter(([pid]) => asignados.some((x) => x.p.id === Number(pid)) && !yaCargado(Number(pid)))

  function tildar(pid: number, si: boolean) { setMarcas((m) => { const n = { ...m }; if (si) n[pid] = { jornada: '1', horas: '' }; else delete n[pid]; return n }) }
  function todos() { setMarcas(Object.fromEntries(asignados.filter((x) => !yaCargado(x.p.id)).map((x) => [x.p.id, marcas[x.p.id] ?? { jornada: '1', horas: '' }]))) }

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!obraId) { setError('Elegí la obra.'); return }
    if (elegidos.length === 0) { setError('Tildá al menos a una persona.'); return }
    if (elegidos.some(([, v]) => !(Number(v.jornada) > 0))) { setError('La jornada tiene que ser mayor que cero (0,5 = medio día).'); return }
    setGuardando(true)
    const { error: fallo } = await supabase.from('jornales').insert(elegidos.map(([pid, v]) => ({
      obra_id: Number(obraId), personal_id: Number(pid), fecha, jornada: Number(v.jornada), horas: v.horas ? Number(v.horas) : null, observaciones: obs.trim() || null,
    })))
    setGuardando(false)
    if (fallo) { console.error(fallo); setError('No se pudo guardar el parte. No se cargó nada.'); return }
    const obra = datos.obras.find((o) => o.id === Number(obraId))?.nombre_obra ?? 'la obra'
    onGuardado(`Parte del ${fechaCorta(fecha)} en ${obra}: ${elegidos.length} persona(s) cargadas.`)
  }

  return <div className="modalOverlay"><div className="modalCard" style={{ maxWidth: 620 }}>
    <div className="modalHeader"><div><p className="subtitle">JORNALES</p><h2>📅 Parte del día</h2></div><button className="closeButton" onClick={onCancelar} disabled={guardando}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}>
      <div className="formGrid">
        <label>Fecha *<input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label>Obra *<select required value={obraId} onChange={(e) => setObraId(e.target.value)}><option value="">Elegí la obra</option>{obrasConGente.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}</select></label>
      </div>
      {obraId && <div className="pdLista">
        <div className="pdHead"><p className="pgTitulo">¿Quiénes fueron?</p>{asignados.length > 1 && <button type="button" className="caLink" onClick={todos}>Tildar a todos</button>}</div>
        {asignados.map(({ a, p }) => {
          const ya = yaCargado(p.id)
          const m = marcas[p.id]
          return <div key={a.id} className={`pdFila ${m && !ya ? 'si' : ''}`}>
            <label className="pdCheck"><input type="checkbox" disabled={!!ya} checked={!!m && !ya} onChange={(e) => tildar(p.id, e.target.checked)} />
              <span><strong>{nombrePersona(p)}</strong><small>{ya ? `Ya cargado: ${ya.jornada === 1 ? 'día completo' : `${ya.jornada.toLocaleString('es-AR')} jornada`}` : esJornal(a.modalidad) ? `Por ${a.modalidad === 'por_hora' ? 'hora' : 'día'} · ${moneda(num(a.valor_acordado) || num(p.costo_dia))}` : 'Por acuerdo (solo asistencia)'}</small></span>
            </label>
            {m && !ya && <div className="pdValores">
              <select value={m.jornada} onChange={(e) => setMarcas((x) => ({ ...x, [p.id]: { ...m, jornada: e.target.value } }))} aria-label="Jornada">
                <option value="1">Día completo</option><option value="0.5">Medio día</option><option value="0.75">3/4 de día</option><option value="0.25">1/4 de día</option><option value="1.5">Día y medio</option>
              </select>
              {a.modalidad === 'por_hora' && <input type="number" min="0" step="0.5" value={m.horas} placeholder="Horas" onChange={(e) => setMarcas((x) => ({ ...x, [p.id]: { ...m, horas: e.target.value } }))} aria-label="Horas" />}
            </div>}
          </div>
        })}
        <p className="gestionAyuda">¿Falta alguien? Asignalo a esta obra desde su tarjeta (⋯ → Asignar a obra).</p>
      </div>}
      <label>Observaciones<input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: cableado planta alta" /></label>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando || elegidos.length === 0}>{guardando ? 'Guardando…' : `Cargar ${elegidos.length || ''} jornal${elegidos.length === 1 ? '' : 'es'}`}</button></div>
    </form>
  </div></div>
}

// ---------- Movimientos (pagos y jornales) ----------
function Movimientos({ datos, onCambio }: { datos: Datos; onCambio: () => void }) {
  const [tipo, setTipo] = useState<'pagos' | 'jornales'>('pagos')
  const [fObra, setFObra] = useState('')
  const [fPersona, setFPersona] = useState('')
  const [fMes, setFMes] = useState('')
  const obraNombre = (id: number) => datos.obras.find((o) => o.id === id)?.nombre_obra ?? `Obra #${id}`
  const persona = (id: number | null) => datos.personas.find((p) => p.id === id)
  const coincide = (x: { obra_id: number; personal_id: number | null; fecha: string }) =>
    (!fObra || x.obra_id === Number(fObra)) && (!fPersona || x.personal_id === Number(fPersona)) && (!fMes || x.fecha.slice(0, 7) === fMes)
  const pagos = datos.costos.filter(coincide)
  const jornales = datos.jornales.filter(coincide).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
  const meses = Array.from(new Set([...datos.costos, ...datos.jornales].map((x) => x.fecha.slice(0, 7)))).sort().reverse()

  // Mano de obra por mes (últimos 6 meses), para ver cómo viene el costo.
  const ultimos = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return aTexto(d).slice(0, 7) })
  const porMes = ultimos.map((m) => ({ m, v: datos.costos.filter((c) => c.fecha.slice(0, 7) === m && (!fObra || c.obra_id === Number(fObra)) && (!fPersona || c.personal_id === Number(fPersona))).reduce((s, c) => s + c.monto, 0) }))
  const maxMes = Math.max(1, ...porMes.map((x) => x.v))

  async function borrarPago(c: Costo) {
    if (!confirmarEliminacion(`¿Eliminar el pago de ${moneda(c.monto)} del ${fechaCorta(c.fecha)}?\n${c.descripcion ?? ''}`)) return
    const { error } = await supabase.from('costos').delete().eq('id', c.id)
    if (error) { window.alert('No se pudo eliminar.'); return }
    onCambio()
  }
  async function borrarJornal(j: Jornal) {
    if (!confirmarEliminacion(`¿Eliminar el jornal de ${nombrePersona(persona(j.personal_id))} del ${fechaCorta(j.fecha)}?`)) return
    const { error } = await supabase.from('jornales').delete().eq('id', j.id)
    if (error) { window.alert('No se pudo eliminar.'); return }
    onCambio()
  }

  return <div className="mvWrap">
    <section className="liSeccion">
      <div className="liHead"><div><h3>Mano de obra por mes</h3><small>Pagos al personal y terceros (últimos 6 meses{fObra || fPersona ? ', con el filtro elegido' : ''})</small></div></div>
      <div className="mvBarras">
        {porMes.map((x) => <div key={x.m} className="mvBarra" title={`${x.m}: ${moneda(x.v)}`}>
          <b>{x.v > 0 ? `$${x.v >= 1e6 ? `${(x.v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M` : `${Math.round(x.v / 1e3)}k`}` : ''}</b>
          <div><span style={{ height: `${(x.v / maxMes) * 100}%` }} /></div>
          <small>{new Date(`${x.m}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')}</small>
        </div>)}
      </div>
    </section>

    <div className="peFiltros">
      <div className="segTipo"><button type="button" className={tipo === 'pagos' ? 'active' : ''} onClick={() => setTipo('pagos')}>💵 Pagos</button><button type="button" className={tipo === 'jornales' ? 'active' : ''} onClick={() => setTipo('jornales')}>📅 Jornales</button></div>
      <select value={fPersona} onChange={(e) => setFPersona(e.target.value)}><option value="">Todas las personas</option>{datos.personas.map((p) => <option key={p.id} value={p.id}>{nombrePersona(p)}{p.activo ? '' : ' (baja)'}</option>)}</select>
      <select value={fObra} onChange={(e) => setFObra(e.target.value)}><option value="">Todas las obras</option>{datos.obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}</select>
      <select value={fMes} onChange={(e) => setFMes(e.target.value)}><option value="">Todos los meses</option>{meses.map((m) => <option key={m} value={m}>{new Date(`${m}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</option>)}</select>
    </div>

    {tipo === 'pagos' ? <section className="liSeccion">
      <div className="liHead"><div><h3>Pagos</h3><small>{pagos.length} pago(s) · total {moneda(pagos.reduce((s, c) => s + c.monto, 0))}</small></div></div>
      {pagos.length === 0 ? <p className="agVacio">No hay pagos con este filtro.</p> : pagos.slice(0, 200).map((c) => (
        <div key={c.id} className="mvFila">
          <span className="mvFecha">{fechaCorta(c.fecha)}</span>
          <span className="mvInfo"><strong>{nombrePersona(persona(c.personal_id))}</strong><small>{obraNombre(c.obra_id)} · {(c.descripcion ?? '').replace(/^Pago a [^·]+(· ?|$)/, '').trim() || (c.tipo === 'terciarizado' ? 'Tercerizado' : 'Mano de obra')}</small></span>
          <b>{moneda(c.monto)}</b>
          <button type="button" className="adicNo" onClick={() => void borrarPago(c)} aria-label="Eliminar pago">✕</button>
        </div>
      ))}
    </section> : <section className="liSeccion">
      <div className="liHead"><div><h3>Jornales</h3><small>{jornales.length} registro(s) · {jornales.reduce((s, j) => s + j.jornada, 0).toLocaleString('es-AR')} día(s)</small></div></div>
      {jornales.length === 0 ? <p className="agVacio">No hay jornales con este filtro.</p> : jornales.slice(0, 200).map((j) => (
        <div key={j.id} className="mvFila">
          <span className="mvFecha">{fechaCorta(j.fecha)}</span>
          <span className="mvInfo"><strong>{nombrePersona(persona(j.personal_id))}</strong><small>{obraNombre(j.obra_id)}{j.observaciones ? ` · ${j.observaciones}` : ''}</small></span>
          <b>{j.jornada === 1 ? 'Día' : `${j.jornada.toLocaleString('es-AR')} jornada`}{j.horas ? ` · ${j.horas} h` : ''}</b>
          <button type="button" className="adicNo" onClick={() => void borrarJornal(j)} aria-label="Eliminar jornal">✕</button>
        </div>
      ))}
    </section>}
    {(pagos.length > 200 || jornales.length > 200) && <p className="gestionAyuda">Se muestran los 200 más recientes. Usá los filtros para ver otros.</p>}
  </div>
}

// ---------- Ficha de la persona ----------
function FormularioPersona({ persona, conDatosPersonales, onCancelar, onGuardado }: { persona?: Persona; conDatosPersonales: boolean; onCancelar: () => void; onGuardado: () => void }) {
  const editando = !!persona
  const [f, setF] = useState({
    nombre: persona?.nombre ?? '', apellido: persona?.apellido ?? '', tipo: persona?.tipo ?? 'obrero',
    especialidad: persona?.especialidad ?? '', modalidad_pago: persona?.modalidad_pago ?? 'por_dia',
    telefono: persona?.telefono ?? '', costo_dia: persona?.costo_dia != null ? String(persona.costo_dia) : '',
    documento: persona?.documento ?? '', cuil: persona?.cuil ?? '', contacto_emergencia: persona?.contacto_emergencia ?? '',
    seguro: persona?.seguro ?? '', seguro_vencimiento: persona?.seguro_vencimiento?.slice(0, 10) ?? '', notas: persona?.notas ?? '',
  })
  const [guardando, setGuardando] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF((a) => ({ ...a, [k]: v }))
  const porDia = f.modalidad_pago === 'por_dia' || f.modalidad_pago === 'por_hora'
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (porDia && !(Number(f.costo_dia) > 0)) { setError(f.modalidad_pago === 'por_hora' ? 'Ingresá el valor por hora.' : 'Ingresá el valor por día (jornal).'); return }
    setGuardando(true)
    // Por acuerdo no tiene valor por día: el monto se pacta en cada obra al asignarlo.
    const base = { nombre: f.nombre.trim(), apellido: f.apellido.trim() || null, tipo: f.tipo, especialidad: f.especialidad.trim() || null, modalidad_pago: f.modalidad_pago, telefono: f.telefono.trim() || null, costo_dia: porDia && f.costo_dia ? Number(f.costo_dia) : null }
    const extra = conDatosPersonales ? { documento: f.documento.trim() || null, cuil: f.cuil.trim() || null, contacto_emergencia: f.contacto_emergencia.trim() || null, seguro: f.seguro.trim() || null, seguro_vencimiento: f.seguro_vencimiento || null, notas: f.notas.trim() || null } : {}
    const datos = { ...base, ...extra }
    const r = editando ? await supabase.from('personal').update(datos).eq('id', persona!.id) : await supabase.from('personal').insert({ ...datos, activo: true })
    if (r.error) { console.error(r.error); setError('No se pudo guardar.'); setGuardando(false); return }
    onGuardado()
  }
  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">{editando ? 'EDITAR REGISTRO' : 'NUEVO REGISTRO'}</p><h2>{editando ? 'Editar personal' : 'Agregar personal'}</h2></div><button className="closeButton" onClick={onCancelar}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}>
      <div className="formGrid">
        <label>Nombre *<input required value={f.nombre} onChange={(e) => set('nombre', e.target.value)} /></label>
        <label>Apellido<input value={f.apellido} onChange={(e) => set('apellido', e.target.value)} /></label>
        <label>Tipo<select value={f.tipo} onChange={(e) => set('tipo', e.target.value)}><option value="obrero">Obrero</option><option value="auxiliar">Auxiliar</option><option value="terciarizado">Tercerizado</option></select></label>
        <label>Especialidad<input value={f.especialidad} onChange={(e) => set('especialidad', e.target.value)} placeholder="Ej.: Electricista, Redes, Domótica" /></label>
        <label>Cómo se le paga<select value={f.modalidad_pago} onChange={(e) => set('modalidad_pago', e.target.value)}>{MODALIDADES_PRINCIPALES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}{!MODALIDADES_PRINCIPALES.some(([v]) => v === f.modalidad_pago) && <option value={f.modalidad_pago}>{MODALIDADES[f.modalidad_pago] ?? f.modalidad_pago}</option>}</select></label>
        <label>Teléfono (WhatsApp)<input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} placeholder="Ej.: 261 555 7970" /></label>
        {porDia && <label>{f.modalidad_pago === 'por_hora' ? 'Valor por hora *' : 'Valor por día (jornal) *'}<input type="number" min="0" step="0.01" value={f.costo_dia} onChange={(e) => set('costo_dia', e.target.value)} /></label>}
      </div>
      <p className="gestionAyuda">{porDia ? 'Se le paga por los días que cargues en el Parte del día: días × valor del día. Se liquida al cierre de la semana.' : 'El monto se acuerda en cada obra al asignarlo, y le corresponde según el avance de la obra. Le pagás cuando quieras.'}</p>
      <details className="peDetalles" open={!!(persona?.documento || persona?.seguro_vencimiento)}>
        <summary>Datos personales y seguro (para ingresar a obras)</summary>
        {!conDatosPersonales ? <p className="usFalta">Para guardar DNI, CUIL, contacto de emergencia y ART, corré el SQL de Personal (fase 18) en Supabase.</p> : <div className="formGrid">
          <label>DNI<input value={f.documento} onChange={(e) => set('documento', e.target.value)} /></label>
          <label>CUIL<input value={f.cuil} onChange={(e) => set('cuil', e.target.value)} placeholder="20-12345678-9" /></label>
          <label className="formFull">Contacto de emergencia<input value={f.contacto_emergencia} onChange={(e) => set('contacto_emergencia', e.target.value)} placeholder="Nombre y teléfono" /></label>
          <label>ART / seguro<input value={f.seguro} onChange={(e) => set('seguro', e.target.value)} placeholder="Ej.: ART Galeno · AP La Segunda" /></label>
          <label>Vence el<input type="date" value={f.seguro_vencimiento} onChange={(e) => set('seguro_vencimiento', e.target.value)} /></label>
          <label className="formFull">Notas<textarea rows={2} value={f.notas} onChange={(e) => set('notas', e.target.value)} placeholder="Talles de ropa, herramientas a cargo, etc." /></label>
        </div>}
      </details>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Guardar'}</button></div>
    </form></div></div>
}

function FormularioAsignacion({ persona, obras, asignadas, onCancelar, onGuardado }: { persona: Persona; obras: Obra[]; asignadas: number[]; onCancelar: () => void; onGuardado: () => void }) {
  const [obraId, setObraId] = useState(''); const [rol, setRol] = useState(''); const [guardando, setGuardando] = useState(false); const [error, setError] = useState('')
  // La modalidad sale de la ficha de la persona: por día trae su jornal; por acuerdo pide el monto de esta obra.
  const [modalidad, setModalidad] = useState(modalidadDePersona(persona.modalidad_pago))
  const [valor, setValor] = useState(modalidadDePersona(persona.modalidad_pago) !== 'por_obra' && persona.costo_dia ? String(persona.costo_dia) : '')
  const libres = obras.filter((o) => !asignadas.includes(o.id))
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!(Number(valor) > 0)) { setError(modalidad === 'por_obra' ? 'Ingresá el monto acordado para esta obra.' : 'Ingresá el valor por día.'); return }
    setGuardando(true)
    const r = await supabase.from('obra_asignaciones').insert({ obra_id: Number(obraId), personal_id: persona.id, rol_en_obra: rol.trim() || null, modalidad, valor_acordado: Number(valor) })
    if (r.error) { console.error(r.error); setError('No se pudo asignar.'); setGuardando(false); return }
    onGuardado()
  }
  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">{nombrePersona(persona)}</p><h2>Asignar a obra</h2></div><button className="closeButton" onClick={onCancelar}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}><div className="formGrid">
      <label>Obra *<select required value={obraId} onChange={(e) => setObraId(e.target.value)}><option value="">{libres.length ? 'Seleccionar obra' : 'Ya está en todas las obras activas'}</option>{libres.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}</select></label>
      <label>Cómo se le paga<select value={modalidad} onChange={(e) => { setModalidad(e.target.value); setValor(e.target.value !== 'por_obra' && persona.costo_dia ? String(persona.costo_dia) : '') }}>{MODALIDADES_PRINCIPALES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}{!MODALIDADES_PRINCIPALES.some(([v]) => v === modalidad) && <option value={modalidad}>{MODALIDADES[modalidad] ?? modalidad}</option>}</select></label>
      <label>{modalidad === 'por_obra' ? 'Monto acordado por esta obra *' : modalidad === 'por_hora' ? 'Valor por hora *' : 'Valor por día (jornal) *'}<input type="number" min="0" step="0.01" required value={valor} onChange={(e) => setValor(e.target.value)} /></label>
      <label>Función en la obra<input value={rol} onChange={(e) => setRol(e.target.value)} placeholder="Ej.: Instalador" /></label>
    </div>
      <p className="gestionAyuda">{modalidad === 'por_obra' ? 'Le corresponde el monto acordado × el % de avance de la obra.' : 'Le corresponde lo que cargues en el Parte del día × el valor del día.'}{asignadas.length > 0 ? ` Ya está en ${asignadas.length} obra(s); para cambiar un valor, hacelo desde la ficha de la obra.` : ''}</p>
      {error && <p className="loginError">{error}</p>}
      <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando || !libres.length}>{guardando ? 'Guardando...' : 'Asignar'}</button></div>
    </form></div></div>
}

export default Personal
