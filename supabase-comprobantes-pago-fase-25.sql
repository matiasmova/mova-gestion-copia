-- Fase 25: aviso al instante y carpeta de comprobantes de pago por obra.
-- Requiere haber corrido antes la fase 24. Se puede correr más de una vez.
-- · Podés guardar vos también comprobantes (por ejemplo, los que te llegan por WhatsApp).
-- · Cada comprobante nuevo del cliente te llega como notificación al celular.
-- · La app abierta se entera al instante (tiempo real).

alter table public.pago_comprobantes alter column token drop not null;
alter table public.pago_comprobantes add column if not exists origen text not null default 'cliente';
alter table public.pago_comprobantes add column if not exists notificado boolean not null default false;
-- Los que ya estaban no se vuelven a notificar.
update public.pago_comprobantes set notificado = true where creado_at < now() - interval '1 hour';

-- Vos (con login) también podés subir archivos a la carpeta.
drop policy if exists pagos_clientes_subir_app on storage.objects;
create policy pagos_clientes_subir_app on storage.objects for insert to authenticated
  with check (bucket_id = 'pagos-clientes');

-- Tiempo real: la app abierta recibe el aviso apenas llega un comprobante.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pago_comprobantes') then
    alter publication supabase_realtime add table public.pago_comprobantes;
  end if;
end $$;
