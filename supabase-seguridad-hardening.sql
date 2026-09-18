-- =====================================================================
--  MOVA Gestión — HARDENING DE SEGURIDAD (auditoría cyber)
--  Correr una vez en: Supabase → SQL Editor → New query → Run.
--  Es idempotente y reversible. NO borra datos.
--
--  Cierra 2 huecos detectados en la auditoría:
--   1) Usuarios nuevos quedaban con rol 'admin' por defecto.
--   2) El log de auditoría podía ser editado/borrado por cualquier usuario.
-- =====================================================================

-- 1) MÍNIMO PRIVILEGIO PARA USUARIOS NUEVOS ---------------------------
--    Antes: todo usuario nuevo quedaba 'admin' (acceso total).
--    Ahora: queda 'auxiliar' (mínimo). El admin lo promueve manualmente
--    desde la tabla profiles cuando corresponde.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nombre, rol)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email), 'auxiliar')
  on conflict (id) do nothing;
  return new;
end; $$;

-- 2) LOG DE AUDITORÍA = SOLO-AGREGAR (append-only) --------------------
--    Antes: policy 'for all' => cualquiera podía UPDATE/DELETE los logs.
--    Ahora: solo INSERT (lo hacen los triggers) y SELECT (el visor).
--    Sin políticas de UPDATE/DELETE => nadie puede alterar el historial.
alter table public.log_auditoria enable row level security;
drop policy if exists log_auth   on public.log_auditoria;
drop policy if exists log_insert on public.log_auditoria;
drop policy if exists log_select on public.log_auditoria;
create policy log_insert on public.log_auditoria for insert to authenticated with check (true);
create policy log_select on public.log_auditoria for select to authenticated using (true);
revoke update, delete on public.log_auditoria from authenticated, anon;
-- (fn_log_auditoria es SECURITY DEFINER, así que los triggers siguen escribiendo)

-- =====================================================================
--  VERIFICACIÓN (opcional): correr y revisar el resultado
--   select rol, count(*) from public.profiles group by rol;
--   select cmd, roles from pg_policies
--     where schemaname='public' and tablename='log_auditoria';
-- =====================================================================
--  FIN. Recordá completar en el panel de Supabase (no es SQL):
--   • Authentication → Sign In/Providers → DESACTIVAR "Allow new users to sign up"
--   • Authentication → Attack Protection → ACTIVAR "Prevent use of leaked passwords"
--   • Authentication → URL Configuration → Site URL = https://mova-gestion.vercel.app
-- =====================================================================
