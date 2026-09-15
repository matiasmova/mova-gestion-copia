-- =====================================================================
--  MOVA Gestión — Migración Fase 5  (ADITIVA Y SEGURA)
--  Solo AGREGA columnas y tablas. No borra ni modifica datos existentes.
--  Correr una vez en: Supabase → SQL Editor → New query → Run.
--  Es idempotente: si la corrés dos veces, no rompe nada.
-- =====================================================================

-- 1) UBICACIÓN GEORREFERENCIADA DEL CLIENTE  (arregla "no deja cargar ubicación")
alter table public."Clientes" add column if not exists lat numeric(9,6);
alter table public."Clientes" add column if not exists lng numeric(9,6);

-- 2) COBROS DIRECTOS A OBRA (además de a presupuesto)
alter table public.pagos add column if not exists obra_id bigint references public.obras(id);

-- 3) PRODUCTOS/SERVICIOS: control de stock, foto, descripción y descuento
alter table public.productos_servicios add column if not exists descripcion text;
alter table public.productos_servicios add column if not exists foto_url text;
alter table public.productos_servicios add column if not exists stock numeric(12,2) default 0;
alter table public.productos_servicios add column if not exists aplica_descuento boolean default false;
alter table public.productos_servicios add column if not exists descuento_pct numeric(5,2) default 0;   -- % de descuento
alter table public.productos_servicios add column if not exists descuento_monto numeric(14,2) default 0; -- descuento en $
-- Nota: el "% de ganancia" y el "precio final" se calculan en la app a partir de
--       precio_venta y costo_unitario (no hace falta guardarlos).

-- 4) RECORDATORIOS / CALENDARIO (para el tab del dashboard)
create table if not exists public.recordatorios (
  id          bigint generated always as identity primary key,
  titulo      text not null,
  detalle     text,
  fecha       date not null,
  hora        time,
  tipo        text default 'recordatorio',
  obra_id     bigint references public.obras(id) on delete set null,
  cliente_id  bigint references public."Clientes"(id) on delete set null,
  completado  boolean not null default false,
  user_id     uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_recordatorios_fecha on public.recordatorios(fecha);

-- 5) STORAGE: bucket para fotos de productos (privado)
insert into storage.buckets (id, name, public)
values ('productos','productos', false)
on conflict (id) do nothing;

-- 6) PERFILES DE USUARIO (roles) — base de la seguridad por rol
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text,
  rol        text not null default 'admin' check (rol in ('admin','encargado','auxiliar','contable')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando se registra un usuario nuevo
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nombre, rol)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email), 'admin')
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Da de alta el perfil de los usuarios que YA existen (quedan como admin)
insert into public.profiles (id, nombre, rol)
select id, coalesce(raw_user_meta_data->>'nombre', email), 'admin'
from auth.users
on conflict (id) do nothing;

-- =====================================================================
--  SEGURIDAD (RLS): NO se activa acá a propósito.
--  Prender RLS sobre tablas que hoy no la tienen puede bloquear la app
--  si falta una sola política. Lo hacemos juntos en un paso aparte,
--  con políticas por rol y probando tabla por tabla, para no dejarte afuera.
-- =====================================================================

-- FIN. Después de correr esto:
--   • La app puede guardar ubicación de clientes, cobros a obra, stock y recordatorios.
--   • Tu usuario queda con rol 'admin' (podés cambiar roles luego en la tabla profiles).
