// Supabase Edge Function: respaldo-semanal
// Respaldo automático de MOVA Gestión (plan gratuito: Supabase no hace backups).
//  · accion 'respaldar' (cron semanal o un administrador desde la app): lee todas
//    las tablas y guarda un JSON en el bucket privado "respaldos" (se conservan los
//    últimos 12). Si el bucket no existe, lo crea.
//  · accion 'listar' (administrador): los respaldos guardados, con link de descarga.
//  · accion 'archivos' (administrador): todas las fotos y archivos (comprobantes,
//    obras, productos…) con link de descarga, para bajarlos en un ZIP desde la app.
// Secrets: CRON_SECRET (el mismo de los recordatorios).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const responder = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const BUCKET = 'respaldos'
const GUARDAR = 12
const TABLAS = [
  'Clientes', 'obras', 'presupuestos', 'presupuesto_items', 'presupuesto_notas', 'adicionales', 'pagos', 'pago_links', 'pago_comprobantes', 'comprobantes',
  'costos', 'materiales', 'gastos_generales', 'gastos_personales', 'categorias_gasto', 'personal', 'obra_asignaciones', 'jornales', 'obra_avances',
  'obra_imagenes', 'obra_accesos', 'productos_servicios', 'productos_precios_historial', 'soluciones', 'relevamientos', 'relevamiento_items',
  'relevamiento_fotos', 'recordatorios', 'configuracion', 'profiles', 'log_auditoria',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // ¿Quién llama? El cron (con el secreto) o un administrador activo.
  const esCron = !!Deno.env.get('CRON_SECRET') && req.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET')
  if (!esCron) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: quien } = await admin.auth.getUser(token)
    if (!quien?.user) return responder({ error: 'No autorizado' }, 401)
    const { data: perfil } = await admin.from('profiles').select('rol, activo').eq('id', quien.user.id).maybeSingle()
    if (!perfil || perfil.rol !== 'admin' || perfil.activo === false) return responder({ error: 'Solo un administrador puede ver los respaldos.' }, 403)
  }
  const { accion = 'respaldar' } = await req.json().catch(() => ({})) as { accion?: string }

  // El bucket privado de los respaldos (se crea la primera vez).
  const { data: buckets } = await admin.storage.listBuckets()
  if (!buckets?.some((b) => b.name === BUCKET)) await admin.storage.createBucket(BUCKET, { public: false })

  if (accion === 'respaldar') {
    const datos: Record<string, unknown[]> = {}
    const conteo: Record<string, number> = {}
    for (const tabla of TABLAS) {
      const filas: unknown[] = []
      let ok = true
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await admin.from(tabla).select('*').range(desde, desde + 999)
        if (error) { ok = false; break }
        filas.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }
      if (ok) { datos[tabla] = filas; conteo[tabla] = filas.length }
    }
    const fecha = new Date().toISOString().slice(0, 10)
    const archivo = `datos/MOVA-respaldo-${fecha}.json`
    const contenido = JSON.stringify({ sistema: 'MOVA Gestión', fecha: new Date().toISOString(), tablas: conteo, datos })
    const { error } = await admin.storage.from(BUCKET).upload(archivo, new Blob([contenido], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })
    if (error) return responder({ error: `No se pudo guardar el respaldo: ${error.message}` }, 500)
    // Se conservan los últimos 12 (unos 3 meses).
    const { data: lista } = await admin.storage.from(BUCKET).list('datos', { limit: 1000, sortBy: { column: 'name', order: 'desc' } })
    const viejos = (lista ?? []).filter((f) => f.name.endsWith('.json')).slice(GUARDAR).map((f) => `datos/${f.name}`)
    if (viejos.length) await admin.storage.from(BUCKET).remove(viejos)
    return responder({ ok: true, archivo, tablas: conteo, bytes: contenido.length })
  }

  if (accion === 'listar') {
    const { data: lista } = await admin.storage.from(BUCKET).list('datos', { limit: 100, sortBy: { column: 'name', order: 'desc' } })
    const archivos = (lista ?? []).filter((f) => f.name.endsWith('.json'))
    const { data: urls } = archivos.length ? await admin.storage.from(BUCKET).createSignedUrls(archivos.map((f) => `datos/${f.name}`), 3600, { download: true }) : { data: [] }
    return responder({ respaldos: archivos.map((f, i) => ({ nombre: f.name, bytes: (f.metadata as { size?: number } | null)?.size ?? null, fecha: f.created_at, url: urls?.[i]?.signedUrl ?? null })) })
  }

  if (accion === 'archivos') {
    // Todos los archivos de todos los buckets (menos los respaldos), recorriendo las carpetas.
    const salida: { bucket: string; ruta: string; url: string | null }[] = []
    for (const b of buckets ?? []) {
      if (b.name === BUCKET) continue
      const rutas: string[] = []
      const recorrer = async (carpeta: string) => {
        for (let desde = 0; ; desde += 1000) {
          const { data } = await admin.storage.from(b.name).list(carpeta, { limit: 1000, offset: desde })
          for (const e of data ?? []) {
            const ruta = carpeta ? `${carpeta}/${e.name}` : e.name
            if (e.id == null) await recorrer(ruta) // es una carpeta
            else if (e.name !== '.emptyFolderPlaceholder') rutas.push(ruta)
          }
          if (!data || data.length < 1000) break
        }
      }
      await recorrer('')
      for (let i = 0; i < rutas.length; i += 100) {
        const tanda = rutas.slice(i, i + 100)
        const { data: urls } = await admin.storage.from(b.name).createSignedUrls(tanda, 3600)
        tanda.forEach((ruta, j) => salida.push({ bucket: b.name, ruta, url: urls?.[j]?.signedUrl ?? null }))
      }
    }
    return responder({ archivos: salida })
  }

  return responder({ error: 'Acción desconocida' }, 400)
})
