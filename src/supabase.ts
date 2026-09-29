import { createClient } from '@supabase/supabase-js'

// Credenciales públicas de Supabase.
// Primero se usan las variables de entorno (archivo .env en StackBlitz o las
// cargadas en Vercel). Si en el build llegan vacías, se usan estos valores de
// respaldo. La clave "sb_publishable_..." es pública por diseño: lo que protege
// los datos son las reglas RLS de Supabase. NUNCA poner acá la clave secret.
const URL_RESPALDO = 'https://aceukzftfkjhmponaktd.supabase.co'
const KEY_RESPALDO = 'sb_publishable_zF0jgcP_kbp777ztfZR2Fg_kLTzM7dp'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || URL_RESPALDO
const supabaseKey = (import.meta.env.VITE_SUPABASE_KEY as string | undefined)?.trim() || KEY_RESPALDO

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Faltan las credenciales de Supabase')
}

// Si se entró desde el link de una invitación o de "olvidé mi contraseña", se
// anota ANTES de crear el cliente (que después limpia la dirección), para
// mostrar la pantalla de crear contraseña.
export const TIPO_LINK_AUTH: 'invite' | 'recovery' | null = (() => {
  try {
    const m = /type=(invite|recovery)/.exec(`${window.location.hash}${window.location.search}`)
    return m ? (m[1] as 'invite' | 'recovery') : null
  } catch { return null }
})()

export const supabase = createClient(supabaseUrl, supabaseKey)
