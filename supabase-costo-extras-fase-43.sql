-- =====================================================================
--  MOVA Gestión — Fase 43: costo interno de los extras de la obra
--  Guarda cuánto te cuesta cada extra agregado en la obra, para ver
--  cuánto ganás con él (no lo ve el cliente). Se puede correr más de una vez.
-- =====================================================================
alter table public.adicionales add column if not exists costo_unitario numeric not null default 0;
