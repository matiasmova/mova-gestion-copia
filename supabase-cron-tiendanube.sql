-- Sincronización automática con Tiendanube cada 15 minutos.
-- Correr DESPUÉS de desplegar la Edge Function "tiendanube" y conectar la tienda.
-- Reemplazá <CRON_SECRET> por el MISMO valor del secret CRON_SECRET (el de los recordatorios).
select cron.schedule(
  'sincronizar-tiendanube',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://aceukzftfkjhmponaktd.supabase.co/functions/v1/tiendanube',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
      body := '{"accion":"sincronizar"}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
-- Para apagarla: select cron.unschedule('sincronizar-tiendanube');
