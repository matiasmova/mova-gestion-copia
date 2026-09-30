// Supabase Edge Function: asistente-ia
// Redacta con IA (Claude, de Anthropic) los textos de "Soluciones" que salen en
// los presupuestos: crear una solución nueva a partir de una idea o mejorar un
// texto existente. Devuelve 3 opciones para elegir.
//
// Solo la usan administradores y contables activos (mismo permiso que la
// pantalla Soluciones). La clave de Anthropic va en el secret
// ANTHROPIC_API_KEY de Supabase: nunca en la app ni en el código.
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SISTEMA = `Sos redactor comercial de MOVA Tecnología Smart, una empresa de Mendoza (Argentina) que instala domótica, redes WiFi, cámaras, riego automático, electricidad y tecnología para el hogar y empresas.

Escribís las "soluciones": bloques cortos que aparecen en los presupuestos, en la sección "Qué vas a disfrutar con este proyecto". Cada una tiene:
- titulo: nombre breve y claro de la solución (2 a 5 palabras, sin marcas ni modelos).
- descripcion: 2 a 4 oraciones (entre 250 y 420 caracteres) que cuentan los beneficios para el cliente en su vida diaria: comodidad, seguridad, ahorro, control desde el celular, tranquilidad.

Estilo: español rioplatense con voseo ("controlá", "tenés"), cálido, concreto y sin exageraciones ni promesas que no se puedan cumplir. Sin emojis, sin signos de exclamación en exceso, sin tecnicismos innecesarios, sin precios, sin marcas ni modelos de equipos. Frases que un cliente sin conocimientos técnicos entienda.

Siempre devolvés exactamente 3 opciones distintas entre sí (por ejemplo: una enfocada en comodidad, otra en seguridad o ahorro, otra más breve).`

const ESQUEMA = {
  type: 'object',
  properties: {
    opciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: { titulo: { type: 'string' }, descripcion: { type: 'string' } },
        required: ['titulo', 'descripcion'],
        additionalProperties: false,
      },
    },
  },
  required: ['opciones'],
  additionalProperties: false,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405)

  // 1) ¿Quién llama? Administrador o contable activo.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: quien } = await db.auth.getUser(token)
  if (!quien?.user) return responder({ error: 'No autorizado' }, 401)
  const { data: perfil } = await db.from('profiles').select('rol, activo').eq('id', quien.user.id).maybeSingle()
  if (!perfil || !['admin', 'contable'].includes(perfil.rol) || perfil.activo === false) return responder({ error: 'No tenés permiso para usar el asistente.' }, 403)

  if (!Deno.env.get('ANTHROPIC_API_KEY')) return responder({ error: 'Falta el secret ANTHROPIC_API_KEY en Supabase.' }, 400)

  // 2) Pedido
  const { accion, idea, titulo, descripcion, existentes } = await req.json().catch(() => ({})) as {
    accion?: string; idea?: string; titulo?: string; descripcion?: string; existentes?: string[]
  }
  const recorte = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n)
  const lista = (Array.isArray(existentes) ? existentes : []).map((x) => recorte(x, 80)).filter(Boolean).slice(0, 40)
  let pedido: string
  if (accion === 'crear') {
    if (!recorte(idea, 600)) return responder({ error: 'Contame la idea de la solución.' }, 400)
    pedido = `Creá una solución nueva a partir de esta idea del instalador:\n"${recorte(idea, 600)}"`
  } else if (accion === 'mejorar') {
    if (!recorte(descripcion, 1500) && !recorte(titulo, 120)) return responder({ error: 'No hay texto para mejorar.' }, 400)
    pedido = `Mejorá esta solución manteniendo la idea (podés ajustar el título si queda mejor):\nTítulo: "${recorte(titulo, 120)}"\nDescripción: "${recorte(descripcion, 1500)}"`
  } else return responder({ error: 'Acción desconocida' }, 400)
  if (lista.length) pedido += `\n\nSoluciones que ya existen (no las repitas ni uses el mismo título): ${lista.join(' · ')}`

  // 3) Claude
  const client = new Anthropic()
  try {
    const respuesta = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
      system: SISTEMA,
      messages: [{ role: 'user', content: pedido }],
    })
    if (respuesta.stop_reason === 'refusal') return responder({ error: 'El asistente no pudo redactar ese texto. Probá describirlo de otra forma.' }, 422)
    const texto = respuesta.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    const datos = JSON.parse(texto) as { opciones?: { titulo: string; descripcion: string }[] }
    const opciones = (datos.opciones ?? []).filter((o) => o.titulo && o.descripcion).slice(0, 3)
    if (!opciones.length) return responder({ error: 'El asistente no devolvió opciones. Probá de nuevo.' }, 502)
    return responder({ opciones })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return responder({ error: 'La clave de Anthropic (ANTHROPIC_API_KEY) no es válida.' }, 400)
    if (e instanceof Anthropic.RateLimitError) return responder({ error: 'El asistente está ocupado. Probá en un minuto.' }, 429)
    if (e instanceof Anthropic.APIError) return responder({ error: `El asistente respondió con un error (${e.status}). Revisá que la cuenta de Anthropic tenga saldo.` }, 502)
    return responder({ error: 'No se pudo generar el texto. Probá de nuevo.' }, 500)
  }
})
