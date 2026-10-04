-- Fase 27: cada ítem del relevamiento puede quedar relacionado con un producto
-- de tu lista (para que el presupuesto salga con el precio cargado).
-- Requiere la fase 26. Se puede correr más de una vez sin problema.
alter table public.relevamiento_items add column if not exists catalogo_id bigint;
