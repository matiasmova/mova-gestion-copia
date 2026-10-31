import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Pedido } from './BuscadorGlobal'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'
import { linkWhatsApp } from './whatsapp'
import { confirmarEliminacion } from './confirmar'
import CargarPago from './CargarPago'

// Personal: todo se maneja desde acá. Cargás cada pago (a quién, cuánto y a qué
// obra va) y ves cuánto le pagaste a cada uno en el mes y a qué obras fue.
// Los pagos se guardan en "costos" (mano de obra de la obra): en cada obra se
// descuentan del "Gasto por ayudantes estimado" del presupuesto.

type Persona = {
  id: number; nombre: string; apellido: string | null; tipo: string; telefono: string | null
  especialidad: string | null; activo: boolean
  // Datos personales (columnas nuevas; si falta el SQL quedan vacías).
  documento?: string | null; cuil?: string | null; contacto_emergencia?: string | null
  seguro?: string | null; seguro_vencimiento?: string | null; notas?: string | null
}
type Obra = { id: number; nombre_obra: string; activo: boolean }
type Pago = { id: number; obra_id: number | null; personal_id: number | null; tipo: string; descripcion: string | null; monto: number; fecha: string }
type Datos = { personas: Persona[]; obras: Obra[]; pagos: Pago[]; conDatosPersonales: boolean }
type Pestana = 'pagos' | 'equipo' | 'movimientos'

