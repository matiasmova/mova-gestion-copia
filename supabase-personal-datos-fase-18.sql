-- Fase 18: datos personales del personal (para ingresar a obras) y seguro / ART
-- con vencimiento (avisa en Personal y en Agenda → Alertas).
-- Correr una vez en Supabase → SQL Editor. Se puede volver a correr sin problema.

alter table public.personal
  add column if not exists documento text,
  add column if not exists cuil text,
  add column if not exists contacto_emergencia text,
  add column if not exists seguro text,
  add column if not exists seguro_vencimiento date,
  add column if not exists notas text;

-- Acelera el parte diario y la liquidación semanal.
create index if not exists jornales_fecha_idx on public.jornales (fecha);
create index if not exists jornales_obra_persona_idx on public.jornales (obra_id, personal_id);
