-- =====================================================================
--  MOVA Gestión — Fase 45: descuento de los extras de la obra
--  Guarda el % de descuento de cada extra, para que al volver a abrirlo
--  se vea el precio de lista y el descuento (no solo el precio final).
--  Se puede correr más de una vez.
-- =====================================================================
alter table public.adicionales add column if not exists descuento_pct numeric not null default 0;
