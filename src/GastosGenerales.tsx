import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta, hoy } from './gestionFormat'

type Gasto = {
  id: number
  fecha: string
  categoria: string | null
  descripcion: string | null
  monto: number
  recurrente: boolean
}

const CATEGORIAS = ['Alquiler', 'Sueldos fijos', 'Servicios', 'Impuestos', 'Contador', 'Combustible', 'Herramientas', 'Marketing', 'Otros']

function GastosGenerales() {
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [mesSel, setMesSel] = useState(() => new Date().toISOString().slice(0, 7))
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [actualizacion, setActualizacion] = useState(0)
  const [form, setForm] = useState<Gasto | null>(null)

  useEffect(() => {
    async function cargar() {
      setCargando(true); setError('')
      const { data, error: err } = await supabase.from('gastos_generales').select('*').order('fecha', { ascending: false })
      if (err) { console.error(err); setError('Falta ejecutar supabase-contable-fase-10.sql en Supabase.'); setCargando(false); return }
      setGastos((data ?? []).map((g) => ({ ...g, monto: Number(g.monto) })) as Gasto[])
      setCargando(false)
    }
    cargar()
  }, [actualizacion])

  const delMes = useMemo(() => gastos.filter((g) => g.fecha?.slice(0, 7) === mesSel), [gastos, mesSel])
  const totalMes = delMes.reduce((s, g) => s + g.monto, 0)
  const recurrentesMes = delMes.filter((g) => g.recurrente).reduce((s, g) => s + g.monto, 0)
  const porCategoria = useMemo(() => {
    const m: Record<string, number> = {}
    delMes.forEach((g) => { const k = g.categoria || 'Otros'; m[k] = (m[k] || 0) + g.monto })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [delMes])

  async function eliminar(g: Gasto) {
    if (!window.confirm(`¿Eliminar el gasto "${g.descripcion || g.categoria}"?`)) return
    const { error: err } = await supabase.from('gastos_generales').delete().eq('id', g.id)
    if (err) { console.error(err); window.alert('No se pudo eliminar.'); return }
    setActualizacion((v) => v + 1)
  }

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div><p className="subtitle">CONTROL FINANCIERO</p><h2>Gastos fijos y de estructura</h2><p className="welcome">Alquiler, sueldos, servicios e impuestos — no atados a una obra</p></div>
        <button className="newButton" onClick={() => setForm({ id: 0, fecha: hoy(), categoria: 'Alquiler', descripcion: '', monto: 0, recurrente: true })}>+ Nuevo gasto</button>
      </div>

      <div className="crmToolbar">
        <div className="crmFiltros">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--mova-muted)' }}>Mes
            <input type="month" value={mesSel} onChange={(e) => setMesSel(e.target.value)} style={{ padding: '9px 12px', border: '1px solid var(--mova-border)', borderRadius: 10 }} />
          </label>
        </div>
      </div>

      {cargando && <p>Cargando gastos...</p>}
      {error && <p className="loginError">{error}</p>}

      {!cargando && !error && <>
        <div className="gestionKpis">
          <div><span>GASTOS DEL MES</span><strong>{moneda(totalMes)}</strong><small>{delMes.length} registros</small></div>
          <div><span>RECURRENTES</span><strong>{moneda(recurrentesMes)}</strong><small>Fijos mensuales</small></div>
          <div><span>PROMEDIO / REGISTRO</span><strong>{moneda(delMes.length ? totalMes / delMes.length : 0)}</strong><small>Del mes</small></div>
        </div>

        {porCategoria.length > 0 && (
          <div className="finBreakdown">
            {porCategoria.map(([cat, monto]) => <span key={cat}>{cat}: <strong>{moneda(monto)}</strong></span>)}
          </div>
        )}

        <div className="crmListaWrap">
          <table className="crmLista">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Tipo</th><th>Monto</th><th>Acción</th></tr></thead>
            <tbody>
              {delMes.length === 0 ? <tr><td colSpan={6}>Sin gastos en este mes.</td></tr> : delMes.map((g) => (
                <tr key={g.id}>
                  <td>{fechaCorta(g.fecha)}</td>
                  <td><strong>{g.categoria || 'Otros'}</strong></td>
                  <td>{g.descripcion || '—'}</td>
                  <td>{g.recurrente ? <span className="crmBadge est-enviado">Recurrente</span> : <span className="crmBadge est-borrador">Puntual</span>}</td>
                  <td><strong>{moneda(g.monto)}</strong></td>
                  <td><div className="adicAcciones"><button className="editButton" onClick={() => setForm(g)}>Editar</button><button className="adicNo" onClick={() => eliminar(g)}>Eliminar</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      {form && <FormularioGasto gasto={form} onCancelar={() => setForm(null)} onGuardado={() => { setForm(null); setActualizacion((v) => v + 1) }} />}
    </div>
  )
}

function FormularioGasto({ gasto, onCancelar, onGuardado }: { gasto: Gasto; onCancelar: () => void; onGuardado: () => void }) {
  const editando = gasto.id > 0
  const [f, setF] = useState({ fecha: gasto.fecha?.slice(0, 10) || hoy(), categoria: gasto.categoria || 'Alquiler', descripcion: gasto.descripcion || '', monto: gasto.monto ? String(gasto.monto) : '', recurrente: gasto.recurrente })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string | boolean) => setF((a) => ({ ...a, [k]: v }))

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!(Number(f.monto) > 0)) { setError('Ingresá un monto mayor que cero.'); return }
    setGuardando(true)
    const datos = { fecha: f.fecha, categoria: f.categoria, descripcion: f.descripcion.trim() || null, monto: Number(f.monto), recurrente: f.recurrente }
    const { error: err } = editando
      ? await supabase.from('gastos_generales').update(datos).eq('id', gasto.id)
      : await supabase.from('gastos_generales').insert(datos)
    if (err) { console.error(err); setError('No se pudo guardar.'); setGuardando(false); return }
    onGuardado()
  }

  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">{editando ? 'EDITAR GASTO' : 'NUEVO GASTO'}</p><h2>Gasto de estructura</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div>
    <form className="clienteForm" onSubmit={guardar}><div className="formGrid">
      <label>Fecha *<input type="date" required value={f.fecha} onChange={(e) => set('fecha', e.target.value)} /></label>
      <label>Categoría<select value={f.categoria} onChange={(e) => set('categoria', e.target.value)}>{CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>Monto *<input type="number" min="0.01" step="0.01" required value={f.monto} onChange={(e) => set('monto', e.target.value)} /></label>
      <label>Recurrente (mensual)<select value={f.recurrente ? 'si' : 'no'} onChange={(e) => set('recurrente', e.target.value === 'si')}><option value="si">Sí, gasto fijo mensual</option><option value="no">No, puntual</option></select></label>
      <label className="formFull">Descripción<input value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} placeholder="Ej.: Alquiler local septiembre" /></label>
    </div>{error && <p className="loginError">{error}</p>}<div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button></div></form>
  </div></div>
}

export default GastosGenerales
