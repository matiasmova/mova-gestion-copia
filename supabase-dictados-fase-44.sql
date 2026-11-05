-- =====================================================================
--  MOVA Gestión — Fase 44: Dictado rápido en "Para hacer"
--  Lo que dictás (o escribís) queda "para revisar" con el destino que
--  elegiste (recordatorio, pendiente de obra, cambio en la obra, pago al
--  personal, compra o nota) hasta que lo cargás definitivo o lo descartás.
--  Se puede correr más de una vez.
-- =====================================================================
create table if not exists public.dictados (
  id          bigint generated always as identity primary key,
  user_id     uuid default auth.uid() references auth.users(id) on delete set null,
  texto       text not null,
  destino     text not null default 'nota',
  datos       jsonb not null default '{}'::jsonb,
  estado      text not null default 'revisar' check (estado in ('revisar', 'cargado', 'descartado')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_dictados_estado on public.dictados(estado, created_at desc);

alter table public.dictados enable row level security;
drop policy if exists dictados_auth_all on public.dictados;
create policy dictados_auth_all on public.dictados for all to authenticated using (true) with check (true);
