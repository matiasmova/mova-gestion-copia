-- =====================================================================
--  MOVA Gestión — Fase 11: Notificaciones push (recordatorios/alertas)
--  Tabla de suscripciones de dispositivos + RLS por usuario.
--  El enviador (Edge Function con service_role) saltea RLS para leerlas.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_push_user on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists push_sub_select on public.push_subscriptions;
drop policy if exists push_sub_insert on public.push_subscriptions;
drop policy if exists push_sub_delete on public.push_subscriptions;
-- Cada usuario gestiona SOLO sus propias suscripciones.
create policy push_sub_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_sub_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy push_sub_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- Marca en recordatorios para no notificar dos veces el mismo.
alter table public.recordatorios add column if not exists notificado boolean not null default false;
