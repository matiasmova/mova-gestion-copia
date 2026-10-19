import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import CampoNumero from './CampoNumero'
import { ImportarDeWeb, llamarTienda, OPCIONES_DEF, type Opciones, type ProductoWeb } from './Tiendanube'
import type { ProductoServicio } from './ProductosServicios'

// Productos → "Productos en página": lo que está publicado en la tienda web
// (Tiendanube). Se edita acá (nombre y descripción de la web, precio, stock,
// visible u oculto) y se sube con "⬆ Subir". Abajo de todo, los productos
// del catálogo que todavía no están en la web, para publicarlos.

type Borrador = { nombre?: string; descripcion?: string }
type Filtro = 'todos' | 'cambios' | 'visibles' | 'ocultos'

// El mismo cálculo que usa la función "tiendanube" para el precio de la web.
function precioWeb(p: ProductoServicio, o: Opciones) {
  let final = p.precio_venta
  if (p.aplica_descuento) {
    if (p.descuento_pct > 0) final = final * (1 - p.descuento_pct / 100)
    else if (p.descuento_monto > 0) final = final - p.descuento_monto
  }
  if (o.preciosConIva) final = final * (1 + (p.iva_pct ?? 21) / 100)
  final = Math.max(0, final)
  return o.redondear ? Math.round(final) : Math.round(final * 100) / 100
}

