import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import { cargarConfig, configActual, configTablaDisponible, guardarConfig, lineaContacto, DEFAULTS, type Condicion, type Empresa } from './config'
import { confirmarEliminacion } from './confirmar'
import Tiendanube from './Tiendanube'
import CampoNumero from './CampoNumero'

// Configuración (solo admin): datos de la empresa, textos de presupuestos y
// documentos, copia de seguridad en Excel y auditoría legible.

type Pestana = 'empresa' | 'presupuestos' | 'tiendanube' | 'backup' | 'auditoria'

export default function Configuracion() {
  // Al volver de autorizar en Tiendanube se abre directo esa pestaña.
  const [pestana, setPestana] = useState<Pestana>(() => (window.location.search.includes('tiendanube=') ? 'tiendanube' : 'empresa'))
  const [listo, setListo] = useState(false)
  const [tablaOk, setTablaOk] = useState<boolean | null>(null)

  useEffect(() => {
    void cargarConfig().then(() => { setTablaOk(configTablaDisponible()); setListo(true) })
  }, [])

  return <div className="gestionPage">
    <div className="pageHeader"><div><p className="subtitle">SISTEMA</p><h2>Configuración</h2><p className="welcome">Datos de la empresa, textos de los documentos, copia de seguridad y auditoría</p></div></div>

    <div className="gestionTabs homeTabs">
      <button className={pestana === 'empresa' ? 'active' : ''} onClick={() => setPestana('empresa')}>🏢 Empresa</button>
      <button className={pestana === 'presupuestos' ? 'active' : ''} onClick={() => setPestana('presupuestos')}>📄 Presupuestos y documentos</button>
      <button className={pestana === 'tiendanube' ? 'active' : ''} onClick={() => setPestana('tiendanube')}>🛒 Tienda web</button>
      <button className={pestana === 'backup' ? 'active' : ''} onClick={() => setPestana('backup')}>💾 Copia de seguridad</button>
      <button className={pestana === 'auditoria' ? 'active' : ''} onClick={() => setPestana('auditoria')}>🕵 Auditoría</button>
    </div>

    {tablaOk === false && (pestana === 'empresa' || pestana === 'presupuestos') && (
      <p className="loginError">Falta correr el SQL de Configuración en Supabase (tabla <code>configuracion</code>). Mientras tanto se usan los valores de siempre y no se pueden guardar cambios.</p>
    )}

    {!listo && (pestana === 'empresa' || pestana === 'presupuestos') && <p>Cargando configuración...</p>}
    {listo && pestana === 'empresa' && <EmpresaForm habilitado={tablaOk !== false} />}
    {listo && pestana === 'presupuestos' && <PresupuestosForm habilitado={tablaOk !== false} />}
    {pestana === 'tiendanube' && <Tiendanube />}
    {pestana === 'backup' && <CopiaSeguridad />}
    {pestana === 'auditoria' && <Auditoria />}
  </div>
}

function useGuardado() {
  const [estado, setEstado] = useState<'' | 'guardando' | 'ok' | 'error'>('')
  async function guardar(fn: () => Promise<void>) {
    setEstado('guardando')
    try { await fn(); setEstado('ok'); setTimeout(() => setEstado(''), 2500) }
    catch (e) { console.error(e); setEstado('error') }
  }
  return { estado, guardar }
}

function BarraGuardar({ estado, onGuardar, habilitado, onRestaurar }: { estado: string; onGuardar: () => void; habilitado: boolean; onRestaurar?: () => void }) {
  return <div className="cfgBarra">
    {estado === 'ok' && <span className="cfgOk">✓ Guardado. Se usa en los próximos documentos.</span>}
    {estado === 'error' && <span className="loginError" style={{ margin: 0 }}>No se pudo guardar. Solo un administrador puede cambiar la configuración.</span>}
    {onRestaurar && <button type="button" className="editButton" onClick={onRestaurar}>Volver a los valores originales</button>}
    <button type="button" className="newButton" disabled={!habilitado || estado === 'guardando'} onClick={onGuardar}>{estado === 'guardando' ? 'Guardando...' : 'Guardar cambios'}</button>
  </div>
}

