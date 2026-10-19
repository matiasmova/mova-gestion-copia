import { useEffect, useRef, useState } from 'react'
import { supabase, msDesdeUltimaEscritura } from './supabase'

// Mantiene la pantalla al día cuando se cambia algo desde otro dispositivo
// (por ejemplo, cargás un producto en el celular y tenés la app abierta en la PC):
//  · Escucha los cambios de Supabase (Realtime) en las tablas principales.
//  · Si no estás en medio de algo (sin ventanas abiertas ni escribiendo), la
//    pantalla se actualiza sola. Si estás editando, aparece un aviso para
//    actualizar cuando quieras, así no se pierde lo que estabas haciendo.
//  · También se actualiza al volver a la pestaña después de un rato.
// Los cambios hechos desde este mismo dispositivo no disparan nada.

const TABLAS = ['productos_servicios', 'presupuestos', 'presupuesto_items', 'obras', 'Clientes', 'pagos', 'costos', 'materiales', 'gastos_generales', 'recordatorios', 'personal', 'obra_asignaciones', 'jornales', 'adicionales', 'obra_avances', 'relevamientos']

// ¿Hay algo abierto que se perdería al actualizar? (ventanas, editores, campos con foco)
function ocupado() {
  if (document.querySelector('.modalOverlay, .pvFondo, .isVelo, .epFondo, .oeHojaFondo, .bgCaja, [role="dialog"]')) return true
  const a = document.activeElement
  return !!a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)
}

export function useActualizarDatos(onActualizar: () => void) {
  const [hayCambios, setHayCambios] = useState(false)
  const tEspera = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimaVista = useRef(Date.now())
  const cb = useRef(onActualizar)
  cb.current = onActualizar

  useEffect(() => {
    const intentar = () => {
      if (ocupado()) { setHayCambios(true); return }
      setHayCambios(false)
      cb.current()
    }
    const canal = supabase.channel('cambios-app')
    TABLAS.forEach((tabla) => {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, () => {
        // Lo guardado desde este dispositivo no cuenta.
        if (msDesdeUltimaEscritura() < 6000) return
        if (tEspera.current) clearTimeout(tEspera.current)
        tEspera.current = setTimeout(intentar, 1500)
      })
    })
    canal.subscribe()
    // Al volver a la pestaña después de más de 1 minuto, se actualiza.
    const visible = () => {
      if (document.visibilityState === 'hidden') { ultimaVista.current = Date.now(); return }
      if (Date.now() - ultimaVista.current > 60000) intentar()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      if (tEspera.current) clearTimeout(tEspera.current)
      document.removeEventListener('visibilitychange', visible)
      void supabase.removeChannel(canal)
    }
  }, [])

  return { hayCambios, listo: () => setHayCambios(false) }
}

// ¿Se publicó una versión nueva del sistema? El celular (sobre todo la app
// agregada a la pantalla de inicio) puede quedar días con la versión vieja
// abierta: se compara el archivo principal de la página publicada con el que
// está corriendo, al volver a la app y cada 10 minutos.
export function useVersionNueva() {
  const [hayVersion, setHayVersion] = useState(false)
  useEffect(() => {
    const actual = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')).map((s) => new URL(s.src).pathname).find((p) => p.includes('/assets/'))
    if (!actual) return // en desarrollo no hay versión publicada
    let cancelado = false
    const revisar = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const html = await (await fetch(`/?v=${Date.now()}`, { cache: 'no-store' })).text()
        const publicada = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/.exec(html)?.[1]
        if (!cancelado && publicada && new URL(publicada, location.href).pathname !== actual) setHayVersion(true)
      } catch { /* sin conexión: se revisa la próxima vez */ }
    }
    void revisar()
    const t = window.setInterval(() => void revisar(), 10 * 60 * 1000)
    document.addEventListener('visibilitychange', revisar)
    return () => { cancelado = true; window.clearInterval(t); document.removeEventListener('visibilitychange', revisar) }
  }, [])
  return hayVersion
}
