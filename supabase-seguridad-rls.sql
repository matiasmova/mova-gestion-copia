-- =====================================================================
--  MOVA Gestión — Seguridad (RLS)  ·  Fase 6
--  Activa Row Level Security en todas las tablas.
--  Baseline seguro: SOLO usuarios autenticados acceden a los datos
--  (bloquea la clave anónima). El uso normal de la app (siempre con
--  usuario logueado) sigue funcionando igual.
--  profiles: lectura para autenticados; ESCRITURA solo para admin.
-- =====================================================================

-- Helper: ¿el usuario actual es admin? SECURITY DEFINER evita recursión de RLS.
create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select rol = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- RLS + política "solo autenticados" en todas las tablas de datos.
do $$
declare t text;
begin
  foreach t in array array[
    'obras','presupuestos','presupuesto_items','productos_servicios',
    'costos','materiales','comprobantes','personal','pagos',
    'obra_imagenes','obra_avances','obra_asignaciones',
    'notificaciones','categorias_gasto','recordatorios','Clientes'
  ] loop
    begin
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_auth_all', t);
      execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_auth_all', t);
    exception when undefined_table then
      raise notice 'Tabla % no existe, se omite.', t;
    end;
  end loop;
end $$;

-- PROFILES: cualquiera autenticado puede leer; solo admin puede escribir roles.
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- =====================================================================
--  Resultado: la clave anónima ya no puede leer/escribir datos.
--  Próximo nivel (opcional, cuando quieras): reglas por rol
--  (ej. auxiliar ve solo sus obras asignadas) y revisar Storage.
-- =====================================================================
