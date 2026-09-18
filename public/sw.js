// MOVA Gestión — Service Worker (PWA + notificaciones push)
const CACHE = 'mova-shell-v1'
const SHELL = ['/', '/index.html', '/icon-192.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

// Solo el "shell" es offline-first (network-first con fallback). Los datos van siempre a la red.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')))
  }
})

// Recibe la notificación push (recordatorios/alertas)
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  const title = data.title || 'MOVA Gestión'
  const options = {
    body: data.body || 'Tenés un recordatorio pendiente.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// Al tocar la notificación, abre/enfoca la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) { w.navigate && w.navigate(url); return w.focus() } }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    }),
  )
})
