import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './AppFase2.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA: registra el service worker (instalable + notificaciones push)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin SW: la app sigue funcionando */ })
  })
}
