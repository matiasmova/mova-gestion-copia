-- =====================================================================
--  MOVA Gestión — Fase 41: un solo avance (por ítems)
--  · El % de la obra se guarda con decimales: sale de sumar lo que avanzó
--    cada ítem del presupuesto, pesado por lo que vale (así el cobro da
--    exacto: seña 60% + el 40% de cada ítem según su avance).
--  · Se borran los puntos automáticos "Avance por ítems" que dejó la versión
--    anterior (las fotos y notas que cargaste a mano en Avances no se tocan).
--  Se puede correr más de una vez.
-- =====================================================================
alter table public.obras alter column porcentaje_avance type numeric(9,6) using round(coalesce(porcentaje_avance, 0)::numeric, 6);
delete from public.obra_avances where titulo = 'Avance por ítems';
