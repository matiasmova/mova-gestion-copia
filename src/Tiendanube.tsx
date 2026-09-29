import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'

// Configuración → Tiendanube: conectar la tienda, traer los productos de la
// web, publicar los que faltan y sincronizar precio y stock (la app manda).
// Todo pasa por la Edge Function "tiendanube": el token de la tienda nunca
// llega al navegador.

type Opciones = { preciosConIva: boolean; redondear: boolean; sincronizarPrecio: boolean; sincronizarStock: boolean; auto: boolean }
const OPCIONES_DEF: Opciones = { preciosConIva: true, redondear: true, sincronizarPrecio: true, sincronizarStock: true, auto: true }
type Estado = { configurado: boolean; conectado: boolean; tienda: string | null; storeId: string | null; desde: string | null; log: { fecha: string; tipo: string; detalle: string | null; ok: boolean }[] }
type ProductoWeb = { product_id: number; variant_id: number; nombre: string; sku: string | null; precio: number; precio_promocional: number | null; stock: number | null; foto: string | null; descripcion: string; categoria: string | null; publicado: boolean }
type ProductoApp = { id: number; codigo: string | null; nombre: string; iva_pct: number; stock: number; precio_venta: number; foto_url: string | null; descripcion: string | null; tipo: string; activo: boolean; tn_variant_id: number | null; tn_sincronizar?: boolean }

