-- Fase 29: permisos para subir y ver las fotos de los productos.
-- La carpeta "productos" existía pero sin permisos, por eso "No se pudo subir la foto".
-- Se puede correr más de una vez sin problema.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists productos_fotos_ver on storage.objects;
create policy productos_fotos_ver on storage.objects for select to authenticated using (bucket_id = 'productos');
drop policy if exists productos_fotos_subir on storage.objects;
create policy productos_fotos_subir on storage.objects for insert to authenticated with check (bucket_id = 'productos');
drop policy if exists productos_fotos_cambiar on storage.objects;
create policy productos_fotos_cambiar on storage.objects for update to authenticated using (bucket_id = 'productos') with check (bucket_id = 'productos');
drop policy if exists productos_fotos_borrar on storage.objects;
create policy productos_fotos_borrar on storage.objects for delete to authenticated using (bucket_id = 'productos');
