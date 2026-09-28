import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import Calendario from './Calendario'
import { moneda } from './gestionFormat'
import { etiquetaObra, claseObra } from './obraEstado'
import { calcularPersona } from './personalCalculos'

// Pantalla de inicio (Home): resumen rápido de la empresa.
// Muestra a cada rol solo lo que puede ver en el resto de la app:
//  · Números de plata (neto, deudas, gastos fijos): admin y contable.
//  · Pagos al personal: admin, contable y encargado.
//  · Presupuestos en borrador: admin y contable.
//  · Obras: todos.

type Rol = 'admin' | 'encargado' | 'auxiliar' | 'contable'
type Destino = 'obras' | 'presupuestos' | 'tablero' | 'clientes'

type Obra = { id: number; cliente_id: number; nombre_obra: string; localidad: string | null; estado: string | null; porcentaje_avance: number | null; activo: boolean }
type Cliente = { id: number; nombre: string; apellido: string | null }
type Presupuesto = { id: number; cliente_id: number; obra_id: number | null; titulo: string; estado: string; total: number; activo: boolean; fecha: string | null }
type Pago = { monto: number; fecha: string; obra_id: number | null; presupuesto_id: number | null }
type Costo = { monto: number; fecha: string; personal_id: number | null; obra_id: number | null }
type Gasto = { id: number; fecha: string; categoria: string | null; descripcion: string | null; monto: number; recurrente: boolean }
type Adicional = { obra_id: number; importe: number; estado: string; tipo: string }
type Asig = { obra_id: number; personal_id: number | null; modalidad: string | null; valor_acordado: number | null }
type Persona = { id: number; nombre: string; apellido: string | null; tipo: string; costo_dia: number | null }
type Jornal = { obra_id: number; personal_id: number | null; jornada: number; horas: number | null }

type Props = {
  nombre: string
  rol: Rol
  rolEtiqueta: string
  onNavegar: (destino: Destino) => void
  onSalir: () => void
  onAbrirObra: (obraId: number) => void
}

