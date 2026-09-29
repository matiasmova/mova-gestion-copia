-- =====================================================================
--  MOVA Gestión — Fase 15: Usuarios
--  Bloqueo real de usuarios inactivos, emails/último ingreso para el admin
--  y protección del último administrador. Requiere es_admin() (fase 6).
-- =====================================================================

-- 1) ¿El usuario actual está activo? (sin perfil = activo, para no dejar a nadie afuera por error)
create or replace function public.es_activo()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select activo from public.profiles where id = auth.uid()), true);
$$;

-- 2) Un usuario INACTIVO no puede leer ni modificar ninguna tabla (salvo su propio perfil,
--    para que la app le muestre "usuario desactivado"). Se suma a las reglas que ya hay.
do $$
declare t text;
begin
  for t in select tablename from pg_tables
           where schemaname = 'public' and rowsecurity and tablename <> 'profiles'
  loop
    execute format('drop policy if exists solo_activos on public.%I', t);
    execute format('create policy solo_activos on public.%I as restrictive for all to authenticated using (public.es_activo()) with check (public.es_activo())', t);
  end loop;
end $$;

-- 3) Email, último ingreso y confirmación de cada usuario (solo lo ve un admin)
create or replace function public.usuarios_detalle()
returns table (id uuid, email text, ultimo_ingreso timestamptz, confirmado boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, u.last_sign_in_at, u.email_confirmed_at is not null
  from auth.users u
  where public.es_admin();
$$;
grant execute on function public.usuarios_detalle() to authenticated;

-- 4) Siempre tiene que quedar al menos un administrador activo
create or replace function public.proteger_ultimo_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.rol = 'admin' and old.activo and (new.rol <> 'admin' or not new.activo) then
    if (select count(*) from public.profiles where rol = 'admin' and activo and id <> old.id) = 0 then
      raise exception 'Tiene que quedar al menos un administrador activo.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ultimo_admin on public.profiles;
create trigger trg_ultimo_admin before update on public.profiles
  for each row execute function public.proteger_ultimo_admin();

-- Nota: si más adelante se crea una tabla nueva con RLS, volver a correr el bloque 2
-- para que también bloquee a los inactivos.
