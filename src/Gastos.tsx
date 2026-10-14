import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { fechaCorta, hoy } from './gestionFormat'
import { confirmarEliminacion } from './confirmar'

// Gastos: los de la EMPRESA (cuentan en la ganancia; se guardan en gastos_generales,
// los mismos que ven Movimientos e Inicio) y los PERSONALES (casa, impuestos de la
// casa, salidas…), privados: solo los ve quien los carga y no tocan la ganancia.

type Ambito = 'empresa' | 'personal'
type Gasto = { id: number; fecha: string; categoria: string | null; descripcion: string | null; monto: number; recurrente: boolean }
type Cat = { nombre: string; icono: string; ayuda: string }

const CATEGORIAS: Record<Ambito, Cat[]> = {
  empresa: [
    { nombre: 'Combustible', icono: '⛽', ayuda: 'Nafta, gasoil, GNC' },
    { nombre: 'Gastos empresa', icono: '🏢', ayuda: 'Alquiler, servicios, contador, celular…' },
    { nombre: 'Inversión en herramientas', icono: '🧰', ayuda: 'Herramientas y equipos de trabajo' },
    { nombre: 'Inversión en productos', icono: '📦', ayuda: 'Stock y mercadería para vender' },
  ],
  personal: [
    { nombre: 'Gastos casa', icono: '🏠', ayuda: 'Supermercado, servicios, alquiler…' },
    { nombre: 'Impuestos casa', icono: '🧾', ayuda: 'Municipal, rentas, patente…' },
    { nombre: 'Salidas y extras', icono: '🎉', ayuda: 'Comidas, paseos, gustos' },
    { nombre: 'Otros personales', icono: '🛍️', ayuda: 'Ropa, salud, regalos…' },
  ],
}
const TABLA: Record<Ambito, string> = { empresa: 'gastos_generales', personal: 'gastos_personales' }
const OTROS_EMPRESA = 'Otros de la empresa'
const SQL_PERSONALES = 'supabase-gastos-personales-fase-30.sql'

