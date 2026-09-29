// Supabase Edge Function: tiendanube
// Conecta MOVA Gestión con la tienda de Tiendanube (www.movaelectronica.com.ar).
//
//  · La app manda: precio y stock se modifican en MOVA y se publican en la web.
//  · Si en la web se vendió algo (el stock de la web bajó respecto de lo último
//    que publicamos), se descuenta del stock de la app antes de publicar.
//  · El token de la tienda se guarda en la tabla "integraciones" (sin acceso
//    desde la app: solo esta función, con la service_role, lo puede leer).
//
// Desplegar con "Verify JWT" DESACTIVADO (Tiendanube vuelve a esta función
// después de autorizar, sin sesión). La función controla sola quién la usa:
//   · acciones de la app  -> usuario administrador activo (token de sesión)
//   · sincronizar por cron -> header x-cron-secret = CRON_SECRET
//   · vuelta de Tiendanube -> parámetro "state" generado por "iniciar"
//
// Secrets: TIENDANUBE_CLIENT_ID, TIENDANUBE_CLIENT_SECRET, CRON_SECRET
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const API = 'https://api.tiendanube.com/v1'
const USER_AGENT = 'MOVA Gestion (https://www.movaelectronica.com.ar)'
const MAX_ACTUALIZACIONES = 80 // por corrida (la API permite ~2 por segundo)
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Conexion = { access_token: string; store_id: string; conectado_at: string; tienda?: string }
type Opciones = { preciosConIva: boolean; redondear: boolean; sincronizarPrecio: boolean; sincronizarStock: boolean; auto: boolean }
const OPCIONES_DEF: Opciones = { preciosConIva: true, redondear: true, sincronizarPrecio: true, sincronizarStock: true, auto: true }

type VarianteTN = { id: number; product_id: number; price: string | null; promotional_price: string | null; stock: number | null; stock_management: boolean; sku: string | null; values?: { es?: string }[] }
type ProductoTN = { id: number; name: Record<string, string>; description?: Record<string, string>; published: boolean; variants: VarianteTN[]; images: { src: string; position: number }[]; categories?: { name: Record<string, string> }[] }

const texto = (m?: Record<string, string>) => (m ? m.es ?? Object.values(m)[0] ?? '' : '')
const sinHtml = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim()
const num = (x: unknown) => Number(x) || 0

