import { supabase } from './supabase'

// Llama a la Edge Function "asistente-ia" (Gemini) y devuelve la respuesta o
// un mensaje de error claro.
export async function pedirAsistente<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('asistente-ia', { body: cuerpo })
  if (error || data?.error) {
    if (data?.error) throw new Error(data.error)
    throw new Error(await explicarFallo(error))
  }
  return data as T
}

// Achica una foto (máx. 1600 px, JPEG) y la devuelve en base64 para mandarla a la IA.
// maxLado: lado más largo de la imagen que se manda (los planos necesitan más detalle).
export async function archivoParaIA(archivo: File, maxLado = 1600): Promise<{ data: string; mime: string }> {
  const aBase64 = (blob: Blob) => new Promise<string>((ok, mal) => {
    const lector = new FileReader()
    lector.onload = () => ok(String(lector.result).split(',')[1] ?? '')
    lector.onerror = () => mal(lector.error)
    lector.readAsDataURL(blob)
  })
  if (archivo.type === 'application/pdf') return { data: await aBase64(archivo), mime: 'application/pdf' }
  try {
    const url = URL.createObjectURL(archivo)
    const img = document.createElement('img')
    await new Promise<void>((ok, mal) => { img.onload = () => ok(); img.onerror = () => mal(new Error('img')); img.src = url })
    const max = maxLado
    let w = img.naturalWidth, h = img.naturalHeight
    if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r) }
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85))
    if (blob) return { data: await aBase64(blob), mime: 'image/jpeg' }
  } catch { /* si no se puede achicar, se manda tal cual */ }
  return { data: await aBase64(archivo), mime: archivo.type || 'image/jpeg' }
}

// Qué pasó cuando la función no contestó bien, dicho para poder arreglarlo.
async function explicarFallo(error: unknown): Promise<string> {
  const nombre = (error as { name?: string } | null)?.name ?? ''
  const ctx = (error as { context?: Response } | null)?.context
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'No hay internet. Probá de nuevo cuando tengas conexión.'
  if (nombre === 'FunctionsFetchError' || !ctx) {
    return 'La función "asistente-ia" de Supabase no respondió. Suele pasar cuando falló al arrancar después de publicarla (código pegado incompleto) o cuando no está publicada. En Supabase → Edge Functions → asistente-ia mirá "Logs"; si dice que falló al iniciar, volvé a pegar el código completo y tocá Deploy (Verify JWT apagado).'
  }
  let detalle = ''
  try { const j = await ctx.clone().json() as { error?: string; message?: string; code?: string }; if (j.error) return j.error; detalle = `${j.code ?? ''} ${j.message ?? ''}`.trim() } catch { /* sin detalle */ }
  if (ctx.status === 404) return 'La función "asistente-ia" no está publicada en Supabase. Creala en Edge Functions con el código del repositorio (Verify JWT apagado).'
  if (ctx.status === 401) return 'Supabase rechazó la llamada a "asistente-ia": apagá "Verify JWT" en la configuración de la función y volvé a publicarla.'
  if (/BOOT|failed to start/i.test(detalle) || ctx.status === 503) return `La función "asistente-ia" falló al arrancar en Supabase. Volvé a pegar el código completo y tocá Deploy.${detalle ? ` (${detalle})` : ''}`
  return `La función "asistente-ia" devolvió un error (${ctx.status}${detalle ? `: ${detalle}` : ''}). Mirá los Logs de la función en Supabase.`
}