// ---------- Empresa ----------
function EmpresaForm({ habilitado }: { habilitado: boolean }) {
  const [e, setE] = useState<Empresa>(configActual().empresa)
  const { estado, guardar } = useGuardado()
  const set = (k: keyof Empresa, v: string) => setE((a) => ({ ...a, [k]: v }))
  const campos: [keyof Empresa, string, string][] = [
    ['nombre', 'Nombre de la empresa', 'MOVA Tecnología Smart'],
    ['lema', 'Frase / lema', 'Espacios inteligentes'],
    ['telefono', 'Teléfono / WhatsApp', '+54 9 261 …'],
    ['email', 'Email', 'contacto@…'],
    ['web', 'Sitio web', 'www.…'],
    ['instagram', 'Instagram', '@…'],
    ['cuit', 'CUIT', '20-…'],
    ['direccion', 'Dirección', 'Calle, número, ciudad'],
  ]
  return <section className="cfgSeccion">
    <p className="gestionAyuda">Estos datos salen al pie de todos los PDF: presupuestos, estado de obra, remitos, accesos y cuentas del personal.</p>
    <div className="clienteForm"><div className="formGrid">
      {campos.map(([k, t, ph]) => <label key={k}>{t}<input value={e[k] ?? ''} placeholder={ph} onChange={(ev) => set(k, ev.target.value)} disabled={!habilitado} /></label>)}
    </div></div>
    <h4 className="cfgSub">🏦 Datos para recibir transferencias</h4>
    <p className="gestionAyuda" style={{ marginTop: 0 }}>Aparecen en la página de pago que recibe el cliente (botón "Pagar" del presupuesto), con botones para copiarlos. Las transferencias no tienen comisión.</p>
    <div className="clienteForm"><div className="formGrid">
      {([['alias', 'Alias', 'mova.smart'], ['cbu', 'CBU / CVU', '22 números'], ['titular', 'Titular de la cuenta', 'Nombre o razón social'], ['banco', 'Banco o billetera (opcional)', 'Ej.: Banco Nación, Mercado Pago']] as [keyof Empresa, string, string][]).map(([k, t, ph]) => <label key={k}>{t}<input value={e[k] ?? ''} placeholder={ph} onChange={(ev) => set(k, ev.target.value)} disabled={!habilitado} /></label>)}
    </div></div>
    <div className="cfgVista"><span>Así se ve el pie de los documentos</span><strong>{e.nombre}</strong><small>{lineaContacto(e) || '—'}</small></div>
    <BarraGuardar estado={estado} habilitado={habilitado} onGuardar={() => void guardar(() => guardarConfig('empresa', e))} onRestaurar={() => setE({ ...DEFAULTS.empresa })} />
  </section>
}

// ---------- Presupuestos y documentos ----------
function PresupuestosForm({ habilitado }: { habilitado: boolean }) {
  const [validez, setValidez] = useState(String(configActual().presupuestos.validezDias))
  const [conds, setConds] = useState<Condicion[]>(configActual().presupuestos.condiciones.map((c) => ({ ...c })))
  const [aviso, setAviso] = useState(configActual().accesos.aviso.join('\n\n'))
  const { estado, guardar } = useGuardado()
  const setCond = (i: number, k: keyof Condicion, v: string) => setConds((a) => a.map((c, j) => (j === i ? { ...c, [k]: v } : c)))
  const mover = (i: number, d: number) => setConds((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b })

  async function guardarTodo() {
    const dias = Math.max(1, Math.round(Number(validez) || DEFAULTS.presupuestos.validezDias))
    await guardarConfig('presupuestos', { validezDias: dias, condiciones: conds.filter((c) => c.titulo.trim() || c.texto.trim()).map((c) => ({ titulo: c.titulo.trim(), texto: c.texto.trim() })) })
    await guardarConfig('accesos', { aviso: aviso.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) })
  }

  return <section className="cfgSeccion">
    <div className="clienteForm"><div className="formGrid">
      <label>Validez de los presupuestos nuevos (días)<CampoNumero min="1" value={validez} onChange={(e) => setValidez(e.target.value)} disabled={!habilitado} /></label>
    </div></div>
    <p className="gestionAyuda">La forma de cobro de las obras (70% al confirmar y 30% al terminar) está en el cálculo de cuentas de todas las obras y no se cambia desde acá. Si cambiás el texto de "Forma de pago", mantené ese acuerdo.</p>

    <h4 className="cfgTitulo">Condiciones generales del presupuesto <small>· aparecen al final del presupuesto, en este orden</small></h4>
    <div className="cfgConds">
      {conds.map((c, i) => (
        <div key={i} className="cfgCond">
          <div className="cfgCondHead">
            <input value={c.titulo} onChange={(e) => setCond(i, 'titulo', e.target.value)} placeholder="Título" disabled={!habilitado} />
            <div>
              <button type="button" className="agBtn" title="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
              <button type="button" className="agBtn" title="Bajar" disabled={i === conds.length - 1} onClick={() => mover(i, 1)}>↓</button>
              <button type="button" className="agBtn peligro" title="Quitar" onClick={() => { if (confirmarEliminacion(`¿Quitar la condición "${c.titulo || 'sin título'}"?`)) setConds((a) => a.filter((_, j) => j !== i)) }}>🗑</button>
            </div>
          </div>
          <textarea value={c.texto} onChange={(e) => setCond(i, 'texto', e.target.value)} rows={3} placeholder="Texto de la condición" disabled={!habilitado} />
          {c.titulo.trim().toLowerCase() === 'variaciones de precios' && <small className="gestionAyuda">Los días de este texto se reemplazan solos por la validez de cada presupuesto.</small>}
        </div>
      ))}
      <button type="button" className="caAgregar" disabled={!habilitado} onClick={() => setConds((a) => [...a, { titulo: '', texto: '' }])}>+ Agregar condición</button>
    </div>

    <h4 className="cfgTitulo">Aviso del PDF de accesos y claves <small>· separá los párrafos con una línea en blanco</small></h4>
    <div className="clienteForm"><textarea className="cfgAviso" rows={9} value={aviso} onChange={(e) => setAviso(e.target.value)} disabled={!habilitado} /></div>

    <BarraGuardar estado={estado} habilitado={habilitado} onGuardar={() => void guardar(guardarTodo)} onRestaurar={() => { setValidez(String(DEFAULTS.presupuestos.validezDias)); setConds(DEFAULTS.presupuestos.condiciones.map((c) => ({ ...c }))); setAviso(DEFAULTS.accesos.aviso.join('\n\n')) }} />
  </section>
}

