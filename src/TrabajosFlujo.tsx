import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { cuentasPorObra } from './cuentaObra'
import { obrasSinPresupuesto } from './estadoTrabajo'
import { cuentaTrabajo, empleadosDeObra, esExtraDeObra, esPagoEmpleado, totalEmpleados, type ItemCuenta } from './gananciaTrabajo'

// "¿Qué hago ahora?": todos los trabajos agrupados por lo que hay que hacer
// (cobrar, seguir, armar y enviar, en obra). Arriba, lo que toca hoy y una cinta
// con la plata en cada etapa; las etapas y las tarjetas de arriba filtran.
// Cada fila dice qué pasa, cuánto ganás y su próximo paso.

export type EtapaFlujo = 'arm' | 'env' | 'obr' | 'ter'
export type Abrir = { tipo: 'presupuesto'; id: number } | { tipo: 'obra'; id: number } | { tipo: 'nuevo'; obraId: number; clienteId: number }

// Grupo de la lista según lo que hay que hacer (no según la etapa).
export type GrupoFlujo = 'cobrar' | 'seguir' | 'enviar' | 'obra' | 'cobrado'
type Fila = {
  clave: string; etapa: EtapaFlujo; titulo: string; cliente: string; total: number; ganancia: number | null
  que: string; accion: string; urgencia: number; abrir: Abrir; buscar: string
  grupo: GrupoFlujo; cobrar: number; dias: number | null; avance: number | null
}

const GRUPOS: { k: GrupoFlujo; t: string; suma: (f: Fila) => number; sumaTxt: string; orden: (a: Fila, b: Fila) => number }[] = [
  { k: 'cobrar', t: 'Cobrar', suma: (f) => f.cobrar, sumaTxt: 'a cobrar', orden: (a, b) => b.cobrar - a.cobrar },
  { k: 'seguir', t: 'Seguir: sin respuesta', suma: (f) => f.total, sumaTxt: 'en juego', orden: (a, b) => (b.dias ?? 0) - (a.dias ?? 0) || b.total - a.total },
  { k: 'enviar', t: 'Armar y enviar', suma: (f) => f.total, sumaTxt: 'por enviar', orden: (a, b) => b.urgencia - a.urgencia || (b.dias ?? 0) - (a.dias ?? 0) },
  { k: 'obra', t: 'En obra, al día', suma: (f) => f.total, sumaTxt: '', orden: (a, b) => (b.avance ?? 0) - (a.avance ?? 0) },
]
// Un presupuesto enviado hace más de esto se marca en rojo.
const DIAS_TARDE = 14

export const ETAPAS: Record<EtapaFlujo, { t: string; i: string; ayuda: string }> = {
  arm: { t: 'Armando', i: '✏️', ayuda: 'borradores y obras sin presupuesto' },
  env: { t: 'Enviado', i: '📤', ayuda: 'esperando respuesta' },
  obr: { t: 'En obra', i: '🏗️', ayuda: 'aceptados, trabajando' },
  ter: { t: 'Terminado', i: '✅', ayuda: 'listos' },
}
const ORDEN: EtapaFlujo[] = ['arm', 'env', 'obr', 'ter']
const esEtapa = (f: string): f is EtapaFlujo => (ORDEN as string[]).includes(f)
const num = (x: unknown) => Number(x) || 0
const pesos = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`
// Montos siempre con el número completo (sin abreviar en k o M).
const corto = (n: number) => `${n < 0 ? '− ' : ''}$ ${Math.round(Math.abs(n)).toLocaleString('es-AR')}`
const diasDesde = (f: string | null | undefined) => (f ? Math.max(0, Math.floor((Date.now() - new Date(f.length <= 10 ? `${f}T12:00:00` : f).getTime()) / 86400000)) : 0)
const haceDias = (d: number) => (d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`)
const terminada = (o: { estado: string | null; porcentaje_avance: unknown }) => o.estado === 'finalizada' || o.estado === 'observacion' || num(o.porcentaje_avance) >= 100

