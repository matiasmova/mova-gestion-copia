-- Fase 24: el cliente adjunta el comprobante de pago desde la página de pago.
-- Requiere haber corrido antes la fase 23 (pago_links).
-- · Los archivos van a una carpeta privada ("pagos-clientes"): el cliente solo
--   puede SUBIR (con un link de pago activo), nunca ver ni borrar nada.
-- · Cada comprobante queda registrado para que lo veas en la obra y en Inicio.
-- Se puede correr más de una vez sin problema.

-- Carpeta privada: hasta 10 MB, solo fotos o PDF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pagos-clientes', 'pagos-clientes', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.pago_comprobantes (
  id bigint generated always as identity primary key,
  token uuid not null,
  presupuesto_id bigint not null references public.presupuestos(id) on delete cascade,
  obra_id bigint,
  cliente text,
  titulo text,
  monto numeric,
  archivo text not null,
  nombre_archivo text,
  nota text,
  visto boolean not null default false,
  creado_at timestamptz not null default now()
);
create index if not exists pago_comprobantes_presu_idx on public.pago_comprobantes (presupuesto_id);

alter table public.pago_comprobantes enable row level security;
drop policy if exists pago_comprobantes_auth_all on public.pago_comprobantes;
create policy pago_comprobantes_auth_all on public.pago_comprobantes for all to authenticated using (true) with check (true);

-- ¿El código del link existe y está activo? (sin dejar ver nada más)
create or replace function public.pago_token_activo(p_token text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pago_links l where l.token::text = p_token and l.activo)
$$;
revoke all on function public.pago_token_activo(text) from public;
grant execute on function public.pago_token_activo(text) to anon, authenticated;

-- Permisos de la carpeta: el cliente (sin login) solo sube dentro de la carpeta
-- de su link activo; vos (con login) ves y borrás.
drop policy if exists pagos_clientes_subir on storage.objects;
create policy pagos_clientes_subir on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'pagos-clientes' and public.pago_token_activo((storage.foldername(name))[1]));
drop policy if exists pagos_clientes_ver on storage.objects;
create policy pagos_clientes_ver on storage.objects for select to authenticated using (bucket_id = 'pagos-clientes');
drop policy if exists pagos_clientes_borrar on storage.objects;
create policy pagos_clientes_borrar on storage.objects for delete to authenticated using (bucket_id = 'pagos-clientes');

-- Registra el comprobante subido (máximo 30 por link, para evitar abusos).
create or replace function public.pago_registrar_comprobante(p_token uuid, p_archivo text, p_nombre text, p_nota text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  select * into l from public.pago_links where token = p_token and activo;
  if not found then return false; end if;
  if p_archivo is null or left(p_archivo, 37) <> p_token::text || '/' then return false; end if;
  if (select count(*) from public.pago_comprobantes where token = p_token) >= 30 then return false; end if;
  insert into public.pago_comprobantes (token, presupuesto_id, obra_id, cliente, titulo, monto, archivo, nombre_archivo, nota)
  values (p_token, l.presupuesto_id, (select p.obra_id from public.presupuestos p where p.id = l.presupuesto_id),
          l.datos->>'cliente', l.datos->>'titulo', nullif(l.datos->>'a_pagar', '')::numeric,
          p_archivo, left(coalesce(p_nombre, ''), 200), left(coalesce(p_nota, ''), 500));
  return true;
end $$;
revoke all on function public.pago_registrar_comprobante(uuid, text, text, text) from public;
grant execute on function public.pago_registrar_comprobante(uuid, text, text, text) to anon, authenticated;
