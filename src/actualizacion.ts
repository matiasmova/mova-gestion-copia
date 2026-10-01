// Avisa cuando hay una versión nueva publicada. En el celular la app queda
// abierta en memoria días enteros y no se entera de las mejoras: cada vez que
// vuelve a primer plano (y cada 10 minutos) compara el archivo principal
// publicado con el que está usando y, si cambió, muestra un botón para actualizar.

const scriptActual = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src') ?? ''

async function hayVersionNueva(): Promise<boolean> {
  const actual = scriptActual()
  if (!actual) return false // en desarrollo no hay archivo compilado
  try {
    const r = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return false
    const m = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/.exec(await r.text())
    return !!m && m[1] !== actual
  } catch { return false }
}

function mostrarAviso() {
  if (document.getElementById('avisoVersion')) return
  const aviso = document.createElement('div')
  aviso.id = 'avisoVersion'
  aviso.setAttribute('role', 'status')
  aviso.innerHTML = '<span>✨ Hay una versión nueva de la app</span><button type="button">Actualizar</button>'
  aviso.querySelector('button')!.addEventListener('click', () => window.location.reload())
  document.body.appendChild(aviso)
}

export function vigilarActualizaciones() {
  let ultima = 0
  const revisar = async () => {
    if (Date.now() - ultima < 30_000) return
    ultima = Date.now()
    if (await hayVersionNueva()) mostrarAviso()
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void revisar() })
  window.addEventListener('focus', () => { void revisar() })
  setInterval(() => { void revisar() }, 10 * 60_000)
}