type Pres = { id: number; cliente_id: number; obra_id: number | null; titulo: string; estado: string; total: number; fecha: string | null; created_at: string | null; enviado_at?: string | null; pago_empleados_estimado?: number | null; activo: boolean | null }
type Obra = { id: number; cliente_id: number; nombre_obra: string; estado: string | null; porcentaje_avance: number | null; activo: boolean | null }

export default function TrabajosFlujo({ verPlata, busqueda, revision, onAbrir, onNuevo }: { verPlata: boolean; busqueda: string; revision: number; onAbrir: (a: Abrir) => void; onNuevo?: () => void }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState<EtapaFlujo | GrupoFlujo | null>(null)
  const [verCobrados, setVerCobrados] = useState(false)

  useEffect(() => {
    let vigente = true
    void (async () => {
      setError('')
      const conEst = 'id,cliente_id,obra_id,titulo,estado,total,fecha,created_at,activo,pago_empleados_estimado'
      let rP = await supabase.from('presupuestos').select(conEst).eq('activo', true)
      if (rP.error) rP = await supabase.from('presupuestos').select('id,cliente_id,obra_id,titulo,estado,total,fecha,created_at,activo').eq('activo', true) as typeof rP
      const [rO, rC, rPa, rAd, rCo, rSeg] = await Promise.all([
        supabase.from('obras').select('id,cliente_id,nombre_obra,estado,porcentaje_avance,activo').eq('activo', true),
        supabase.from('Clientes').select('id,nombre,apellido'),
        supabase.from('pagos').select('obra_id,presupuesto_id,monto'),
        supabase.from('adicionales').select('obra_id,importe,estado,tipo'),
        supabase.from('costos').select('obra_id,personal_id,tipo,monto'),
        supabase.from('presupuestos').select('id,enviado_at').eq('activo', true),
      ])
      if (!vigente) return
      if (rP.error || rO.error) { console.error(rP.error || rO.error); setError('No se pudieron cargar los trabajos.'); return }
      const envios = new Map(((rSeg.error ? [] : rSeg.data ?? []) as { id: number; enviado_at: string | null }[]).map((x) => [x.id, x.enviado_at]))
      const pres = ((rP.data ?? []) as Record<string, unknown>[]).map((p) => ({ ...p, total: num(p.total), pago_empleados_estimado: num(p.pago_empleados_estimado), enviado_at: envios.get(Number(p.id)) ?? null })) as Pres[]
      const obras = (rO.data ?? []) as Obra[]
      const clientes = (rC.data ?? []) as { id: number; nombre: string; apellido: string | null }[]
      const adic = ((rAd.data ?? []) as { obra_id: number | null; importe: unknown; estado: string; tipo: string }[]).map((a) => ({ ...a, importe: num(a.importe) }))
      const costos = ((rCo.data ?? []) as { obra_id: number | null; personal_id: number | null; tipo: string | null; monto: unknown }[]).map((c) => ({ ...c, monto: num(c.monto) }))

      // Ítems para la ganancia (solo si se ve la plata).
      const itemsPor: Record<number, ItemCuenta[]> = {}
      if (verPlata && pres.length) {
        const ids = pres.map((p) => p.id)
        for (let i = 0; i < ids.length; i += 200) {
          const r = await supabase.from('presupuesto_items').select('presupuesto_id,catalogo_id,tipo,cantidad,precio_unitario,costo_unitario,descuento_pct').in('presupuesto_id', ids.slice(i, i + 200))
          for (const it of (r.error ? [] : r.data ?? []) as Record<string, unknown>[]) {
            (itemsPor[Number(it.presupuesto_id)] ??= []).push({ tipo: String(it.tipo ?? ''), catalogo_id: it.catalogo_id == null ? null : Number(it.catalogo_id), cantidad: num(it.cantidad), precio_unitario: num(it.precio_unitario), costo_unitario: num(it.costo_unitario), descuento_pct: num(it.descuento_pct) })
          }
        }
        if (!vigente) return
      }

      const nombreCli = (id: number) => { const c = clientes.find((x) => x.id === id); return c ? `${c.nombre} ${c.apellido ?? ''}`.trim() : 'Cliente' }
      const cuentas = cuentasPorObra(obras, pres, adic, ((rPa.data ?? []) as { obra_id: number | null; presupuesto_id: number | null; monto: unknown }[]).map((p) => ({ ...p, monto: num(p.monto) })))
      const ganancia = (presDeTrabajo: Pres[], obraId: number | null) => {
        if (!verPlata) return null
        const items = presDeTrabajo.flatMap((p) => itemsPor[p.id] ?? [])
        const total = presDeTrabajo.reduce((s, p) => s + p.total, 0)
        const estimado = presDeTrabajo.reduce((s, p) => s + num(p.pago_empleados_estimado), 0)
        if (obraId == null) return cuentaTrabajo(items, total, estimado, 0).ganancia
        const valorObra = total + adic.filter((a) => a.obra_id === obraId && a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + a.importe, 0)
        const filasEmp = empleadosDeObra(costos.filter((c) => c.obra_id === obraId && esPagoEmpleado(c)))
        const ext = costos.filter((c) => c.obra_id === obraId && esExtraDeObra(c)).reduce((s, c) => s + c.monto, 0)
        return cuentaTrabajo(items, total, totalEmpleados(filasEmp, estimado).total, ext, valorObra - total).ganancia
      }

      const out: Fila[] = []
      // Presupuestos que no están en una obra en marcha.
      for (const p of pres) {
        const obra = p.obra_id != null ? obras.find((o) => o.id === p.obra_id) : undefined
        const cli = nombreCli(p.cliente_id)
        const base = { cliente: cli, total: p.total, ganancia: ganancia([p], null), buscar: `${p.titulo} ${cli} ${obra?.nombre_obra ?? ''}`.toLowerCase() }
        if (p.estado === 'borrador') {
          const d = diasDesde(p.created_at ?? p.fecha)
          out.push({ ...base, clave: `p${p.id}`, etapa: 'arm', titulo: p.titulo, que: `Falta enviarlo · creado ${haceDias(d)}`, accion: 'Enviar', urgencia: d >= 2 ? 2 : 1, abrir: { tipo: 'presupuesto', id: p.id }, grupo: 'enviar', cobrar: 0, dias: d, avance: null })
        } else if (p.estado === 'enviado') {
          const d = diasDesde(p.enviado_at ?? p.fecha)
          out.push({ ...base, clave: `p${p.id}`, etapa: 'env', titulo: p.titulo, que: `Enviado ${haceDias(d)} · sin respuesta`, accion: 'Recordar', urgencia: d >= 3 ? 2 : 0, abrir: { tipo: 'presupuesto', id: p.id }, grupo: 'seguir', cobrar: 0, dias: d, avance: null })
        } else if (p.estado === 'aceptado' && (p.obra_id == null || !obra)) {
          out.push({ ...base, clave: `p${p.id}`, etapa: 'arm', titulo: p.titulo, que: 'Aceptado · falta crear la obra', accion: 'Crear obra', urgencia: 3, abrir: { tipo: 'presupuesto', id: p.id }, grupo: 'enviar', cobrar: 0, dias: null, avance: null })
        }
      }
      // Obras con presupuesto aceptado (un trabajo por obra).
      for (const o of obras) {
        const c = cuentas[o.id]
        if (!c) continue
        const suyos = pres.filter((p) => p.obra_id === o.id && p.estado === 'aceptado')
        const cli = nombreCli(o.cliente_id)
        const av = Math.round(c.avance)
        const fin = terminada(o)
        const cobrar = c.pendienteHoy
        const fila: Fila = {
          clave: `o${o.id}`, etapa: fin ? 'ter' : 'obr', titulo: o.nombre_obra, cliente: cli, total: c.valor + c.extras, ganancia: ganancia(suyos, o.id), buscar: `${o.nombre_obra} ${cli}`.toLowerCase(),
          abrir: { tipo: 'obra', id: o.id },
          que: fin ? (c.saldo > 0.5 ? `Terminada · falta cobrar ${pesos(c.saldo)}` : 'Cobrado completo') : cobrar > 0.5 ? `${av}% hecho · cobrar ${pesos(cobrar)}` : `${av}% hecho · al día`,
          accion: (fin ? c.saldo : cobrar) > 0.5 ? 'Cobrar' : fin ? 'Ver' : 'Avance',
          urgencia: (fin ? c.saldo : cobrar) > 0.5 ? 3 : 0,
          grupo: (fin ? c.saldo : cobrar) > 0.5 ? 'cobrar' : fin ? 'cobrado' : 'obra',
          cobrar: Math.max(0, fin ? c.saldo : cobrar), dias: null, avance: av,
        }
        out.push(fila)
      }
      // Obras activas sin presupuesto todavía.
      for (const o of obrasSinPresupuesto(obras, pres)) {
        const cli = nombreCli(o.cliente_id)
        out.push({ clave: `n${o.id}`, etapa: 'arm', titulo: o.nombre_obra, cliente: cli, total: 0, ganancia: null, que: 'Obra sin presupuesto todavía', accion: 'Armar', urgencia: 2, abrir: { tipo: 'nuevo', obraId: o.id, clienteId: o.cliente_id }, buscar: `${o.nombre_obra} ${cli}`.toLowerCase(), grupo: 'enviar', cobrar: 0, dias: null, avance: null })
      }
      setFilas(verPlata ? out : out.filter((f) => f.etapa === 'obr' || f.etapa === 'ter'))
    })()
    return () => { vigente = false }
  }, [verPlata, revision])

  const texto = busqueda.trim().toLowerCase()
  const visibles = useMemo(() => (filas ?? []).filter((f) => !texto || f.buscar.includes(texto)), [filas, texto])
  const porEtapa = (e: EtapaFlujo) => visibles.filter((f) => f.etapa === e)
  const deGrupo = (g: GrupoFlujo) => visibles.filter((f) => f.grupo === g)
  const lista = visibles.filter((f) => !filtro || (esEtapa(filtro) ? f.etapa === filtro : f.grupo === filtro))
  const totalCinta = visibles.reduce((s, f) => s + f.total, 0)
  const cambiarFiltro = (f: EtapaFlujo | GrupoFlujo | null) => setFiltro((x) => (x === f ? null : f))

  const fila = (f: Fila) => {
    const tarde = f.dias != null && f.dias > DIAS_TARDE
    const estado = f.grupo === 'seguir' ? <span className={`tfDias${tarde ? ' tarde' : ''}`}>Enviado {haceDias(f.dias ?? 0)}</span>
      : f.grupo === 'obra' && f.avance != null ? <span className="tfAvance">{f.avance}% hecho<i aria-hidden><i style={{ width: `${Math.min(100, f.avance)}%` }} /></i></span>
      : <span className="tfQue">{f.que}</span>
    return <button key={f.clave} type="button" className={`tfFila2 g-${f.grupo} et-${f.etapa}`} onClick={() => onAbrir(f.abrir)}>
      <span className="tfInfo"><b>{f.cliente || f.titulo}</b>{f.cliente && <small className="tfObra">{f.titulo}</small>}</span>
      {verPlata && f.total > 0 ? <span className="tfPlata"><b>{pesos(f.total)}</b>{f.ganancia != null && <small className={f.ganancia < 0 ? 'neg' : ''}>ganás {corto(f.ganancia)}</small>}</span> : <span />}
      <span className="tfPie">{estado}<span className="tfAcc">{f.accion}</span></span>
    </button>
  }

  if (error) return <p className="loginError">{error}</p>
  if (!filas) return <p className="tfCargando">Cargando trabajos…</p>

  const cob = deGrupo('cobrar'), seg = deGrupo('seguir'), env = deGrupo('enviar')
  const cobrados = lista.filter((f) => f.grupo === 'cobrado').sort((a, b) => b.total - a.total)
  return <div className="tf">
    {verPlata && <div className="tfHoy" role="group" aria-label="Lo que toca hoy">
      <button type="button" className={`g-cobrar${filtro === 'cobrar' ? ' on' : ''}`} aria-pressed={filtro === 'cobrar'} onClick={() => cambiarFiltro('cobrar')}>
        <small>Para cobrar</small><b>{pesos(cob.reduce((s, f) => s + f.cobrar, 0))}</b><span>{cob.length} trabajo{cob.length === 1 ? '' : 's'}</span></button>
      <button type="button" className={`g-seguir${filtro === 'seguir' ? ' on' : ''}`} aria-pressed={filtro === 'seguir'} onClick={() => cambiarFiltro('seguir')}>
        <small>Sin respuesta</small><b>{seg.length}</b><span>{(() => { const n = seg.filter((f) => (f.dias ?? 0) > DIAS_TARDE).length; return n ? `${n} atrasado${n === 1 ? "" : "s"}` : "al día" })()}</span></button>
      <button type="button" className={`g-enviar${filtro === 'enviar' ? ' on' : ''}`} aria-pressed={filtro === 'enviar'} onClick={() => cambiarFiltro('enviar')}>
        <small>Falta enviar</small><b>{env.length}</b><span>{env.length ? pesos(env.reduce((s, f) => s + f.total, 0)) : 'nada pendiente'}</span></button>
    </div>}

    {verPlata && totalCinta > 0 && <div className="tfEtapas">
      <div className="tfCinta" aria-hidden>
        {ORDEN.map((e) => { const v = porEtapa(e).reduce((s, f) => s + f.total, 0); return v > 0 ? <i key={e} className={`et-${e}`} style={{ flex: v / (totalCinta || 1) }} /> : null })}
      </div>
      <div className="tfEtapasCab"><span>Plata en cada etapa</span><b>{corto(totalCinta)} en total</b></div>
    </div>}
    <div className="tfChips" role="group" aria-label="Filtrar por etapa">
      <button type="button" className={!filtro ? 'on' : ''} aria-pressed={!filtro} onClick={() => setFiltro(null)}>Todo</button>
      {ORDEN.map((e) => { const l = porEtapa(e); return <button key={e} type="button" className={`et-${e}${filtro === e ? ' on' : ''}`} aria-pressed={filtro === e} onClick={() => cambiarFiltro(e)}
        title={verPlata ? `${ETAPAS[e].t}: ${corto(l.reduce((s, f) => s + f.total, 0))}` : ETAPAS[e].t}><i aria-hidden />{ETAPAS[e].t}<em>{l.length}</em></button> })}
    </div>
    {filtro && !esEtapa(filtro) && <button type="button" className="tfQuitar" onClick={() => setFiltro(null)}>Mostrando solo «{GRUPOS.find((g) => g.k === filtro)?.t}» · ver todo ✕</button>}

    {GRUPOS.map((g) => {
      const l = lista.filter((f) => f.grupo === g.k).sort(g.orden)
      if (!l.length) return null
      const suma = l.reduce((s, f) => s + g.suma(f), 0)
      return <section key={g.k} className={`tfGrupo g-${g.k}`}>
        <div className="tfGrupoCab"><h3><i aria-hidden />{g.t}<small>· {l.length}</small></h3>{verPlata && g.sumaTxt && suma > 0 && <span>{pesos(suma)} {g.sumaTxt}</span>}</div>
        <div className="tfGrupoLista">{l.map(fila)}</div>
      </section>
    })}
    {cobrados.length > 0 && <section className="tfGrupo g-cobrado">
      <button type="button" className="tfPlegado" aria-expanded={verCobrados} onClick={() => setVerCobrados((v) => !v)}>
        <span>✓ Cobradas completas · {cobrados.length}</span><small>{verPlata ? pesos(cobrados.reduce((s, f) => s + f.total, 0)) : ''} {verCobrados ? '▴' : '▾'}</small></button>
      {verCobrados && <div className="tfGrupoLista">{cobrados.map(fila)}</div>}
    </section>}
    {lista.length === 0 && <div className="tfVacio">{texto ? 'No hay trabajos con esa búsqueda.' : <>No hay trabajos {filtro && esEtapa(filtro) ? `en ${ETAPAS[filtro].t.toLowerCase()}` : filtro ? 'en este grupo' : 'todavía'}. {onNuevo && !filtro && <button type="button" onClick={onNuevo}>＋ Armar un presupuesto</button>}</>}</div>}
  </div>
}