async function llamar<T>(accion: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('tiendanube', { body: { accion, ...extra } })
  if (error) {
    let msg = error.message
    try { const ctx = (error as { context?: Response }).context; if (ctx) msg = (await ctx.json()).error ?? msg } catch { /* sin detalle */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}

const normal = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ')

export default function Tiendanube() {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [error, setError] = useState('')
  const [sinFuncion, setSinFuncion] = useState(false)
  const [opciones, setOpciones] = useState<Opciones>(OPCIONES_DEF)
  const [trabajando, setTrabajando] = useState('')
  const [aviso, setAviso] = useState(() => {
    const r = new URLSearchParams(window.location.search).get('tiendanube')
    return r === 'ok' ? '✓ Tienda conectada. Ahora traé los productos de la web.' : r === 'error' ? '⚠ No se pudo conectar la tienda. Probá de nuevo.' : ''
  })
  const [importando, setImportando] = useState(false)
  const [publicando, setPublicando] = useState(false)

  async function cargar() {
    setError('')
    try {
      setEstado(await llamar<Estado>('estado')); setSinFuncion(false)
    } catch (e) {
      const m = (e as Error).message
      if (/Failed to send|not found|404|FunctionsFetchError|FunctionsHttpError/i.test(m)) setSinFuncion(true)
      else setError(m)
    }
    const { data } = await supabase.from('configuracion').select('valor').eq('clave', 'tiendanube').maybeSingle()
    if (data?.valor) setOpciones({ ...OPCIONES_DEF, ...(data.valor as Partial<Opciones>) })
  }
  useEffect(() => {
    void cargar()
    // Limpia el ?tiendanube= que deja la vuelta desde Tiendanube.
    if (window.location.search.includes('tiendanube=')) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  async function guardarOpciones(o: Opciones) {
    setOpciones(o)
    const { error: e } = await supabase.from('configuracion').upsert({ clave: 'tiendanube', valor: o, updated_at: new Date().toISOString() })
    if (e) setError('No se pudieron guardar las opciones (falta el SQL de Configuración).')
  }

  async function conectar() {
    setTrabajando('conectar'); setError('')
    try {
      const { url } = await llamar<{ url: string }>('iniciar', { volver: window.location.origin })
      window.location.href = url
    } catch (e) { setError((e as Error).message); setTrabajando('') }
  }
  async function desconectar() {
    if (!window.confirm('¿Desconectar la tienda? La web deja de actualizarse sola. Los productos quedan como están (en la app y en la web).')) return
    setTrabajando('desconectar')
    try { await llamar('desconectar'); await cargar() } catch (e) { setError((e as Error).message) }
    setTrabajando('')
  }
  async function sincronizarAhora() {
    setTrabajando('sincronizar'); setError(''); setAviso('')
    try {
      const r = await llamar<{ actualizados: number; ventasWeb: string[]; quedan: number; errores: string[] }>('sincronizar')
      setAviso([`✓ ${r.actualizados} producto(s) actualizados en la web.`, r.ventasWeb.length ? `Ventas en la web descontadas del stock: ${r.ventasWeb.join(', ')}.` : '', r.quedan ? `Quedan ${r.quedan}: tocá "Sincronizar ahora" otra vez.` : '', r.errores.length ? `⚠ ${r.errores.join(' · ')}` : ''].filter(Boolean).join(' '))
      await cargar()
    } catch (e) { setError((e as Error).message) }
    setTrabajando('')
  }

  if (sinFuncion) return <GuiaInstalacion paso="funcion" />
  if (!estado) return error ? <p className="loginError">{error}</p> : <p>Revisando la conexión con Tiendanube…</p>
  if (!estado.configurado) return <GuiaInstalacion paso="secrets" />

  return <div className="tnWrap">
    {aviso && <p className="tnAviso" role="status">{aviso}</p>}
    {error && <p className="loginError">{error}</p>}

    <section className="tnCard">
      <div className="tnEstado">
        <span className={`tnPunto ${estado.conectado ? 'ok' : ''}`} />
        <div>
          <strong>{estado.conectado ? `Conectado a ${estado.tienda || 'tu tienda'}` : 'Tienda sin conectar'}</strong>
          <small>{estado.conectado ? `Tienda #${estado.storeId}${estado.desde ? ` · desde el ${fechaCorta(estado.desde)}` : ''}` : 'Conectá la tienda para que precios y stock se actualicen solos en la web.'}</small>
        </div>
        {estado.conectado
          ? <button type="button" className="deactivateButton" disabled={!!trabajando} onClick={() => void desconectar()}>Desconectar</button>
          : <button type="button" className="newButton" disabled={!!trabajando} onClick={() => void conectar()}>{trabajando === 'conectar' ? 'Abriendo Tiendanube…' : '🛒 Conectar con Tiendanube'}</button>}
      </div>
    </section>

    {estado.conectado && <>
      <section className="tnCard">
        <h3>Qué hacer</h3>
        <div className="tnAcciones">
          <button type="button" className="tnAccion" disabled={!!trabajando} onClick={() => setImportando(true)}>
            <b>⬇ Traer productos de la web</b><small>La primera vez: trae todos los productos (foto, SKU, precio, stock, descripción) y los vincula con los de la app.</small>
          </button>
          <button type="button" className="tnAccion" disabled={!!trabajando} onClick={() => void sincronizarAhora()}>
            <b>{trabajando === 'sincronizar' ? 'Sincronizando…' : '🔄 Sincronizar ahora'}</b><small>Publica en la web los precios y el stock de la app, y descuenta lo que se vendió por la web.{opciones.auto ? ' Igual se hace sola cada 15 minutos.' : ''}</small>
          </button>
          <button type="button" className="tnAccion" disabled={!!trabajando} onClick={() => setPublicando(true)}>
            <b>⬆ Subir productos a la web</b><small>Elegís cuáles de la app querés en la web. Nada se publica solo: los servicios y los productos que no subas quedan solo en la app.</small>
          </button>
        </div>
      </section>

      <section className="tnCard">
        <h3>Opciones</h3>
        <div className="tnOpciones">
          <label className="caCheck"><input type="checkbox" checked={opciones.sincronizarPrecio} onChange={(e) => void guardarOpciones({ ...opciones, sincronizarPrecio: e.target.checked })} /> Actualizar los <strong>precios</strong> de la web</label>
          <label className="caCheck"><input type="checkbox" checked={opciones.sincronizarStock} onChange={(e) => void guardarOpciones({ ...opciones, sincronizarStock: e.target.checked })} /> Actualizar el <strong>stock</strong> de la web (y descontar las ventas de la web)</label>
          <label className="caCheck"><input type="checkbox" checked={opciones.preciosConIva} onChange={(e) => void guardarOpciones({ ...opciones, preciosConIva: e.target.checked })} /> En la web los precios van <strong>con IVA incluido</strong> (precio de la app + IVA)</label>
          <label className="caCheck"><input type="checkbox" checked={opciones.redondear} onChange={(e) => void guardarOpciones({ ...opciones, redondear: e.target.checked })} /> Redondear los precios de la web (sin centavos)</label>
          <label className="caCheck"><input type="checkbox" checked={opciones.auto} onChange={(e) => void guardarOpciones({ ...opciones, auto: e.target.checked })} /> Sincronizar <strong>automáticamente</strong> cada 15 minutos</label>
        </div>
        <p className="gestionAyuda">La app manda: cambiás el precio, el stock o la cotización del dólar acá y la web se actualiza. Si un producto en la web no controla stock (stock ilimitado), no se toca. Nada se publica solo: un producto llega a la web solo si lo subís (acá o con "Publicar en la web" en su ficha). Para que uno ya publicado no se actualice, destildá "Sincronizar" en su ficha.</p>
      </section>

      <section className="tnCard">
        <h3>Últimos movimientos</h3>
        {estado.log.length === 0 ? <p className="agVacio">Todavía no hubo sincronizaciones.</p> : estado.log.map((l, i) => (
          <div key={i} className={`tnLog ${l.ok ? '' : 'error'}`}><span>{new Date(l.fecha).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><p>{l.detalle}</p></div>
        ))}
      </section>
    </>}

    {importando && <ImportarDeWeb opciones={opciones} onCerrar={(msg) => { setImportando(false); if (msg) { setAviso(msg); void cargar() } }} />}
    {publicando && <SubirAWeb onCerrar={(msg) => { setPublicando(false); if (msg) { setAviso(msg); void cargar() } }} />}
  </div>
}

// ---------- Traer productos de la web ----------
type Fila = { web: ProductoWeb; app: ProductoApp | null; como: 'vinculado' | 'sku' | 'nombre' | 'nuevo' }

function ImportarDeWeb({ opciones, onCerrar }: { opciones: Opciones; onCerrar: (msg?: string) => void }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState('')
  const [traerPrecioStock, setTraerPrecioStock] = useState(true)
  const [completar, setCompletar] = useState(true)
  const [soloPublicados, setSoloPublicados] = useState(false)
  const [iva, setIva] = useState('21')
  const [trabajando, setTrabajando] = useState(false)
  const [progreso, setProgreso] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [{ productos }, rApp] = await Promise.all([
          llamar<{ productos: ProductoWeb[] }>('leer_productos'),
          supabase.from('productos_servicios').select('id, codigo, nombre, iva_pct, stock, precio_venta, foto_url, descripcion, tipo, activo, tn_variant_id'),
        ])
        if (rApp.error) throw new Error('Falta correr el SQL de Tiendanube (fase 19) en Supabase.')
        const app = (rApp.data ?? []) as ProductoApp[]
        const usados = new Set<number>()
        const res = productos.map((web): Fila => {
          let p = app.find((a) => a.tn_variant_id === web.variant_id)
          if (p) { usados.add(p.id); return { web, app: p, como: 'vinculado' } }
          p = web.sku ? app.find((a) => !usados.has(a.id) && !a.tn_variant_id && normal(a.codigo) === normal(web.sku)) : undefined
          if (p) { usados.add(p.id); return { web, app: p, como: 'sku' } }
          p = app.find((a) => !usados.has(a.id) && !a.tn_variant_id && normal(a.nombre) === normal(web.nombre))
          if (p) { usados.add(p.id); return { web, app: p, como: 'nombre' } }
          return { web, app: null, como: 'nuevo' }
        })
        setFilas(res)
      } catch (e) { setError((e as Error).message) }
    })()
  }, [])

  const visibles = useMemo(() => (filas ?? []).filter((f) => !soloPublicados || f.web.publicado), [filas, soloPublicados])
  const cuenta = (c: Fila['como'] | 'vincular') => visibles.filter((f) => (c === 'vincular' ? f.como === 'sku' || f.como === 'nombre' : f.como === c)).length
  const factorIva = opciones.preciosConIva ? 1 + (Number(iva) || 0) / 100 : 1
  const sinIva = (precio: number) => Math.round((precio / factorIva) * 100) / 100

  async function importar() {
    setTrabajando(true); setError('')
    const ahora = new Date().toISOString()
    const vinculo = (w: ProductoWeb) => ({ tn_product_id: w.product_id, tn_variant_id: w.variant_id, tn_sincronizar: true, tn_precio_publicado: w.precio, tn_stock_publicado: w.stock, tn_sincronizado_at: ahora })
    try {
      // Nuevos: se crean en tandas.
      const nuevos = visibles.filter((f) => f.como === 'nuevo').map((f) => ({
        tipo: 'producto', nombre: f.web.nombre.slice(0, 200), codigo: f.web.sku, descripcion: f.web.descripcion || null,
        categoria: f.web.categoria, unidad: 'unidad', precio_venta: sinIva(f.web.precio), costo_unitario: 0,
        stock: f.web.stock ?? 0, stock_minimo: 1, iva_pct: Number(iva) || 21, foto_url: f.web.foto, link_compra: null, proveedor: null,
        aplica_descuento: false, descuento_pct: 0, descuento_monto: 0, activo: true, ...vinculo(f.web),
      }))
      for (let i = 0; i < nuevos.length; i += 100) {
        setProgreso(`Creando productos ${i + 1}–${Math.min(i + 100, nuevos.length)} de ${nuevos.length}…`)
        const { error: e } = await supabase.from('productos_servicios').insert(nuevos.slice(i, i + 100))
        if (e) throw e
      }
      // Existentes: se vinculan (y opcionalmente toman precio, stock, foto y descripción de la web).
      const existentes = visibles.filter((f) => f.app)
      let hechos = 0
      let cursor = 0
      const trabajador = async () => {
        while (cursor < existentes.length) {
          const f = existentes[cursor++]
          const cambios: Record<string, unknown> = { ...vinculo(f.web) }
          if (traerPrecioStock) { cambios.precio_venta = sinIva(f.web.precio); if (f.web.stock != null) cambios.stock = f.web.stock }
          if (completar) { if (!f.app!.foto_url && f.web.foto) cambios.foto_url = f.web.foto; if (!f.app!.descripcion && f.web.descripcion) cambios.descripcion = f.web.descripcion }
          const { error: e } = await supabase.from('productos_servicios').update(cambios).eq('id', f.app!.id)
          if (e) throw e
          hechos++
          if (hechos % 10 === 0) setProgreso(`Vinculando ${hechos} de ${existentes.length}…`)
        }
      }
      await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()])
      onCerrar(`✓ Listo: ${nuevos.length} producto(s) nuevos y ${existentes.length} vinculados con la web. Completá el precio de compra (o el % de ganancia) de los nuevos en Productos y servicios.`)
    } catch (e) {
      console.error(e)
      setError(`Se cortó a mitad de camino: ${(e as Error).message}. Podés volver a correrlo: lo que ya quedó vinculado no se duplica.`)
      setTrabajando(false)
    }
  }

  return <div className="modalOverlay"><div className="modalCard tnModal">
    <div className="modalHeader"><div><p className="subtitle">TIENDANUBE</p><h2>⬇ Traer productos de la web</h2></div><button className="closeButton" disabled={trabajando} onClick={() => onCerrar()}>×</button></div>
    <div className="clienteForm">
      {!filas && !error && <p>Leyendo los productos de la tienda…</p>}
      {error && <p className="loginError">{error}</p>}
      {filas && <>
        <div className="tnResumen">
          <div><strong>{cuenta('nuevo')}</strong><span>nuevos</span></div>
          <div><strong>{cuenta('vincular')}</strong><span>ya están en la app (se vinculan)</span></div>
          <div><strong>{cuenta('vinculado')}</strong><span>ya vinculados</span></div>
        </div>
        <div className="tnOpciones">
          <label className="caCheck"><input type="checkbox" checked={soloPublicados} onChange={(e) => setSoloPublicados(e.target.checked)} /> Traer solo los productos <strong>publicados</strong> en la web</label>
          <label className="caCheck"><input type="checkbox" checked={traerPrecioStock} onChange={(e) => setTraerPrecioStock(e.target.checked)} /> A los que ya están en la app, <strong>traerles el precio y el stock de la web</strong> (si lo destildás, se publican los de la app)</label>
          <label className="caCheck"><input type="checkbox" checked={completar} onChange={(e) => setCompletar(e.target.checked)} /> Completar foto y descripción si en la app están vacías</label>
          {opciones.preciosConIva && <label className="tnIva">Los precios de la web incluyen IVA del <input type="number" min="0" max="50" value={iva} onChange={(e) => setIva(e.target.value)} />% → en la app se guardan sin IVA</label>}
        </div>
        <div className="tnLista">
          {visibles.slice(0, 300).map((f) => (
            <div key={f.web.variant_id} className="tnFila">
              {f.web.foto ? <img src={f.web.foto} alt="" loading="lazy" /> : <span className="tnSinFoto">📦</span>}
              <div><strong>{f.web.nombre}</strong><small>{[f.web.sku && `SKU ${f.web.sku}`, f.web.categoria, f.web.publicado ? null : 'oculto en la web'].filter(Boolean).join(' · ')}</small></div>
              <span className="tnPrecio">{moneda(f.web.precio)}<small>{f.web.stock == null ? 'stock ilimitado' : `stock ${f.web.stock}`}</small></span>
              <em className={`tnComo ${f.como}`}>{f.como === 'nuevo' ? 'Nuevo' : f.como === 'vinculado' ? 'Ya vinculado' : `= ${f.app?.nombre}`}</em>
            </div>
          ))}
          {visibles.length > 300 && <p className="gestionAyuda">…y {visibles.length - 300} más.</p>}
        </div>
        {progreso && trabajando && <p role="status">{progreso}</p>}
        <div className="formActions">
          <button type="button" className="cancelButton" disabled={trabajando} onClick={() => onCerrar()}>Cancelar</button>
          <button type="button" className="newButton" disabled={trabajando || visibles.length === 0} onClick={() => void importar()}>{trabajando ? 'Importando…' : `Importar ${visibles.length} producto(s)`}</button>
        </div>
      </>}
    </div>
  </div></div>
}

