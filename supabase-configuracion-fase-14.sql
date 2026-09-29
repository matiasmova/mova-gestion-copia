-- =====================================================================
--  MOVA Gestión — Fase 14: Configuración
--  Datos de la empresa, validez y condiciones de los presupuestos, aviso
--  del PDF de accesos. Clave → valor (json). La app usa valores por
--  defecto si una clave no existe.
-- =====================================================================
create table if not exists public.configuracion (
  clave       text primary key,
  valor       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.configuracion enable row level security;
drop policy if exists configuracion_leer on public.configuracion;
drop policy if exists configuracion_admin on public.configuracion;
-- Todos los usuarios logueados la leen (los PDF la necesitan); solo admin la modifica.
create policy configuracion_leer on public.configuracion
  for select to authenticated using (true);
create policy configuracion_admin on public.configuracion
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
