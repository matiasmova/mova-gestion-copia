-- Fase 30: Gastos personales (casa, impuestos de la casa, salidas…).
-- PRIVADOS: cada usuario ve y carga solo los suyos. Nadie más los puede ver,
-- ni siquiera otro administrador. No se mezclan con la ganancia de la empresa.
-- Se puede correr más de una vez sin problema.

create table if not exists public.gastos_personales (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fecha       date not null default current_date,
  categoria   text not null default 'Gastos casa',
  descripcion text,
  monto       numeric(14,2) not null default 0,
  recurrente  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_gp_usuario_fecha on public.gastos_personales(user_id, fecha);

alter table public.gastos_personales enable row level security;
drop policy if exists gp_solo_dueno on public.gastos_personales;
create policy gp_solo_dueno on public.gastos_personales for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
