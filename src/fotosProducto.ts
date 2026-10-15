import { supabase } from './supabase'

// Fotos de productos del catálogo (bucket "productos").

export const BUCKET_PRODUCTOS = 'productos'

// Comprime y redimensiona la imagen antes de subirla, para ocupar el mínimo de storage.
// Reescala a máx. 1000px y exporta WebP ~0.8 (una foto de celular de ~4MB queda en ~100-200KB).
export async function comprimirImagen(file: File): Promise<Blob> {
  try {
    const url = URL.createObjectURL(file)
    const img = document.createElement('img')
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('img')); img.src = url })
    const max = 1000
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
    if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r) }
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    const armar = (tipo: string, calidad: number) => new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), tipo, calidad))
    // Safari (iPhone) no arma WebP y devuelve PNG pesado: en ese caso se usa JPEG.
    let blob = await armar('image/webp', 0.8)
    if (!blob || blob.type !== 'image/webp') blob = await armar('image/jpeg', 0.85)
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

// Comprime y sube una foto. Devuelve la ruta guardada o un mensaje de error claro.
export async function subirFotoProducto(file: File): Promise<{ path: string } | { error: string }> {
  const comprimida = await comprimirImagen(file)
  // El iPhone no siempre arma WebP: se usa el tipo real de la imagen para el nombre y el formato.
  const tipo = comprimida.type || file.type || 'image/jpeg'
  const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : tipo.includes('hei') ? 'heic' : 'jpg'
  const path = `p-${Date.now()}.${ext}`
  const subida = await supabase.storage.from(BUCKET_PRODUCTOS).upload(path, comprimida, { upsert: true, contentType: tipo })
  if (subida.error) {
    console.error(subida.error)
    const msg = subida.error.message ?? ''
    return {
      error: /row-level|policy|unauthorized|not found|bucket/i.test(msg)
        ? 'No se pudo subir la foto: falta correr en Supabase el SQL "supabase-fotos-productos-fase-29.sql".'
        : /size|large/i.test(msg) ? 'No se pudo subir la foto: es muy pesada (máximo 10 MB).' : `No se pudo subir la foto. ${msg}`,
    }
  }
  return { path }
}
