-- Fase 19: conexión con Tiendanube (www.movaelectronica.com.ar).
-- Correr una vez en Supabase → SQL Editor. Se puede volver a correr sin problema.

-- 1) Vínculo de cada producto de la app con su variante en la web.
alter table public.productos_servicios
  add column if not exists tn_product_id bigint,
  add column if not exists tn_variant_id bigint,
  add column if not exists tn_sincronizar boolean not null default true,
  add column if not exists tn_precio_publicado numeric(14,2),
  add column if not exists tn_stock_publicado numeric(14,2),
  add column if not exists tn_sincronizado_at timestamptz;
create unique index if not exists productos_tn_variant_uidx
  on public.productos_servicios (tn_variant_id) where tn_variant_id is not null;

-- 2) Datos de la conexión (token de la tienda). SIN políticas: desde la app no
--    se puede leer; solo la Edge Function "tiendanube" (service_role).
create table if not exists public.integraciones (
  proveedor text primary key,
  datos jsonb not null default '{}'::jsonb,
  actualizado_at timestamptz not null default now()
);
alter table public.integraciones enable row level security;
revoke all on public.integraciones from anon, authenticated;

-- 3) Historial de sincronizaciones (lo ven los administradores).
create table if not exists public.tiendanube_log (
  id bigserial primary key,
  fecha timestamptz not null default now(),
  tipo text not null,
  detalle text,
  ok boolean not null default true
);
alter table public.tiendanube_log enable row level security;
drop policy if exists tiendanube_log_admin on public.tiendanube_log;
create policy tiendanube_log_admin on public.tiendanube_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'admin' and coalesce(p.activo, true)));
