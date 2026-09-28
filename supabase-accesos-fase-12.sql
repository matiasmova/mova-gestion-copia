-- =====================================================================
--  MOVA Gestión — Fase 12: Accesos y claves de la obra
--  Apps, usuarios y contraseñas que crea el instalador para el cliente.
--  Se imprimen en el PDF "Resumen de accesos" que se le entrega.
--  Aditivo y seguro.
-- =====================================================================

create table if not exists public.obra_accesos (
  id          bigint generated always as identity primary key,
  obra_id     bigint not null references public.obras(id) on delete cascade,
  app         text not null,              -- Ej.: SmartLife, eWeLink, Router WiFi, Alarma
  descripcion text,                       -- Para qué sirve / qué controla
  detalle     text,                       -- Datos extra: red, código, equipo, observaciones
  usuario     text,
  contrasena  text,
  orden       integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_obra_accesos_obra on public.obra_accesos(obra_id);

-- Seguridad (igual que el resto de las tablas: solo usuarios logueados)
alter table public.obra_accesos enable row level security;
drop policy if exists obra_accesos_auth_all on public.obra_accesos;
create policy obra_accesos_auth_all on public.obra_accesos
  for all to authenticated using (true) with check (true);
