// Supabase Edge Function: gestionar-usuarios
// Usuarios desde la app (pantalla Usuarios): invitar por email, crear con
// contraseña, poner una contraseña nueva y eliminar.
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

  const { accion, email, nombre, rol, redirectTo, clave, id } = await req.json().catch(() => ({}))

  // Eliminar un usuario (no a uno mismo, y siempre queda un administrador activo).
  if (accion === 'eliminar') {
    const uid = String(id ?? '')
    if (!uid) return responder({ error: 'Falta el usuario.' }, 400)
    if (uid === quien.user.id) return responder({ error: 'No podés eliminar tu propio usuario.' }, 400)
    const { data: objetivo } = await admin.from('profiles').select('rol, activo').eq('id', uid).maybeSingle()
    if (objetivo?.rol === 'admin' && objetivo.activo !== false) {
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('rol', 'admin').neq('activo', false).neq('id', uid)
      if (!count) return responder({ error: 'Tiene que quedar al menos un administrador activo.' }, 400)
    }
    const { error: errDel } = await admin.auth.admin.deleteUser(uid)
    if (errDel) return responder({ error: `No se pudo eliminar (${errDel.message}). Podés desactivarlo para que no entre más.` }, 400)
    await admin.from('profiles').delete().eq('id', uid)
    return responder({ ok: true })
  }

  // Poner una contraseña nueva a un usuario existente (sin mandarle mail).
  if (accion === 'clave') {
    const uid = String(id ?? '')
    const nueva = String(clave ?? '')
    if (!uid) return responder({ error: 'Falta el usuario.' }, 400)
    if (nueva.length < 8) return responder({ error: 'La contraseña tiene que tener al menos 8 caracteres.' }, 400)
    const { error: errClave } = await admin.auth.admin.updateUserById(uid, { password: nueva, email_confirm: true })
    if (errClave) return responder({ error: `No se pudo cambiar la contraseña: ${errClave.message}` }, 400)
    return responder({ ok: true })
  }

  if (accion !== 'invitar' && accion !== 'crear') return responder({ error: 'Acción desconocida' }, 400)
  const correo = String(email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return responder({ error: 'El email no es válido.' }, 400)
  const rolFinal = ROLES.includes(rol) ? rol : 'auxiliar'
  const nombreFinal = String(nombre ?? '').trim() || correo

  // Crear el usuario con una contraseña que elige el administrador (sin mail).
  if (accion === 'crear') {
    const nueva = String(clave ?? '')
    if (nueva.length < 8) return responder({ error: 'La contraseña tiene que tener al menos 8 caracteres.' }, 400)
    const { data: creado, error: errCrear } = await admin.auth.admin.createUser({ email: correo, password: nueva, email_confirm: true, user_metadata: { nombre: nombreFinal } })
    if (errCrear || !creado?.user) {
      const msg = errCrear?.message ?? ''
      return responder({ error: /already|registered|exists/i.test(msg) ? 'Ese email ya tiene un usuario. Si no puede entrar, ponele una contraseña nueva con la llave 🔑.' : `No se pudo crear: ${msg}` }, 400)
    }
    const { error: errP } = await admin.from('profiles').upsert({ id: creado.user.id, nombre: nombreFinal, rol: rolFinal, activo: true })
    if (errP) return responder({ ok: true, aviso: 'Se creó el usuario, pero no se pudo asignar el rol. Asignalo desde la lista.' })
    return responder({ ok: true })
  }

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