const mesActual = () => new Date().toISOString().slice(0, 7)
const sumarMeses = (ym: string, n: number) => {
  const [anio, mes] = ym.split('-').map(Number)
  const d = new Date(anio, mes - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const enMes = (f: string | null | undefined, ym: string) => (f ?? '').slice(0, 7) === ym
const nombreMes = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
const diasDesde = (f: string | null) => f ? Math.max(0, Math.floor((Date.now() - new Date(`${f.slice(0, 10)}T12:00:00`).getTime()) / 86400000)) : null
const num = (x: unknown) => Number(x) || 0
const redondear = (n: number) => Math.round(n * 100) / 100

const VERDE = '#23764e'
const ROJO = '#b23b32'
const NARANJA = '#b86608'

export default function HomeResumen({ nombre, rol, rolEtiqueta, onNavegar, onSalir, onAbrirObra }: Props) {
  const verFinanzas = rol === 'admin' || rol === 'contable'
  const verPersonal = verFinanzas || rol === 'encargado'
  const verPresupuestos = verFinanzas

  const [tab, setTab] = useState<'resumen' | 'calendario'>('resumen')
  const [mesSel, setMesSel] = useState(mesActual())
  const [cargando, setCargando] = useState(true)
  const [obras, setObras] = useState<Obra[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [costos, setCostos] = useState<Costo[]>([])
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [adicionales, setAdicionales] = useState<Adicional[]>([])
  const [asignaciones, setAsignaciones] = useState<Asig[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [jornales, setJornales] = useState<Jornal[]>([])

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      const [rO, rC, rP, rPa, rCo, rG, rAd, rAs, rPe, rJ] = await Promise.all([
        supabase.from('obras').select('id,cliente_id,nombre_obra,localidad,estado,porcentaje_avance,activo').eq('activo', true).order('created_at', { ascending: false }),
        supabase.from('Clientes').select('id,nombre,apellido'),
        supabase.from('presupuestos').select('id,cliente_id,obra_id,titulo,estado,total,activo,fecha').eq('activo', true),
        supabase.from('pagos').select('monto,fecha,obra_id,presupuesto_id'),
        supabase.from('costos').select('monto,fecha,personal_id,obra_id'),
        supabase.from('gastos_generales').select('id,fecha,categoria,descripcion,monto,recurrente'),
        supabase.from('adicionales').select('obra_id,importe,estado,tipo'),
        supabase.from('obra_asignaciones').select('obra_id,personal_id,modalidad,valor_acordado'),
        supabase.from('personal').select('id,nombre,apellido,tipo,costo_dia'),
        supabase.from('jornales').select('obra_id,personal_id,jornada,horas'),
      ])
      if (!vigente) return
      setObras(rO.error ? [] : (rO.data ?? []) as Obra[])
      setClientes(rC.error ? [] : (rC.data ?? []) as Cliente[])
      setPresupuestos(rP.error ? [] : (rP.data ?? []).map((p) => ({ ...p, total: num(p.total) })) as Presupuesto[])
      setPagos(rPa.error ? [] : (rPa.data ?? []).map((p) => ({ ...p, monto: num(p.monto) })) as Pago[])
      setCostos(rCo.error ? [] : (rCo.data ?? []).map((c) => ({ ...c, monto: num(c.monto) })) as Costo[])
      setGastos(rG.error ? [] : (rG.data ?? []).map((g) => ({ ...g, monto: num(g.monto) })) as Gasto[])
      setAdicionales(rAd.error ? [] : (rAd.data ?? []).map((a) => ({ ...a, importe: num(a.importe) })) as Adicional[])
      setAsignaciones(rAs.error ? [] : (rAs.data ?? []).map((a) => ({ ...a, valor_acordado: a.valor_acordado == null ? null : num(a.valor_acordado) })) as Asig[])
      setPersonas(rPe.error ? [] : (rPe.data ?? []).map((p) => ({ ...p, costo_dia: p.costo_dia == null ? null : num(p.costo_dia) })) as Persona[])
      setJornales(rJ.error ? [] : (rJ.data ?? []).map((j) => ({ ...j, jornada: num(j.jornada), horas: j.horas == null ? null : num(j.horas) })) as Jornal[])
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [])

  const nombreCli = (id: number) => { const c = clientes.find((x) => x.id === id); return c ? `${c.nombre} ${c.apellido ?? ''}`.trim() : 'Cliente' }

  // ---- Obras: valor, cobrado y situación (igual que Obras y Tablero) ----
  const obrasInfo = useMemo(() => {
    const valorPorObra: Record<number, number> = {}
    const obraDePresupuesto: Record<number, number> = {}
    presupuestos.forEach((p) => {
      if (p.obra_id == null) return
      obraDePresupuesto[p.id] = p.obra_id
      if (p.estado === 'aceptado') valorPorObra[p.obra_id] = (valorPorObra[p.obra_id] || 0) + p.total
    })
    const conAceptado = new Set(Object.keys(valorPorObra).map(Number))
    adicionales.forEach((a) => { if (a.estado === 'aprobado' && conAceptado.has(a.obra_id)) valorPorObra[a.obra_id] += a.importe })
    const cobradoPorObra: Record<number, number> = {}
    pagos.forEach((p) => {
      const obraId = p.obra_id ?? (p.presupuesto_id != null ? obraDePresupuesto[p.presupuesto_id] : undefined)
      if (obraId != null) cobradoPorObra[obraId] = (cobradoPorObra[obraId] || 0) + p.monto
    })

    // Solo cuentan las obras con presupuesto aceptado (misma regla que la pantalla Obras).
    const vigentes = obras.filter((o) => conAceptado.has(o.id))
    const activas = vigentes.filter((o) => (o.estado ?? 'en_proceso') === 'en_proceso')
    const enObservacion = vigentes.filter((o) => o.estado === 'observacion')

    const deudas = vigentes.map((o) => {
      const valor = redondear(valorPorObra[o.id] || 0)
      const cobrado = redondear(cobradoPorObra[o.id] || 0)
      const saldo = redondear(Math.max(0, valor - cobrado))
      const terminada = o.estado === 'finalizada' || o.estado === 'observacion'
      const avance = terminada ? 100 : Math.min(100, Math.max(0, num(o.porcentaje_avance)))
      const faltaAvance = redondear(Math.max(0, valor * avance / 100 - cobrado))
      const situacion: 'rojo' | 'naranja' | 'verde' = terminada ? 'rojo' : faltaAvance > 0.5 ? 'naranja' : 'verde'
      return { obra: o, saldo, faltaAvance, situacion }
    }).filter((d) => d.saldo > 0)
    const orden = { rojo: 0, naranja: 1, verde: 2 }
    deudas.sort((a, b) => orden[a.situacion] - orden[b.situacion] || b.saldo - a.saldo)

    const avancePromedio = activas.length ? Math.round(activas.reduce((s, o) => s + num(o.porcentaje_avance), 0) / activas.length) : 0
    return {
      activas, enObservacion, deudas, avancePromedio,
      porCobrar: deudas.reduce((s, d) => s + d.saldo, 0),
      terminadasConSaldo: deudas.filter((d) => d.situacion === 'rojo'),
    }
  }, [obras, presupuestos, adicionales, pagos])

  const borradores = useMemo(
    () => presupuestos.filter((p) => p.estado === 'borrador').sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '')),
    [presupuestos],
  )

  // ---- Personal: le debés / adelantado / al día (igual que Tablero → Personal) ----
  const personal = useMemo(() => {
    const valorObra = (obraId: number) =>
      presupuestos.filter((p) => p.obra_id === obraId && p.estado === 'aceptado').reduce((s, p) => s + p.total, 0) +
      adicionales.filter((a) => a.obra_id === obraId && a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + a.importe, 0)
    const filas = asignaciones.map((a) => {
      const persona = personas.find((p) => p.id === a.personal_id)
      const obra = obras.find((o) => o.id === a.obra_id)
      const pagosPersona = costos.filter((c) => c.personal_id === a.personal_id && c.obra_id === a.obra_id).map((c) => ({ personal_id: c.personal_id, monto: c.monto }))
      const avanceObra = obra?.porcentaje_avance ?? 0
      const calc = calcularPersona(a, persona, pagosPersona, jornales.filter((j) => j.obra_id === a.obra_id), valorObra(a.obra_id), avanceObra)
      const terminada = obra?.estado === 'finalizada' || obra?.estado === 'observacion'
      const avance = terminada ? 100 : Math.min(100, Math.max(0, num(avanceObra)))
      let debe = 0
      let adelantado = 0
      if (calc.totalContrato != null) {
        const corresponde = calc.totalContrato * avance / 100
        debe = Math.max(0, corresponde - calc.pagado)
        adelantado = Math.max(0, calc.pagado - corresponde)
      } else {
        debe = Math.max(0, calc.diferencia)
        adelantado = Math.max(0, -calc.diferencia)
      }
      return {
        clave: `${a.personal_id}-${a.obra_id}`,
        obraId: a.obra_id,
        nombre: persona ? `${persona.nombre} ${persona.apellido ?? ''}`.trim() : 'Persona',
        obra: obra?.nombre_obra ?? `Obra #${a.obra_id}`,
        debe: redondear(debe),
        adelantado: redondear(adelantado),
      }
    })
    const conMovimiento = filas.filter((f) => f.debe > 0.5 || f.adelantado > 0.5).sort((x, y) => y.debe - x.debe || y.adelantado - x.adelantado)
    return {
      filas: conMovimiento,
      alDia: filas.length - conMovimiento.length,
      debe: filas.reduce((s, f) => s + f.debe, 0),
      adelantado: filas.reduce((s, f) => s + f.adelantado, 0),
    }
  }, [asignaciones, personas, obras, costos, jornales, presupuestos, adicionales])

  // ---- Plata del mes: neto real y neto si pagás lo pendiente ----
  const mes = useMemo(() => {
    const cobrado = pagos.filter((p) => enMes(p.fecha, mesSel)).reduce((s, p) => s + p.monto, 0)
    const manoObra = costos.filter((c) => enMes(c.fecha, mesSel) && c.personal_id != null).reduce((s, c) => s + c.monto, 0)
    const otrosCostos = costos.filter((c) => enMes(c.fecha, mesSel) && c.personal_id == null).reduce((s, c) => s + c.monto, 0)
    const gastosMes = gastos.filter((g) => enMes(g.fecha, mesSel))
    const fijos = gastosMes.reduce((s, g) => s + g.monto, 0)
    const neto = cobrado - manoObra - otrosCostos - fijos

    // Previstos (solo para el mes en curso): recurrentes del mes pasado sin cargar + lo que se le debe al personal por avance.
    const esMesActual = mesSel === mesActual()
    const clave = (g: Gasto) => `${(g.categoria || 'Otros').toLowerCase()}|${(g.descripcion || '').trim().toLowerCase()}`
    const cargados = new Set(gastosMes.map(clave))
    const vistos = new Set<string>()
    const recurrentesPendientes = esMesActual
      ? gastos.filter((g) => g.recurrente && enMes(g.fecha, sumarMeses(mesSel, -1))).filter((g) => {
          const k = clave(g)
          if (cargados.has(k) || vistos.has(k)) return false
          vistos.add(k)
          return true
        })
      : []
    const recurrentesMonto = recurrentesPendientes.reduce((s, g) => s + g.monto, 0)
    const personalPendiente = esMesActual ? personal.debe : 0
    const netoProyectado = neto - recurrentesMonto - personalPendiente

    const categorias: Record<string, number> = {}
    gastosMes.forEach((g) => { const k = g.categoria || 'Otros'; categorias[k] = (categorias[k] || 0) + g.monto })
    return {
      cobrado, manoObra, otrosCostos, fijos, neto, esMesActual,
      recurrentesPendientes, recurrentesMonto, personalPendiente, netoProyectado,
      recurrentesMes: gastosMes.filter((g) => g.recurrente).reduce((s, g) => s + g.monto, 0),
      porCategoria: Object.entries(categorias).sort((a, b) => b[1] - a[1]),
    }
  }, [pagos, costos, gastos, mesSel, personal.debe])

  const colorMonto = (v: number) => (v > 0 ? VERDE : v < 0 ? ROJO : undefined)
  const kpiClick = (destino: Destino) => ({ role: 'button', tabIndex: 0, style: { cursor: 'pointer' }, onClick: () => onNavegar(destino) })
  const maxBarra = Math.max(1, mes.cobrado, mes.manoObra + mes.otrosCostos + mes.fijos)

  const barraNeto = (etiqueta: string, monto: number, signo: '+' | '−', color: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 190px) 1fr auto', gap: 10, alignItems: 'center', padding: '6px 0', fontSize: 14 }}>
      <span>{etiqueta}</span>
      <div className="tabBar"><span style={{ width: `${(monto / maxBarra) * 100}%`, background: color }} /></div>
      <strong style={{ whiteSpace: 'nowrap', color: signo === '−' && monto > 0 ? ROJO : undefined }}>{signo === '−' && monto > 0 ? '− ' : ''}{moneda(monto)}</strong>
    </div>
  )

  const hayAlertas = obrasInfo.enObservacion.length > 0 || (verFinanzas && obrasInfo.terminadasConSaldo.length > 0) || (verPresupuestos && borradores.length > 0)

  return <div className="fase2Dashboard">
    <header className="fase2Encabezado">
      <div><p className="subtitle">MOVA GESTIÓN · {rolEtiqueta.toUpperCase()}</p><h2>Hola, {nombre || 'bienvenido'}</h2><p className="welcome">Resumen rápido de tu empresa</p></div>
      <div className="headerActions"><button className="logoutButton" onClick={onSalir}>Cerrar sesión</button><button className="newButton" onClick={() => onNavegar('clientes')}>+ Nuevo</button></div>
    </header>

    <div className="gestionTabs" style={{ marginBottom: 18 }}>
      <button className={tab === 'resumen' ? 'active' : ''} onClick={() => setTab('resumen')}>Resumen</button>
      <button className={tab === 'calendario' ? 'active' : ''} onClick={() => setTab('calendario')}>📅 Calendario</button>
    </div>

    {tab === 'calendario' && <Calendario obras={obras.map((o) => ({ id: o.id, nombre_obra: o.nombre_obra }))} />}

    {tab === 'resumen' && (cargando ? <p>Cargando resumen...</p> : <>
      {verFinanzas && (
        <div className="dashMesFiltro">
          <label>Ver mes<input type="month" value={mesSel} max={mesActual()} onChange={(e) => e.target.value && setMesSel(e.target.value)} /></label>
          <span>{nombreMes(mesSel)}{!mes.esMesActual && ' · los previstos se calculan solo para el mes en curso'}</span>
        </div>
      )}

      {/* ---- Números principales ---- */}
      <section className="fase2Kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        {verFinanzas && (
          <div className="destacado" {...kpiClick('tablero')}>
            <span>NETO DEL MES</span>
            <strong style={{ color: colorMonto(mes.neto) }}>{moneda(mes.neto)}</strong>
            <small>{mes.esMesActual && (mes.recurrentesMonto > 0 || mes.personalPendiente > 0) ? `Si pagás lo previsto: ${moneda(mes.netoProyectado)}` : 'Cobrado − todos los gastos'}</small>
          </div>
        )}
        <div {...kpiClick('obras')}>
          <span>OBRAS ACTIVAS</span>
          <strong>{obrasInfo.activas.length}</strong>
          <small>{obrasInfo.activas.length ? `${obrasInfo.avancePromedio}% de avance promedio` : 'Con presupuesto aceptado'}</small>
        </div>
        <div {...kpiClick('obras')}>
          <span>EN OBSERVACIÓN</span>
          <strong style={{ color: obrasInfo.enObservacion.length ? NARANJA : undefined }}>{obrasInfo.enObservacion.length}</strong>
          <small>{obrasInfo.enObservacion.length ? 'Requieren revisión' : 'Nada para revisar'}</small>
        </div>
        {verPresupuestos && (
          <div {...kpiClick('presupuestos')}>
            <span>PRESUPUESTOS EN BORRADOR</span>
            <strong style={{ color: borradores.length ? NARANJA : undefined }}>{borradores.length}</strong>
            <small>{borradores.length ? 'Sin enviar al cliente' : 'Todos enviados'}</small>
          </div>
        )}
        {verFinanzas && (
          <div {...kpiClick('tablero')}>
            <span>TE DEBEN</span>
            <strong style={{ color: obrasInfo.terminadasConSaldo.length ? ROJO : undefined }}>{moneda(obrasInfo.porCobrar)}</strong>
            <small>{obrasInfo.deudas.length} obra{obrasInfo.deudas.length === 1 ? '' : 's'} con saldo</small>
          </div>
        )}
      </section>

      {/* ---- Neto del mes, en barras ---- */}
      {verFinanzas && (
        <section className="fase2Panel" style={{ marginTop: 18 }}>
          <div className="fase2PanelTitulo"><div><h3>¿Cuánto te quedó en {nombreMes(mesSel)}?</h3><p>Lo cobrado menos todo lo que salió</p></div><button onClick={() => onNavegar('tablero')}>Ver balance →</button></div>
          <div style={{ padding: '4px 20px 16px' }}>
            {barraNeto('Cobrado', mes.cobrado, '+', '#23935b')}
            {barraNeto('Mano de obra', mes.manoObra, '−', '#b23b32')}
            {barraNeto('Materiales y otros costos', mes.otrosCostos, '−', '#d0645b')}
            {barraNeto('Gastos fijos', mes.fijos, '−', '#b86608')}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--mova-border)', marginTop: 8, paddingTop: 10, fontSize: 15 }}>
              <strong>Neto</strong>
              <strong style={{ color: colorMonto(mes.neto) }}>{moneda(mes.neto)}</strong>
            </div>
            {mes.esMesActual && (mes.recurrentesMonto > 0 || mes.personalPendiente > 0) && (
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--mova-muted)' }}>
                Previsto por pagar este mes:
                {mes.recurrentesMonto > 0 && <> gastos fijos sin cargar <strong>{moneda(mes.recurrentesMonto)}</strong></>}
                {mes.recurrentesMonto > 0 && mes.personalPendiente > 0 && ' ·'}
                {mes.personalPendiente > 0 && <> personal por avance <strong>{moneda(mes.personalPendiente)}</strong></>}
                {' → '}neto si pagás todo: <strong style={{ color: colorMonto(mes.netoProyectado) }}>{moneda(mes.netoProyectado)}</strong>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="fase2Paneles">
        {/* ---- Para mirar ---- */}
        <div className="fase2Panel">
          <div className="fase2PanelTitulo"><div><h3>Para mirar</h3><p>Lo que requiere tu atención</p></div></div>
          {!hayAlertas ? <div className="fase2Vacio"><span>✓</span><p>Todo en orden.</p></div> : <>
            {verFinanzas && obrasInfo.terminadasConSaldo.map((d) => (
              <div className="fase2Cuenta" key={`t-${d.obra.id}`} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onAbrirObra(d.obra.id)}>
                <div><strong>🔴 {d.obra.nombre_obra}</strong><span>Obra terminada con saldo · {nombreCli(d.obra.cliente_id)}</span></div>
                <b style={{ color: ROJO }}>{moneda(d.saldo)}</b>
              </div>
            ))}
            {obrasInfo.enObservacion.map((o) => (
              <div className="fase2Cuenta" key={`o-${o.id}`} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onAbrirObra(o.id)}>
                <div><strong>🟠 {o.nombre_obra}</strong><span>En observación · {nombreCli(o.cliente_id)}</span></div>
                <b>Revisar →</b>
              </div>
            ))}
            {verPresupuestos && borradores.slice(0, 5).map((p) => {
              const dias = diasDesde(p.fecha)
              return (
                <div className="fase2Cuenta" key={`b-${p.id}`} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onNavegar('presupuestos')}>
                  <div><strong>📝 {p.titulo}</strong><span>Borrador sin enviar · {nombreCli(p.cliente_id)}{dias != null ? ` · hace ${dias} día${dias === 1 ? '' : 's'}` : ''}</span></div>
                  <b>{moneda(p.total)}</b>
                </div>
              )
            })}
          </>}
        </div>

        {/* ---- Obras activas, con barra de avance ---- */}
        <div className="fase2Panel">
          <div className="fase2PanelTitulo"><div><h3>Obras activas</h3><p>Avance de cada trabajo</p></div><button onClick={() => onNavegar('obras')}>Ver todas →</button></div>
          {obrasInfo.activas.length === 0 ? <div className="fase2Vacio"><span>🏠</span><p>No hay obras en proceso con presupuesto aceptado.</p></div>
            : obrasInfo.activas.slice(0, 6).map((o) => (
              <div className="fase2Cuenta" key={o.id} role="button" tabIndex={0} style={{ cursor: 'pointer', display: 'block' }} onClick={() => onAbrirObra(o.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div><strong>{o.nombre_obra}</strong><span>{nombreCli(o.cliente_id)} · {o.localidad || 'Sin localidad'}</span></div>
                  <b>{num(o.porcentaje_avance)}%</b>
                </div>
                <div className="tabBar" style={{ marginTop: 6 }}><span style={{ width: `${Math.min(100, num(o.porcentaje_avance))}%`, background: '#2f6fb3' }} /></div>
              </div>
            ))}
        </div>

        {/* ---- Te deben ---- */}
        {verFinanzas && (
          <div className="fase2Panel">
            <div className="fase2PanelTitulo"><div><h3>Te deben</h3><p>{moneda(obrasInfo.porCobrar)} en total</p></div><button onClick={() => onNavegar('tablero')}>Ver cobranzas →</button></div>
            {obrasInfo.deudas.length === 0 ? <div className="fase2Vacio"><span>✓</span><p>Sin saldos pendientes.</p></div>
              : obrasInfo.deudas.slice(0, 6).map((d) => (
                <div className="fase2Cuenta" key={d.obra.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onAbrirObra(d.obra.id)}>
                  <div>
                    <strong>{d.obra.nombre_obra}</strong>
                    <span>
                      {nombreCli(d.obra.cliente_id)} · <span className={`crmBadge est-${claseObra(d.obra.estado)}`}>{etiquetaObra(d.obra.estado)}</span>{' '}
                      {d.situacion === 'rojo' && <strong style={{ color: ROJO }}>🔴 cobrar ya</strong>}
                      {d.situacion === 'naranja' && <strong style={{ color: NARANJA }}>🟠 falta {moneda(d.faltaAvance)} por avance</strong>}
                      {d.situacion === 'verde' && <span style={{ color: VERDE }}>🟢 al día</span>}
                    </span>
                  </div>
                  <b>{moneda(d.saldo)}</b>
                </div>
              ))}
          </div>
        )}

        {/* ---- Pagos al personal ---- */}
        {verPersonal && (
          <div className="fase2Panel">
            <div className="fase2PanelTitulo">
              <div><h3>Pagos al personal</h3><p>Le debés <strong style={{ color: personal.debe > 0 ? ROJO : undefined }}>{moneda(personal.debe)}</strong>{personal.adelantado > 0 && <> · adelantado {moneda(personal.adelantado)}</>}</p></div>
              {verFinanzas && <button onClick={() => onNavegar('tablero')}>Ver detalle →</button>}
            </div>
            {personal.filas.length === 0 ? <div className="fase2Vacio"><span>✓</span><p>{personal.alDia ? 'Todo el personal al día.' : 'Sin personal asignado.'}</p></div> : <>
              {personal.filas.slice(0, 6).map((f) => (
                <div className="fase2Cuenta" key={f.clave} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onAbrirObra(f.obraId)}>
                  <div><strong>{f.nombre}</strong><span>{f.obra}</span></div>
                  {f.debe > 0.5
                    ? <b style={{ color: ROJO }}>🔴 Le debés {moneda(f.debe)}</b>
                    : <b style={{ color: NARANJA }}>🟠 Adelantado {moneda(f.adelantado)}</b>}
                </div>
              ))}
              {personal.alDia > 0 && <p style={{ padding: '8px 20px', margin: 0, fontSize: 13, color: VERDE }}>🟢 {personal.alDia} asignación{personal.alDia === 1 ? '' : 'es'} al día</p>}
            </>}
          </div>
        )}

        {/* ---- Gastos fijos del mes ---- */}
        {verFinanzas && (
          <div className="fase2Panel">
            <div className="fase2PanelTitulo"><div><h3>Gastos fijos del mes</h3><p>{moneda(mes.fijos)} · recurrentes {moneda(mes.recurrentesMes)}</p></div><button onClick={() => onNavegar('tablero')}>Ver gastos →</button></div>
            {mes.recurrentesPendientes.length > 0 && (
              <p style={{ padding: '8px 20px 0', margin: 0, fontSize: 13, color: NARANJA }}>
                ⏰ Faltan cargar {mes.recurrentesPendientes.length} recurrente{mes.recurrentesPendientes.length === 1 ? '' : 's'} ({moneda(mes.recurrentesMonto)}). Cargalos desde Tablero → Gastos fijos.
              </p>
            )}
            {mes.porCategoria.length === 0 ? <div className="fase2Vacio"><span>💸</span><p>Sin gastos fijos cargados este mes.</p></div>
              : <div style={{ padding: '8px 20px 16px' }}>
                {mes.porCategoria.map(([cat, monto]) => {
                  const pct = mes.fijos > 0 ? Math.round((monto / mes.fijos) * 100) : 0
                  return (
                    <div key={cat} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 130px) 1fr auto', gap: 10, alignItems: 'center', padding: '5px 0', fontSize: 13 }}>
                      <strong>{cat}</strong>
                      <div className="tabBar"><span style={{ width: `${pct}%`, background: NARANJA }} /></div>
                      <span style={{ whiteSpace: 'nowrap' }}>{moneda(monto)} · {pct}%</span>
                    </div>
                  )
                })}
              </div>}
          </div>
        )}
      </section>
    </>)}
  </div>
}