// ---------- Subir productos de la app a la web ----------
function SubirAWeb({ onCerrar }: { onCerrar: (msg?: string) => void }) {
  const [lista, setLista] = useState<ProductoApp[] | null>(null)
  const [elegidos, setElegidos] = useState<Set<number>>(new Set())
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void supabase.from('productos_servicios').select('id, codigo, nombre, iva_pct, stock, precio_venta, foto_url, descripcion, tipo, activo, tn_variant_id')
      .is('tn_variant_id', null).eq('activo', true).eq('tipo', 'producto').order('nombre')
      .then(({ data, error: e }) => { if (e) setError('Falta correr el SQL de Tiendanube (fase 19).'); else setLista((data ?? []) as ProductoApp[]) })
  }, [])
  function tildar(id: number) { setElegidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < 30) n.add(id); return n }) }
  async function subir() {
    setTrabajando(true); setError('')
    try {
      const r = await llamar<{ creados: string[]; errores: string[] }>('crear', { productos: Array.from(elegidos) })
      onCerrar(`✓ ${r.creados.length} producto(s) creados en Tiendanube, sin publicar: revisalos y publicalos desde el panel de la tienda.${r.errores.length ? ` ⚠ No se pudieron crear: ${r.errores.join(', ')}` : ''}`)
    } catch (e) { setError((e as Error).message); setTrabajando(false) }
  }
  return <div className="modalOverlay"><div className="modalCard tnModal">
    <div className="modalHeader"><div><p className="subtitle">TIENDANUBE</p><h2>⬆ Subir productos a la web</h2></div><button className="closeButton" disabled={trabajando} onClick={() => onCerrar()}>×</button></div>
    <div className="clienteForm">
      <p className="gestionAyuda">Productos activos de la app que no están en la web. Se crean con nombre, SKU, precio, stock y foto, <strong>sin publicar</strong>, para que les agregues la descripción y las categorías en Tiendanube. Hasta 30 por vez.</p>
      {error && <p className="loginError">{error}</p>}
      {!lista && !error && <p>Cargando…</p>}
      {lista && (lista.length === 0 ? <p className="agVacio">Todos los productos activos ya están en la web.</p> : <div className="tnLista">
        {lista.map((p) => (
          <label key={p.id} className="tnFila tnElegir"><input type="checkbox" checked={elegidos.has(p.id)} onChange={() => tildar(p.id)} />
            <div><strong>{p.nombre}</strong><small>{p.codigo ? `SKU ${p.codigo} · ` : ''}stock {p.stock}</small></div>
            <span className="tnPrecio">{moneda(p.precio_venta)}<small>sin IVA</small></span>
          </label>
        ))}
      </div>)}
      <div className="formActions">
        <button type="button" className="cancelButton" disabled={trabajando} onClick={() => onCerrar()}>Cancelar</button>
        <button type="button" className="newButton" disabled={trabajando || elegidos.size === 0} onClick={() => void subir()}>{trabajando ? 'Subiendo…' : `Subir ${elegidos.size} a la web`}</button>
      </div>
    </div>
  </div></div>
}

