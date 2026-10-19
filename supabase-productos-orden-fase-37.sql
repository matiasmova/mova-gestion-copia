-- =====================================================================
--  MOVA Gestión — Fase 37: orden propio de los productos ("Mi orden")
--  Para acomodar a mano el catálogo en Productos y servicios.
--  Se puede correr más de una vez.
-- =====================================================================
alter table public.productos_servicios add column if not exists orden integer;
