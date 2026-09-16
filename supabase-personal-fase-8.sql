-- =====================================================================
--  MOVA Gestión — Fase 8: Personal por obra + Jornales
--  * Amplía la asignación de personal a obra (modalidad + valor acordado)
--  * Agrega especialidad y modalidad de pago al personal
--  * Nueva tabla de jornales / asistencia
--  Aditivo y seguro (IF NOT EXISTS). Los PAGOS al personal se siguen
--  registrando como costos (tipo mano_obra/terciarizado) — no se duplican.
-- =====================================================================

-- 1) Personal por obra: qué se acordó y cómo se paga
alter table public.obra_asignaciones
  add column if not exists modalidad text,          -- por_obra | por_dia | por_hora | porcentaje | por_etapa
  add column if not exists valor_acordado numeric(14,2) default 0,
  add column if not exists notas text;

-- 2) Datos del trabajador
alter table public.personal
  add column if not exists especialidad text,
  add column if not exists modalidad_pago text default 'por_dia';

-- 3) Jornales / asistencia (días u horas trabajadas por obra)
create table if not exists public.jornales (
  id            bigint generated always as identity primary key,
  obra_id       bigint not null references public.obras(id) on delete cascade,
  personal_id   bigint references public.personal(id) on delete set null,
  fecha         date not null default current_date,
  jornada       numeric(5,2) not null default 1,   -- 1 = día completo, 0.5 = medio
  horas         numeric(6,2),                        -- opcional
  observaciones text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_jornales_obra on public.jornales(obra_id);
create index if not exists idx_jornales_personal on public.jornales(personal_id);

alter table public.jornales enable row level security;
drop policy if exists jornales_auth_all on public.jornales;
create policy jornales_auth_all on public.jornales
  for all to authenticated using (true) with check (true);