// ---------- Guía de instalación (una sola vez) ----------
function GuiaInstalacion({ paso }: { paso: 'funcion' | 'secrets' }) {
  const callback = 'https://aceukzftfkjhmponaktd.supabase.co/functions/v1/tiendanube'
  return <section className="tnCard tnGuia">
    <h3>🛒 Conectar con Tiendanube — puesta en marcha (una sola vez)</h3>
    <p className="gestionAyuda">{paso === 'funcion' ? 'Todavía no está instalada la función "tiendanube" en Supabase.' : 'La función está instalada, pero faltan las claves de la app de Tiendanube.'} Estos son los pasos:</p>
    <ol>
      <li><strong>SQL:</strong> en Supabase → SQL Editor, correr <code>supabase-tiendanube-fase-19.sql</code>.</li>
      <li><strong>App en Tiendanube:</strong> entrá a <a href="https://partners.tiendanube.com" target="_blank" rel="noreferrer">partners.tiendanube.com</a> (con tu cuenta), creá una aplicación "MOVA Gestión" con permisos de <em>Productos: leer y escribir</em> y como URL de redirección: <code>{callback}</code></li>
      <li><strong>Secrets en Supabase</strong> (Edge Functions → Secrets): <code>TIENDANUBE_CLIENT_ID</code> y <code>TIENDANUBE_CLIENT_SECRET</code> con los datos de esa aplicación. No los pegues en ningún chat.</li>
      <li><strong>Función:</strong> Supabase → Edge Functions → nueva función <code>tiendanube</code> → pegar <code>supabase/functions/tiendanube/index.ts</code> → <em>desactivar "Verify JWT"</em> → Deploy.</li>
      <li>Volvé a esta pantalla y tocá <strong>Conectar con Tiendanube</strong>.</li>
      <li><strong>Automático:</strong> correr <code>supabase-cron-tiendanube.sql</code> (con tu CRON_SECRET) para que sincronice cada 15 minutos.</li>
    </ol>
  </section>
}
