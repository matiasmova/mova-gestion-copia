// Supabase Edge Function: asistente-ia
// Asistente con Gemini (Google), que tiene uso gratuito. Pedidos:
//   · completar / titulos / descripciones -> textos de "Soluciones"
//   · presupuesto -> arma un presupuesto (ítems del catálogo, título, soluciones)
//                    a partir de lo que pide el cliente
//   · factura     -> lee la foto de una factura o ticket y devuelve la compra
//
// Soluciones y presupuestos: administradores y contables. Factura: también
// encargados y auxiliares (los que cargan compras). Desplegar con "Verify JWT" apagado
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

type Parte = { text: string } | { inlineData: { mimeType: string; data: string } }

async function gemini(clave: string, pedido: string | Parte[], esquema: unknown, sistema = ESTILO, temperatura = 0.9): Promise<unknown> {
  // Google retira modelos seguido: se prueba el del secret GEMINI_MODEL y después estos.
  const modelos = Array.from(new Set([Deno.env.get('GEMINI_MODEL'), 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-2.5-flash'].filter(Boolean) as string[]))
  const errores: string[] = []
  for (const modelo of modelos) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: 'user', parts: typeof pedido === 'string' ? [{ text: pedido }] : pedido }],
        generationConfig: { temperature: temperatura, responseMimeType: 'application/json', responseSchema: esquema },
      }),
    })
    const cuerpo = await r.json().catch(() => ({}))
    const mensaje = String((cuerpo as { error?: { message?: string } }).error?.message ?? '').slice(0, 300)
    if (r.status === 404) { errores.push(`${modelo}: ${mensaje || 'no disponible'}`); continue }
    if ((r.status === 400 || r.status === 403) && /API key|API_KEY|permission|PERMISSION/i.test(JSON.stringify(cuerpo))) throw new Error(`clave|${mensaje}`)
    if (r.status === 429) throw new Error(`límite: ${mensaje}`)
    if (!r.ok) { errores.push(`${modelo}: ${r.status} ${mensaje}`); continue }
    let texto = (cuerpo as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    texto = texto.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    try { return JSON.parse(texto) } catch { errores.push(`${modelo}: respuesta sin formato`); continue }
  }
  throw new Error(errores.join(' | ') || 'sin respuesta')
}

const SISTEMA_PRESUPUESTO = `Sos el asistente comercial de MOVA Tecnología Smart (Mendoza, Argentina): domótica, redes WiFi, cámaras, alarmas, riego automático, electricidad y tecnología para hogares y empresas.
Te pasan lo que pide un cliente y el CATÁLOGO de la empresa (id | nombre | categoría | tipo | unidad | precio). Armá un presupuesto:
- items: usá productos y servicios del catálogo (catalogo_id = su id) con cantidades razonables para lo pedido. Incluí la mano de obra / instalación si está en el catálogo. Solo si algo necesario no está en el catálogo, agregalo con catalogo_id 0, una descripción clara para el cliente (sin marcas) y tipo producto o servicio.
- No inventes ids: catalogo_id tiene que ser un id del catálogo o 0.
- titulo: breve, por ejemplo "Domótica y WiFi integral".
- descripcion: 1 a 3 oraciones para el cliente, en español rioplatense con voseo, sin precios ni marcas.
- soluciones: ids de las SOLUCIONES de la lista que correspondan a lo pedido (pueden ser ninguna).
- notas: supuestos importantes para que el instalador revise (por ejemplo "calculé 3 nodos por 200 m²"). Corto.
- Precios: NO hace falta que pongas precios, la app usa los del catálogo. Solo si el pedido dice un precio para algo (por ejemplo "las cámaras a 90000"), ponelo en precio_unitario de ese ítem; si no, precio_unitario = 0.
- Descuentos: si el pedido pide un descuento para un ítem o tipo de ítem (por ejemplo "20% en la mano de obra"), ponelo en descuento_pct de esos ítems. Si pide un descuento general sobre todo el presupuesto (por ejemplo "aplicá un 15% de descuento"), ponelo en descuento_general_pct y dejá descuento_pct en 0. Si no se pide descuento, todo en 0.`