const plata = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Math.round(n) || 0)
const nombreMes = (m: string) => { const t = new Date(`${m}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1) }
const moverMes = (m: string, d: number) => { const f = new Date(`${m}-01T12:00:00`); f.setMonth(f.getMonth() + d); return f.toISOString().slice(0, 7) }
const aGasto = (g: Record<string, unknown>) => ({ ...g, monto: Number(g.monto) || 0, recurrente: !!g.recurrente }) as Gasto

export default function Gastos() {
  const [ambito, setAmbito] = useState<Ambito>('empresa')
  const [mes, setMes] = useState(() => hoy().slice(0, 7))
  const [empresa, setEmpresa] = useState<Gasto[]>([])
  const [personales, setPersonales] = useState<Gasto[]>([])
  const [faltaSql, setFaltaSql] = useState(false)
  // Lo que entró y salió en la empresa (para la ganancia del mes).
  const [mov, setMov] = useState<{ cobros: { fecha: string; monto: number }[]; salidas: { fecha: string; monto: number }[] }>({ cobros: [], salidas: [] })
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [filtroCat, setFiltroCat] = useState<string | null>(null)
  const [form, setForm] = useState<(Gasto & { ambito: Ambito }) | null>(null)
  const [actualizar, setActualizar] = useState(0)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true); setError('')
      const [rE, rP, rPagos, rCostos, rCompras] = await Promise.all([
        supabase.from('gastos_generales').select('id,fecha,categoria,descripcion,monto,recurrente').order('fecha', { ascending: false }),
        supabase.from('gastos_personales').select('id,fecha,categoria,descripcion,monto,recurrente').order('fecha', { ascending: false }),
        supabase.from('pagos').select('monto,fecha'),
        supabase.from('costos').select('monto,fecha'),
        supabase.from('materiales').select('cantidad,precio_unitario,fecha'),
      ])
      if (!vigente) return
      if (rE.error) { console.error(rE.error); setError('No se pudieron cargar los gastos de la empresa.') }
      setEmpresa((rE.data ?? []).map(aGasto))
      setFaltaSql(!!rP.error)
      setPersonales(rP.error ? [] : (rP.data ?? []).map(aGasto))
      setMov({
        cobros: (rPagos.data ?? []).map((p) => ({ fecha: String(p.fecha ?? ''), monto: Number(p.monto) || 0 })),
        salidas: [
          ...(rCostos.data ?? []).map((c) => ({ fecha: String(c.fecha ?? ''), monto: Number(c.monto) || 0 })),
          ...(rCompras.data ?? []).map((c) => ({ fecha: String(c.fecha ?? ''), monto: (Number(c.cantidad) || 0) * (Number(c.precio_unitario) || 0) })),
        ],
      })
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [actualizar])

  const delMes = <T extends { fecha: string }>(l: T[], m = mes) => l.filter((x) => x.fecha?.slice(0, 7) === m)
  const suma = (l: { monto: number }[]) => l.reduce((s, x) => s + x.monto, 0)
  const lista = ambito === 'empresa' ? empresa : personales
  const cats = CATEGORIAS[ambito]
  // Para la empresa, lo cargado antes con otras categorías (Alquiler, Servicios…) va en "Otros".
  const catDe = (g: Gasto) => (ambito === 'empresa' && !cats.some((c) => c.nombre === g.categoria) ? OTROS_EMPRESA : g.categoria || cats[0].nombre)

  const resumen = useMemo(() => {
    const cobros = suma(delMes(mov.cobros))
    const gastosEmp = suma(delMes(empresa))
    const salidas = suma(delMes(mov.salidas)) + gastosEmp
    const ganancia = cobros - salidas
    const pers = suma(delMes(personales))
    return { cobros, salidas, gastosEmp, ganancia, pers, queda: ganancia - pers }
  }, [mov, empresa, personales, mes]) // eslint-disable-line react-hooks/exhaustive-deps

  const delMesAmbito = delMes(lista)
  const porCat = useMemo(() => {
    const m: Record<string, number> = {}
    delMesAmbito.forEach((g) => { const k = catDe(g); m[k] = (m[k] || 0) + g.monto })
    return m
  }, [delMesAmbito]) // eslint-disable-line react-hooks/exhaustive-deps
  const tiles = [...cats, ...(ambito === 'empresa' && porCat[OTROS_EMPRESA] ? [{ nombre: OTROS_EMPRESA, icono: '📁', ayuda: 'Cargados con otras categorías' }] : [])]
  const totalAmbito = suma(delMesAmbito)
  const visibles = filtroCat ? delMesAmbito.filter((g) => catDe(g) === filtroCat) : delMesAmbito

  // Fijos del mes anterior que todavía no se cargaron en este mes.
  const fijosPendientes = useMemo(() => {
    const ant = delMes(lista, moverMes(mes, -1)).filter((g) => g.recurrente)
    const ya = delMes(lista).filter((g) => g.recurrente)
    return ant.filter((g) => !ya.some((x) => x.categoria === g.categoria && (x.descripcion ?? '') === (g.descripcion ?? '')))
  }, [lista, mes]) // eslint-disable-line react-hooks/exhaustive-deps

  async function copiarFijos() {
    const dia = (f: string) => f.slice(8, 10)
    const ultimo = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate()
    const filas = fijosPendientes.map((g) => ({ fecha: `${mes}-${String(Math.min(Number(dia(g.fecha)) || 1, ultimo)).padStart(2, '0')}`, categoria: g.categoria, descripcion: g.descripcion, monto: g.monto, recurrente: true }))
    const { error: e } = await supabase.from(TABLA[ambito]).insert(filas)
    if (e) { console.error(e); window.alert('No se pudieron cargar los gastos fijos.'); return }
    setActualizar((v) => v + 1)
  }

  async function eliminar(g: Gasto) {
    if (!confirmarEliminacion(`¿Eliminar el gasto "${g.descripcion || g.categoria}" de ${plata(g.monto)}?`)) return
    const { error: e } = await supabase.from(TABLA[ambito]).delete().eq('id', g.id)
    if (e) { console.error(e); window.alert('No se pudo eliminar.'); return }
    setActualizar((v) => v + 1)
  }

  const nuevo = (categoria?: string) => setForm({ id: 0, ambito, fecha: mes === hoy().slice(0, 7) ? hoy() : `${mes}-01`, categoria: categoria && categoria !== OTROS_EMPRESA ? categoria : cats[0].nombre, descripcion: '', monto: 0, recurrente: false })

  return (
    <div className="gestionPage gtsPage">
      <div className="gtsCab">
        <h2>Gastos</h2>
        <button type="button" className="trbNuevo" onClick={() => nuevo()}>＋ Nuevo gasto</button>
      </div>

      <div className="gtsMes">
        <button type="button" onClick={() => { setMes((m) => moverMes(m, -1)); setFiltroCat(null) }} aria-label="Mes anterior">‹</button>
        <b>{nombreMes(mes)}</b>
        <button type="button" onClick={() => { setMes((m) => moverMes(m, 1)); setFiltroCat(null) }} aria-label="Mes siguiente" disabled={mes >= hoy().slice(0, 7)}>›</button>
      </div>

      {error && <p className="loginError">{error}</p>}

      {/* Cómo cerró el mes: la empresa y lo que te queda después de los gastos personales. */}
      {!cargando && (
        <section className="gtsResumen">
          <div className="gtsFila"><span>💰 Entró a la empresa</span><b>{plata(resumen.cobros)}</b></div>
          <div className="gtsFila"><span>↘ Salió (obras, compras y gastos)</span><b>− {plata(resumen.salidas)}</b></div>
          <div className="gtsFila fuerte"><span>Ganancia de la empresa</span><b className={resumen.ganancia >= 0 ? 'pos' : 'neg'}>{plata(resumen.ganancia)}</b></div>
          <div className="gtsFila"><span>🏠 Gastos personales</span><b>− {plata(resumen.pers)}</b></div>
          <div className={`gtsQueda ${resumen.queda >= 0 ? 'pos' : 'neg'}`}><span>Te queda este mes</span><b>{plata(resumen.queda)}</b></div>
        </section>
      )}

      <div className="trabajosTabs gtsTabs" role="tablist" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <button type="button" role="tab" aria-selected={ambito === 'empresa'} className={ambito === 'empresa' ? 'activo' : ''} onClick={() => { setAmbito('empresa'); setFiltroCat(null) }}>
          🏢 Empresa<small>cuenta en la ganancia</small>
        </button>
        <button type="button" role="tab" aria-selected={ambito === 'personal'} className={ambito === 'personal' ? 'activo' : ''} onClick={() => { setAmbito('personal'); setFiltroCat(null) }}>
          🏠 Personal<small>🔒 solo lo ves vos</small>
        </button>
      </div>

      {ambito === 'personal' && faltaSql && (
        <p className="gestionAyuda">Para guardar gastos personales falta correr en Supabase el SQL "{SQL_PERSONALES}".</p>
      )}

      {cargando ? <p className="gestionAyuda">Cargando…</p> : <>
        <div className="gtsCats">
          {tiles.map((c) => (
            <div key={c.nombre} className={`gtsCat${filtroCat === c.nombre ? ' activo' : ''}`}>
              <button type="button" className="gtsCatInfo" onClick={() => setFiltroCat((f) => (f === c.nombre ? null : c.nombre))}>
                <span className="gtsIco">{c.icono}</span>
                <span className="gtsCatTxt"><b>{c.nombre}</b><small>{c.ayuda}</small></span>
                <strong>{plata(porCat[c.nombre] ?? 0)}</strong>
              </button>
              {c.nombre !== OTROS_EMPRESA && <button type="button" className="gtsMas" onClick={() => nuevo(c.nombre)} aria-label={`Cargar ${c.nombre}`}>＋</button>}
            </div>
          ))}
        </div>

        {fijosPendientes.length > 0 && (
          <div className="gtsFijos">
            <span>🔁 Tenés {fijosPendientes.length} gasto{fijosPendientes.length === 1 ? '' : 's'} fijo{fijosPendientes.length === 1 ? '' : 's'} del mes pasado ({plata(suma(fijosPendientes))}) sin cargar en {nombreMes(mes).toLowerCase()}.</span>
            <button type="button" className="newButton" onClick={() => void copiarFijos()}>Cargarlos</button>
          </div>
        )}

        <div className="gtsListaCab">
          <b>{filtroCat ?? (ambito === 'empresa' ? 'Gastos de la empresa' : 'Gastos personales')}</b>
          <span>{plata(filtroCat ? suma(visibles) : totalAmbito)}</span>
          {filtroCat && <button type="button" className="gtsQuitarFiltro" onClick={() => setFiltroCat(null)}>Ver todos ✕</button>}
        </div>
        {visibles.length === 0
          ? <p className="gtsVacio">No hay gastos cargados {filtroCat ? 'en esta categoría ' : ''}en {nombreMes(mes).toLowerCase()}.</p>
          : (
            <div className="gtsLista">
              {visibles.map((g) => {
                const cat = [...CATEGORIAS.empresa, ...CATEGORIAS.personal].find((c) => c.nombre === g.categoria)
                return (
                  <div className="gtsItem" key={g.id}>
                    <span className="gtsIco chico">{cat?.icono ?? '📁'}</span>
                    <button type="button" className="gtsItemInfo" onClick={() => setForm({ ...g, ambito })}>
                      <b>{g.descripcion || g.categoria}</b>
                      <small>{fechaCorta(g.fecha)} · {g.categoria}{g.recurrente ? ' · 🔁 todos los meses' : ''}</small>
                    </button>
                    <strong>{plata(g.monto)}</strong>
                    <button type="button" className="gtsBorrar" onClick={() => void eliminar(g)} aria-label="Eliminar">🗑</button>
                  </div>
                )
              })}
            </div>
          )}
      </>}

      {form && <FormGasto inicial={form} faltaSql={faltaSql} onCerrar={() => setForm(null)} onGuardado={(a) => { setForm(null); setAmbito(a); setActualizar((v) => v + 1) }} />}
    </div>
  )
}

function FormGasto({ inicial, faltaSql, onCerrar, onGuardado }: { inicial: Gasto & { ambito: Ambito }; faltaSql: boolean; onCerrar: () => void; onGuardado: (a: Ambito) => void }) {
  const [ambito, setAmbito] = useState<Ambito>(inicial.ambito)
  const [categoria, setCategoria] = useState(inicial.categoria ?? CATEGORIAS[inicial.ambito][0].nombre)
  const [monto, setMonto] = useState(inicial.monto ? String(inicial.monto) : '')
  const [fecha, setFecha] = useState(inicial.fecha)
  const [descripcion, setDescripcion] = useState(inicial.descripcion ?? '')
  const [recurrente, setRecurrente] = useState(inicial.recurrente)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const editando = inicial.id > 0
  const cats = CATEGORIAS[ambito]

  function cambiarAmbito(a: Ambito) {
    setAmbito(a)
    if (!CATEGORIAS[a].some((c) => c.nombre === categoria)) setCategoria(CATEGORIAS[a][0].nombre)
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    const valor = Number(monto)
    if (!(valor > 0)) { setError('Escribí el monto.'); return }
    if (ambito === 'personal' && faltaSql) { setError(`Falta correr en Supabase el SQL "${SQL_PERSONALES}".`); return }
    setGuardando(true)
    const fila = { fecha, categoria, descripcion: descripcion.trim() || null, monto: valor, recurrente }
    // Si se cambió de Empresa a Personal (o al revés), se mueve de una lista a la otra.
    const r = editando && ambito === inicial.ambito
      ? await supabase.from(TABLA[ambito]).update(fila).eq('id', inicial.id)
      : await supabase.from(TABLA[ambito]).insert(fila)
    if (!r.error && editando && ambito !== inicial.ambito) await supabase.from(TABLA[inicial.ambito]).delete().eq('id', inicial.id)
    setGuardando(false)
    if (r.error) { console.error(r.error); setError('No se pudo guardar el gasto.'); return }
    onGuardado(ambito)
  }

  return (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
      <form className="modalCard gtsForm" onSubmit={(e) => void guardar(e)}>
        <div className="modalHeader">
          <div><h2>{editando ? 'Editar gasto' : 'Nuevo gasto'}</h2></div>
          <button type="button" className="closeButton" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>
        <div className="gtsAmbito">
          <button type="button" className={ambito === 'empresa' ? 'activo' : ''} onClick={() => cambiarAmbito('empresa')}>🏢 Empresa</button>
          <button type="button" className={ambito === 'personal' ? 'activo' : ''} onClick={() => cambiarAmbito('personal')}>🏠 Personal 🔒</button>
        </div>
        <p className="gestionAyuda" style={{ margin: 0 }}>{ambito === 'empresa' ? 'Se resta de la ganancia de la empresa.' : 'Privado: solo lo ves vos. No toca la ganancia de la empresa.'}</p>
        <div className="gtsChips">
          {cats.map((c) => (
            <button type="button" key={c.nombre} className={categoria === c.nombre ? 'activo' : ''} onClick={() => setCategoria(c.nombre)}>{c.icono} {c.nombre}</button>
          ))}
        </div>
        <label className="gtsCampo">Monto
          <input type="number" inputMode="decimal" min="0" step="any" autoFocus value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0" />
        </label>
        <label className="gtsCampo">Detalle (opcional)
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder={cats.find((c) => c.nombre === categoria)?.ayuda ?? ''} />
        </label>
        <label className="gtsCampo">Fecha
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label className="caCheck"><input type="checkbox" checked={recurrente} onChange={(e) => setRecurrente(e.target.checked)} /> 🔁 Se repite todos los meses (te aviso para cargarlo)</label>
        {error && <p className="loginError" style={{ margin: 0 }}>{error}</p>}
        <div className="gtsAcc">
          <button type="button" className="cancelButton" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="newButton" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  )
}
