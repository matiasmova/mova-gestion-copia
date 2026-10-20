-- =====================================================================
--  MOVA Gestión — Fase 40: avance por ítem del presupuesto
--  Cada ítem del presupuesto aceptado lleva su % de avance (0 a 100).
--  El avance de la obra se calcula pesando cada ítem por lo que vale.
--  Se puede correr más de una vez.
-- =====================================================================
alter table public.presupuesto_items add column if not exists avance numeric not null default 0;
alter table public.presupuesto_items drop constraint if exists presupuesto_items_avance_rango;
alter table public.presupuesto_items add constraint presupuesto_items_avance_rango check (avance >= 0 and avance <= 100);
