-- =====================================================================
--  MOVA Gestión — Cron de recordatorios push
--  Programa el envío automático cada 15 minutos.
--  Correr DESPUÉS de haber desplegado la Edge Function 'enviar-recordatorios'
--  y de haber cargado sus secrets (VAPID_* y CRON_SECRET).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Reemplazá <CRON_SECRET> por el MISMO valor que pusiste en el secret CRON_SECRET.
select cron.schedule(
  'enviar-recordatorios',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://aceukzftfkjhmponaktd.supabase.co/functions/v1/enviar-recordatorios',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>')
    );
  $$
);

-- Útiles:
--   select * from cron.job;                          -- ver tareas programadas
--   select cron.unschedule('enviar-recordatorios');  -- desprogramar
