import { supabase } from './supabase'

// Clave VAPID PÚBLICA (es pública por diseño; la privada va solo en la Edge Function).
const VAPID_PUBLIC = 'BN_Y26WGdU2vg9z0xNOwhlaJPyl2XfJH83a1tlVo6wHJ1BPmn5ZwxeIdZcAqxUTjadQ3SmofxEzeSwgurecWsqI'

export type EstadoPush = 'no-soportado' | 'activo' | 'inactivo' | 'bloqueado'

function base64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function pushSoportado() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function estadoPush(): Promise<EstadoPush> {
  if (!pushSoportado()) return 'no-soportado'
  if (Notification.permission === 'denied') return 'bloqueado'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  return sub ? 'activo' : 'inactivo'
}

export async function activarPush(): Promise<{ ok: boolean; msg: string }> {
  if (!pushSoportado()) {
    return { ok: false, msg: 'Este dispositivo no soporta notificaciones. En iPhone, primero agregá la app a la pantalla de inicio (Compartir → Agregar a inicio).' }
  }
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') return { ok: false, msg: 'No se concedió el permiso de notificaciones.' }

  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64ToUint8Array(VAPID_PUBLIC),
  })
  const json = sub.toJSON()
  const { data: userData } = await supabase.auth.getUser()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userData.user?.id ?? null,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: 'endpoint' },
  )
  if (error) return { ok: false, msg: 'No se pudo guardar la suscripción: ' + error.message }
  return { ok: true, msg: '¡Listo! Vas a recibir las alertas en este dispositivo.' }
}

export async function desactivarPush(): Promise<{ ok: boolean; msg: string }> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
  return { ok: true, msg: 'Notificaciones desactivadas en este dispositivo.' }
}
