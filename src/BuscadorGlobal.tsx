import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { puedeVer, type Rol, type Vista } from './permisos'
import { codigoPresupuesto } from './codigoPresupuesto'
import IconoMenu from './iconosMenu'

// Buscador general (clientes, obras, presupuestos, productos) y botón "+" de
// acciones rápidas. Los dos le piden a la app que vaya a una sección y abra
// algo con un "pedido" que el módulo atiende al montarse.

export type Pedido = { accion: 'nuevo' | 'abrir' | 'cobro' | 'gasto'; id?: number; n: number }
export type Ir = (vista: Vista, pedido?: Omit<Pedido, 'n'>) => void

type Accion = { clave: string; vista: Vista; accion: Pedido['accion']; texto: string; icono: string; buscar: string }

export const ACCIONES: Accion[] = [
  { clave: 'presupuesto', vista: 'presupuestos', accion: 'nuevo', texto: 'Presupuesto', icono: 'presupuestos', buscar: 'nuevo presupuesto cotizar' },
  { clave: 'cobro', vista: 'finanzas', accion: 'cobro', texto: 'Cobro', icono: 'cobro', buscar: 'nuevo cobro pago ingreso cobrar' },
  { clave: 'gasto', vista: 'finanzas', accion: 'gasto', texto: 'Gasto', icono: 'gasto', buscar: 'nuevo gasto costo egreso' },
  { clave: 'compra', vista: 'compras', accion: 'nuevo', texto: 'Compra', icono: 'compras', buscar: 'nueva compra material proveedor' },
  { clave: 'cliente', vista: 'clientes', accion: 'nuevo', texto: 'Cliente', icono: 'clientes', buscar: 'nuevo cliente' },
  { clave: 'recordatorio', vista: 'agenda', accion: 'nuevo', texto: 'Recordatorio', icono: 'agenda', buscar: 'nuevo recordatorio agenda evento visita tarea' },
]

type Resultado = { clave: string; grupo: string; titulo: string; detalle: string; icono: string; ir: () => void }

const sinAcentos = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
// Para el filtro de Supabase: sin caracteres que rompan la sintaxis del "or".
const limpiarTermino = (s: string) => s.replace(/[,()%*\\]/g, ' ').trim()

