-- Fase 23: página de pago para el cliente (transferencia / efectivo, sin comisiones).
-- Cada presupuesto tiene un link con un código imposible de adivinar. La página
-- pública solo puede leer lo que guarda el link (nombre, obra, montos y datos
-- para transferir) a través de la función pago_publico; no ve nada más.
-- Se puede correr más de una vez sin problema.

create table if not exists public.pago_links (
  token uuid primary key default gen_random_uuid(),
  presupuesto_id bigint not null unique references public.presupuestos(id) on delete cascade,
  datos jsonb not null,
  activo boolean not null default true,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

alter table public.pago_links enable row level security;
drop policy if exists pago_links_auth_all on public.pago_links;
create policy pago_links_auth_all on public.pago_links for all to authenticated using (true) with check (true);

-- Lectura pública por código (solo links activos).
create or replace function public.pago_publico(p_token uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select l.datos || jsonb_build_object('actualizado_at', l.actualizado_at)
  from public.pago_links l
  where l.token = p_token and l.activo
$$;
revoke all on function public.pago_publico(uuid) from public;
grant execute on function public.pago_publico(uuid) to anon, authenticated;
