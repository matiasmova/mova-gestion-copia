-- Fase 17: seguimiento de presupuestos.
-- Guarda cuándo se envió cada presupuesto y cuándo se hizo el último seguimiento
-- (WhatsApp o "ya lo seguí"). Correr una vez en Supabase → SQL Editor.

alter table public.presupuestos
  add column if not exists enviado_at timestamptz,
  add column if not exists seguimiento_at timestamptz;

-- Los que ya están enviados toman como fecha de envío la fecha del presupuesto.
update public.presupuestos set enviado_at = fecha::timestamptz
 where estado = 'enviado' and enviado_at is null and fecha is not null;

-- Cada vez que un presupuesto pasa a "enviado", se anota la fecha sola.
create or replace function public.presupuestos_marcar_enviado()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.estado = 'enviado' and (tg_op = 'INSERT' or old.estado is distinct from 'enviado') then
    new.enviado_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_presupuestos_enviado on public.presupuestos;
create trigger trg_presupuestos_enviado
  before insert or update of estado on public.presupuestos
  for each row execute function public.presupuestos_marcar_enviado();
