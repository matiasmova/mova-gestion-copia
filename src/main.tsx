import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './AppFase2.tsx'
import PaginaPago from './PaginaPago'
import './index.css'
import { vigilarActualizaciones } from './actualizacion'

// Página pública de pago del cliente (?pagar=código): sin login ni el resto de la app.
const tokenPago = new URLSearchParams(window.location.search).get('pagar')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {tokenPago ? <PaginaPago token={tokenPago} /> : <App />}
  </React.StrictMode>,
)

// PWA: registra el service worker (instalable + notificaciones push)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin SW: la app sigue funcionando */ })
  })
}

// Aviso de versión nueva (la app abierta en el celular no se recarga sola).
if (!tokenPago) vigilarActualizaciones()