const pesos = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`

export default function ProductosEnPagina({ elementos, mostrar, onCampo, onRecargar, onEditar }: {
  elementos: ProductoServicio[]
  mostrar: (ars: number) => string
  // guardar=false: solo en pantalla (mientras escribe); true: se guarda en la base.
  onCampo: (id: number, cambios: Partial<ProductoServicio>, guardar: boolean) => Promise<void> | void
  onRecargar: () => void
  onEditar: (el: ProductoServicio) => void
}) {
  const [web, setWeb] = useState<Map<number, ProductoWeb> | null>(null)
  const [todosWeb, setTodosWeb] = useState<ProductoWeb[]>([])
  const [errorWeb, setErrorWeb] = useState('')
  const [leyendo, setLeyendo] = useState(false)
  const [opciones, setOpciones] = useState<Opciones>(OPCIONES_DEF)
  const [borradores, setBorradores] = useState<Record<number, Borrador>>({})
  const [abierto, setAbierto] = useState<number | null>(null)
  const [trabajando, setTrabajando] = useState<number | 'todos' | 'publicar' | null>(null)
  const [mensajes, setMensajes] = useState<Record<number, string>>({})
  const [aviso, setAviso] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [verPublicar, setVerPublicar] = useState(false)
  const [elegidos, setElegidos] = useState<Set<number>>(new Set())
  const [buscarPub, setBuscarPub] = useState('')
  const [importando, setImportando] = useState(false)
  // Lo que se está guardando en la base: "Subir" espera a que termine (la función lee de ahí).
  const guardando = useRef(new Set<Promise<void>>())
  function guardar(id: number, cambios: Partial<ProductoServicio>) {
    const pr = Promise.resolve(onCampo(id, cambios, true)).finally(() => guardando.current.delete(pr))
    guardando.current.add(pr)
  }

  async function leerWeb() {
    setLeyendo(true); setErrorWeb('')
    try {
      const { productos } = await llamarTienda<{ productos: ProductoWeb[] }>('leer_productos')
      setTodosWeb(productos)
      setWeb(new Map(productos.map((p) => [p.variant_id, p])))
    } catch (e) { setErrorWeb((e as Error).message) }
    setLeyendo(false)
  }
  useEffect(() => {
    void leerWeb()
    void supabase.from('configuracion').select('valor').eq('clave', 'tiendanube').maybeSingle()
      .then(({ data }) => setOpciones({ ...OPCIONES_DEF, ...(data?.valor as Partial<Opciones> | undefined) }))
  }, [])

  const publicados = useMemo(() => elementos.filter((e) => e.tn_variant_id), [elementos])
  const vinculados = useMemo(() => new Set(publicados.map((e) => e.tn_variant_id)), [publicados])
  const soloEnWeb = todosWeb.filter((w) => !vinculados.has(w.variant_id)).length
  const sinPublicar = useMemo(() => elementos.filter((e) => e.tipo === 'producto' && e.activo && !e.tn_variant_id), [elementos])

  const nombreWeb = (w?: ProductoWeb) => w?.nombre_web ?? w?.nombre ?? ''
  // Qué falta subir de cada producto (comparado con lo que hoy está en la web).
  function pendientes(el: ProductoServicio): string[] {
    const w = web?.get(el.tn_variant_id!)
    const b = borradores[el.id]
    const lista: string[] = []
    if (b?.nombre !== undefined && b.nombre.trim() !== nombreWeb(w)) lista.push('nombre')
    if (b?.descripcion !== undefined && b.descripcion.trim() !== (w?.descripcion ?? '').trim()) lista.push('descripción')
    if (!w) return lista
    if (Math.abs(precioWeb(el, opciones) - w.precio) >= 0.5) lista.push('precio')
    if (el.tipo === 'producto' && w.stock != null && Math.max(0, Math.floor(el.stock)) !== w.stock) lista.push('stock')
    return lista
  }

  const filas = publicados.filter((el) => {
    const w = web?.get(el.tn_variant_id!)
    const q = busqueda.trim().toLowerCase()
    if (q && !`${el.nombre} ${nombreWeb(w)} ${el.codigo ?? ''}`.toLowerCase().includes(q)) return false
    if (filtro === 'cambios') return pendientes(el).length > 0
    if (filtro === 'visibles') return w?.publicado === true
    if (filtro === 'ocultos') return w ? !w.publicado : false
    return true
  })
  const conCambios = publicados.filter((el) => pendientes(el).length > 0)
  const visibles = publicados.filter((el) => web?.get(el.tn_variant_id!)?.publicado).length

  function cambioDe(el: ProductoServicio) {
    const b = borradores[el.id]; const w = web?.get(el.tn_variant_id!)
    return {
      id: el.id,
      ...(b?.nombre !== undefined && b.nombre.trim() && b.nombre.trim() !== nombreWeb(w) ? { nombre: b.nombre } : {}),
      ...(b?.descripcion !== undefined && b.descripcion.trim() !== (w?.descripcion ?? '').trim() ? { descripcion: b.descripcion } : {}),
    }
  }

  async function subir(lista: ProductoServicio[], quien: number | 'todos') {
    if (!lista.length) return
    setTrabajando(quien); setAviso('')
    await Promise.all(Array.from(guardando.current))
    try {
      const r = await llamarTienda<{ actualizados: number; ventasWeb: string[]; errores: string[] }>('editar', { cambios: lista.map(cambioDe) })
      setBorradores((s) => { const n = { ...s }; lista.forEach((el) => delete n[el.id]); return n })
      const texto = r.errores.length ? `⚠ ${r.errores.join(' · ')}` : `✓ Subido a la web${r.ventasWeb.length ? ` · ${r.ventasWeb.join(' · ')}` : ''}`
      if (quien === 'todos') setAviso(r.errores.length ? texto : `✓ ${lista.length} producto(s) subidos a la web.`)
      else setMensajes((m) => ({ ...m, [quien]: texto }))
      if (r.ventasWeb.length) onRecargar()
      await leerWeb()
    } catch (e) {
      const msg = (e as Error).message
      const texto = `⚠ ${/desconocida/i.test(msg) ? 'Falta actualizar la función "tiendanube" en Supabase (pegá de nuevo el código y Deploy).' : msg}`
      if (quien === 'todos') setAviso(texto); else setMensajes((m) => ({ ...m, [quien]: texto }))
    }
    setTrabajando(null)
  }

  async function cambiarVisible(el: ProductoServicio, visible: boolean) {
    setTrabajando(el.id)
    try {
      await llamarTienda('visibilidad', { id: el.id, visible })
      setWeb((m) => { if (!m) return m; const n = new Map(m); const w = n.get(el.tn_variant_id!); if (w) n.set(w.variant_id, { ...w, publicado: visible }); return n })
      setMensajes((m) => ({ ...m, [el.id]: visible ? '✓ Ahora se ve en la tienda' : '✓ Oculto en la tienda (sigue vinculado)' }))
    } catch (e) { setMensajes((m) => ({ ...m, [el.id]: `⚠ ${(e as Error).message}` })) }
    setTrabajando(null)
  }

  // Lo borra de la tienda web; en el catálogo queda igual (vuelve a "sin publicar").
  async function quitar(el: ProductoServicio) {
    if (!window.confirm(`¿Quitar "${el.nombre}" de la tienda web?\n\nSe borra de la página (con su descripción y fotos de la web). En tu catálogo queda igual y lo podés volver a publicar cuando quieras.\n\nSi solo querés que no se vea por un tiempo, usá "Ocultar".`)) return
    setTrabajando(el.id); setAviso('')
    try {
      await llamarTienda('eliminar', { id: el.id })
      setAviso(`✓ "${el.nombre}" se quitó de la tienda web. Sigue en tu catálogo.`)
      onRecargar(); await leerWeb()
    } catch (e) {
      const msg = (e as Error).message
      setMensajes((m) => ({ ...m, [el.id]: `⚠ ${/desconocida/i.test(msg) ? 'Falta actualizar la función "tiendanube" en Supabase (pegá de nuevo el código y Deploy).' : msg}` }))
    }
    setTrabajando(null)
  }

  async function publicar(visible: boolean) {
    const ids = Array.from(elegidos)
    if (!ids.length) return
    if (visible && !window.confirm(`¿Publicar ${ids.length} producto(s) en la tienda web, visibles para los clientes?`)) return
    setTrabajando('publicar'); setAviso('')
    try {
      const r = await llamarTienda<{ creados: string[]; errores: string[] }>('crear', { productos: ids, visible })
      setAviso(`✓ ${r.creados.length} producto(s) ${visible ? 'publicados' : 'subidos ocultos'} en la web.${r.errores.length ? ` ⚠ No se pudieron subir: ${r.errores.join(', ')}` : ''}`)
      setElegidos(new Set()); setVerPublicar(false)
      onRecargar(); await leerWeb()
    } catch (e) { setAviso(`⚠ ${(e as Error).message}`) }
    setTrabajando(null)
  }

  const listaPublicar = sinPublicar.filter((el) => `${el.nombre} ${el.codigo ?? ''} ${el.categoria ?? ''}`.toLowerCase().includes(buscarPub.trim().toLowerCase()))
  const tildar = (id: number) => setElegidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < 30) n.add(id); return n })
  const ocupado = trabajando !== null

  return <div className="pwWrap">
    <div className="pwCab">
      <div className="pwNums">
        <div><span>EN LA PÁGINA</span><strong>{publicados.length}</strong><small>{web ? `${visibles} visibles · ${publicados.length - visibles} ocultos` : 'productos vinculados'}</small></div>
        <button type="button" className={`pwNum ${conCambios.length ? 'alerta' : ''} ${filtro === 'cambios' ? 'activo' : ''}`} onClick={() => setFiltro((f) => (f === 'cambios' ? 'todos' : 'cambios'))}>
          <span>CAMBIOS SIN SUBIR</span><strong>{web ? conCambios.length : '…'}</strong><small>{filtro === 'cambios' ? 'Mostrando solo estos ✓' : 'Tocá para ver cuáles'}</small>
        </button>
        <button type="button" className="pwNum" onClick={() => setVerPublicar((v) => !v)}>
          <span>SIN PUBLICAR</span><strong>{sinPublicar.length}</strong><small>Productos del catálogo · tocá para publicar</small>
        </button>
      </div>
      <div className="pwAcc">
        <button type="button" className="editButton" disabled={leyendo || ocupado} onClick={() => void leerWeb()}>{leyendo ? 'Leyendo la web…' : '↻ Ver cómo está la web'}</button>
        <button type="button" className="newButton" disabled={!web || ocupado || conCambios.length === 0} onClick={() => void subir(conCambios, 'todos')}>{trabajando === 'todos' ? 'Subiendo…' : `⬆ Subir todos los cambios${conCambios.length ? ` (${conCambios.length})` : ''}`}</button>
      </div>
    </div>

    {aviso && <p className={`pwAviso ${aviso.startsWith('⚠') ? 'error' : ''}`} role="status">{aviso}</p>}
    {errorWeb && <p className="pwAviso error">⚠ No se pudo leer la tienda web: {errorWeb}. Revisá que esté conectada en Configuración → Tienda web. Igual podés editar el precio y el stock acá.</p>}
    {soloEnWeb > 0 && <p className="pwAviso">Hay <strong>{soloEnWeb}</strong> producto(s) en la web que no están en tu sistema. <button type="button" className="caLink" onClick={() => setImportando(true)}>Traerlos a mi catálogo →</button></p>}

    {verPublicar && <section className="pwPublicar">
      <div className="pwPubCab">
        <h3>🛒 Publicar productos del catálogo</h3>
        <button type="button" className="closeButton" onClick={() => setVerPublicar(false)}>×</button>
      </div>
      <p className="gestionAyuda">Elegí cuáles querés en la página (hasta 30 por vez). Se suben con nombre, código, precio, stock y foto. Los servicios no se publican.</p>
      <input type="search" value={buscarPub} onChange={(e) => setBuscarPub(e.target.value)} placeholder="Buscar en los productos sin publicar…" />
      {listaPublicar.length === 0 ? <p className="agVacio">{sinPublicar.length ? 'No hay productos con esa búsqueda.' : 'Todos los productos activos ya están en la página.'}</p> : <div className="tnLista">
        {listaPublicar.map((el) => (
          <label key={el.id} className="tnFila tnElegir"><input type="checkbox" checked={elegidos.has(el.id)} onChange={() => tildar(el.id)} />
            {el.fotoView ? <img src={el.fotoView} alt="" loading="lazy" /> : <span className="tnSinFoto">📦</span>}
            <div><strong>{el.nombre}</strong><small>{el.codigo ? `Cód. ${el.codigo} · ` : ''}stock {el.stock}{!el.fotoView ? ' · sin foto' : ''}</small></div>
            <span className="tnPrecio">{pesos(precioWeb(el, opciones))}<small>precio en la web</small></span>
          </label>
        ))}
      </div>}
      <div className="pwAcc">
        <button type="button" className="editButton" disabled={ocupado || !elegidos.size} onClick={() => void publicar(false)}>Subir ocultos para revisar</button>
        <button type="button" className="newButton" disabled={ocupado || !elegidos.size} onClick={() => void publicar(true)}>{trabajando === 'publicar' ? 'Publicando…' : `🛒 Publicar ${elegidos.size || ''} en la página`}</button>
      </div>
    </section>}

    <div className="crmToolbar"><div className="crmFiltros">
      <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar en los productos de la página…" />
      <select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
        <option value="todos">Todos</option>
        <option value="cambios">Con cambios sin subir</option>
        <option value="visibles">Visibles en la tienda</option>
        <option value="ocultos">Ocultos</option>
      </select>
    </div></div>

    {publicados.length === 0 ? <div className="pwVacio">
      <strong>Todavía no hay productos en la página.</strong>
      <span>Elegí cuáles publicar: tocá <b>SIN PUBLICAR</b> arriba, o el botón 🛒 Publicar de cada producto en "Productos y servicios".</span>
    </div> : filas.length === 0 ? <p className="agVacio">No hay productos con ese filtro.</p> : <div className="pwLista">
      {filas.map((el) => {
        const w = web?.get(el.tn_variant_id!)
        const b = borradores[el.id] ?? {}
        const falta = pendientes(el)
        const msg = mensajes[el.id]
        const estaTrabajando = trabajando === el.id
        const foto = w?.foto ?? el.fotoView
        return <article key={el.id} className={`pwFila ${falta.length ? 'conCambios' : ''} ${w && !w.publicado ? 'oculto' : ''}`}>
          <div className="pwFoto">{foto ? <img src={foto} alt="" loading="lazy" /> : <span>📦</span>}</div>
          <div className="pwInfo">
            <input className="pwNombre" value={b.nombre ?? nombreWeb(w) ?? el.nombre} placeholder={el.nombre}
              onChange={(e) => setBorradores((s) => ({ ...s, [el.id]: { ...s[el.id], nombre: e.target.value } }))} aria-label="Nombre en la web" />
            <small>En tu catálogo: {el.nombre}{el.codigo ? ` · Cód. ${el.codigo}` : ''}</small>
            <div className="pwChips">
              {web && !w && <span className="pwChip gris">No se encontró en la web</span>}
              {w && (w.publicado ? <span className="pwChip verde">👁 Visible</span> : <span className="pwChip gris">🙈 Oculto</span>)}
              {el.tn_sincronizar === false && <span className="pwChip gris" title="No se actualiza solo: solo cuando tocás Subir">⏸ No se actualiza solo</span>}
              {falta.length ? <span className="pwChip naranja">Falta subir: {falta.join(', ')}</span> : w && <span className="pwChip verde">✓ Al día</span>}
            </div>
          </div>
          <div className="pwCampo">
            <span>Precio sin IVA</span>
            {el.moneda === 'USD'
              ? <strong title="Está en dólares: se cambia desde la ficha">{mostrar(el.precio_venta)}</strong>
              : <CampoNumero min="0" value={el.precio_venta} onChange={(e) => void onCampo(el.id, { precio_venta: Number(e.target.value || 0) }, false)} onBlur={(e) => guardar(el.id, { precio_venta: Number(e.target.value || 0) })} />}
            <small>En la web: <b>{pesos(precioWeb(el, opciones))}</b>{w && Math.abs(precioWeb(el, opciones) - w.precio) >= 0.5 ? <> · hoy {pesos(w.precio)}</> : null}</small>
          </div>
          <div className="pwCampo chico">
            <span>Stock</span>
            <CampoNumero min="0" value={el.stock} onChange={(e) => void onCampo(el.id, { stock: Number(e.target.value || 0) }, false)} onBlur={(e) => guardar(el.id, { stock: Number(e.target.value || 0) })} />
            <small>{w ? (w.stock == null ? 'en la web: ilimitado' : `en la web: ${w.stock}`) : ''}</small>
          </div>
          <div className="pwBotones">
            <button type="button" className="newButton" disabled={ocupado || (!!web && falta.length === 0)} onClick={() => void subir([el], el.id)}>{estaTrabajando ? 'Subiendo…' : '⬆ Subir'}</button>
            {w && <button type="button" className="editButton" disabled={ocupado} onClick={() => void cambiarVisible(el, !w.publicado)}>{w.publicado ? '🙈 Ocultar' : '👁 Mostrar'}</button>}
            <button type="button" className="editButton" onClick={() => setAbierto((a) => (a === el.id ? null : el.id))}>{abierto === el.id ? '▲ Menos' : '✏️ Más'}</button>
            <button type="button" className="editButton pwQuitar" disabled={ocupado} onClick={() => void quitar(el)}>🗑 Quitar de la web</button>
          </div>
          {msg && <small className={`pwMsg ${msg.startsWith('⚠') ? 'error' : ''}`}>{msg}</small>}
          {abierto === el.id && <div className="pwMas">
            <label>Descripción en la web
              <textarea rows={5} value={b.descripcion ?? w?.descripcion ?? ''} placeholder="Lo que lee el cliente en la tienda…"
                onChange={(e) => setBorradores((s) => ({ ...s, [el.id]: { ...s[el.id], descripcion: e.target.value } }))} />
            </label>
            <div className="pwMasPie">
              <label className="caCheck"><input type="checkbox" checked={el.tn_sincronizar !== false} onChange={(e) => guardar(el.id, { tn_sincronizar: e.target.checked })} /> Que el precio y el stock se actualicen solos</label>
              <button type="button" className="caLink" onClick={() => onEditar(el)}>Abrir la ficha completa →</button>
            </div>
          </div>}
        </article>
      })}
    </div>}

    <p className="gestionAyuda">El precio y el stock que cambiás acá también quedan en tu catálogo. El nombre y la descripción son solo de la página. Nada llega a la web hasta que tocás <b>⬆ Subir</b> (o la sincronización automática, si está prendida).</p>

    {importando && <ImportarDeWeb opciones={opciones} onCerrar={(m) => { setImportando(false); if (m) { setAviso(m); onRecargar(); void leerWeb() } }} />}
  </div>
}