export function BuscadorGlobal({ rol, abierto, onCerrar, ir }: { rol: Rol; abierto: boolean; onCerrar: () => void; ir: Ir }) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Resultado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [activo, setActivo] = useState(0)
  const entrada = useRef<HTMLInputElement>(null)
  const turno = useRef(0)

  useEffect(() => {
    if (abierto) { setTexto(''); setResultados([]); setActivo(0); setTimeout(() => entrada.current?.focus(), 30) }
  }, [abierto])

  const acciones = useMemo(() => {
    const t = sinAcentos(texto.trim())
    return ACCIONES.filter((a) => puedeVer(rol, a.vista)).filter((a) => !t || a.buscar.includes(t) || t.split(/\s+/).every((p) => a.buscar.includes(p)))
  }, [texto, rol])

  useEffect(() => {
    const t = limpiarTermino(texto)
    if (t.length < 2) { setResultados([]); setBuscando(false); return }
    const mio = ++turno.current
    setBuscando(true)
    const h = setTimeout(async () => {
      const like = `%${t}%`
      const tareas: PromiseLike<Resultado[]>[] = []
      if (puedeVer(rol, 'clientes')) tareas.push(supabase.from('Clientes').select('id, nombre, apellido, telefono, localidad')
        .or(`nombre.ilike.${like},apellido.ilike.${like},telefono.ilike.${like},email.ilike.${like},localidad.ilike.${like}`).limit(6)
        .then(({ data }) => ((data ?? []) as { id: number; nombre: string; apellido: string | null; telefono: string | null; localidad: string | null }[]).map((c) => ({
          clave: `c${c.id}`, grupo: 'Clientes', icono: 'clientes', titulo: `${c.nombre} ${c.apellido ?? ''}`.trim(),
          detalle: [c.telefono, c.localidad].filter(Boolean).join(' · '), ir: () => ir('clientes', { accion: 'abrir', id: c.id }),
        }))))
      if (puedeVer(rol, 'obras')) tareas.push(supabase.from('obras').select('id, nombre_obra, direccion, localidad, estado')
        .or(`nombre_obra.ilike.${like},direccion.ilike.${like},localidad.ilike.${like}`).limit(6)
        .then(({ data }) => ((data ?? []) as { id: number; nombre_obra: string; direccion: string | null; localidad: string | null; estado: string | null }[]).map((o) => ({
          clave: `o${o.id}`, grupo: 'Obras', icono: 'obras', titulo: o.nombre_obra,
          detalle: [o.direccion, o.localidad].filter(Boolean).join(', '), ir: () => ir('obras', { accion: 'abrir', id: o.id }),
        }))))
      if (puedeVer(rol, 'presupuestos')) {
        const porCodigo = /^mv-?[0-9a-z]{0,5}$/i.test(t)
        tareas.push(supabase.from('presupuestos').select('id, titulo, estado, total, fecha').eq('activo', true)
          .ilike('titulo', like).order('created_at', { ascending: false }).limit(6)
          .then(({ data }) => ((data ?? []) as { id: number; titulo: string; estado: string; total: number; fecha: string }[]).map((p) => ({
            clave: `p${p.id}`, grupo: 'Presupuestos', icono: 'presupuestos', titulo: p.titulo,
            detalle: `${codigoPresupuesto(p.id)} · ${p.estado} · $ ${Number(p.total || 0).toLocaleString('es-AR')}`, ir: () => ir('presupuestos', { accion: 'abrir', id: p.id }),
          }))))
        // Búsqueda por código (MV-XXXXX): el código se calcula desde el id.
        if (porCodigo && t.length >= 4) tareas.push(supabase.from('presupuestos').select('id, titulo, estado').eq('activo', true).order('created_at', { ascending: false }).limit(1000)
          .then(({ data }) => ((data ?? []) as { id: number; titulo: string; estado: string }[])
            .filter((p) => codigoPresupuesto(p.id).replace('-', '').includes(t.toUpperCase().replace('-', ''))).slice(0, 6).map((p) => ({
              clave: `p${p.id}`, grupo: 'Presupuestos', icono: 'presupuestos', titulo: p.titulo,
              detalle: `${codigoPresupuesto(p.id)} · ${p.estado}`, ir: () => ir('presupuestos', { accion: 'abrir', id: p.id }),
            }))))
      }
      if (puedeVer(rol, 'catalogo')) tareas.push(supabase.from('productos_servicios').select('id, nombre, codigo, categoria, stock, tipo')
        .or(`nombre.ilike.${like},codigo.ilike.${like},categoria.ilike.${like},proveedor.ilike.${like}`).limit(6)
        .then(({ data }) => ((data ?? []) as { id: number; nombre: string; codigo: string | null; categoria: string | null; stock: number; tipo: string }[]).map((p) => ({
          clave: `s${p.id}`, grupo: 'Productos y servicios', icono: 'catalogo', titulo: p.nombre,
          detalle: [p.codigo, p.categoria, p.tipo === 'producto' ? `stock ${p.stock}` : ''].filter(Boolean).join(' · '), ir: () => ir('catalogo', { accion: 'abrir', id: p.id }),
        }))))
      const listas = await Promise.all(tareas.map((tarea) => Promise.resolve(tarea).catch(() => [] as Resultado[])))
      if (mio !== turno.current) return
      const vistos = new Set<string>()
      setResultados(listas.flat().filter((r) => (vistos.has(r.clave) ? false : (vistos.add(r.clave), true))))
      setActivo(0)
      setBuscando(false)
    }, 250)
    return () => clearTimeout(h)
  }, [texto, rol, ir])

  const items: Resultado[] = useMemo(() => [
    ...acciones.map((a) => ({ clave: `a${a.clave}`, grupo: 'Crear', icono: a.icono, titulo: `+ ${a.texto}`, detalle: '', ir: () => ir(a.vista, { accion: a.accion }) })),
    ...resultados,
  ], [acciones, resultados, ir])

  if (!abierto) return null

  function tecla(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onCerrar()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(items.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter' && items[activo]) { e.preventDefault(); items[activo].ir(); onCerrar() }
  }

  let grupoAnterior = ''
  return (
    <div className="bgOverlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
      <div className="bgCaja" role="dialog" aria-label="Buscar en toda la app">
        <div className="bgEntrada">
          <IconoMenu nombre="buscar" tamano={20} />
          <input ref={entrada} autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={tecla}
            placeholder="Buscar cliente, obra, presupuesto (o código MV-…), producto…" aria-label="Buscar" />
          <button type="button" className="bgCerrar" onClick={onCerrar} aria-label="Cerrar">Esc</button>
        </div>
        <div className="bgLista">
          {items.map((r, i) => {
            const cabecera = r.grupo !== grupoAnterior ? r.grupo : null
            grupoAnterior = r.grupo
            return <div key={r.clave}>
              {cabecera && <p className="bgGrupo">{cabecera}</p>}
              <button type="button" className={`bgItem ${i === activo ? 'activo' : ''}`} onMouseEnter={() => setActivo(i)} onClick={() => { r.ir(); onCerrar() }}>
                <span className="bgIcono"><IconoMenu nombre={r.icono} /></span>
                <span className="bgTexto"><strong>{r.titulo}</strong>{r.detalle && <small>{r.detalle}</small>}</span>
                <span className="bgIr" aria-hidden>›</span>
              </button>
            </div>
          })}
          {buscando && <p className="bgEstado">Buscando…</p>}
          {!buscando && limpiarTermino(texto).length >= 2 && resultados.length === 0 && <p className="bgEstado">No encontré nada con "{texto.trim()}".</p>}
          {limpiarTermino(texto).length < 2 && <p className="bgEstado">Escribí al menos 2 letras. Atajo: <kbd>Ctrl</kbd> + <kbd>K</kbd></p>}
        </div>
      </div>
    </div>
  )
}

// Botón flotante "+" con las acciones rápidas.
export function BotonMas({ rol, ir }: { rol: Rol; ir: Ir }) {
  const [abierto, setAbierto] = useState(false)
  const acciones = ACCIONES.filter((a) => puedeVer(rol, a.vista))
  if (acciones.length === 0) return null
  return <>
    {abierto && <div className="bmFondo" onClick={() => setAbierto(false)} />}
    <div className={`bmWrap ${abierto ? 'abierto' : ''}`}>
      {abierto && <div className="bmMenu" role="menu">
        {acciones.map((a) => (
          <button key={a.clave} type="button" role="menuitem" onClick={() => { setAbierto(false); ir(a.vista, { accion: a.accion }) }}>
            <span>{a.texto}</span><i><IconoMenu nombre={a.icono} /></i>
          </button>
        ))}
      </div>}
      <button type="button" className="bmBoton" aria-label={abierto ? 'Cerrar acciones rápidas' : 'Crear algo nuevo'} aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <span>+</span>
      </button>
    </div>
  </>
}
