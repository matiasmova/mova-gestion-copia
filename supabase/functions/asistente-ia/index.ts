// Supabase Edge Function: asistente-ia
// Asistente con Gemini (Google), que tiene uso gratuito. Pedidos:
//   · completar / titulos / descripciones -> textos de "Soluciones"
//   · presupuesto -> arma un presupuesto (ítems del catálogo, título, soluciones)
//                    a partir de lo que pide el cliente
//   · factura     -> lee la foto de una factura o ticket y devuelve la compra
//   · mercado     -> busca en internet precios actuales de productos en Argentina
//                    (con Claude si está el secret ANTHROPIC_API_KEY, porque la
//                    búsqueda de Gemini no tiene cupo gratis; si no, con Gemini)
//   · ordenar_catalogo -> propone categoría, nombre en presupuesto y descripción
//   · informe_obra -> mensaje de avance de obra para mandarle al cliente
//   · resumen_dia -> "qué mirar hoy" para Inicio, a partir de lo que manda la app
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
  const errores: string[] = [], limites: string[] = []
  // Cada modelo tiene su propio cupo gratis: si uno se agotó, se prueba el siguiente.
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
    if (r.status === 429) { limites.push(`${modelo}: ${mensaje}`); continue }
    if (!r.ok) { errores.push(`${modelo}: ${r.status} ${mensaje}`); continue }
    let texto = (cuerpo as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    texto = texto.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    try { return JSON.parse(texto) } catch { errores.push(`${modelo}: respuesta sin formato`); continue }
  }
  if (limites.length) throw new Error(`límite|${limites.join(' | ')}`)
  throw new Error(errores.join(' | ') || 'sin respuesta')
}

type Fuente = { titulo: string; url: string }

// Igual que gemini(), pero buscando en Google antes de responder. Con la
// búsqueda no siempre se puede pedir JSON con esquema, así que se pide en el
// texto y se extrae. Devuelve también las páginas y búsquedas que usó.
async function geminiBuscar(clave: string, pedido: string, sistema: string): Promise<{ datos: unknown; fuentes: Fuente[]; busquedas: string[] }> {
  const modelos = Array.from(new Set([Deno.env.get('GEMINI_MODEL'), 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-2.5-flash'].filter(Boolean) as string[]))
  const errores: string[] = [], limites: string[] = []
  // Cada modelo tiene su propio cupo gratis: si uno se agotó, se prueba el siguiente.
  for (const modelo of modelos) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: 'user', parts: [{ text: pedido }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 },
      }),
    })
    const cuerpo = await r.json().catch(() => ({})) as {
      error?: { message?: string }
      candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[]; webSearchQueries?: string[] } }[]
    }
    const mensaje = String(cuerpo.error?.message ?? '').slice(0, 300)
    if (r.status === 404) { errores.push(`${modelo}: ${mensaje || 'no disponible'}`); continue }
    if ((r.status === 400 || r.status === 403) && /API key|API_KEY|permission|PERMISSION/i.test(JSON.stringify(cuerpo))) throw new Error(`clave|${mensaje}`)
    if (r.status === 429) { limites.push(`${modelo}: ${mensaje}`); continue }
    if (!r.ok) { errores.push(`${modelo}: ${r.status} ${mensaje}`); continue }
    const c = cuerpo.candidates?.[0]
    const texto = c?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    const desde = texto.indexOf('{'), hasta = texto.lastIndexOf('}')
    let datos: unknown
    try { datos = JSON.parse(texto.slice(desde, hasta + 1)) } catch { errores.push(`${modelo}: respuesta sin formato`); continue }
    const fuentes = (c?.groundingMetadata?.groundingChunks ?? []).map((x) => ({ titulo: recorte(x.web?.title, 80), url: String(x.web?.uri ?? '') }))
      .filter((x) => /^https:\/\//.test(x.url))
    return { datos, fuentes, busquedas: (c?.groundingMetadata?.webSearchQueries ?? []).map((q) => recorte(q, 120)).filter(Boolean).slice(0, 8) }
  }
  if (limites.length) throw new Error(`límite|${limites.join(' | ')}`)
  throw new Error(errores.join(' | ') || 'sin respuesta')
}

