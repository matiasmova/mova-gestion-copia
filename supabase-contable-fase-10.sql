-- =====================================================================
--  MOVA Gestión — Fase 10: capa contable
--  Gastos fijos/estructura · IVA · Cuentas por pagar · Log de auditoría
-- =====================================================================

-- 1) Gastos generales / de estructura (NO atados a una obra)
create table if not exists public.gastos_generales (
  id          bigint generated always as identity primary key,
  fecha       date not null default current_date,
  categoria   text,   -- alquiler, sueldos, servicios, impuestos, contador, combustible, herramientas, marketing, otros
  descripcion text,
  monto       numeric(14,2) not null default 0,
  recurrente  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_gg_fecha on public.gastos_generales(fecha);
alter table public.gastos_generales enable row level security;
drop policy if exists gg_auth on public.gastos_generales;
create policy gg_auth on public.gastos_generales for all to authenticated using (true) with check (true);

-- 2) IVA (alícuota) en productos y presupuestos
alter table public.productos_servicios add column if not exists iva_pct numeric(5,2) not null default 21;
alter table public.presupuestos       add column if not exists iva_pct numeric(5,2) not null default 21;

-- 3) Cuentas por pagar: estado de pago de las compras
alter table public.materiales add column if not exists pagado boolean not null default true;
alter table public.materiales add column if not exists fecha_vencimiento date;

-- 4) Log de auditoría (quién hizo qué y cuándo)
create table if not exists public.log_auditoria (
  id          bigint generated always as identity primary key,
  tabla       text,
  accion      text,
  registro_id text,
  usuario     text,
  fecha       timestamptz not null default now()
);
create index if not exists idx_log_fecha on public.log_auditoria(fecha desc);
alter table public.log_auditoria enable row level security;
drop policy if exists log_auth on public.log_auditoria;
create policy log_auth on public.log_auditoria for all to authenticated using (true) with check (true);

create or replace function public.fn_log_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.log_auditoria(tabla, accion, registro_id, usuario)
  values (TG_TABLE_NAME, TG_OP, coalesce(NEW.id, OLD.id)::text, coalesce(auth.jwt() ->> 'email', 'sistema'));
  return coalesce(NEW, OLD);
end $$;

-- Triggers en tablas clave
do $$
declare t text;
begin
  foreach t in array array['presupuestos','obras','pagos','costos','productos_servicios','gastos_generales','materiales','obra_asignaciones','adicionales','Clientes'] loop
    execute format('drop trigger if exists trg_log on public.%I', t);
    execute format('create trigger trg_log after insert or update or delete on public.%I for each row execute function public.fn_log_auditoria()', t);
  end loop;
end $$;
