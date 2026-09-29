// Supabase Edge Function: enviar-recordatorios
// Envía notificaciones push (Web Push / VAPID) de la Agenda cuando llega la hora del aviso.
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
    return new Response(JSON.stringify({ recordatorios: 0, enviados: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: subs } = await supabase.from('push_subscriptions').select('id,endpoint,p256dh,auth')
  let enviados = 0
  for (const r of recs) {
    const tipos: Record<string, string> = { reunion: '🤝 Reunión', visita: '🏠 Visita de obra', llamada: '📞 Llamada', recordatorio: '🔔 Recordatorio' }
    const cuando = r.hora ? `${String(r.fecha).split('-').reverse().slice(0, 2).join('/')} ${String(r.hora).slice(0, 5)}` : String(r.fecha).split('-').reverse().slice(0, 2).join('/')
    const body = [r.titulo, cuando, r.lugar].filter(Boolean).join(' · ')
    const payload = JSON.stringify({ title: `MOVA — ${tipos[r.tipo ?? ''] ?? tipos.recordatorio}`, body, url: '/', tag: 'rec-' + r.id })
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