// Búsqueda con Claude (API de Anthropic, se paga aparte del plan Pro). Solo se
// usa para comparar precios. Secret ANTHROPIC_API_KEY; opcional CLAUDE_MODEL.
async function claudeBuscar(clave: string, pedido: string, sistema: string, busquedasMax = 6): Promise<{ datos: unknown; fuentes: Fuente[]; busquedas: string[] }> {
  type Bloque = { type: string; text?: string; input?: { query?: string }; content?: { type?: string; url?: string; title?: string }[] }
  const mensajes: { role: string; content: string | Bloque[] }[] = [{ role: 'user', content: pedido }]
  const fuentes: Fuente[] = [], busquedas: string[] = []
  let textoFinal = ''
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': clave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: Deno.env.get('CLAUDE_MODEL') || 'claude-haiku-4-5-20251001',
        max_tokens: 4000, system: sistema, messages: mensajes,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: busquedasMax, user_location: { type: 'approximate', country: 'AR', region: 'Mendoza', city: 'Mendoza', timezone: 'America/Argentina/Mendoza' } }],
      }),
    })
    const cuerpo = await r.json().catch(() => ({})) as { error?: { message?: string }; content?: Bloque[]; stop_reason?: string }
    const mensaje = String(cuerpo.error?.message ?? '').slice(0, 300)
    if (r.status === 401 || r.status === 403) throw new Error(`claude|Claude rechazó la clave (ANTHROPIC_API_KEY): ${mensaje}`)
    if (/credit balance/i.test(mensaje)) throw new Error('claude|No queda saldo en la cuenta de Claude. Cargá crédito en console.anthropic.com → Billing.')
    if (r.status === 429 || r.status === 529) throw new Error(`claude|Claude está con mucha demanda o llegaste al límite por minuto. Probá en un minuto. (${mensaje})`)
    if (!r.ok) throw new Error(`claude|Claude respondió ${r.status}: ${mensaje}`)
    const bloques = cuerpo.content ?? []
    for (const b of bloques) {
      if (b.type === 'server_tool_use' && b.input?.query) busquedas.push(recorte(b.input.query, 120))
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const x of b.content) if (x.url && /^https:\/\//.test(x.url)) fuentes.push({ titulo: recorte(x.title, 80) || new URL(x.url).hostname, url: x.url })
      }
    }
    // El JSON está en el texto que viene después de la última búsqueda.
    const ultima = bloques.map((b) => b.type).lastIndexOf('web_search_tool_result')
    textoFinal = bloques.slice(ultima + 1).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    if (cuerpo.stop_reason !== 'pause_turn') break
    mensajes.push({ role: 'assistant', content: bloques })
  }
  const desde = textoFinal.indexOf('{'), hasta = textoFinal.lastIndexOf('}')
  let datos: unknown
  try { datos = JSON.parse(textoFinal.slice(desde, hasta + 1)) } catch { throw new Error('claude|Claude no devolvió el resultado en el formato esperado. Probá de nuevo.') }
  return { datos, fuentes, busquedas: Array.from(new Set(busquedas)).slice(0, 8) }
}

const SISTEMA_MERCADO = `Sos analista de precios de MOVA Tecnología Smart (Mendoza, Argentina), que vende e instala domótica, WiFi, cámaras, alarmas, riego y electricidad.
Para cada producto de la lista buscá en Google el precio de venta actual en Argentina: Mercado Libre, tiendas de electrónica y tecnología, distribuidores y la tienda oficial de la marca.
Reglas:
- Buscá el mismo producto (misma marca y modelo). Si no aparece, usá uno equivalente y marcá equivalente = true.
- precio: precio final al público por UNA unidad, con IVA incluido, en pesos argentinos, sin separador de miles. Si un pack trae varias unidades, dividí. Si la publicación está en dólares, poné el número en dólares y moneda "USD".
- Ignorá usados, reacondicionados, repuestos, valores de cuotas y precios viejos.
- Hasta 6 ofertas por producto, de tiendas distintas cuando se pueda.
- url: el link exacto de la publicación que encontraste; vacío si no lo tenés. No inventes links ni precios.
- comentario: una frase útil (por ejemplo "en Mercado Libre varía mucho según el vendedor" o "no lo encontré, comparé con un modelo parecido").
Respondé SOLO con este JSON, sin texto antes ni después:
{"productos":[{"n":1,"buscado":"lo que buscaste","ofertas":[{"tienda":"","titulo":"","precio":0,"moneda":"ARS","url":"","equivalente":false}],"comentario":""}]}`

