-- =====================================================================
--  MOVA Gestión — Fase 35: respaldo automático semanal
--  Todos los domingos a las 3 de la mañana (hora de Argentina) se guarda una
--  copia de todos los datos en el bucket privado "respaldos" de Supabase.
--  Correr DESPUÉS de haber desplegado la Edge Function 'respaldo-semanal'.
--  Usa el mismo secret CRON_SECRET de los recordatorios.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Si ya existía, se reemplaza.
select cron.unschedule('respaldo-semanal') where exists (select 1 from cron.job where jobname = 'respaldo-semanal');

-- Reemplazá <CRON_SECRET> por el MISMO valor que tenés en el secret CRON_SECRET.
-- 06:00 UTC del domingo = 03:00 en Argentina.
select cron.schedule(
  'respaldo-semanal',
  '0 6 * * 0',
  $$
    select net.http_post(
      url := 'https://aceukzftfkjhmponaktd.supabase.co/functions/v1/respaldo-semanal',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
      body := '{"accion":"respaldar"}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- Útiles:
--   select * from cron.job;                          -- ver tareas programadas
--   select cron.unschedule('respaldo-semanal');      -- desprogramar
