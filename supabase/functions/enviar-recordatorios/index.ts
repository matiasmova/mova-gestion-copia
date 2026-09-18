// Supabase Edge Function: enviar-recordatorios
// Envía notificaciones push (Web Push / VAPID) de los recordatorios vencidos o de hoy.
// Se invoca por cron (pg_cron). Secrets necesarios:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.)
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  // Seguridad: solo el cron con el secreto correcto puede disparar el envío.
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('No autorizado', { status: 401 })
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

  const hoy = new Date().toISOString().slice(0, 10)
  const { data: recs, error } = await supabase
    .from('recordatorios')
    .select('id,titulo,fecha')
    .eq('completado', false)
    .eq('notificado', false)
    .lte('fecha', hoy)
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  if (!recs || recs.length === 0) {
    return new Response(JSON.stringify({ recordatorios: 0, enviados: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: subs } = await supabase.from('push_subscriptions').select('id,endpoint,p256dh,auth')
  let enviados = 0
  for (const r of recs) {
    const payload = JSON.stringify({ title: 'MOVA — Recordatorio', body: r.titulo, url: '/', tag: 'rec-' + r.id })
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        enviados++
      } catch (e) {
        // 404/410 = suscripción vencida → la borramos
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) await supabase.from('push_subscriptions').delete().eq('id', s.id)
      }
    }
    await supabase.from('recordatorios').update({ notificado: true }).eq('id', r.id)
  }

  return new Response(JSON.stringify({ recordatorios: recs.length, enviados }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
