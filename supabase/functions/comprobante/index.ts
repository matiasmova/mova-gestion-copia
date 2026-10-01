// Supabase Edge Function: comprobante
// Link permanente para que el cliente descargue el comprobante de un gasto
// extra desde el botón del PDF.
//   · GET  ?g=<id del gasto>&t=<firma>  → redirige al archivo actual (link
//     temporal de 5 minutos). No vence: si el comprobante se cambia, baja el
//     nuevo; si se quitó, muestra un aviso.
//   · POST { ids: [...] } (usuario de la app) → devuelve los links firmados.
// La firma (HMAC) hace que cada link sirva solo para su gasto. Desplegar con
// "Verify JWT" apagado: el cliente abre el link sin iniciar sesión.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Clave para firmar: un secret propio si existe; si no, la service role (nunca sale del servidor).
const CLAVE = Deno.env.get('COMPROBANTE_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

async function firma(id: number): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(CLAVE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`comprobante:${id}`)))
  return btoa(String.fromCharCode(...s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 24)
}

function pagina(titulo: string, texto: string, status = 200) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title>
<style>body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f4f5f7;color:#14181e;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}
div{background:#fff;border-radius:18px;padding:28px 24px;max-width:420px;box-shadow:0 6px 24px rgba(0,0,0,.08);text-align:center}
b{display:block;font-size:13px;letter-spacing:2px;color:#e8812a;margin-bottom:10px}h1{font-size:21px;margin:0 0 10px}p{color:#5b6270;line-height:1.5;margin:0}</style></head>
<body><div><b>MOVA TECNOLOGÍA SMART</b><h1>${titulo}</h1><p>${texto}</p></div></body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // ---------- El cliente toca el botón del PDF ----------
  if (req.method === 'GET') {
    const u = new URL(req.url)
    const id = Number(u.searchParams.get('g'))
    const t = u.searchParams.get('t') ?? ''
    if (!id || !CLAVE || t !== await firma(id)) return pagina('Link no válido', 'Este link de comprobante no es correcto. Pedinos el comprobante y te lo enviamos.', 404)
    const { data } = await db.from('adicionales').select('comprobante_path, descripcion').eq('id', id).maybeSingle()
    if (!data?.comprobante_path) return pagina('Comprobante no disponible', 'Este comprobante ya no está disponible. Escribinos y te lo enviamos actualizado.', 404)
    const { data: link, error } = await db.storage.from('comprobantes').createSignedUrl(data.comprobante_path, 300)
    if (error || !link?.signedUrl) return pagina('No se pudo abrir', 'Hubo un problema al abrir el comprobante. Probá de nuevo en un rato.', 502)
    return new Response(null, { status: 302, headers: { Location: link.signedUrl, 'Cache-Control': 'no-store' } })
  }

  // ---------- La app pide los links para armar el PDF ----------
  if (req.method === 'POST') {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: quien } = await db.auth.getUser(token)
    if (!quien?.user) return json({ error: 'No autorizado' }, 401)
    const { data: perfil } = await db.from('profiles').select('activo').eq('id', quien.user.id).maybeSingle()
    if (!perfil || perfil.activo === false) return json({ error: 'No autorizado' }, 403)
    const cuerpo = await req.json().catch(() => ({})) as { ids?: unknown[] }
    const ids = (Array.isArray(cuerpo.ids) ? cuerpo.ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 50)
    const base = `${Deno.env.get('SUPABASE_URL')}/functions/v1/comprobante`
    const links: Record<number, string> = {}
    for (const id of ids) links[id] = `${base}?g=${id}&t=${await firma(id)}`
    return json({ links })
  }
  return json({ error: 'Método no permitido' }, 405)
})
