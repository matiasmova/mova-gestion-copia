import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { pedirAsistente } from './asistenteIA'
import { moneda } from './gestionFormat'
import { partirDescripcion } from './presupuestoCalculos'
import { agruparPorTipo } from './pdfPresupuesto'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import { PARTE_UNICA, normalizarResumen, partesConItems, resumenVacio, totalItems, type ResumenDoc } from './resumenDocumento'

// "Cómo lo ve el cliente": Detallado (ítem por ítem) o Resumido (un texto por
// sección, que puede escribir la IA, sin el precio de cada ítem). Cada sección
// se puede dividir en partes (por ejemplo, Planta baja y Planta alta).

type Props = { presupuestoId: number; titulo: string; items: ItemPresupuesto[]; onGuardado: () => void; abierto?: boolean }

const SQL = 'supabase-resumen-documento-fase-28.sql'
const nuevaId = () => Math.random().toString(36).slice(2, 9)

export default function ComoLoVeCliente({ presupuestoId, titulo, items, onGuardado, abierto = false }: Props) {
  const [r, setR] = useState<ResumenDoc>(resumenVacio)
  const [guardado, setGuardado] = useState('')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [pensando, setPensando] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    let cancelado = false
    setCargando(true); setError(''); setOk('')
    void supabase.from('presupuestos').select('resumen_doc').eq('id', presupuestoId).maybeSingle().then(({ data, error: e }) => {
      if (cancelado) return
      setCargando(false)
      if (e) { setError(`Falta correr en Supabase el SQL "${SQL}" para poder usar el modo resumido.`); return }
      const g = normalizarResumen(data?.resumen_doc)
      setR(g); setGuardado(JSON.stringify(g))
    })
    return () => { cancelado = true }
  }, [presupuestoId])

  const grupos = useMemo(() => agruparPorTipo(items), [items])
  const cambios = JSON.stringify(r) !== guardado
  const cambiar = (f: (x: ResumenDoc) => ResumenDoc) => { setR((x) => f(x)); setOk('') }

  // Partes guardadas de una sección (o la única por defecto) para poder editarlas.
  const partesEn = (x: ResumenDoc, clave: string) => x.grupos[clave]?.length ? x.grupos[clave] : [{ id: `${clave}-1`, nombre: PARTE_UNICA, texto: '', incluye: [] }]
  const partesDe = (clave: string) => partesEn(r, clave)
  const editarParte = (clave: string, id: string, cambio: Partial<{ nombre: string; texto: string; incluye: string[] }>) =>
    cambiar((x) => ({ ...x, grupos: { ...x.grupos, [clave]: partesEn(x, clave).map((p) => (p.id === id ? { ...p, ...cambio } : p)) } }))

  function dividir(clave: string, itemsGrupo: ItemPresupuesto[]) {
    const actuales = partesDe(clave)
    const id = nuevaId()
    const nombres = actuales.length === 1 && actuales[0].nombre === PARTE_UNICA
    const lista = [...actuales.map((p, i) => (i === 0 && nombres ? { ...p, nombre: 'Planta baja' } : p)), { id, nombre: actuales.length === 1 ? 'Planta alta' : `Parte ${actuales.length + 1}`, texto: '', incluye: [] }]
    // Los últimos ítems de la primera parte pasan a la nueva, para empezar (después se mueven a gusto).
    const deLaPrimera = partesConItems(r, clave, itemsGrupo, items)[0].items
    const asignacion = { ...r.asignacion }
    for (const it of itemsGrupo) if (!asignacion[String(items.indexOf(it))]) asignacion[String(items.indexOf(it))] = actuales[0].id
    deLaPrimera.slice(Math.ceil(deLaPrimera.length / 2)).forEach((it) => { asignacion[String(items.indexOf(it))] = id })
    cambiar((x) => ({ ...x, grupos: { ...x.grupos, [clave]: lista }, asignacion }))
  }

  function quitarParte(clave: string, id: string) {
    const lista = partesDe(clave).filter((p) => p.id !== id)
    const destino = lista[0].id
    const asignacion = Object.fromEntries(Object.entries(r.asignacion).map(([k, v]) => [k, v === id ? destino : v]))
    if (lista.length === 1 && (lista[0].nombre === 'Planta baja' || !lista[0].nombre.trim())) lista[0] = { ...lista[0], nombre: PARTE_UNICA }
    cambiar((x) => ({ ...x, grupos: { ...x.grupos, [clave]: lista }, asignacion }))
  }

  async function escribir(clave: string, seccion: string, parte: { id: string; nombre: string; texto: string; items: ItemPresupuesto[] }, varias: boolean) {
    setError(''); setOk(''); setPensando(parte.id)
    try {
      const res = await pedirAsistente<{ texto: string; incluye: string[] }>({
        accion: 'resumen_documento', titulo, seccion, parte: varias ? parte.nombre : '', cantidades: r.cantidades, marca: r.marca, actual: parte.texto,
        items: parte.items.map((it) => { const p = partirDescripcion(it.descripcion); return `${Number(it.cantidad).toLocaleString('es-AR')} × ${p.detalle ? `${p.titulo} (${p.detalle})` : p.titulo}` }),
      })
      if (!res.texto) throw new Error('La IA no devolvió el texto. Probá de nuevo.')
      editarParte(clave, parte.id, { texto: res.texto, incluye: res.incluye ?? [] })
      setOk('Listo. Revisalo, corregí lo que quieras y tocá Guardar.')
    } catch (e) { setError((e as Error).message) } finally { setPensando(null) }
  }

  async function guardar() {
    setError(''); setOk(''); setGuardando(true)
    // Solo se guardan las secciones que existen hoy en el presupuesto.
    const limpio: ResumenDoc = { ...r, grupos: Object.fromEntries(Object.entries(r.grupos).filter(([k]) => grupos.some((g) => g.clave === k))) }
    const { error: e } = await supabase.from('presupuestos').update({ resumen_doc: limpio }).eq('id', presupuestoId)
    setGuardando(false)
    if (e) { console.error(e); setError(`No se pudo guardar. ¿Corriste en Supabase el SQL "${SQL}"?`); return }
    setR(limpio); setGuardado(JSON.stringify(limpio))
    setOk(limpio.modo === 'resumido' ? '✓ Guardado: el cliente ve el presupuesto resumido.' : '✓ Guardado: el cliente ve el detalle ítem por ítem.')
    onGuardado()
  }

  const vuelta = guardado ? normalizarResumen(JSON.parse(guardado)) : null

  return (
    <details className="presuMas presuRecos lvcWrap" open={abierto || undefined}>
      <summary>👁️ Cómo lo ve el cliente <span className={vuelta?.modo === 'resumido' ? 'presuRecosSi' : 'presuRecosNo'}>{vuelta?.modo === 'resumido' ? 'resumido' : 'detallado'}</span></summary>
      <div className="presuRecosCuerpo">
        {cargando ? <p className="gestionAyuda">Cargando…</p> : <>
          <div className="lvcModo" role="radiogroup" aria-label="Cómo lo ve el cliente">
            <button type="button" role="radio" aria-checked={r.modo === 'detallado'} className={r.modo === 'detallado' ? 'activo' : ''} onClick={() => cambiar((x) => ({ ...x, modo: 'detallado' }))}>📋 Detallado</button>
            <button type="button" role="radio" aria-checked={r.modo === 'resumido'} className={r.modo === 'resumido' ? 'activo' : ''} onClick={() => cambiar((x) => ({ ...x, modo: 'resumido' }))}>✨ Resumido</button>
          </div>
          <p className="gestionAyuda" style={{ margin: 0 }}>
            {r.modo === 'resumido'
              ? 'El cliente ve un texto claro por sección y el total. No ve el precio de cada ítem ni el modelo exacto, así es más difícil comparar o copiar. Vos seguís cargando los ítems como siempre.'
              : 'El cliente ve cada ítem con cantidad, precio unitario y subtotal.'}
          </p>

          {r.modo === 'resumido' && <>
            <div className="lvcOpciones">
              <label className="caCheck"><input type="checkbox" checked={r.cantidades} onChange={(e) => cambiar((x) => ({ ...x, cantidades: e.target.checked }))} /> Mostrar cantidades (ej.: 13 teclas)</label>
              <label className="caCheck"><input type="checkbox" checked={r.marca} onChange={(e) => cambiar((x) => ({ ...x, marca: e.target.checked }))} /> Mostrar marca y modelo exacto</label>
              <label className="caCheck"><input type="checkbox" checked={r.subtotales} onChange={(e) => cambiar((x) => ({ ...x, subtotales: e.target.checked }))} /> Mostrar el total de cada sección</label>
            </div>
            {grupos.length === 0 && <p className="gestionAyuda">El presupuesto todavía no tiene ítems.</p>}
            {grupos.map((g) => {
              const partes = partesConItems(r, g.clave, g.items, items)
              const varias = partes.length > 1
              return (
                <section className="lvcSeccion" key={g.clave}>
                  <div className="lvcSeccionCab"><h4>{g.titulo}</h4><b>{moneda(totalItems(g.items))}</b></div>
                  {partes.map((p) => (
                    <div className="lvcParte" key={p.id}>
                      {varias && (
                        <div className="lvcParteCab">
                          <input value={p.nombre} onChange={(e) => editarParte(g.clave, p.id, { nombre: e.target.value })} aria-label="Nombre de la parte" placeholder="Ej.: Planta baja" />
                          <button type="button" className="lvcQuitar" title="Quitar esta parte (sus ítems pasan a la primera)" onClick={() => quitarParte(g.clave, p.id)}>×</button>
                        </div>
                      )}
                      <ul className="lvcItems">
                        {p.items.length === 0 && <li className="lvcVacio">Sin ítems: movelos desde otra parte.</li>}
                        {p.items.map((it) => (
                          <li key={items.indexOf(it)}>
                            <span>{partirDescripcion(it.descripcion).titulo}</span><em>×{Number(it.cantidad).toLocaleString('es-AR')}</em>
                            {varias && (
                              <select value={p.id} aria-label="Mover a otra parte" onChange={(e) => cambiar((x) => ({ ...x, asignacion: { ...x.asignacion, [String(items.indexOf(it))]: e.target.value } }))}>
                                {partes.map((o) => <option key={o.id} value={o.id}>{o.nombre || 'Sin nombre'}</option>)}
                              </select>
                            )}
                          </li>
                        ))}
                      </ul>
                      <textarea rows={4} value={p.texto} onChange={(e) => editarParte(g.clave, p.id, { texto: e.target.value })} placeholder="Texto que lee el cliente. Tocá ✨ para que la IA lo escriba." />
                      <input value={p.incluye.join(', ')} onChange={(e) => editarParte(g.clave, p.id, { incluye: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="Incluye (separado por comas): 13 teclas smart, Central de control…" aria-label="Lista de lo que incluye" />
                      <button type="button" className="lvcIA" disabled={!!pensando || p.items.length === 0} onClick={() => void escribir(g.clave, g.titulo, p, varias)}>
                        {pensando === p.id ? 'Escribiendo…' : p.texto.trim() ? '✨ Volver a escribir con IA' : '✨ Escribir con IA'}
                      </button>
                    </div>
                  ))}
                  <button type="button" className="lvcMas" onClick={() => dividir(g.clave, g.items)}>＋ Dividir en otra parte (ej.: Planta alta)</button>
                </section>
              )
            })}
          </>}

          {error && <p className="loginError" style={{ margin: 0 }}>{error}</p>}
          {ok && <p className="presuRecosOk">{ok}</p>}
          <div className="presuRecosAcc">
            {cambios && <button type="button" className="cancelButton" onClick={() => { if (vuelta) setR(vuelta); setOk('') }}>Descartar</button>}
            <button type="button" className="newButton" disabled={guardando || !cambios} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </>}
      </div>
    </details>
  )
}
