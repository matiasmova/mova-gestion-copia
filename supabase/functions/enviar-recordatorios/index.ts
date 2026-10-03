// Supabase Edge Function: enviar-recordatorios
// Envía notificaciones push (Web Push / VAPID) de la Agenda cuando llega la hora del aviso.
// Se invoca por cron (pg_cron). Secrets necesarios:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.)
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

// La página de pago llama desde el navegador: permite esa llamada (solo POST).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  // Seguridad: solo el cron con el secreto correcto dispara el envío completo.
  // Sin secreto (la página de pago, al enviar un comprobante) solo se avisan los
  // comprobantes pendientes de aviso: no recibe datos ni puede elegir qué mandar.
  const conSecreto = req.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET')
  let soloComprobantes = false
  if (!conSecreto) {
    const cuerpo = await req.json().catch(() => null) as { solo?: string } | null
    if (cuerpo?.solo !== 'comprobantes') return new Response('No autorizado', { status: 401, headers: CORS })
    soloComprobantes = true
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  webpush.setVapidDetails(
    'mailto:soporte@movaelectronica.com.ar',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )

  const { data: subs } = await supabase.from('push_subscriptions').select('id,endpoint,p256dh,auth')
  let enviados = 0
  async function enviarATodos(payload: string) {
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        enviados++
      } catch (e) {
        // 404/410 = suscripción vencida → la borramos
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) await supabase.from('push_subscriptions').delete().eq('id', s.id)
      }
    }
  }

  // Comprobantes de pago que mandaron los clientes (fase 25).
  const { data: comps } = await supabase.from('pago_comprobantes')
    .select('id,cliente,titulo,obra_id').eq('notificado', false).eq('origen', 'cliente').limit(20)
  for (const c of comps ?? []) {
    // Se marca primero para no mandar el mismo aviso dos veces si llegan dos llamadas juntas.
    const { data: marcado } = await supabase.from('pago_comprobantes').update({ notificado: true }).eq('id', c.id).eq('notificado', false).select('id')
    if (!marcado?.length) continue
    await enviarATodos(JSON.stringify({
      title: 'MOVA — 🧾 Comprobante de pago recibido',
      body: `${c.cliente ?? 'Un cliente'} envió un comprobante${c.titulo ? ` · ${c.titulo}` : ''}. Tocá para revisarlo.`,
      url: '/', tag: 'comp-' + c.id,
    }))
  }
  if (soloComprobantes) {
    return new Response(JSON.stringify({ comprobantes: comps?.length ?? 0, enviados }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Agenda: se avisa cuando llega notificar_en (fecha + hora − anticipación, lo calcula la app).
  // Solo lo de las últimas 24 h, para no mandar de golpe avisos viejos.
  const ahora = new Date()
  const desde = new Date(ahora.getTime() - 24 * 3600 * 1000)
  const { data: recs, error } = await supabase
    .from('recordatorios')
    .select('id,titulo,fecha,hora,tipo,lugar')
    .eq('completado', false)
    .eq('notificado', false)
    .not('notificar_en', 'is', null)
    .lte('notificar_en', ahora.toISOString())
    .gte('notificar_en', desde.toISOString())
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  if (!recs || recs.length === 0) {
    return new Response(JSON.stringify({ recordatorios: 0, enviados }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  for (const r of recs) {
    const tipos: Record<string, string> = { reunion: '🤝 Reunión', visita: '🏠 Visita de obra', llamada: '📞 Llamada', recordatorio: '🔔 Recordatorio' }
    const cuando = r.hora ? `${String(r.fecha).split('-').reverse().slice(0, 2).join('/')} ${String(r.hora).slice(0, 5)}` : String(r.fecha).split('-').reverse().slice(0, 2).join('/')
    const body = [r.titulo, cuando, r.lugar].filter(Boolean).join(' · ')
    const payload = JSON.stringify({ title: `MOVA — ${tipos[r.tipo ?? ''] ?? tipos.recordatorio}`, body, url: '/', tag: 'rec-' + r.id })
    await enviarATodos(payload)
    await supabase.from('recordatorios').update({ notificado: true }).eq('id', r.id)
  }

  return new Response(JSON.stringify({ recordatorios: recs.length, enviados }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