const SISTEMA_CATALOGO = `Ordenás el catálogo de MOVA Tecnología Smart (Mendoza, Argentina): domótica, redes WiFi, cámaras, alarmas, riego automático, electricidad, iluminación y servicios de instalación.
Para cada producto o servicio devolvé:
- categoria: una categoría corta y clara (1 a 3 palabras), por ejemplo "WiFi y redes", "Domótica Zigbee", "Cámaras", "Alarmas", "Iluminación", "Riego", "Electricidad", "Accesorios", "Mano de obra". Usá pocas categorías en total (idealmente 6 a 12) y siempre escritas igual; reutilizá las CATEGORÍAS YA USADAS cuando correspondan.
- nombre_presupuesto: cómo lo ve el cliente en el presupuesto: genérico, sin marca ni modelo ni código, claro y profesional, 2 a 6 palabras (por ejemplo "Router mesh WiFi 6", "Cámara exterior IP 4 MP", "Interruptor inteligente 2 vías", "Instalación y configuración").
- descripcion: una frase corta (máximo 160 caracteres) de qué es y para qué sirve, para uso interno. Sin precios.
Español rioplatense, sin emojis.`

const SISTEMA_INFORME = `Escribís, para MOVA Tecnología Smart (Mendoza, Argentina), el mensaje de WhatsApp con el avance de una obra para mandarle al cliente.
- Español rioplatense con voseo, claro y profesional. Saludo con el primer nombre del cliente.
- Contá lo que se hizo en el período (según los AVANCES), en qué porcentaje está la obra y qué sigue.
- Si hay adicionales o cambios aprobados o pendientes de aprobación, mencionalos en una línea.
- Formato de WhatsApp: párrafos cortos, se pueden usar viñetas con "•" y *negrita* con asteriscos. Entre 400 y 1200 caracteres. Sin montos de dinero salvo que se pida.
- No inventes trabajos que no figuren en los datos. Si no hay avances en el período, decilo con naturalidad y contá cómo sigue.
- Cerrá ofreciendo responder dudas, firmado con el nombre de la empresa.`

const SISTEMA_RESUMEN_DIA = `Sos el asistente del dueño de MOVA Tecnología Smart (Mendoza, Argentina). Te pasan los datos de hoy de su app de gestión.
Elegí lo MÁS importante para hoy: entre 3 y 5 puntos, ordenados por urgencia (primero lo que pierde plata o tiene horario hoy).
- texto: una oración corta y concreta, en español rioplatense con voseo, con nombres y montos cuando ayuden ("Cobrale a Pérez el saldo de $350.000: la obra ya terminó").
- icono: un emoji que lo represente.
- ir: a qué pantalla lleva, uno de: agenda, obras, presupuestos, cobranzas, personal, gastos, ninguno.
- saludo: una frase breve de arranque según el día ("Lunes tranquilo: 2 cosas para cobrar y una visita").
No inventes datos que no estén en la lista. Si no hay nada urgente, decilo y sugerí algo útil (seguir presupuestos, cargar gastos).`

