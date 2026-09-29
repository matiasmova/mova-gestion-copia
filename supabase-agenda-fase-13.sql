-- =====================================================================
--  MOVA Gestión — Fase 13: Agenda
--  Lugar, anticipación del aviso y momento exacto del aviso push.
--  La app calcula notificar_en = fecha + hora − aviso_min (hora de Argentina);
--  la Edge Function enviar-recordatorios avisa cuando llega ese momento.
-- =====================================================================
alter table public.recordatorios add column if not exists lugar text;
alter table public.recordatorios add column if not exists aviso_min integer default 0;
alter table public.recordatorios add column if not exists notificar_en timestamptz;
create index if not exists idx_recordatorios_notificar on public.recordatorios(notificar_en)
  where completado = false and notificado = false;

-- Los que ya existían: aviso a su hora (o 9:00 si no tenían hora).
update public.recordatorios
set notificar_en = ((fecha + coalesce(hora, time '09:00')) at time zone 'America/Argentina/Buenos_Aires')
where notificar_en is null;
