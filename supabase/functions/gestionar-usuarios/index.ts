// Supabase Edge Function: gestionar-usuarios
// Invita usuarios nuevos por email desde la app (pantalla Usuarios).
// Solo la puede usar un administrador activo. Usa la clave service_role, que
// Supabase inyecta sola (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY): nunca va en el código.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const ROLES = ['admin', 'encargado', 'auxiliar', 'contable']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // 1) ¿Quién llama? Tiene que ser un administrador activo.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: quien, error: errUser } = await admin.auth.getUser(token)
  if (errUser || !quien?.user) return responder({ error: 'No autorizado' }, 401)
  const { data: perfil } = await admin.from('profiles').select('rol, activo').eq('id', quien.user.id).maybeSingle()
  if (!perfil || perfil.rol !== 'admin' || perfil.activo === false) return responder({ error: 'Solo un administrador puede invitar usuarios.' }, 403)

  // 2) Invitar
  const { accion, email, nombre, rol, redirectTo } = await req.json().catch(() => ({}))
  if (accion !== 'invitar') return responder({ error: 'Acción desconocida' }, 400)
  const correo = String(email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return responder({ error: 'El email no es válido.' }, 400)
  const rolFinal = ROLES.includes(rol) ? rol : 'auxiliar'
  const nombreFinal = String(nombre ?? '').trim() || correo

  const { data: invitado, error: errInv } = await admin.auth.admin.inviteUserByEmail(correo, {
    data: { nombre: nombreFinal },
    redirectTo: typeof redirectTo === 'string' ? redirectTo : undefined,
  })
  if (errInv || !invitado?.user) {
    const msg = errInv?.message ?? ''
    return responder({ error: /already|registered|exists/i.test(msg) ? 'Ese email ya tiene un usuario.' : `No se pudo invitar: ${msg}` }, 400)
  }

  // 3) Perfil con el nombre y el rol elegidos (el trigger lo crea como auxiliar).
  const { error: errPerfil } = await admin.from('profiles').upsert({ id: invitado.user.id, nombre: nombreFinal, rol: rolFinal, activo: true })
  if (errPerfil) return responder({ ok: true, aviso: 'Se envió la invitación, pero no se pudo asignar el rol. Asignalo desde la lista.' })

  return responder({ ok: true })
})
