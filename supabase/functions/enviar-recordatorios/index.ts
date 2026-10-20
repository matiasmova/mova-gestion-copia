// Supabase Edge Function: enviar-recordatorios
// Envía notificaciones push (Web Push / VAPID) de la Agenda cuando llega la hora del aviso,
// y el resumen de "Para hacer": a la mañana (lo del día) y el viernes a la tarde (la semana).
// Qué se manda y a qué hora se elige en la app (Para hacer → 🔔 Avisos → configuracion "avisos").
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

  const { data: subs } = await supabase.from('push_subscriptions').select('id,endpoint,p256dh,auth,user_id')
  let enviados = 0
  async function enviarATodos(payload: string, lista = subs ?? []) {
    for (const s of lista) {
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

  // ---- Resumen de "Para hacer" (solo a los administradores) ----
  try { await resumenes(supabase, subs ?? [], enviarATodos) } catch (e) { console.error('resumen', e) }

  // Notas (fase 39): se avisa a quien la escribió cuando llega notificar_en.
  try {
    const ahoraN = new Date()
    const { data: notas } = await supabase.from('notas').select('id,texto,fecha,hora,user_id')
      .eq('hecha', false).eq('notificado', false).not('notificar_en', 'is', null)
      .lte('notificar_en', ahoraN.toISOString()).gte('notificar_en', new Date(ahoraN.getTime() - 24 * 3600 * 1000).toISOString())
    for (const n of (notas ?? []) as { id: number; texto: string; fecha: string | null; hora: string | null; user_id: string }[]) {
      const { data: marcada } = await supabase.from('notas').update({ notificado: true }).eq('id', n.id).eq('notificado', false).select('id')
      if (!marcada?.length) continue
      const suyas = (subs ?? []).filter((s) => s.user_id === n.user_id)
      if (!suyas.length) continue
      const cuando = n.fecha ? `${String(n.fecha).split('-').reverse().slice(0, 2).join('/')}${n.hora ? ` ${String(n.hora).slice(0, 5)}` : ''}` : ''
      await enviarATodos(JSON.stringify({ title: '📝 MOVA — Nota', body: [n.texto.slice(0, 180), cuando].filter(Boolean).join(' · '), url: '/', tag: 'nota-' + n.id }), suyas)
    }
  } catch (e) { console.error('notas', e) } // sin la tabla (falta el SQL de la fase 39) sigue igual

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

// ---------------------------------------------------------------------------
// Resumen de la mañana y del viernes. Se fija la hora de Argentina (UTC−3) y
// manda cada uno una sola vez por día (lo anota en configuracion "avisos_estado").
type Sub = { id: number; endpoint: string; p256dh: string; auth: string; user_id: string | null }
type Cliente = ReturnType<typeof createClient>
const pesos = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`
const cortoP = pesos // montos con el número completo

async function resumenes(db: Cliente, subs: Sub[], enviar: (payload: string, lista?: Sub[]) => Promise<void>) {
  const { data: cfgRow } = await db.from('configuracion').select('valor').eq('clave', 'avisos').maybeSingle()
  const cfg = { resumen: true, hora: 8, viernes: true, stock: true, ...((cfgRow?.valor as Record<string, unknown>) ?? {}) } as { resumen: boolean; hora: number; viernes: boolean; stock: boolean }
  const ar = new Date(Date.now() - 3 * 3600 * 1000)
  const hoy = ar.toISOString().slice(0, 10)
  const hora = ar.getUTCHours()
  const esManana = cfg.resumen && hora >= Number(cfg.hora) && hora < Number(cfg.hora) + 3
  const esViernes = cfg.viernes && ar.getUTCDay() === 5 && hora >= 18 && hora < 21
  if (!esManana && !esViernes) return
  const { data: estRow } = await db.from('configuracion').select('valor').eq('clave', 'avisos_estado').maybeSingle()
  const est = ((estRow?.valor as Record<string, string>) ?? {}) as { manana?: string; viernes?: string }
  const tocaManana = esManana && est.manana !== hoy
  const tocaViernes = esViernes && est.viernes !== hoy
  if (!tocaManana && !tocaViernes) return
  // Se anota antes de mandar, para no repetirlo si el cron corre dos veces.
  await db.from('configuracion').upsert({ clave: 'avisos_estado', valor: { ...est, ...(tocaManana ? { manana: hoy } : {}), ...(tocaViernes ? { viernes: hoy } : {}) }, updated_at: new Date().toISOString() })

  // Solo a los administradores (y a suscripciones viejas sin usuario).
  const { data: admins } = await db.from('profiles').select('id').eq('rol', 'admin')
  const ids = new Set(((admins ?? []) as { id: string }[]).map((a) => a.id))
  const destino = subs.filter((s) => !s.user_id || ids.has(s.user_id))
  if (!destino.length) return

  // Cobros: por obra, lo que corresponde según el avance menos lo cobrado.
  const [rO, rP, rA, rPa] = await Promise.all([
    db.from('obras').select('id,nombre_obra,estado,porcentaje_avance,fecha_fin_estimada').eq('activo', true),
    db.from('presupuestos').select('id,obra_id,total,estado,fecha,titulo').eq('activo', true),
    db.from('adicionales').select('obra_id,importe,estado,tipo'),
    db.from('pagos').select('obra_id,monto,fecha'),
  ])
  const obras = (rO.data ?? []) as { id: number; nombre_obra: string; estado: string | null; porcentaje_avance: number | null; fecha_fin_estimada: string | null }[]
  const pres = (rP.data ?? []) as { id: number; obra_id: number | null; total: number; estado: string; fecha: string | null; titulo: string }[]
  const adic = (rA.data ?? []) as { obra_id: number; importe: number; estado: string; tipo: string }[]
  const pagos = (rPa.data ?? []) as { obra_id: number | null; monto: number; fecha: string }[]
  const cobros = obras.map((o) => {
    const valor = pres.filter((x) => x.obra_id === o.id && x.estado === 'aceptado').reduce((s, x) => s + Number(x.total || 0), 0)
      + adic.filter((a) => a.obra_id === o.id && a.estado === 'aprobado' && a.tipo !== 'gasto_extra').reduce((s, a) => s + Number(a.importe || 0), 0)
    const pagado = pagos.filter((x) => x.obra_id === o.id).reduce((s, x) => s + Number(x.monto || 0), 0)
    const avance = o.estado === 'finalizada' || o.estado === 'observacion' ? 100 : Math.max(0, Math.min(100, Number(o.porcentaje_avance) || 0))
    // Misma regla que la app: seña del 60% + el 40% restante según el avance de la obra.
    const sena = valor * 0.6
    return { nombre: o.nombre_obra, monto: sena + (valor - sena) * avance / 100 - pagado }
  }).filter((c) => c.monto > 0.5).sort((a, b) => b.monto - a.monto)
  const totalCobros = cobros.reduce((s, c) => s + c.monto, 0)

  if (tocaManana) {
    const hace30 = new Date(ar.getTime() - 30 * 86400000).toISOString().slice(0, 10)
    const [rR, rAt, rN, rS] = await Promise.all([
      db.from('recordatorios').select('titulo,hora').eq('fecha', hoy).eq('completado', false).order('hora', { ascending: true, nullsFirst: true }),
      db.from('recordatorios').select('id', { count: 'exact', head: true }).lt('fecha', hoy).gte('fecha', hace30).eq('completado', false),
      db.from('notas').select('id', { count: 'exact', head: true }).eq('fecha', hoy).eq('hecha', false).in('user_id', [...ids]),
      cfg.stock ? db.from('productos_servicios').select('stock,stock_minimo').eq('tipo', 'producto').eq('activo', true).gt('stock_minimo', 0) : Promise.resolve({ data: [] }),
    ])
    const agenda = (rR.data ?? []) as { titulo: string; hora: string | null }[]
    const hace3 = new Date(ar.getTime() - 3 * 86400000).toISOString().slice(0, 10)
    const borradores = pres.filter((x) => x.estado === 'borrador').length
    const sinRespuesta = pres.filter((x) => x.estado === 'enviado' && (x.fecha ?? hoy) <= hace3).length
    const vencidas = obras.filter((o) => (o.estado ?? 'en_proceso') === 'en_proceso' && o.fecha_fin_estimada && o.fecha_fin_estimada < hoy).length
    const stockBajo = ((rS.data ?? []) as { stock: number; stock_minimo: number }[]).filter((x) => Number(x.stock) <= Number(x.stock_minimo)).length
    const lineas = [
      cobros.length ? `💵 Cobrar ${cobros.length === 1 ? `a ${cobros[0].nombre}` : `${cobros.length} obras`}: ${cortoP(totalCobros)}` : '',
      agenda.length ? `📍 ${agenda.length === 1 ? `${agenda[0].hora ? agenda[0].hora.slice(0, 5) + ' ' : ''}${agenda[0].titulo}` : `${agenda.length} cosas en la agenda${agenda[0].hora ? ` (la primera ${agenda[0].hora.slice(0, 5)})` : ''}`}` : '',
      rN.count ? `📝 ${rN.count} nota${rN.count === 1 ? '' : 's'} para hoy` : '',
      borradores ? `📤 ${borradores} presupuesto${borradores === 1 ? '' : 's'} para enviar` : '',
      sinRespuesta ? `💬 ${sinRespuesta} presupuesto${sinRespuesta === 1 ? '' : 's'} sin respuesta` : '',
      vencidas ? `⏰ ${vencidas} obra${vencidas === 1 ? '' : 's'} con el plazo vencido` : '',
      stockBajo ? `📦 ${stockBajo} producto${stockBajo === 1 ? '' : 's'} con stock bajo` : '',
      rAt.count ? `⚠ ${rAt.count} atrasada${rAt.count === 1 ? '' : 's'} en la agenda` : '',
    ].filter(Boolean)
    await enviar(JSON.stringify({
      title: lineas.length ? `☀ Buen día · hoy tenés ${lineas.length} cosa${lineas.length === 1 ? '' : 's'} para hacer` : '☀ Buen día · nada urgente para hoy',
      body: lineas.length ? lineas.join('\n') : 'Todo al día. Tocá para ver la semana.',
      url: '/', tag: 'resumen-' + hoy,
    }), destino)
  }

  if (tocaViernes) {
    const d = new Date(`${hoy}T12:00:00Z`)
    const lunes = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
    const vendido = pres.filter((x) => x.estado === 'aceptado' && (x.fecha ?? '').slice(0, 10) >= lunes && (x.fecha ?? '').slice(0, 10) <= hoy).reduce((s, x) => s + Number(x.total || 0), 0)
    const cobrado = pagos.filter((x) => (x.fecha ?? '').slice(0, 10) >= lunes && (x.fecha ?? '').slice(0, 10) <= hoy).reduce((s, x) => s + Number(x.monto || 0), 0)
    await enviar(JSON.stringify({
      title: '📊 Así cerró la semana',
      body: [`Vendiste ${cortoP(vendido)} · cobraste ${cortoP(cobrado)}`, cobros.length ? `Quedan ${cobros.length} cobro${cobros.length === 1 ? '' : 's'} por ${cortoP(totalCobros)}` : 'No quedan cobros pendientes ✓'].join('\n'),
      url: '/', tag: 'semana-' + hoy,
    }), destino)
  }
}