// ---------- Copia de seguridad ----------
const TABLAS_BACKUP: [string, string][] = [
  ['Clientes', 'Clientes'], ['obras', 'Obras'], ['presupuestos', 'Presupuestos'], ['presupuesto_items', 'Items de presupuestos'],
  ['adicionales', 'Cambios y adicionales'], ['pagos', 'Cobros'], ['costos', 'Costos y pagos personal'], ['materiales', 'Compras'],
  ['gastos_generales', 'Gastos fijos'], ['personal', 'Personal'], ['obra_asignaciones', 'Asignaciones'], ['jornales', 'Jornales'],
  ['obra_avances', 'Avances de obra'], ['productos_servicios', 'Productos y servicios'], ['soluciones', 'Soluciones'],
  ['recordatorios', 'Agenda'], ['obra_accesos', 'Accesos y claves'],
]

async function leerTabla(tabla: string) {
  const filas: Record<string, unknown>[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from(tabla).select('*').range(desde, desde + 999)
    if (error) throw error
    filas.push(...((data ?? []) as Record<string, unknown>[]))
    if (!data || data.length < 1000) break
  }
  // Excel no guarda objetos: se pasan a texto.
  return filas.map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])))
}

function CopiaSeguridad() {
  const [progreso, setProgreso] = useState('')
  const [resultado, setResultado] = useState<{ tabla: string; filas: number; error?: boolean }[]>([])
  const [trabajando, setTrabajando] = useState(false)

  async function descargar() {
    setTrabajando(true); setResultado([])
    const libro = XLSX.utils.book_new()
    const res: { tabla: string; filas: number; error?: boolean }[] = []
    for (const [tabla, hoja] of TABLAS_BACKUP) {
      setProgreso(`Leyendo ${hoja}…`)
      try {
        const filas = await leerTabla(tabla)
        XLSX.utils.book_append_sheet(libro, filas.length ? XLSX.utils.json_to_sheet(filas) : XLSX.utils.aoa_to_sheet([['Sin datos']]), hoja.slice(0, 31))
        res.push({ tabla: hoja, filas: filas.length })
      } catch (e) {
        console.error(tabla, e)
        res.push({ tabla: hoja, filas: 0, error: true })
      }
    }
    const fecha = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(libro, `MOVA-copia-de-seguridad-${fecha}.xlsx`)
    setResultado(res); setProgreso(''); setTrabajando(false)
  }

  return <section className="cfgSeccion">
    <div className="cfgBackup">
      <div className="configIcono">💾</div>
      <div>
        <h3>Descargar todo en Excel</h3>
        <p>Un archivo con una hoja por sección: clientes, obras, presupuestos, cobros, compras, personal, agenda y más. Guardalo en tu computadora o en Drive como respaldo.</p>
        <p className="gestionAyuda">⚠ Incluye la hoja "Accesos y claves" con las contraseñas de los clientes: guardá el archivo en un lugar seguro.</p>
      </div>
      <button type="button" className="newButton" disabled={trabajando} onClick={() => void descargar()}>{trabajando ? progreso || 'Preparando…' : '⬇ Descargar copia'}</button>
    </div>
    {resultado.length > 0 && <div className="cfgResultado">
      <strong>✓ Copia descargada</strong>
      <ul>{resultado.map((r) => <li key={r.tabla} className={r.error ? 'err' : ''}>{r.tabla}: {r.error ? 'no se pudo leer (puede que la tabla no exista)' : `${r.filas} fila${r.filas === 1 ? '' : 's'}`}</li>)}</ul>
    </div>}
    <p className="gestionAyuda">Recomendación: descargá una copia una vez por semana o antes de hacer cambios grandes. Supabase además guarda sus propios respaldos diarios del plan.</p>
  </section>
}

