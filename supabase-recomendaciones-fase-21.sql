-- Fase 21: "Formas de uso y recomendaciones" opcionales por presupuesto.
-- · recomendaciones: el texto (una recomendación por renglón), redactado a mano o con IA.
-- · recomendaciones_incluir: si va o no en el documento y el PDF del cliente.
-- Se puede correr más de una vez sin problema.

alter table public.presupuestos add column if not exists recomendaciones text;
alter table public.presupuestos add column if not exists recomendaciones_incluir boolean not null default false;