const TIPOS: Record<string, string> = { obrero: 'Obrero', auxiliar: 'Auxiliar', terciarizado: 'Tercerizado' }
const COLORES_OBRA = ['#e47b00', '#2f6fd6', '#12a06a', '#7c5cff', '#d9483f', '#0e8fb5', '#d4880f', '#8b5cf6']
const nombrePersona = (p: { nombre: string; apellido: string | null } | undefined | null) => (p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : 'Mano de obra')
const aTexto = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hoyTexto = () => aTexto(new Date())
const diasHasta = (f: string) => Math.round((new Date(`${f.slice(0, 10)}T12:00:00`).getTime() - new Date(`${hoyTexto()}T12:00:00`).getTime()) / 86400000)
const nombreMes = (m: string) => { const t = new Date(`${m}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1) }
const detalleDe = (p: Pago) => (p.descripcion ?? '').replace(/^Pago a [^·]+(· ?|$)/, '').trim()

// Lee una tabla completa en tandas de 500 filas (evita el tope por defecto de Supabase).
async function leerTodo<T>(tabla: string, columnas: string, extra?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
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
  const [personas, obras, costos, extra] = await Promise.all([
    leerTodo<Persona>('personal', '*'),
    leerTodo<Obra>('obras', 'id,nombre_obra,activo'),
    leerTodo<Pago>('costos', 'id,obra_id,personal_id,tipo,descripcion,monto,fecha', (q) => q.in('tipo', ['mano_obra', 'terciarizado'])),
    supabase.from('personal').select('id,seguro_vencimiento').limit(1),
  ])
  return {
    personas: personas.sort((a, b) => nombrePersona(a).localeCompare(nombrePersona(b))),
    obras,
    pagos: costos.map((c) => ({ ...c, monto: Number(c.monto) || 0 })).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id),
    conDatosPersonales: !extra.error,
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
  const [pestana, setPestana] = useState<Pestana>('pagos')
  const [mes, setMes] = useState(() => hoyTexto().slice(0, 7))
  const [verBajas, setVerBajas] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [formPersona, setFormPersona] = useState<Persona | 'nueva' | null>(null)
  const [pagando, setPagando] = useState<{ personaId?: number } | null>(null)
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
    else if (pedido.accion === 'parte' || pedido.accion === 'pagoPersonal') setPagando({})
    onPedidoAtendido?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido])

  const obraNombre = (id: number | null) => (id == null ? 'Sin obra (gasto general)' : datos?.obras.find((o) => o.id === id)?.nombre_obra ?? `Obra #${id}`)
  const colorObra = (id: number | null) => (id == null ? '#9aa2ae' : COLORES_OBRA[Math.abs(id) % COLORES_OBRA.length])
  const persona = (id: number | null) => datos?.personas.find((p) => p.id === id)
  const delMes = useMemo(() => (datos?.pagos ?? []).filter((p) => p.fecha.slice(0, 7) === mes), [datos, mes])
  const meses = useMemo(() => {
    const set = new Set((datos?.pagos ?? []).map((p) => p.fecha.slice(0, 7)))
    set.add(hoyTexto().slice(0, 7))
    return Array.from(set).sort().reverse()
  }, [datos])
  const totalMes = delMes.reduce((s, p) => s + p.monto, 0)
  const obrasMes = new Set(delMes.filter((p) => p.obra_id != null).map((p) => p.obra_id)).size
  const seguros = (datos?.personas ?? []).filter((p) => p.activo && estadoSeguro(p))

  // Resumen por empleado del mes elegido (activos, y los de baja si cobraron ese mes).
  const resumen = useMemo(() => {
    if (!datos) return []
    return datos.personas.filter((p) => p.activo || delMes.some((x) => x.personal_id === p.id)).map((p) => {
      const suyos = delMes.filter((x) => x.personal_id === p.id)
      const porObra = new Map<number | null, number>()
      suyos.forEach((x) => porObra.set(x.obra_id, (porObra.get(x.obra_id) ?? 0) + x.monto))
      return { p, suyos, total: suyos.reduce((s, x) => s + x.monto, 0), porObra: Array.from(porObra.entries()).sort((a, b) => b[1] - a[1]), ultimo: datos.pagos.find((x) => x.personal_id === p.id)?.fecha ?? null }
    }).sort((a, b) => b.total - a.total || nombrePersona(a.p).localeCompare(nombrePersona(b.p)))
  }, [datos, delMes])
  const sinPersonaMes = delMes.filter((x) => x.personal_id == null || !datos?.personas.some((p) => p.id === x.personal_id))

  async function borrarPago(c: Pago) {
    if (!confirmarEliminacion(`¿Eliminar el pago de ${moneda(c.monto)} del ${fechaCorta(c.fecha)}?\n${nombrePersona(persona(c.personal_id))} · ${obraNombre(c.obra_id)}`)) return
    const { error: e } = await supabase.from('costos').delete().eq('id', c.id)
    if (e) { window.alert('No se pudo eliminar.'); return }
    recargar()
  }
  async function darDeBaja(p: Persona) {
    if (!confirmarEliminacion(`¿Dar de baja a ${nombrePersona(p)}?\n\nNo se borra nada: sus pagos quedan guardados. Podés reactivarlo cuando quieras desde "Dados de baja".`)) return
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
  // Eliminar del todo (solo dados de baja): se borran sus asignaciones y jornales viejos;
  // los pagos que ya le hiciste quedan como gasto de la obra, sin su nombre.
  async function eliminar(p: Persona) {
    const pagos = (datos?.pagos ?? []).filter((c) => c.personal_id === p.id).length
    if (!confirmarEliminacion(`¿Eliminar a ${nombrePersona(p)} para siempre?\n\nSe borran sus datos.${pagos ? ` Los ${pagos} pago(s) que le hiciste quedan en las obras como gasto de mano de obra (sin su nombre), así no cambian tus cuentas.` : ''}\n\nNo se puede deshacer.`)) return
    const pasos = [
      await supabase.from('jornales').delete().eq('personal_id', p.id),
      await supabase.from('obra_asignaciones').delete().eq('personal_id', p.id),
      await supabase.from('costos').update({ personal_id: null }).eq('personal_id', p.id),
      await supabase.from('personal').delete().eq('id', p.id),
    ]
    const fallo = pasos.find((r) => r.error)
    if (fallo) { console.error(fallo.error); window.alert(`No se pudo eliminar: ${fallo.error?.message ?? 'probá de nuevo'}`); recargar(); return }
    setAviso(`${nombrePersona(p)} se eliminó.`)
    recargar()
  }
  function whatsappMes(r: (typeof resumen)[number]) {
    const lineas = r.suyos.slice().reverse().map((x) => `• ${fechaCorta(x.fecha)} · ${obraNombre(x.obra_id)}: ${moneda(x.monto)}`)
    const url = linkWhatsApp(r.p.telefono, `Hola ${r.p.nombre}! Te paso los pagos de ${nombreMes(mes).toLowerCase()}:\n${lineas.join('\n') || '• Sin pagos'}\nTotal: ${moneda(r.total)}`)
    if (url) window.open(url, '_blank', 'noopener')
  }

  const equipo = (datos?.personas ?? [])
    .filter((p) => p.activo !== verBajas)
    .filter((p) => { const t = busqueda.trim().toLowerCase(); return !t || `${nombrePersona(p)} ${p.especialidad ?? ''} ${p.telefono ?? ''}`.toLowerCase().includes(t) })

  return <div className="gestionPage">
    <div className="pageHeader">
      <div><p className="subtitle">RECURSOS HUMANOS</p><h2>Personal</h2><p className="welcome">Cargá los pagos, elegí la obra y mirá cuánto le pagaste a cada uno</p></div>
      <div className="headerActions peHeaderAcc">
        <button type="button" className="editButton" onClick={() => setFormPersona('nueva')}>+ Nueva persona</button>
        <button type="button" className="newButton" disabled={!datos} onClick={() => setPagando({})}>💵 Cargar pago</button>
      </div>
    </div>

    {error && <p className="loginError">{error}</p>}
    {aviso && <p className="gestionAyuda" role="status">✓ {aviso}</p>}
    {!datos && !error && <p>Cargando personal…</p>}

    {datos && <>
      <div className="peKpis">
        <button type="button" onClick={() => setPestana('pagos')}><span>Pagado en {nombreMes(mes).split(' ')[0].toLowerCase()}</span><strong>{moneda(totalMes)}</strong><small>{nombreMes(mes)}</small></button>
        <button type="button" onClick={() => setPestana('pagos')}><span>Pagos del mes</span><strong>{delMes.length}</strong><small>{new Set(delMes.map((p) => p.personal_id)).size} persona(s)</small></button>
        <button type="button" onClick={() => setPestana('pagos')}><span>Obras con pagos</span><strong>{obrasMes}</strong><small>{delMes.some((p) => p.obra_id == null) ? 'más gastos generales' : 'en el mes'}</small></button>
        <div className={seguros.length ? 'alerta' : ''}><span>Seguros / ART</span><strong>{seguros.length ? `${seguros.length} para revisar` : 'Al día'}</strong><small>{datos.conDatosPersonales ? 'Vencidos o por vencer (15 días)' : 'Corré el SQL de Personal para cargarlos'}</small></div>
      </div>

      <div className="gestionTabs">
        <button className={pestana === 'pagos' ? 'active' : ''} onClick={() => setPestana('pagos')}>💵 Pagos del mes</button>
        <button className={pestana === 'equipo' ? 'active' : ''} onClick={() => setPestana('equipo')}>👷 Equipo</button>
        <button className={pestana === 'movimientos' ? 'active' : ''} onClick={() => setPestana('movimientos')}>📋 Historial</button>
      </div>

      {pestana === 'pagos' && <>
        <div className="peFiltros">
          <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes">{meses.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}</select>
        </div>
        <section className="liSeccion">
          <div className="liHead"><div><h3>Resumen por empleado</h3><small>{nombreMes(mes)} · total {moneda(totalMes)}</small></div></div>
          {resumen.length === 0 ? <p className="agVacio">Sin personal cargado. Agregá a alguien con "+ Nueva persona".</p> : <div className="peResGrid">
            {resumen.map((r) => <article key={r.p.id} className={`peRes${r.total > 0 ? '' : ' cero'}`}>
              <div className="peResCab">
                <div className="peAvatar">{r.p.nombre.charAt(0).toUpperCase()}</div>
                <span><b>{nombrePersona(r.p)}</b><small>{[r.p.especialidad, TIPOS[r.p.tipo] ?? r.p.tipo].filter(Boolean).join(' · ')}{r.p.activo ? '' : ' · de baja'}</small></span>
                <em><b>{moneda(r.total)}</b><small>{r.suyos.length} pago(s) en el mes</small></em>
              </div>
              <div className="peResObras">{r.porObra.length ? r.porObra.map(([o, m]) => <span key={String(o)} style={{ ['--c' as string]: colorObra(o) }}><i aria-hidden />{obraNombre(o)} · <b>{moneda(m)}</b></span>) : <small>Sin pagos este mes{r.ultimo ? ` · último ${fechaCorta(r.ultimo)}` : ''}</small>}</div>
              <div className="peResAcc">
                {r.p.activo && <button type="button" className="newButton" onClick={() => setPagando({ personaId: r.p.id })}>💵 Cargar pago</button>}
                {r.p.telefono && r.suyos.length > 0 && <button type="button" className="editButton peWa" onClick={() => whatsappMes(r)}>💬 Mandarle el resumen</button>}
              </div>
            </article>)}
          </div>}
          {sinPersonaMes.length > 0 && <p className="gestionAyuda">Además hay {sinPersonaMes.length} pago(s) de mano de obra sin persona ({moneda(sinPersonaMes.reduce((s, x) => s + x.monto, 0))}).</p>}
        </section>
        <section className="liSeccion">
          <div className="liHead"><div><h3>Pagos de {nombreMes(mes).toLowerCase()}</h3><small>{delMes.length} pago(s)</small></div></div>
          {delMes.length === 0 ? <p className="agVacio">No hay pagos en este mes. Cargá uno con "💵 Cargar pago".</p> : delMes.map((c) => (
            <div key={c.id} className="mvFila">
              <span className="mvFecha">{fechaCorta(c.fecha)}</span>
              <span className="mvInfo"><strong>{nombrePersona(persona(c.personal_id))}</strong><small>{obraNombre(c.obra_id)}{detalleDe(c) ? ` · ${detalleDe(c)}` : ''}</small></span>
              <b>{moneda(c.monto)}</b>
              <button type="button" className="adicNo" onClick={() => void borrarPago(c)} aria-label="Eliminar pago">✕</button>
            </div>
          ))}
        </section>
      </>}

      {pestana === 'equipo' && <>
        <div className="peFiltros">
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, especialidad o teléfono…" />
          <div className="segTipo">
            <button type="button" className={!verBajas ? 'active' : ''} onClick={() => setVerBajas(false)}>Activos ({datos.personas.filter((p) => p.activo).length})</button>
            <button type="button" className={verBajas ? 'active' : ''} onClick={() => setVerBajas(true)}>Dados de baja ({datos.personas.filter((p) => !p.activo).length})</button>
          </div>
        </div>
        {equipo.length === 0 ? <div className="agVacio">{verBajas ? 'No hay personas dadas de baja.' : 'Sin personal cargado. Agregá a alguien con "+ Nueva persona".'}</div> : <div className="peGrid">
          {equipo.map((p) => {
            const seguro = estadoSeguro(p)
            const suyos = datos.pagos.filter((x) => x.personal_id === p.id)
            return <article key={p.id} className={`peCard ${p.activo ? '' : 'baja'}`}>
              <div className="peTop">
                <div className="peAvatar">{p.nombre.charAt(0).toUpperCase()}</div>
                <div className="peNombre">
                  <strong>{nombrePersona(p)}</strong>
                  <small>{[p.especialidad, TIPOS[p.tipo] ?? p.tipo].filter(Boolean).join(' · ')}</small>
                  {p.telefono && <small>📞 {p.telefono}</small>}
                </div>
                <div className="peSaldo libre"><span>Pagado en total</span><strong>{moneda(suyos.reduce((s, x) => s + x.monto, 0))}</strong></div>
              </div>
              <div className="peDatos"><span>💵 {suyos.length ? `Último pago ${fechaCorta(suyos[0].fecha)}` : 'Sin pagos'}</span></div>
              {seguro && <p className={`peSeguro ${seguro.clase}`}>🛡 {seguro.texto}</p>}
              <div className="peAcciones">
                {p.activo ? <>
                  <button type="button" className="newButton" onClick={() => setPagando({ personaId: p.id })}>💵 Cargar pago</button>
                  <button type="button" className="editButton" onClick={() => setFormPersona(p)}>Editar datos</button>
                  <button type="button" className="editButton peEliminar" onClick={() => void darDeBaja(p)}>Dar de baja</button>
                </> : <>
                  <button type="button" className="newButton" onClick={() => void reactivar(p)}>↺ Reactivar</button>
                  <button type="button" className="editButton peEliminar" onClick={() => void eliminar(p)}>🗑 Eliminar</button>
                </>}
              </div>
            </article>
          })}
        </div>}
      </>}

      {pestana === 'movimientos' && <Movimientos datos={datos} obraNombre={obraNombre} onBorrar={(c) => void borrarPago(c)} />}
    </>}

    {formPersona && <FormularioPersona persona={formPersona === 'nueva' ? undefined : formPersona} conDatosPersonales={datos?.conDatosPersonales ?? false}
      onCancelar={() => setFormPersona(null)} onGuardado={() => { setFormPersona(null); recargar() }} />}
    {pagando && <CargarPago personaId={pagando.personaId} onCancelar={() => setPagando(null)} onGuardado={(texto) => { setPagando(null); setAviso(texto); recargar() }} />}
  </div>
}

// ---------- Historial de pagos (con filtros) ----------
function Movimientos({ datos, obraNombre, onBorrar }: { datos: Datos; obraNombre: (id: number | null) => string; onBorrar: (c: Pago) => void }) {
  const [fObra, setFObra] = useState('')
  const [fPersona, setFPersona] = useState('')
  const persona = (id: number | null) => datos.personas.find((p) => p.id === id)
  const pagos = datos.pagos.filter((c) => (!fObra || String(c.obra_id ?? 'general') === fObra) && (!fPersona || c.personal_id === Number(fPersona)))
  // Mano de obra por mes (últimos 6 meses), para ver cómo viene el costo.
  const ultimos = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return aTexto(d).slice(0, 7) })
  const porMes = ultimos.map((m) => ({ m, v: pagos.filter((c) => c.fecha.slice(0, 7) === m).reduce((s, c) => s + c.monto, 0) }))
  const maxMes = Math.max(1, ...porMes.map((x) => x.v))
  return <div className="mvWrap">
    <div className="peFiltros">
      <select value={fPersona} onChange={(e) => setFPersona(e.target.value)}><option value="">Todas las personas</option>{datos.personas.map((p) => <option key={p.id} value={p.id}>{nombrePersona(p)}{p.activo ? '' : ' (baja)'}</option>)}</select>
      <select value={fObra} onChange={(e) => setFObra(e.target.value)}><option value="">Todas las obras</option>{datos.obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}<option value="general">Sin obra (gasto general)</option></select>
    </div>
    <section className="liSeccion">
      <div className="liHead"><div><h3>Pagos por mes</h3><small>Últimos 6 meses{fObra || fPersona ? ', con el filtro elegido' : ''}</small></div></div>
      <div className="mvBarras">
        {porMes.map((x) => <div key={x.m} className="mvBarra" title={`${x.m}: ${moneda(x.v)}`}>
          <b>{x.v > 0 ? `$ ${Math.round(x.v).toLocaleString('es-AR')}` : ''}</b>
          <div><span style={{ height: `${(x.v / maxMes) * 100}%` }} /></div>
          <small>{new Date(`${x.m}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')}</small>
        </div>)}
      </div>
    </section>
    <section className="liSeccion">
      <div className="liHead"><div><h3>Pagos</h3><small>{pagos.length} pago(s) · total {moneda(pagos.reduce((s, c) => s + c.monto, 0))}</small></div></div>
      {pagos.length === 0 ? <p className="agVacio">No hay pagos con este filtro.</p> : pagos.slice(0, 300).map((c) => (
        <div key={c.id} className="mvFila">
          <span className="mvFecha">{fechaCorta(c.fecha)}</span>
          <span className="mvInfo"><strong>{nombrePersona(persona(c.personal_id))}</strong><small>{obraNombre(c.obra_id)}{detalleDe(c) ? ` · ${detalleDe(c)}` : ''}</small></span>
          <b>{moneda(c.monto)}</b>
          <button type="button" className="adicNo" onClick={() => onBorrar(c)} aria-label="Eliminar pago">✕</button>
        </div>
      ))}
      {pagos.length > 300 && <p className="gestionAyuda">Se muestran los 300 más recientes. Usá los filtros para ver otros.</p>}
    </section>
  </div>
}

// ---------- Ficha de la persona ----------
function FormularioPersona({ persona, conDatosPersonales, onCancelar, onGuardado }: { persona?: Persona; conDatosPersonales: boolean; onCancelar: () => void; onGuardado: () => void }) {
  const editando = !!persona
  const [f, setF] = useState({
    nombre: persona?.nombre ?? '', apellido: persona?.apellido ?? '', tipo: persona?.tipo ?? 'obrero',
    especialidad: persona?.especialidad ?? '', telefono: persona?.telefono ?? '',
    documento: persona?.documento ?? '', cuil: persona?.cuil ?? '', contacto_emergencia: persona?.contacto_emergencia ?? '',
    seguro: persona?.seguro ?? '', seguro_vencimiento: persona?.seguro_vencimiento?.slice(0, 10) ?? '', notas: persona?.notas ?? '',
  })
  const [guardando, setGuardando] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF((a) => ({ ...a, [k]: v }))
  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    setGuardando(true)
    const base = { nombre: f.nombre.trim(), apellido: f.apellido.trim() || null, tipo: f.tipo, especialidad: f.especialidad.trim() || null, telefono: f.telefono.trim() || null }
    const extra = conDatosPersonales ? { documento: f.documento.trim() || null, cuil: f.cuil.trim() || null, contacto_emergencia: f.contacto_emergencia.trim() || null, seguro: f.seguro.trim() || null, seguro_vencimiento: f.seguro_vencimiento || null, notas: f.notas.trim() || null } : {}
    const datos = { ...base, ...extra }
    const r = editando ? await supabase.from('personal').update(datos).eq('id', persona!.id) : await supabase.from('personal').insert({ ...datos, modalidad_pago: 'libre', activo: true })
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
        <label>Teléfono (WhatsApp)<input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} placeholder="Ej.: 261 555 7970" /></label>
      </div>
      <p className="gestionAyuda">Los pagos se cargan con "💵 Cargar pago": elegís la obra y se descuentan del gasto por ayudantes estimado de su presupuesto.</p>
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


export default Personal
