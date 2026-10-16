-- Fase 32: notas y fotos en la línea de tiempo de cada presupuesto
-- (por ejemplo: "lo llamé", "pidió cambiar las teclas", captura del WhatsApp
-- donde aceptó, foto del lugar). Se puede correr más de una vez sin problema.

create table if not exists public.presupuesto_notas (
  id              bigint generated always as identity primary key,
  presupuesto_id  bigint not null references public.presupuestos(id) on delete cascade,
  fecha           date not null default current_date,
  texto           text,
  foto_path       text,
  usuario         text default (auth.jwt() ->> 'email'),
  created_at      timestamptz not null default now()
);
create index if not exists idx_presupuesto_notas on public.presupuesto_notas(presupuesto_id, fecha desc);

alter table public.presupuesto_notas enable row level security;
drop policy if exists presupuesto_notas_auth on public.presupuesto_notas;
create policy presupuesto_notas_auth on public.presupuesto_notas for all to authenticated using (true) with check (true);

-- Carpeta privada para las fotos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('presupuestos', 'presupuestos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists presupuestos_fotos_ver on storage.objects;
create policy presupuestos_fotos_ver on storage.objects for select to authenticated using (bucket_id = 'presupuestos');
drop policy if exists presupuestos_fotos_subir on storage.objects;
create policy presupuestos_fotos_subir on storage.objects for insert to authenticated with check (bucket_id = 'presupuestos');
drop policy if exists presupuestos_fotos_borrar on storage.objects;
create policy presupuestos_fotos_borrar on storage.objects for delete to authenticated using (bucket_id = 'presupuestos');
