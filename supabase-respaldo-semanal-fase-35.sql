-- =====================================================================
--  MOVA Gestión — Fase 35: respaldo automático semanal
--  Todos los domingos a las 3 de la mañana (hora de Argentina) se guarda una
--  copia de todos los datos en el bucket privado "respaldos" de Supabase.
--  Correr DESPUÉS de haber desplegado la Edge Function 'respaldo-semanal'.
--
--  No hace falta copiar ningún secreto: se toma el CRON_SECRET de la tarea de
--  recordatorios que ya está programada ('enviar-recordatorios').
--  Se puede correr todas las veces que haga falta (reemplaza la tarea).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  secreto text;
begin
  -- El secreto que ya usa el cron de los recordatorios.
  select substring(command from '''x-cron-secret''\s*,\s*''([^'']+)''') into secreto
  from cron.job where jobname = 'enviar-recordatorios' limit 1;

  if secreto is null or secreto = '<CRON_SECRET>' then
    raise exception 'No encontré el CRON_SECRET en la tarea "enviar-recordatorios". Avisale a soporte para cargarlo de otra forma.';
  end if;

  -- Si ya existía, se reemplaza.
  if exists (select 1 from cron.job where jobname = 'respaldo-semanal') then
    perform cron.unschedule('respaldo-semanal');
  end if;

  -- 06:00 UTC del domingo = 03:00 en Argentina.
  perform cron.schedule(
    'respaldo-semanal',
    '0 6 * * 0',
    format($cmd$
      select net.http_post(
        url := 'https://aceukzftfkjhmponaktd.supabase.co/functions/v1/respaldo-semanal',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
        body := '{"accion":"respaldar"}'::jsonb,
        timeout_milliseconds := 60000
      );
    $cmd$, secreto)
  );

  raise notice 'Listo: respaldo semanal programado para los domingos a las 3 AM.';
end $$;

-- Útiles:
--   select jobname, schedule from cron.job;          -- ver tareas programadas
--   select cron.unschedule('respaldo-semanal');      -- desprogramar