const SISTEMA_PRESUPUESTO = `Sos el asistente comercial de MOVA Tecnología Smart (Mendoza, Argentina): domótica, redes WiFi, cámaras, alarmas, riego automático, electricidad y tecnología para hogares y empresas.
Te pasan lo que pide un cliente y el CATÁLOGO de la empresa (id | nombre | categoría | tipo | unidad | precio). Armá un presupuesto:
- items: usá productos y servicios del catálogo (catalogo_id = su id) con cantidades razonables para lo pedido. Incluí la mano de obra / instalación si está en el catálogo. Solo si algo necesario no está en el catálogo, agregalo con catalogo_id 0, una descripción clara para el cliente (sin marcas) y tipo producto o servicio.
- No inventes ids: catalogo_id tiene que ser un id del catálogo o 0.
- titulo: breve, por ejemplo "Domótica y WiFi integral".
- descripcion: 1 a 3 oraciones para el cliente, en español rioplatense con voseo, sin precios ni marcas.
- soluciones: ids de las SOLUCIONES de la lista que correspondan a lo pedido (pueden ser ninguna).
- notas: supuestos importantes para que el instalador revise (por ejemplo "calculé 3 nodos por 200 m²"). Corto.
- Precios: NO hace falta que pongas precios, la app usa los del catálogo. Solo si el pedido dice un precio para algo (por ejemplo "las cámaras a 90000"), ponelo en precio_unitario de ese ítem; si no, precio_unitario = 0.
- Cliente y obra: si el pedido nombra al cliente (por ejemplo "para Sergio Baigoria") o la obra (por ejemplo "en la finca de Junín"), buscalos en la lista de CLIENTES y OBRAS y devolvé cliente_id y obra_id (la obra tiene que ser de ese cliente). Si nombra un cliente u obra que no está en la lista, dejá el id en 0 y escribí el nombre en cliente_texto u obra_texto. Si no nombra ninguno, todo en 0 y vacío.
- Imagen: si viene una imagen, leela con atención. En un plano o croquis contá ambientes, metros y aberturas para calcular cantidades (por ejemplo nodos WiFi según superficie y paredes, cámaras en accesos y perímetro, puntos de luz y módulos por ambiente). En una foto del lugar, fijate qué se ve (tablero, techo, jardín). Si es un pedido escrito a mano, transcribilo. Explicá en notas lo que viste y los supuestos ("vi 3 dormitorios y living de ~40 m²").
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
  const roles = accion === 'factura' ? ['admin', 'contable', 'encargado', 'auxiliar'] : accion === 'informe_obra' ? ['admin', 'contable', 'encargado'] : ['admin', 'contable']
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
      // Opcional: foto de un plano, croquis, el lugar o un pedido escrito a mano.
      const imagen = String(cuerpo.imagen ?? '')
      const mime = String(cuerpo.mime ?? 'image/jpeg')
      if (imagen && (imagen.length > 8_000_000 || !/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mime))) return responder({ error: 'La foto no es válida o es muy pesada.' }, 400)
      if (!pedido && !imagen) return responder({ error: 'Contá qué necesita el cliente o subí una foto.' }, 400)
      const [rCat, rSol, rCli, rObr] = await Promise.all([
        db.from('productos_servicios').select('id, nombre, categoria, tipo, unidad, precio_venta').eq('activo', true).order('nombre').limit(600),
        db.from('soluciones').select('id, titulo').eq('activo', true).limit(60),
        db.from('Clientes').select('id, nombre, apellido, localidad').limit(1500),
        db.from('obras').select('id, nombre_obra, cliente_id, localidad').limit(2000),
      ])
      const clientes = (rCli.data ?? []) as { id: number; nombre: string; apellido: string | null; localidad: string | null }[]
      const obras = (rObr.data ?? []) as { id: number; nombre_obra: string; cliente_id: number; localidad: string | null }[]
      const catalogo = (rCat.data ?? []) as { id: number; nombre: string; categoria: string | null; tipo: string; unidad: string; precio_venta: number }[]
      const soluciones = (rSol.data ?? []) as { id: number; titulo: string }[]
      const texto = `${imagen ? 'Te paso además una IMAGEN (plano, croquis, foto del lugar o pedido escrito): usala para armar el presupuesto.\n\n' : ''}PEDIDO DEL CLIENTE:\n${pedido || '(solo la imagen)'}\n\nCATÁLOGO:\n${catalogo.map((p) => `${p.id} | ${p.nombre} | ${p.categoria ?? ''} | ${p.tipo} | ${p.unidad} | ${Number(p.precio_venta) || 0}`).join('\n') || '(vacío)'}\n\nSOLUCIONES:\n${soluciones.map((x) => `${x.id} | ${x.titulo}`).join('\n') || '(ninguna)'}\n\nCLIENTES (id | nombre | localidad):\n${clientes.map((c) => `${c.id} | ${c.nombre} ${c.apellido ?? ''} | ${c.localidad ?? ''}`).join('\n') || '(ninguno)'}\n\nOBRAS (id | nombre | id del cliente | localidad):\n${obras.map((o) => `${o.id} | ${o.nombre_obra} | ${o.cliente_id} | ${o.localidad ?? ''}`).join('\n') || '(ninguna)'}`
      const esquema = {
        type: 'OBJECT',
        properties: {
          titulo: { type: 'STRING' }, descripcion: { type: 'STRING' }, notas: { type: 'STRING' }, descuento_general_pct: { type: 'NUMBER' },
          cliente_id: { type: 'INTEGER' }, obra_id: { type: 'INTEGER' }, cliente_texto: { type: 'STRING' }, obra_texto: { type: 'STRING' },
          soluciones: { type: 'ARRAY', items: { type: 'INTEGER' } },
          items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { catalogo_id: { type: 'INTEGER' }, descripcion: { type: 'STRING' }, cantidad: { type: 'NUMBER' }, tipo: { type: 'STRING', enum: ['producto', 'servicio'] }, precio_unitario: { type: 'NUMBER' }, descuento_pct: { type: 'NUMBER' } }, required: ['catalogo_id', 'descripcion', 'cantidad', 'tipo', 'precio_unitario', 'descuento_pct'] } },
        },
        required: ['titulo', 'descripcion', 'items', 'soluciones', 'notas', 'cliente_id', 'obra_id'],
      }
      const r = await gemini(clave, imagen ? [{ inlineData: { mimeType: mime, data: imagen } }, { text: texto }] : texto, esquema, SISTEMA_PRESUPUESTO, 0.4) as { titulo?: string; descripcion?: string; notas?: string; descuento_general_pct?: number; cliente_id?: number; obra_id?: number; cliente_texto?: string; obra_texto?: string; soluciones?: number[]; items?: { catalogo_id: number; descripcion: string; cantidad: number; tipo: string; precio_unitario?: number; descuento_pct?: number }[] }
      const ids = new Set(catalogo.map((p) => p.id))
      const precioDe = new Map(catalogo.map((p) => [p.id, Number(p.precio_venta) || 0]))
      const pct = (x: unknown) => Math.min(100, Math.max(0, Number(x) || 0))
      const idsSol = new Set(soluciones.map((x) => x.id))
      return responder({
        titulo: recorte(r.titulo, 120), descripcion: recorte(r.descripcion, 800), notas: recorte(r.notas, 600),
        descuento_general_pct: pct(r.descuento_general_pct),
        ...(() => {
          // Solo ids que existen; la obra tiene que ser del cliente elegido.
          const cli = clientes.find((c) => c.id === Number(r.cliente_id))
          let obra = obras.find((o) => o.id === Number(r.obra_id))
          if (obra && cli && obra.cliente_id !== cli.id) obra = undefined
          const clienteFinal = cli ?? (obra ? clientes.find((c) => c.id === obra!.cliente_id) : undefined)
          return {
            cliente_id: clienteFinal?.id ?? null, obra_id: obra?.id ?? null,
            cliente_texto: clienteFinal ? '' : recorte(r.cliente_texto, 80), obra_texto: obra ? '' : recorte(r.obra_texto, 80),
          }
        })(),
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
    if (accion === 'mercado') {
      // productos: [{ id?, descripcion? }] — con id se usan los datos del catálogo.
      const pedidos = (Array.isArray(cuerpo.productos) ? cuerpo.productos : []).slice(0, 10) as { id?: number; descripcion?: string }[]
      const cotizacion = Number(cuerpo.cotizacion) || 0
      if (!pedidos.length) return responder({ error: 'No hay productos para comparar.' }, 400)
      const ids = pedidos.map((x) => Number(x.id)).filter(Boolean)
      const { data: cat } = ids.length
        ? await db.from('productos_servicios').select('id, nombre, codigo, categoria, proveedor').in('id', ids)
        : { data: [] }
      const porId = new Map(((cat ?? []) as { id: number; nombre: string; codigo: string | null; categoria: string | null; proveedor: string | null }[]).map((p) => [p.id, p]))
      const renglones = pedidos.map((x, k) => {
        const p = porId.get(Number(x.id))
        return p
          ? `${k + 1}. ${p.nombre}${p.codigo ? ` (código ${p.codigo})` : ''}${p.proveedor ? ` · marca/proveedor: ${p.proveedor}` : ''}${p.categoria ? ` · ${p.categoria}` : ''}`
          : `${k + 1}. ${recorte(x.descripcion, 160)}`
      })
      const claveClaude = Deno.env.get('ANTHROPIC_API_KEY')
      const textoPedido = `Buscá el precio de mercado actual en Argentina de estos productos:\n${renglones.join('\n')}`
      let respuesta: Awaited<ReturnType<typeof geminiBuscar>>
      if (claveClaude) respuesta = await claudeBuscar(claveClaude, textoPedido, SISTEMA_MERCADO, Math.min(6, pedidos.length + 2))
      else {
        try { respuesta = await geminiBuscar(clave, textoPedido, SISTEMA_MERCADO) } catch (e) {
          if (String((e as Error).message).startsWith('límite|')) throw new Error('claude|La búsqueda en Google de Gemini no tiene cupo gratis en tu cuenta. Para comparar precios hay que cargar el secret ANTHROPIC_API_KEY (Claude) en Supabase.')
          throw e
        }
      }
      const { datos, fuentes, busquedas } = respuesta
      const lista = ((datos as { productos?: unknown[] })?.productos ?? []) as { n?: number; buscado?: string; comentario?: string; ofertas?: { tienda?: string; titulo?: string; precio?: number; moneda?: string; url?: string; equivalente?: boolean }[] }[]
      // Solo se muestran links de páginas que la búsqueda realmente visitó.
      // Gemini da el dominio en el título (y un link de redirección); Claude da el link real.
      const dominios = new Set([
        ...fuentes.map((f) => f.titulo.toLowerCase().replace(/^www\./, '')).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
        ...fuentes.map((f) => { try { return new URL(f.url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' } }).filter((d) => d && !d.endsWith('vertexaisearch.cloud.google.com')),
      ])
      const linkValido = (u: unknown) => {
        try {
          const url = new URL(String(u ?? ''))
          const host = url.hostname.toLowerCase().replace(/^www\./, '')
          return url.protocol === 'https:' && [...dominios].some((d) => host === d || host.endsWith(`.${d}`) || d.endsWith(`.${host}`)) ? url.toString() : ''
        } catch { return '' }
      }
      const resultados = pedidos.map((_, k) => {
        const r = lista.find((x) => Number(x.n) === k + 1) ?? lista[k]
        let ofertas = (r?.ofertas ?? []).map((o) => {
          const usd = String(o.moneda ?? '').toUpperCase() === 'USD'
          const precio = Number(o.precio) || 0
          return { tienda: recorte(o.tienda, 60), titulo: recorte(o.titulo, 140), precio: usd ? (cotizacion > 0 ? Math.round(precio * cotizacion) : 0) : Math.round(precio), en_dolares: usd, url: linkValido(o.url), equivalente: o.equivalente === true }
        }).filter((o) => o.precio > 0).slice(0, 8)
        // Se descartan precios absurdos (muy lejos de la mediana).
        const orden = ofertas.map((o) => o.precio).sort((a, b) => a - b)
        const med = orden.length ? orden[Math.floor(orden.length / 2)] : 0
        if (orden.length >= 3) ofertas = ofertas.filter((o) => o.precio >= med / 3 && o.precio <= med * 3)
        const precios = ofertas.map((o) => o.precio).sort((a, b) => a - b)
        return {
          buscado: recorte(r?.buscado, 160), comentario: recorte(r?.comentario, 300), ofertas,
          minimo: precios[0] ?? 0, maximo: precios[precios.length - 1] ?? 0,
          promedio: precios.length ? Math.round(precios.reduce((a, b) => a + b, 0) / precios.length) : 0,
          mediana: precios.length ? precios[Math.floor(precios.length / 2)] : 0,
        }
      })
      return responder({ resultados, fuentes: fuentes.slice(0, 12), busquedas })
    }
    if (accion === 'ordenar_catalogo') {
      const ids = (Array.isArray(cuerpo.ids) ? cuerpo.ids : []).map(Number).filter(Boolean).slice(0, 40)
      if (!ids.length) return responder({ error: 'No hay productos para ordenar.' }, 400)
      const { data } = await db.from('productos_servicios').select('id, tipo, nombre, codigo, categoria, proveedor, descripcion').in('id', ids)
      const productos = (data ?? []) as { id: number; tipo: string; nombre: string; codigo: string | null; categoria: string | null; proveedor: string | null; descripcion: string | null }[]
      const usadas = (Array.isArray(cuerpo.categorias) ? cuerpo.categorias : []).map((x) => recorte(x, 40)).filter(Boolean).slice(0, 40)
      const texto = `CATEGORÍAS YA USADAS: ${usadas.join(' · ') || '(ninguna)'}\n\nPRODUCTOS (id | tipo | nombre | marca/proveedor | categoría actual | descripción actual):\n${productos.map((p) => `${p.id} | ${p.tipo} | ${p.nombre}${p.codigo ? ` (${p.codigo})` : ''} | ${p.proveedor ?? ''} | ${p.categoria ?? ''} | ${recorte(p.descripcion, 160)}`).join('\n')}`
      const esquema = { type: 'OBJECT', properties: { productos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, categoria: { type: 'STRING' }, nombre_presupuesto: { type: 'STRING' }, descripcion: { type: 'STRING' } }, required: ['id', 'categoria', 'nombre_presupuesto', 'descripcion'] } } }, required: ['productos'] }
      const r = await gemini(clave, texto, esquema, SISTEMA_CATALOGO, 0.3) as { productos?: { id: number; categoria: string; nombre_presupuesto: string; descripcion: string }[] }
      const validos = new Set(productos.map((p) => p.id))
      return responder({
        productos: (r.productos ?? []).filter((p) => validos.has(Number(p.id))).map((p) => ({
          id: Number(p.id), categoria: recorte(p.categoria, 40), nombre_presupuesto: recorte(p.nombre_presupuesto, 80), descripcion: recorte(p.descripcion, 200),
        })),
      })
    }
    if (accion === 'informe_obra') {
      const obraId = Number(cuerpo.obra_id)
      const dias = Math.min(365, Math.max(1, Number(cuerpo.dias) || 7))
      const tono = cuerpo.tono === 'formal' ? 'formal' : 'cercano'
      const { data: obra } = await db.from('obras').select('id, nombre_obra, cliente_id, direccion, localidad, estado, porcentaje_avance, fecha_fin_estimada').eq('id', obraId).maybeSingle()
      if (!obra) return responder({ error: 'No encontré la obra.' }, 404)
      const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)
      const [rCli, rAv, rAd, rImg, rConf] = await Promise.all([
        db.from('Clientes').select('nombre, apellido, telefono').eq('id', obra.cliente_id).maybeSingle(),
        db.from('obra_avances').select('fecha, titulo, descripcion, estado, porcentaje').eq('obra_id', obraId).order('fecha', { ascending: true }).limit(200),
        db.from('adicionales').select('fecha, tipo, descripcion, estado').eq('obra_id', obraId).gte('fecha', desde).limit(50),
        db.from('obra_imagenes').select('id', { count: 'exact', head: true }).eq('obra_id', obraId).gte('created_at', desde),
        db.from('configuracion').select('valor').eq('clave', 'empresa').maybeSingle(),
      ])
      const avances = (rAv.data ?? []) as { fecha: string; titulo: string; descripcion: string | null; estado: string | null; porcentaje: number | null }[]
      const recientes = avances.filter((a) => a.fecha >= desde)
      const anteriores = avances.filter((a) => a.fecha < desde).slice(-3)
      const empresa = recorte((rConf.data?.valor as { nombre?: string } | null)?.nombre, 80) || 'MOVA Tecnología Smart'
      const cli = rCli.data as { nombre: string; apellido: string | null; telefono: string | null } | null
      const linea = (a: typeof avances[number]) => `- ${a.fecha} · ${a.titulo}${a.descripcion ? `: ${recorte(a.descripcion, 400)}` : ''}${a.porcentaje != null ? ` (${a.porcentaje}%)` : ''}`
      const texto = `EMPRESA: ${empresa}\nCLIENTE: ${cli ? `${cli.nombre} ${cli.apellido ?? ''}` : ''}\nOBRA: ${obra.nombre_obra}${obra.localidad ? ` (${obra.localidad})` : ''}\nESTADO: ${obra.estado ?? 'en_proceso'} · AVANCE TOTAL: ${Number(obra.porcentaje_avance) || 0}%${obra.fecha_fin_estimada ? ` · fin estimado ${obra.fecha_fin_estimada}` : ''}\nPERÍODO: últimos ${dias} días (desde ${desde})\nTONO: ${tono}\n\nAVANCES DEL PERÍODO:\n${recientes.map(linea).join('\n') || '(ninguno)'}\n\nAVANCES ANTERIORES (contexto):\n${anteriores.map(linea).join('\n') || '(ninguno)'}\n\nADICIONALES Y CAMBIOS DEL PERÍODO:\n${((rAd.data ?? []) as { fecha: string; tipo: string; descripcion: string; estado: string }[]).map((a) => `- ${a.fecha} · ${a.tipo}: ${recorte(a.descripcion, 200)} (${a.estado})`).join('\n') || '(ninguno)'}\n\nFOTOS CARGADAS EN EL PERÍODO: ${rImg.count ?? 0}`
      const r = await gemini(clave, texto, { type: 'OBJECT', properties: { mensaje: { type: 'STRING' } }, required: ['mensaje'] }, SISTEMA_INFORME, 0.6) as { mensaje?: string }
      return responder({ mensaje: recorte(r.mensaje, 3000), telefono: cli?.telefono ?? null, avances_periodo: recientes.length, fotos_periodo: rImg.count ?? 0 })
    }
    if (accion === 'resumen_dia') {
      const hechos = (Array.isArray(cuerpo.hechos) ? cuerpo.hechos : []).map((x) => recorte(x, 220)).filter(Boolean).slice(0, 60)
      const hoy = recorte(cuerpo.hoy, 60)
      const esquema = { type: 'OBJECT', properties: {
        saludo: { type: 'STRING' },
        puntos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { icono: { type: 'STRING' }, texto: { type: 'STRING' }, ir: { type: 'STRING', enum: ['agenda', 'obras', 'presupuestos', 'cobranzas', 'personal', 'gastos', 'ninguno'] } }, required: ['icono', 'texto', 'ir'] } },
      }, required: ['saludo', 'puntos'] }
      const r = await gemini(clave, `HOY: ${hoy}\n\nDATOS:\n${hechos.map((h) => `- ${h}`).join('\n') || '(no hay nada pendiente)'}`, esquema, SISTEMA_RESUMEN_DIA, 0.5) as { saludo?: string; puntos?: { icono: string; texto: string; ir: string }[] }
      return responder({ saludo: recorte(r.saludo, 200), puntos: (r.puntos ?? []).slice(0, 5).map((x) => ({ icono: recorte(x.icono, 8), texto: recorte(x.texto, 260), ir: x.ir })).filter((x) => x.texto) })
    }
    return responder({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    const m = (e as Error).message
    if (m.startsWith('clave|')) return responder({ error: `Google rechazó la clave de Gemini (GEMINI_API_KEY): ${m.slice(6)}` }, 400)
    if (m.startsWith('claude|')) return responder({ error: m.slice(7) }, 502)
    if (m.startsWith('límite|')) {
      const diario = /per ?day|PerDay|daily/i.test(m)
      return responder({ error: `${diario ? 'Se agotó el cupo gratuito de Gemini de hoy' : 'Se alcanzó el límite gratuito de Gemini por un rato: probá en un minuto'}. Detalle de Google: ${m.slice(7, 600)}` }, 429)
    }
    return responder({ error: `No se pudo generar el texto. Detalle de Google: ${m}` }, 502)
  }
})
