-- Fase 26: Relevamientos (lo que anotás en la visita al cliente, antes del presupuesto).
-- · Un relevamiento por visita: cliente, dirección, fecha y notas.
-- · Ítems por ambiente (cochera, cocina, terraza…): cantidad, tipo, canales, detalle, "ver".
-- · Fotos por ambiente en una carpeta privada.
-- Se puede correr más de una vez sin problema.

create table if not exists public.relevamientos (
  id bigint generated always as identity primary key,
  cliente_id bigint references public."Clientes"(id) on delete set null,
  titulo text not null default 'Relevamiento',
  direccion text,
  fecha date not null default current_date,
  notas text,
  estado text not null default 'abierto',          -- abierto | presupuestado
  presupuesto_id bigint references public.presupuestos(id) on delete set null,
  creado_at timestamptz not null default now()
);

create table if not exists public.relevamiento_items (
  id bigint generated always as identity primary key,
  relevamiento_id bigint not null references public.relevamientos(id) on delete cascade,
  ambiente text not null default 'General',
  cantidad numeric not null default 1,
  tipo text not null default 'otro',               -- dimmer | tecla | onoff | lampara | otro
  canales int,
  detalle text,
  revisar boolean not null default false,          -- "ver": falta definir
  smart boolean not null default false,
  orden int not null default 0
);
create index if not exists relevamiento_items_rel_idx on public.relevamiento_items (relevamiento_id);

create table if not exists public.relevamiento_fotos (
  id bigint generated always as identity primary key,
  relevamiento_id bigint not null references public.relevamientos(id) on delete cascade,
  ambiente text not null default 'General',
  archivo text not null,
  creado_at timestamptz not null default now()
);
create index if not exists relevamiento_fotos_rel_idx on public.relevamiento_fotos (relevamiento_id);

alter table public.relevamientos enable row level security;
alter table public.relevamiento_items enable row level security;
alter table public.relevamiento_fotos enable row level security;
drop policy if exists relevamientos_auth_all on public.relevamientos;
create policy relevamientos_auth_all on public.relevamientos for all to authenticated using (true) with check (true);
drop policy if exists relevamiento_items_auth_all on public.relevamiento_items;
create policy relevamiento_items_auth_all on public.relevamiento_items for all to authenticated using (true) with check (true);
drop policy if exists relevamiento_fotos_auth_all on public.relevamiento_fotos;
create policy relevamiento_fotos_auth_all on public.relevamiento_fotos for all to authenticated using (true) with check (true);

-- Carpeta privada para las fotos (hasta 10 MB cada una).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relevamientos', 'relevamientos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists relevamientos_fotos_ver on storage.objects;
create policy relevamientos_fotos_ver on storage.objects for select to authenticated using (bucket_id = 'relevamientos');
drop policy if exists relevamientos_fotos_subir on storage.objects;
create policy relevamientos_fotos_subir on storage.objects for insert to authenticated with check (bucket_id = 'relevamientos');
drop policy if exists relevamientos_fotos_borrar on storage.objects;
create policy relevamientos_fotos_borrar on storage.objects for delete to authenticated using (bucket_id = 'relevamientos');
