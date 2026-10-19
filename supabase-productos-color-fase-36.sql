-- =====================================================================
--  MOVA Gestión — Fase 36: color del producto (opcional)
--  Para productos que vienen en varios colores (teclas blancas, negras…).
--  Se puede correr más de una vez.
-- =====================================================================
alter table public.productos_servicios add column if not exists color text;
