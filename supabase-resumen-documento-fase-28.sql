-- Fase 28: "Cómo lo ve el cliente" (presupuesto detallado o resumido).
-- · resumen_doc: el modo (detallado / resumido), las opciones (cantidades, marca,
--   totales por sección) y el texto de cada sección y de sus partes.
-- Se puede correr más de una vez sin problema.

alter table public.presupuestos add column if not exists resumen_doc jsonb;