const SISTEMA_FACTURA = `Leés fotos de facturas, tickets y remitos de proveedores argentinos (materiales eléctricos, redes, domótica, ferretería).
Devolvé los datos tal cual figuran:
- proveedor: razón social o nombre del comercio.
- fecha: en formato AAAA-MM-DD (en Argentina las fechas se escriben día/mes/año).
- numero: número de factura o ticket (por ejemplo "0003-00012345"), vacío si no hay.
- items: cada renglón con descripcion, cantidad, unidad (unidad, metro, rollo, caja, etc.) y precio_unitario FINAL por unidad (con IVA incluido si la factura lo discrimina, para que la suma dé el total pagado).
- total: el total a pagar.
Números sin separador de miles y con punto decimal. Si algo no se lee, dejalo vacío o en 0; no inventes.`

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
  const cuerpo = await req.json().catch(() => ({})) as Record<string, unknown>
  const { accion, idea, titulo, descripcion, existentes } = cuerpo
  const roles = accion === 'factura' ? ['admin', 'contable', 'encargado', 'auxiliar'] : ['admin', 'contable']
  if (!perfil || !roles.includes(perfil.rol) || perfil.activo === false) return responder({ error: 'No tenés permiso para usar el asistente.' }, 403)

  const clave = Deno.env.get('GEMINI_API_KEY')
  if (!clave) return responder({ error: 'Falta el secret GEMINI_API_KEY en Supabase.' }, 400)

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
    if (accion === 'presupuesto') {
      const pedido = recorte(cuerpo.pedido, 2000)
      if (!pedido) return responder({ error: 'Contá qué necesita el cliente.' }, 400)
      const [rCat, rSol] = await Promise.all([
        db.from('productos_servicios').select('id, nombre, categoria, tipo, unidad, precio_venta').eq('activo', true).order('nombre').limit(600),
        db.from('soluciones').select('id, titulo').eq('activo', true).limit(60),
      ])
      const catalogo = (rCat.data ?? []) as { id: number; nombre: string; categoria: string | null; tipo: string; unidad: string; precio_venta: number }[]
      const soluciones = (rSol.data ?? []) as { id: number; titulo: string }[]
      const texto = `PEDIDO DEL CLIENTE:\n${pedido}\n\nCATÁLOGO:\n${catalogo.map((p) => `${p.id} | ${p.nombre} | ${p.categoria ?? ''} | ${p.tipo} | ${p.unidad} | ${Number(p.precio_venta) || 0}`).join('\n') || '(vacío)'}\n\nSOLUCIONES:\n${soluciones.map((x) => `${x.id} | ${x.titulo}`).join('\n') || '(ninguna)'}`
      const esquema = {
        type: 'OBJECT',
        properties: {
          titulo: { type: 'STRING' }, descripcion: { type: 'STRING' }, notas: { type: 'STRING' }, descuento_general_pct: { type: 'NUMBER' },
          soluciones: { type: 'ARRAY', items: { type: 'INTEGER' } },
          items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { catalogo_id: { type: 'INTEGER' }, descripcion: { type: 'STRING' }, cantidad: { type: 'NUMBER' }, tipo: { type: 'STRING', enum: ['producto', 'servicio'] }, precio_unitario: { type: 'NUMBER' }, descuento_pct: { type: 'NUMBER' } }, required: ['catalogo_id', 'descripcion', 'cantidad', 'tipo', 'precio_unitario', 'descuento_pct'] } },
        },
        required: ['titulo', 'descripcion', 'items', 'soluciones', 'notas'],
      }
      const r = await gemini(clave, texto, esquema, SISTEMA_PRESUPUESTO, 0.4) as { titulo?: string; descripcion?: string; notas?: string; descuento_general_pct?: number; soluciones?: number[]; items?: { catalogo_id: number; descripcion: string; cantidad: number; tipo: string; precio_unitario?: number; descuento_pct?: number }[] }
      const ids = new Set(catalogo.map((p) => p.id))
      const precioDe = new Map(catalogo.map((p) => [p.id, Number(p.precio_venta) || 0]))
      const pct = (x: unknown) => Math.min(100, Math.max(0, Number(x) || 0))
      const idsSol = new Set(soluciones.map((x) => x.id))
      return responder({
        titulo: recorte(r.titulo, 120), descripcion: recorte(r.descripcion, 800), notas: recorte(r.notas, 600),
        descuento_general_pct: pct(r.descuento_general_pct),
        soluciones: (r.soluciones ?? []).filter((id) => idsSol.has(id)),
        items: (r.items ?? []).slice(0, 40).map((it) => ({
          catalogo_id: ids.has(Number(it.catalogo_id)) ? Number(it.catalogo_id) : null,
          descripcion: recorte(it.descripcion, 200), cantidad: Math.max(0.01, Number(it.cantidad) || 1),
          tipo: it.tipo === 'producto' ? 'producto' : 'servicio',
          // Precio que dijo el pedido (si dijo uno); si no, el de la lista.
          precio_pedido: Math.max(0, Number(it.precio_unitario) || 0),
          precio_catalogo: ids.has(Number(it.catalogo_id)) ? precioDe.get(Number(it.catalogo_id)) ?? 0 : 0,
          descuento_pct: pct(it.descuento_pct),
        })).filter((it) => it.catalogo_id || it.descripcion),
      })
    }
    if (accion === 'factura') {
      const imagen = String(cuerpo.imagen ?? '')
      const mime = String(cuerpo.mime ?? 'image/jpeg')
      if (!imagen || imagen.length > 8_000_000 || !/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mime)) return responder({ error: 'La foto no es válida o es muy pesada.' }, 400)
      const esquema = {
        type: 'OBJECT',
        properties: {
          proveedor: { type: 'STRING' }, fecha: { type: 'STRING' }, numero: { type: 'STRING' }, total: { type: 'NUMBER' },
          items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { descripcion: { type: 'STRING' }, cantidad: { type: 'NUMBER' }, unidad: { type: 'STRING' }, precio_unitario: { type: 'NUMBER' } }, required: ['descripcion', 'cantidad', 'precio_unitario'] } },
        },
        required: ['proveedor', 'fecha', 'items', 'total'],
      }
      const r = await gemini(clave, [{ inlineData: { mimeType: mime, data: imagen } }, { text: 'Leé esta factura o ticket y devolvé los datos.' }], esquema, SISTEMA_FACTURA, 0.1) as { proveedor?: string; fecha?: string; numero?: string; total?: number; items?: { descripcion: string; cantidad: number; unidad?: string; precio_unitario: number }[] }
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(r.fecha ?? '')) ? String(r.fecha) : ''
      return responder({
        proveedor: recorte(r.proveedor, 120), fecha, numero: recorte(r.numero, 40), total: Number(r.total) || 0,
        items: (r.items ?? []).slice(0, 60).map((it) => ({ descripcion: recorte(it.descripcion, 160), cantidad: Number(it.cantidad) || 1, unidad: recorte(it.unidad, 20) || 'unidad', precio_unitario: Math.max(0, Number(it.precio_unitario) || 0) })).filter((it) => it.descripcion),
      })
    }
    return responder({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    const m = (e as Error).message
    if (m.startsWith('clave|')) return responder({ error: `Google rechazó la clave de Gemini (GEMINI_API_KEY): ${m.slice(6)}` }, 400)
    if (/límite/.test(m)) return responder({ error: 'Se alcanzó el límite gratuito de Gemini por un rato. Probá en un minuto.' }, 429)
    return responder({ error: `No se pudo generar el texto. Detalle de Google: ${m}` }, 502)
  }
})
