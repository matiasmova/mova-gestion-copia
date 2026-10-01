-- Fase 20: etapas del presupuesto.
-- · motivo_rechazo: por qué el cliente no avanzó (precio, tiempos, eligió a otro…).
-- · version / version_de: cuando el cliente pide cambios se crea una versión nueva
--   y la anterior queda guardada como historial.
-- Se puede correr más de una vez sin problema.

alter table public.presupuestos add column if not exists motivo_rechazo text;
alter table public.presupuestos add column if not exists version integer not null default 1;
alter table public.presupuestos add column if not exists version_de bigint references public.presupuestos(id) on delete set null;
