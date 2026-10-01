import { useMemo, useState } from 'react'
import { pedirAsistente } from './asistenteIA'
import { supabase } from './supabase'

// La IA propone categoría, nombre en presupuesto y descripción para el
// catálogo. Se revisa todo antes de guardar; nada se cambia solo.

type Prod = { id: number; nombre: string; tipo: 'producto' | 'servicio'; categoria: string | null; nombre_presupuesto: string | null; descripcion: string | null; activo: boolean }
type Propuesta = { id: number; categoria: string; nombre_presupuesto: string; descripcion: string }
type Fila = Propuesta & { elegido: boolean }

const vacio = (s: string | null | undefined) => !String(s ?? '').trim()
const igual = (a: string | null | undefined, b: string) => String(a ?? '').trim().toLowerCase() === b.trim().toLowerCase()

function OrdenarCatalogoIA({ productos, sinNombrePresupuesto, onCerrar, onGuardado }: { productos: Prod[]; sinNombrePresupuesto: boolean; onCerrar: () => void; onGuardado: () => void }) {
  const [fase, setFase] = useState<'opciones' | 'pensando' | 'revisar' | 'guardando' | 'listo'>('opciones')
  const [alcance, setAlcance] = useState<'faltan' | 'todos'>('faltan')
  const [usarCategoria, setUsarCategoria] = useState(true)
  const [usarNombre, setUsarNombre] = useState(!sinNombrePresupuesto)
  const [usarDescripcion, setUsarDescripcion] = useState(true)
  const [progreso, setProgreso] = useState('')
  const [filas, setFilas] = useState<Fila[]>([])
  const [error, setError] = useState('')
  const [resumen, setResumen] = useState('')

  const activos = useMemo(() => productos.filter((p) => p.activo), [productos])
  const candidatos = useMemo(() => activos.filter((p) => alcance === 'todos' || vacio(p.categoria) || (!sinNombrePresupuesto && vacio(p.nombre_presupuesto)) || vacio(p.descripcion)), [activos, alcance, sinNombrePresupuesto])
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])

  async function pedir() {
    setError(''); setFase('pensando')
    try {
      // Las categorías buenas que ya existen se reutilizan para no duplicar.
      const categorias = new Set(activos.map((p) => p.categoria?.trim()).filter((c): c is string => !!c))
      const todas: Propuesta[] = []
      for (let i = 0; i < candidatos.length; i += 40) {
        setProgreso(`Revisando ${Math.min(i + 40, candidatos.length)} de ${candidatos.length}…`)
        const r = await pedirAsistente<{ productos: Propuesta[] }>({ accion: 'ordenar_catalogo', ids: candidatos.slice(i, i + 40).map((p) => p.id), categorias: [...categorias].slice(0, 40) })
        r.productos.forEach((x) => { todas.push(x); if (x.categoria) categorias.add(x.categoria) })
      }
      // Solo quedan los que cambian algo de lo elegido.
      const nuevas = todas.map((x) => {
        const p = porId.get(x.id)!
        return {
          id: x.id,
          categoria: usarCategoria && x.categoria && !igual(p.categoria, x.categoria) ? x.categoria : '',
          nombre_presupuesto: usarNombre && x.nombre_presupuesto && !igual(p.nombre_presupuesto, x.nombre_presupuesto) ? x.nombre_presupuesto : '',
          // La descripción solo se completa si está vacía (la de la web no se pisa).
          descripcion: usarDescripcion && vacio(p.descripcion) && x.descripcion ? x.descripcion : '',
          elegido: true,
        }
      }).filter((f) => f.categoria || f.nombre_presupuesto || f.descripcion)
      setFilas(nuevas)
      setFase('revisar')
    } catch (e) { setError((e as Error).message); setFase('opciones') }
  }

  function cambiar(id: number, campo: 'categoria' | 'nombre_presupuesto' | 'descripcion' | 'elegido', valor: string | boolean) {
    setFilas((a) => a.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)))
  }

  async function guardar() {
    setFase('guardando'); setError('')
    const elegidas = filas.filter((f) => f.elegido)
    let ok = 0; const fallas: string[] = []
    for (let i = 0; i < elegidas.length; i += 6) {
      await Promise.all(elegidas.slice(i, i + 6).map(async (f) => {
        const cambios: Record<string, string> = {}
        if (f.categoria.trim()) cambios.categoria = f.categoria.trim()
        if (f.nombre_presupuesto.trim()) cambios.nombre_presupuesto = f.nombre_presupuesto.trim()
        if (f.descripcion.trim()) cambios.descripcion = f.descripcion.trim()
        if (!Object.keys(cambios).length) return
        const { error } = await supabase.from('productos_servicios').update(cambios).eq('id', f.id)
        if (error) fallas.push(porId.get(f.id)?.nombre ?? String(f.id)); else ok++
      }))
    }
    setResumen(`${ok} producto${ok === 1 ? '' : 's'} actualizado${ok === 1 ? '' : 's'}.${fallas.length ? ` No se pudieron guardar: ${fallas.join(', ')}.` : ''}`)
    setFase('listo')
    onGuardado()
  }

  const elegidos = filas.filter((f) => f.elegido).length
  const cats = Array.from(new Set(filas.map((f) => f.categoria).filter(Boolean)))

  return (
    <div className="modalOverlay">
      <div className="modalCard catalogoModal ordenarModal">
        <div className="modalHeader">
          <div><p className="subtitle">✨ CATÁLOGO CON IA</p><h2>Ordenar el catálogo</h2></div>
          <button type="button" className="modalClose closeButton" onClick={onCerrar} disabled={fase === 'guardando'}>×</button>
        </div>

        {fase === 'opciones' && (
          <div className="catalogoForm">
            <p className="gestionAyuda" style={{ marginTop: 0 }}>La IA revisa tus productos y propone cómo ordenarlos. Después ves todo en una lista para aprobar o corregir: <b>no se guarda nada sin que lo confirmes</b>.</p>
            <div className="simulacionBox">
              <span className="simulacionTitulo">¿Qué productos?</span>
              <label className="caCheck"><input type="radio" checked={alcance === 'faltan'} onChange={() => setAlcance('faltan')} /> Solo los que tienen algo sin completar</label>
              <label className="caCheck"><input type="radio" checked={alcance === 'todos'} onChange={() => setAlcance('todos')} /> Todos los activos ({activos.length})</label>
            </div>
            <div className="simulacionBox">
              <span className="simulacionTitulo">¿Qué querés que proponga?</span>
              <label className="caCheck"><input type="checkbox" checked={usarCategoria} onChange={(e) => setUsarCategoria(e.target.checked)} /> <span><b>Categoría</b> ordenada y sin repetidas (WiFi y redes, Domótica Zigbee, Cámaras…)</span></label>
              <label className="caCheck"><input type="checkbox" checked={usarNombre} disabled={sinNombrePresupuesto} onChange={(e) => setUsarNombre(e.target.checked)} /> <span><b>Nombre en presupuesto</b>, genérico y sin marca ("Router mesh WiFi 6"){sinNombrePresupuesto ? ' — falta correr el SQL de Productos' : ''}</span></label>
              <label className="caCheck"><input type="checkbox" checked={usarDescripcion} onChange={(e) => setUsarDescripcion(e.target.checked)} /> <span><b>Descripción corta</b>, solo para los que no tienen (las que vinieron de la web no se tocan)</span></label>
            </div>
            {error && <p className="loginError">{error}</p>}
            <div className="modalActions formActions">
              <button type="button" className="cancelButton" onClick={onCerrar}>Cancelar</button>
              <button type="button" className="newButton" disabled={!candidatos.length || !(usarCategoria || usarNombre || usarDescripcion)} onClick={() => void pedir()}>
                {candidatos.length ? `✨ Revisar ${candidatos.length} producto${candidatos.length === 1 ? '' : 's'}` : 'No hay nada para completar'}
              </button>
            </div>
          </div>
        )}

        {fase === 'pensando' && (
          <div className="mercadoCargando" role="status"><span className="mercadoSpinner" /><p><strong>La IA está ordenando tu catálogo…</strong><br /><small>{progreso}</small></p></div>
        )}

        {fase === 'revisar' && (
          <div className="catalogoForm">
            {filas.length === 0 ? <p className="gestionAyuda">Tu catálogo ya está ordenado: la IA no propuso cambios. 👌</p> : <>
              <p className="gestionAyuda" style={{ marginTop: 0 }}>
                {filas.length} producto{filas.length === 1 ? '' : 's'} con cambios. Podés corregir cualquier texto o destildar los que no quieras.
                {cats.length > 0 && <> Categorías propuestas: <b>{cats.join(' · ')}</b>.</>}
              </p>
              <div className="ordenarBarra">
                <button type="button" className="caLink" onClick={() => setFilas((a) => a.map((f) => ({ ...f, elegido: true })))}>Marcar todos</button>
                <button type="button" className="caLink" onClick={() => setFilas((a) => a.map((f) => ({ ...f, elegido: false })))}>Ninguno</button>
              </div>
              <div className="ordenarLista">
                {filas.map((f) => {
                  const p = porId.get(f.id)!
                  return (
                    <div className={`ordenarFila ${f.elegido ? '' : 'apagada'}`} key={f.id}>
                      <label className="ordenarCab"><input type="checkbox" checked={f.elegido} onChange={(e) => cambiar(f.id, 'elegido', e.target.checked)} /><b>{p.nombre}</b></label>
                      {f.categoria && <label><small>Categoría{p.categoria ? <> · antes: <s>{p.categoria}</s></> : ' · estaba vacía'}</small><input value={f.categoria} onChange={(e) => cambiar(f.id, 'categoria', e.target.value)} list="ordenarCats" /></label>}
                      {f.nombre_presupuesto && <label><small>Nombre en presupuesto{p.nombre_presupuesto ? <> · antes: <s>{p.nombre_presupuesto}</s></> : ' · estaba vacío'}</small><input value={f.nombre_presupuesto} onChange={(e) => cambiar(f.id, 'nombre_presupuesto', e.target.value)} /></label>}
                      {f.descripcion && <label><small>Descripción · estaba vacía</small><input value={f.descripcion} onChange={(e) => cambiar(f.id, 'descripcion', e.target.value)} /></label>}
                    </div>
                  )
                })}
              </div>
              <datalist id="ordenarCats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
            </>}
            <div className="modalActions formActions">
              <button type="button" className="cancelButton" onClick={onCerrar}>Cancelar</button>
              {filas.length > 0 && <button type="button" className="newButton" disabled={!elegidos} onClick={() => void guardar()}>Guardar {elegidos} producto{elegidos === 1 ? '' : 's'}</button>}
            </div>
          </div>
        )}

        {fase === 'guardando' && <div className="catalogoForm"><p role="status">Guardando…</p><p className="gestionAyuda">No cierres esta ventana.</p></div>}

        {fase === 'listo' && (
          <div className="catalogoForm">
            <p className="gestionAyuda" style={{ marginTop: 0 }}>✅ {resumen}</p>
            <div className="modalActions formActions"><button type="button" className="newButton" onClick={onCerrar}>Listo</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

export default OrdenarCatalogoIA
