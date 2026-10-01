import { supabase } from './supabase'

// Llama a la Edge Function "asistente-ia" (Gemini) y devuelve la respuesta o
// un mensaje de error claro.
export async function pedirAsistente<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('asistente-ia', { body: cuerpo })
  if (error || data?.error) {
    let msg = data?.error ?? 'No se pudo conectar con el asistente de IA. Revisá que la función "asistente-ia" esté instalada en Supabase (con Verify JWT apagado).'
    try { const ctx = (error as { context?: Response } | null)?.context; if (ctx) { const j = await ctx.json(); msg = j.error ?? j.message ?? msg } } catch { /* sin detalle */ }
    throw new Error(msg)
  }
  return data as T
}

// Achica una foto (máx. 1600 px, JPEG) y la devuelve en base64 para mandarla a la IA.
export async function archivoParaIA(archivo: File): Promise<{ data: string; mime: string }> {
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
    const max = 1600
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