// ---------- Auditoría ----------
type Log = { id: number; tabla: string | null; accion: string | null; registro_id: string | null; usuario: string | null; fecha: string }
const MODULO: Record<string, string> = {
  presupuestos: 'un presupuesto', obras: 'una obra', pagos: 'un cobro', costos: 'un costo o pago al personal',
  productos_servicios: 'un producto o servicio', gastos_generales: 'un gasto fijo', materiales: 'una compra',
  obra_asignaciones: 'una asignación de personal', adicionales: 'un cambio o adicional', Clientes: 'un cliente',
}
const MODULO_CORTO: Record<string, string> = {
  presupuestos: 'Presupuestos', obras: 'Obras', pagos: 'Cobros', costos: 'Costos', productos_servicios: 'Productos',
  gastos_generales: 'Gastos fijos', materiales: 'Compras', obra_asignaciones: 'Personal', adicionales: 'Cambios', Clientes: 'Clientes',
}
const ACCION: Record<string, { verbo: string; clase: string; texto: string }> = {
  INSERT: { verbo: 'creó', clase: 'alta', texto: 'Altas' },
  UPDATE: { verbo: 'editó', clase: 'edicion', texto: 'Ediciones' },
  DELETE: { verbo: 'eliminó', clase: 'baja', texto: 'Bajas' },
}
const quien = (u: string | null) => (u && u !== 'sistema' ? u.split('@')[0] : 'Sistema')

function Auditoria() {
  const [logs, setLogs] = useState<Log[]>([])
  const [cargando, setCargando] = useState(true)
  const [usuario, setUsuario] = useState('todos')
  const [modulo, setModulo] = useState('todos')
  const [accion, setAccion] = useState('todas')

  useEffect(() => {
    void supabase.from('log_auditoria').select('*').order('fecha', { ascending: false }).limit(400).then(({ data }) => {
      setLogs((data ?? []) as Log[]); setCargando(false)
    })
  }, [])

  const usuarios = useMemo(() => Array.from(new Set(logs.map((l) => quien(l.usuario)))).sort(), [logs])
  const modulos = useMemo(() => Array.from(new Set(logs.map((l) => l.tabla ?? ''))).filter(Boolean).sort(), [logs])
  const filtrados = logs.filter((l) =>
    (usuario === 'todos' || quien(l.usuario) === usuario) && (modulo === 'todos' || l.tabla === modulo) && (accion === 'todas' || l.accion === accion))
  const porDia = useMemo(() => {
    const g: { dia: string; items: Log[] }[] = []
    for (const l of filtrados) {
      const dia = new Date(l.fecha).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      const grupo = g.find((x) => x.dia === dia)
      if (grupo) grupo.items.push(l); else g.push({ dia, items: [l] })
    }
    return g
  }, [filtrados])

  if (cargando) return <p>Cargando registro...</p>
  return <section className="cfgSeccion">
    <p className="gestionAyuda">Quién creó, editó o eliminó algo, y cuándo. Se registra solo; muestra los últimos {logs.length} movimientos.</p>
    <div className="cpFiltros cfgFiltros">
      <select value={usuario} onChange={(e) => setUsuario(e.target.value)} aria-label="Usuario"><option value="todos">Todos los usuarios</option>{usuarios.map((u) => <option key={u} value={u}>{u}</option>)}</select>
      <select value={modulo} onChange={(e) => setModulo(e.target.value)} aria-label="Sección"><option value="todos">Todas las secciones</option>{modulos.map((m) => <option key={m} value={m}>{MODULO_CORTO[m] ?? m}</option>)}</select>
      <select value={accion} onChange={(e) => setAccion(e.target.value)} aria-label="Acción"><option value="todas">Altas, ediciones y bajas</option>{Object.entries(ACCION).map(([k, a]) => <option key={k} value={k}>{a.texto}</option>)}</select>
    </div>
    {porDia.length === 0 ? <p className="agVacio">No hay movimientos con esos filtros.</p> : porDia.map((g) => (
      <div key={g.dia} className="cfgDia">
        <p className="agDiaTit">{g.dia}</p>
        {g.items.map((l) => {
          const a = ACCION[l.accion ?? ''] ?? { verbo: l.accion ?? '', clase: '', texto: '' }
          return <div key={l.id} className={`cfgLog ${a.clase}`}>
            <span className="cfgLogHora">{new Date(l.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
            <p><strong>{quien(l.usuario)}</strong> {a.verbo} {MODULO[l.tabla ?? ''] ?? l.tabla} <small>#{l.registro_id}</small></p>
          </div>
        })}
      </div>
    ))}
  </section>
}
