import { useState } from 'react'
import { supabase } from './supabase'
import { categoriasProducto, fijarCategorias } from './categoriasApp'
import IconoCategoria, { ICONOS_ELEGIBLES } from './IconoCategoria'

// Productos y servicios → Editar categorías: agregar, renombrar, cambiar el
// ícono, ordenar y borrar. La lista se guarda en configuracion →
// "categorias_producto". Al renombrar, sus productos pasan al nombre nuevo; al
// borrar, quedan sin categoría.

type Fila = { id: number; orig: string | null; nombre: string; icono: string }
type Prod = { id: number; categoria: string | null }

export default function EditarCategorias({ productos, onCerrar, onGuardado }: { productos: Prod[]; onCerrar: () => void; onGuardado: (cambios: Record<number, string | null>) => void }) {
  const [filas, setFilas] = useState<Fila[]>(() => categoriasProducto().map((c, i) => ({ id: i, orig: c.nombre, nombre: c.nombre, icono: c.icono })))
  const [iconoDe, setIconoDe] = useState<number | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const cuantos = (orig: string | null) => (orig ? productos.filter((p) => p.categoria?.trim() === orig).length : 0)
  const borradas = categoriasProducto().filter((c) => !filas.some((f) => f.orig === c.nombre))

  const cambiar = (id: number, campo: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...campo } : f)))
  function mover(i: number, d: -1 | 1) {
    setFilas((fs) => { const j = i + d; if (j < 0 || j >= fs.length) return fs; const n = [...fs]; [n[i], n[j]] = [n[j], n[i]]; return n })
  }
  function borrar(f: Fila) {
    const n = cuantos(f.orig)
    if (n && !window.confirm(`"${f.nombre}" tiene ${n} producto${n === 1 ? '' : 's'}. Si la borrás, quedan sin categoría. ¿Seguro?`)) return
    setFilas((fs) => fs.filter((x) => x.id !== f.id))
  }
  function agregar() {
    const id = Math.max(0, ...filas.map((f) => f.id)) + 1
    setFilas((fs) => [...fs, { id, orig: null, nombre: '', icono: 'sin' }])
    setIconoDe(id)
  }

  async function guardar() {
    const limpias = filas.map((f) => ({ ...f, nombre: f.nombre.trim() }))
    if (limpias.some((f) => !f.nombre)) { setError('Hay una categoría sin nombre.'); return }
    const vistos = new Set<string>()
    for (const f of limpias) { const k = f.nombre.toLowerCase(); if (vistos.has(k)) { setError(`"${f.nombre}" está repetida.`); return } vistos.add(k) }
    setGuardando(true); setError('')
    // Los productos se mueven por id (así un intercambio de nombres no se pisa).
    const cambios: Record<number, string | null> = {}
    limpias.filter((f) => f.orig && f.orig !== f.nombre).forEach((f) => productos.filter((p) => p.categoria?.trim() === f.orig).forEach((p) => { cambios[p.id] = f.nombre }))
    borradas.forEach((c) => productos.filter((p) => p.categoria?.trim() === c.nombre).forEach((p) => { cambios[p.id] = null }))
    const porValor = new Map<string | null, number[]>()
    Object.entries(cambios).forEach(([id, v]) => porValor.set(v, [...(porValor.get(v) ?? []), Number(id)]))
    for (const [v, ids] of porValor) {
      const { error: e } = await supabase.from('productos_servicios').update({ categoria: v }).in('id', ids)
      if (e) { setError('No se pudieron mover los productos. Probá de nuevo.'); setGuardando(false); return }
    }
    const valor = limpias.map((f) => ({ nombre: f.nombre, icono: f.icono }))
    const { error: e } = await supabase.from('configuracion').upsert({ clave: 'categorias_producto', valor, updated_at: new Date().toISOString() })
    if (e) { setError('No se pudo guardar la lista. Probá de nuevo.'); setGuardando(false); return }
    fijarCategorias(valor)
    onGuardado(cambios)
  }

  return <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget && !guardando) onCerrar() }}>
    <div className="modalCard catModal" role="dialog" aria-modal="true" aria-label="Editar categorías">
      <div className="modalHeader"><div><p className="subtitle">PRODUCTOS</p><h2>Editar categorías</h2></div><button type="button" className="closeButton" disabled={guardando} onClick={onCerrar} aria-label="Cerrar">×</button></div>
      <div className="catCuerpo">
        <p className="gestionAyuda">Cambiá el nombre o el ícono, ordenalas con las flechas o agregá nuevas. Si renombrás una, sus productos pasan solos al nombre nuevo.</p>
        <div className="ecLista">
          {filas.map((f, i) => <div key={f.id} className="ecFila">
            <div className="ecPrinc">
              <button type="button" className={`ecIcono${iconoDe === f.id ? ' on' : ''}`} onClick={() => setIconoDe(iconoDe === f.id ? null : f.id)} aria-label={`Cambiar ícono de ${f.nombre || 'la categoría'}`} title="Cambiar ícono"><IconoCategoria icono={f.icono} tamano={16} conFondo /></button>
              <input value={f.nombre} placeholder="Nombre de la categoría" autoFocus={!f.orig && !f.nombre} onChange={(e) => cambiar(f.id, { nombre: e.target.value })} aria-label="Nombre" />
              <small className="ecCant">{f.orig ? `${cuantos(f.orig)} prod.` : 'nueva'}</small>
              <div className="ecAcc">
                <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">▲</button>
                <button type="button" disabled={i === filas.length - 1} onClick={() => mover(i, 1)} aria-label="Bajar">▼</button>
                <button type="button" className="ecBorrar" onClick={() => borrar(f)} aria-label={`Borrar ${f.nombre}`}>✕</button>
              </div>
            </div>
            {f.orig && f.orig !== f.nombre.trim() && f.nombre.trim() && <small className="ecAviso">Antes: {f.orig} · sus productos pasan a “{f.nombre.trim()}”</small>}
            {iconoDe === f.id && <div className="ecIconos" role="listbox" aria-label="Íconos">
              {ICONOS_ELEGIBLES.map((k) => <button type="button" key={k} role="option" aria-selected={f.icono === k} className={f.icono === k ? 'on' : ''} onClick={() => { cambiar(f.id, { icono: k }); setIconoDe(null) }} title={k === 'sin' ? 'Etiqueta' : k}><IconoCategoria icono={k} tamano={16} conFondo /></button>)}
            </div>}
          </div>)}
        </div>
        <button type="button" className="ecNueva" onClick={agregar}>＋ Nueva categoría</button>
        {borradas.length > 0 && <p className="gestionAyuda">Se borran: {borradas.map((c) => c.nombre).join(', ')}.</p>}
        {error && <p className="loginError">{error}</p>}
        <div className="formActions">
          <button type="button" className="cancelButton" disabled={guardando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="newButton" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  </div>
}
