-- =====================================================================
--  MOVA Gestión — Fase 42: pagos al personal desde Personal
--  Permite cargar un pago "Sin obra" (gasto general de personal).
--  El "Gasto por ayudantes estimado" usa la columna
--  presupuestos.pago_empleados_estimado (fase 33); por las dudas se crea.
--  Se puede correr más de una vez.
-- =====================================================================
alter table public.costos alter column obra_id drop not null;
alter table public.presupuestos add column if not exists pago_empleados_estimado numeric not null default 0;
