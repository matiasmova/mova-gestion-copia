// Supabase Edge Function: asistente-ia
// Ayuda de texto para las "Soluciones" de los presupuestos, con Gemini (Google),
// que tiene uso gratuito. Tres pedidos:
//   · completar     -> a partir de una idea: 3 opciones de título + descripción
//   · titulos       -> 3 títulos para la descripción/idea actual
//   · descripciones -> 3 descripciones para el título/texto actual
//
// Solo administradores y contables activos. Desplegar con "Verify JWT" apagado
// (la función controla sola quién la usa). La clave va en el secret
// GEMINI_API_KEY (Google AI Studio). Opcional: GEMINI_MODEL.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const ESTILO = `Sos redactor comercial de MOVA Tecnología Smart, empresa de Mendoza (Argentina) que instala domótica, redes WiFi, cámaras, riego automático, electricidad y tecnología para hogares y empresas.
Escribís "soluciones" para los presupuestos (sección "Qué vas a disfrutar con este proyecto"):
- título: breve y claro, 2 a 5 palabras, sin marcas ni modelos.
- descripción: 2 a 4 oraciones (250 a 420 caracteres) con los beneficios para el cliente en su día a día: comodidad, seguridad, ahorro, control desde el celular, tranquilidad.
Estilo: español rioplatense con voseo ("controlá", "tenés"), cálido y concreto, sin exageraciones, sin emojis, sin precios, sin marcas, sin tecnicismos.
Siempre das 3 opciones distintas entre sí.`

const recorte = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n)

async function gemini(clave: string, pedido: string, esquema: unknown): Promise<unknown> {
  const modelos = [Deno.env.get('GEMINI_MODEL'), 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'].filter(Boolean) as string[]
  let ultimo = ''
  for (const modelo of modelos) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: ESTILO }] },
        contents: [{ role: 'user', parts: [{ text: pedido }] }],
        generationConfig: { temperature: 0.9, responseMimeType: 'application/json', responseSchema: esquema },
      }),
    })
    const cuerpo = await r.json().catch(() => ({}))
    const mensaje = String((cuerpo as { error?: { message?: string } }).error?.message ?? '').slice(0, 300)
    if (r.status === 404) { ultimo = `${modelo}: ${mensaje || 'no disponible'}`; continue }
    if ((r.status === 400 || r.status === 403) && /API key|API_KEY|permission|PERMISSION/i.test(JSON.stringify(cuerpo))) throw new Error(`clave|${mensaje}`)
    if (r.status === 429) { ultimo = `${modelo}: límite (${mensaje})`; continue }
    if (!r.ok) { ultimo = `${modelo}: ${r.status} ${mensaje}`; continue }
    let texto = (cuerpo as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    texto = texto.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    try { return JSON.parse(texto) } catch { ultimo = `${modelo}: respuesta sin formato`; continue }
  }
  throw new Error(ultimo || 'sin respuesta')
}

// Esquema en el formato de Gemini (los tipos van en mayúsculas).
const lista = (props: Record<string, unknown>) => ({
  type: 'OBJECT', properties: { opciones: { type: 'ARRAY', items: { type: 'OBJECT', properties: props, required: Object.keys(props) } } }, required: ['opciones'],
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: quien } = await db.auth.getUser(token)
  if (!quien?.user) return responder({ error: 'No autorizado' }, 401)
  const { data: perfil } = await db.from('profiles').select('rol, activo').eq('id', quien.user.id).maybeSingle()
  if (!perfil || !['admin', 'contable'].includes(perfil.rol) || perfil.activo === false) return responder({ error: 'No tenés permiso para usar el asistente.' }, 403)

  const clave = Deno.env.get('GEMINI_API_KEY')
  if (!clave) return responder({ error: 'Falta el secret GEMINI_API_KEY en Supabase.' }, 400)

  const { accion, idea, titulo, descripcion, existentes } = await req.json().catch(() => ({})) as Record<string, unknown>
  const ya = (Array.isArray(existentes) ? existentes : []).map((x) => recorte(x, 80)).filter(Boolean).slice(0, 40)
  const evitar = ya.length ? `\nNo repitas estas soluciones que ya existen: ${ya.join(' · ')}` : ''
  const t = recorte(titulo, 120), d = recorte(descripcion, 1500), i = recorte(idea, 600)

  try {
    if (accion === 'completar') {
      if (!i && !t && !d) return responder({ error: 'Escribí una idea.' }, 400)
      const r = await gemini(clave, `Creá una solución a partir de esta idea: "${i || t || d}".${evitar}`, lista({ titulo: { type: 'STRING' }, descripcion: { type: 'STRING' } })) as { opciones?: { titulo: string; descripcion: string }[] }
      return responder({ opciones: (r.opciones ?? []).filter((o) => o.titulo && o.descripcion).slice(0, 3) })
    }
    if (accion === 'titulos') {
      if (!t && !d && !i) return responder({ error: 'Escribí algo en la descripción o una idea.' }, 400)
      const r = await gemini(clave, `Proponé 3 títulos para esta solución.\nTítulo actual: "${t}"\nDescripción: "${d || i}"${evitar}`, lista({ titulo: { type: 'STRING' } })) as { opciones?: { titulo: string }[] }
      return responder({ opciones: (r.opciones ?? []).map((o) => o.titulo).filter(Boolean).slice(0, 3) })
    }
    if (accion === 'descripciones') {
      if (!t && !d && !i) return responder({ error: 'Escribí el título o una idea.' }, 400)
      const r = await gemini(clave, d
        ? `Mejorá esta descripción manteniendo la idea, en 3 versiones.\nTítulo: "${t}"\nDescripción actual: "${d}"`
        : `Escribí 3 descripciones para la solución "${t || i}".`, lista({ descripcion: { type: 'STRING' } })) as { opciones?: { descripcion: string }[] }
      return responder({ opciones: (r.opciones ?? []).map((o) => o.descripcion).filter(Boolean).slice(0, 3) })
    }
    return responder({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    const m = (e as Error).message
    if (m.startsWith('clave|')) return responder({ error: `Google rechazó la clave de Gemini (GEMINI_API_KEY): ${m.slice(6)}` }, 400)
    if (/límite/.test(m)) return responder({ error: 'Se alcanzó el límite gratuito de Gemini por un rato. Probá en un minuto.' }, 429)
    return responder({ error: `No se pudo generar el texto. Detalle de Google: ${m}` }, 502)
  }
})
