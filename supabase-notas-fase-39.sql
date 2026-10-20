-- =====================================================================
--  MOVA Gestión — Fase 39: Notas en "Para hacer"
--  Notas con o sin día y hora. Las que tienen día avisan al celular
--  (a la hora elegida, o a las 9 si no tiene hora) y entran en el
--  resumen de la mañana.
--  PRIVADAS: cada usuario ve y carga solo las suyas.
--  Se puede correr más de una vez.
-- =====================================================================
create table if not exists public.notas (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  texto         text not null,
  fecha         date,
  hora          time,
  color         text,
  fijada        boolean not null default false,
  hecha         boolean not null default false,
  aviso         boolean not null default true,
  notificar_en  timestamptz,
  notificado    boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_notas_usuario on public.notas(user_id, hecha);
create index if not exists idx_notas_aviso on public.notas(notificar_en) where notificado = false;

alter table public.notas enable row level security;
drop policy if exists notas_solo_dueno on public.notas;
create policy notas_solo_dueno on public.notas for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