async function tn(con: Conexion, ruta: string, init: RequestInit = {}) {
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch(`${API}/${con.store_id}${ruta}`, {
      ...init,
      headers: { 'Authentication': `bearer ${con.access_token}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    if (r.status === 429) { await esperar(1500 * (intento + 1)); continue } // límite de la API: esperar y reintentar
    if (r.status === 404 && init.method === undefined && ruta.startsWith('/products?')) return { ok: true, datos: [] } // sin más páginas
    const cuerpo = await r.text()
    let datos: unknown = null
    try { datos = cuerpo ? JSON.parse(cuerpo) : null } catch { datos = cuerpo }
    return { ok: r.ok, status: r.status, datos }
  }
  return { ok: false, status: 429, datos: 'Demasiados pedidos seguidos a Tiendanube.' }
}

async function todosLosProductos(con: Conexion): Promise<ProductoTN[]> {
  const lista: ProductoTN[] = []
  for (let pagina = 1; pagina <= 50; pagina++) {
    const r = await tn(con, `/products?per_page=200&page=${pagina}`)
    if (!r.ok) throw new Error(`Tiendanube respondió ${r.status}: ${typeof r.datos === 'string' ? r.datos : JSON.stringify(r.datos)}`)
    const parte = (r.datos ?? []) as ProductoTN[]
    lista.push(...parte)
    if (parte.length < 200) break
  }
  return lista
}

async function leerConexion(db: SupabaseClient): Promise<Conexion | null> {
  const { data } = await db.from('integraciones').select('datos').eq('proveedor', 'tiendanube').maybeSingle()
  const d = data?.datos as Conexion | undefined
  return d?.access_token && d?.store_id ? d : null
}
async function leerOpciones(db: SupabaseClient): Promise<Opciones> {
  const { data } = await db.from('configuracion').select('valor').eq('clave', 'tiendanube').maybeSingle()
  return { ...OPCIONES_DEF, ...((data?.valor as Partial<Opciones>) ?? {}) }
}
async function registrar(db: SupabaseClient, tipo: string, detalle: string, ok = true) {
  await db.from('tiendanube_log').insert({ tipo, detalle: detalle.slice(0, 2000), ok })
}

// Precio que se publica en la web a partir del producto de la app.
function precioWeb(p: { precio_venta: number; aplica_descuento: boolean; descuento_pct: number; descuento_monto: number; iva_pct: number }, o: Opciones) {
  let final = num(p.precio_venta)
  if (p.aplica_descuento) {
    if (num(p.descuento_pct) > 0) final = final * (1 - num(p.descuento_pct) / 100)
    else if (num(p.descuento_monto) > 0) final = final - num(p.descuento_monto)
  }
  if (o.preciosConIva) final = final * (1 + num(p.iva_pct ?? 21) / 100)
  final = Math.max(0, final)
  return o.redondear ? Math.round(final) : Math.round(final * 100) / 100
}

async function sincronizar(db: SupabaseClient, con: Conexion, soloIds?: number[]) {
  const o = await leerOpciones(db)
  let consulta = db.from('productos_servicios')
    .select('id, nombre, tipo, stock, precio_venta, aplica_descuento, descuento_pct, descuento_monto, iva_pct, tn_product_id, tn_variant_id, tn_precio_publicado, tn_stock_publicado')
    .not('tn_variant_id', 'is', null).eq('tn_sincronizar', true).eq('activo', true)
  if (soloIds?.length) consulta = consulta.in('id', soloIds)
  const { data: productos, error } = await consulta
  if (error) throw error
  if (!productos?.length) return { actualizados: 0, ventasWeb: [], quedan: 0, errores: [] as string[] }

  const web = await todosLosProductos(con)
  const variantes = new Map<number, VarianteTN>()
  web.forEach((p) => p.variants.forEach((v) => variantes.set(v.id, v)))

  const ventasWeb: string[] = []
  const errores: string[] = []
  let actualizados = 0
  let quedan = 0
  for (const p of productos) {
    const v = variantes.get(Number(p.tn_variant_id))
    if (!v) { errores.push(`${p.nombre}: ya no existe en la web (se desvinculó).`); await db.from('productos_servicios').update({ tn_product_id: null, tn_variant_id: null }).eq('id', p.id); continue }

    let stockApp = num(p.stock)
    const esProducto = p.tipo === 'producto'
    // 1) Ventas en la web: el stock de la web bajó desde la última publicación.
    if (o.sincronizarStock && esProducto && v.stock != null && p.tn_stock_publicado != null && v.stock < num(p.tn_stock_publicado)) {
      const vendidas = num(p.tn_stock_publicado) - v.stock
      stockApp = Math.max(0, stockApp - vendidas)
      await db.from('productos_servicios').update({ stock: stockApp, tn_stock_publicado: v.stock }).eq('id', p.id)
      ventasWeb.push(`${p.nombre}: ${vendidas} vendida(s) en la web`)
    }

    // 2) Publicar lo que cambió en la app.
    const cambios: Record<string, unknown> = {}
    const precio = precioWeb(p, o)
    if (o.sincronizarPrecio && precio > 0 && Math.abs(precio - num(v.price)) >= 0.5) cambios.price = precio
    const stockWeb = Math.max(0, Math.floor(stockApp))
    // Si en la web el producto no controla stock (stock ilimitado), se respeta.
    if (o.sincronizarStock && esProducto && v.stock != null && v.stock !== stockWeb) cambios.stock = stockWeb
    if (Object.keys(cambios).length === 0) {
      await db.from('productos_servicios').update({ tn_precio_publicado: num(v.price), tn_stock_publicado: v.stock, tn_sincronizado_at: new Date().toISOString() }).eq('id', p.id)
      continue
    }
    if (actualizados >= MAX_ACTUALIZACIONES) { quedan++; continue }
    const r = await tn(con, `/products/${v.product_id}/variants/${v.id}`, { method: 'PUT', body: JSON.stringify(cambios) })
    if (!r.ok) { errores.push(`${p.nombre}: la web respondió ${r.status}`); continue }
    actualizados++
    await db.from('productos_servicios').update({
      tn_precio_publicado: cambios.price ?? num(v.price), tn_stock_publicado: cambios.stock ?? v.stock, tn_sincronizado_at: new Date().toISOString(),
    }).eq('id', p.id)
    await esperar(450)
  }
  const resumen = [`${actualizados} producto(s) actualizados en la web`, ...ventasWeb, ...errores].join(' · ')
  if (actualizados || ventasWeb.length || errores.length) await registrar(db, 'sincronizar', resumen, errores.length === 0)
  return { actualizados, ventasWeb, quedan, errores }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const url = new URL(req.url)

  // ---- Vuelta de Tiendanube después de autorizar (GET ?code=&state=) ----
  if (req.method === 'GET') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const { data: pendiente } = await db.from('integraciones').select('datos').eq('proveedor', 'tiendanube_estado').maybeSingle()
    const esperado = pendiente?.datos as { nonce?: string; volver?: string; creado?: string } | undefined
    const volver = esperado?.volver || 'https://www.movaelectronica.com.ar'
    const irA = (resultado: string) => Response.redirect(`${volver}${volver.includes('?') ? '&' : '?'}tiendanube=${resultado}`, 302)
    if (!code || !esperado?.nonce || state !== esperado.nonce || Date.now() - new Date(esperado.creado ?? 0).getTime() > 30 * 60 * 1000) return irA('error')
    const r = await fetch('https://www.tiendanube.com/apps/authorize/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: Deno.env.get('TIENDANUBE_CLIENT_ID'), client_secret: Deno.env.get('TIENDANUBE_CLIENT_SECRET'), grant_type: 'authorization_code', code }),
    })
    const t = await r.json().catch(() => ({}))
    if (!r.ok || !t.access_token || !t.user_id) { await registrar(db, 'conectar', `No se pudo obtener el acceso: ${JSON.stringify(t).slice(0, 300)}`, false); return irA('error') }
    const con: Conexion = { access_token: t.access_token, store_id: String(t.user_id), conectado_at: new Date().toISOString() }
    const tienda = await tn(con, '/store')
    if (tienda.ok) con.tienda = texto((tienda.datos as { name?: Record<string, string> })?.name)
    await db.from('integraciones').upsert({ proveedor: 'tiendanube', datos: con, actualizado_at: new Date().toISOString() })
    await db.from('integraciones').delete().eq('proveedor', 'tiendanube_estado')
    await registrar(db, 'conectar', `Tienda conectada: ${con.tienda ?? con.store_id}`)
    return irA('ok')
  }
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405)

  const cuerpo = await req.json().catch(() => ({})) as { accion?: string; volver?: string; ids?: number[]; productos?: number[] }

  // ---- Cron: sincronización automática ----
  const secretoCron = Deno.env.get('CRON_SECRET')
  if (secretoCron && req.headers.get('x-cron-secret') === secretoCron) {
    const con = await leerConexion(db)
    if (!con) return responder({ ok: true, omitido: 'Tiendanube no está conectado' })
    if (!(await leerOpciones(db)).auto) return responder({ ok: true, omitido: 'Sincronización automática apagada' })
    try { return responder({ ok: true, ...(await sincronizar(db, con)) }) } catch (e) { await registrar(db, 'sincronizar', `Error: ${(e as Error).message}`, false); return responder({ error: (e as Error).message }, 500) }
  }

  // ---- Acciones desde la app: solo administradores activos ----
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: quien } = await db.auth.getUser(token)
  if (!quien?.user) return responder({ error: 'No autorizado' }, 401)
  const { data: perfil } = await db.from('profiles').select('rol, activo').eq('id', quien.user.id).maybeSingle()
  if (!perfil || perfil.rol !== 'admin' || perfil.activo === false) return responder({ error: 'Solo un administrador puede usar la conexión con Tiendanube.' }, 403)

  const con = await leerConexion(db)
  try {
    switch (cuerpo.accion) {
      case 'estado': {
        const { data: log } = await db.from('tiendanube_log').select('fecha, tipo, detalle, ok').order('fecha', { ascending: false }).limit(10)
        return responder({ configurado: !!Deno.env.get('TIENDANUBE_CLIENT_ID') && !!Deno.env.get('TIENDANUBE_CLIENT_SECRET'), conectado: !!con, tienda: con?.tienda ?? null, storeId: con?.store_id ?? null, desde: con?.conectado_at ?? null, log: log ?? [] })
      }
      case 'iniciar': {
        const clientId = Deno.env.get('TIENDANUBE_CLIENT_ID')
        if (!clientId || !Deno.env.get('TIENDANUBE_CLIENT_SECRET')) return responder({ error: 'Faltan los secrets TIENDANUBE_CLIENT_ID y TIENDANUBE_CLIENT_SECRET en Supabase.' }, 400)
        const nonce = crypto.randomUUID()
        const volver = typeof cuerpo.volver === 'string' && /^https:\/\//.test(cuerpo.volver) ? cuerpo.volver : ''
        await db.from('integraciones').upsert({ proveedor: 'tiendanube_estado', datos: { nonce, volver, creado: new Date().toISOString() }, actualizado_at: new Date().toISOString() })
        return responder({ url: `https://www.tiendanube.com/apps/${clientId}/authorize?state=${nonce}` })
      }
      case 'desconectar': {
        await db.from('integraciones').delete().eq('proveedor', 'tiendanube')
        await registrar(db, 'conectar', 'Tienda desconectada desde la app')
        return responder({ ok: true })
      }
      case 'leer_productos': {
        if (!con) return responder({ error: 'Tiendanube no está conectado.' }, 400)
        const productos = await todosLosProductos(con)
        return responder({
          productos: productos.flatMap((p) => p.variants.map((v) => {
            const variante = (v.values ?? []).map((x) => x.es).filter(Boolean).join(' / ')
            return {
              product_id: p.id, variant_id: v.id,
              nombre: texto(p.name) + (variante ? ` (${variante})` : ''),
              sku: v.sku || null, precio: num(v.price), precio_promocional: v.promotional_price ? num(v.promotional_price) : null,
              stock: v.stock_management ? v.stock : null,
              foto: [...(p.images ?? [])].sort((a, b) => a.position - b.position)[0]?.src ?? null,
              descripcion: sinHtml(texto(p.description)).slice(0, 4000),
              categoria: texto(p.categories?.[0]?.name) || null,
              publicado: p.published,
            }
          })),
        })
      }
      case 'crear': {
        // Publica en la web productos de la app que todavía no están.
        if (!con) return responder({ error: 'Tiendanube no está conectado.' }, 400)
        const ids = (cuerpo.productos ?? []).map(Number).filter(Boolean).slice(0, 30)
        const o = await leerOpciones(db)
        const { data: lista } = await db.from('productos_servicios').select('id, nombre, nombre_presupuesto, codigo, descripcion, stock, tipo, precio_venta, aplica_descuento, descuento_pct, descuento_monto, iva_pct, foto_url').in('id', ids).is('tn_variant_id', null)
        const creados: string[] = []; const errores: string[] = []
        for (const p of lista ?? []) {
          let foto: string | null = null
          if (p.foto_url) foto = /^https?:\/\//.test(p.foto_url) ? p.foto_url : (await db.storage.from('productos').createSignedUrl(p.foto_url, 3600)).data?.signedUrl ?? null
          const precio = precioWeb(p, o)
          const r = await tn(con, '/products', { method: 'POST', body: JSON.stringify({
            name: { es: p.nombre }, published: false,
            variants: [{ price: precio, sku: p.codigo || undefined, stock: p.tipo === 'producto' ? Math.max(0, Math.floor(num(p.stock))) : null }],
            ...(foto ? { images: [{ src: foto }] } : {}),
          }) })
          if (!r.ok) { errores.push(`${p.nombre}: ${r.status}`); continue }
          const nuevo = r.datos as ProductoTN
          const v = nuevo.variants?.[0]
          await db.from('productos_servicios').update({ tn_product_id: nuevo.id, tn_variant_id: v?.id ?? null, tn_sincronizar: true, tn_precio_publicado: precio, tn_stock_publicado: v?.stock ?? null, tn_sincronizado_at: new Date().toISOString() }).eq('id', p.id)
          creados.push(p.nombre)
          await esperar(500)
        }
        await registrar(db, 'crear', `${creados.length} producto(s) creados en la web (sin publicar, revisalos en Tiendanube)${errores.length ? ` · errores: ${errores.join(', ')}` : ''}`, errores.length === 0)
        return responder({ creados, errores })
      }
      case 'sincronizar': {
        if (!con) return responder({ error: 'Tiendanube no está conectado.' }, 400)
        return responder({ ok: true, ...(await sincronizar(db, con, cuerpo.ids)) })
      }
      default:
        return responder({ error: 'Acción desconocida' }, 400)
    }
  } catch (e) {
    await registrar(db, cuerpo.accion ?? 'error', `Error: ${(e as Error).message}`, false)
    return responder({ error: (e as Error).message }, 500)
  }
})
