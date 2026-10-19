-- Fase 33: pago estimado a empleados en cada presupuesto.
-- Sirve para ver "Vas a ganar" en borrador y enviado, antes de asignar personal a la obra.
alter table public.presupuestos add column if not exists pago_empleados_estimado numeric not null default 0;
