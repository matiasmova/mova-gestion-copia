-- Fase 31: Historial de precios de cada producto / servicio del catálogo.
-- Cada vez que cambia el precio de venta o el costo de un producto, queda
-- registrado solo (desde el catálogo, la comparación con el mercado, la
-- importación o la actualización del dólar): cuándo, quién, de cuánto a cuánto
-- y de dónde vino el cambio.
-- Se puede correr más de una vez sin problema.

-- La app avisa de dónde viene el cambio con estas dos columnas; el registro las
-- lee y las vuelve a dejar vacías.
alter table public.productos_servicios add column if not exists precio_origen text;
alter table public.productos_servicios add column if not exists precio_nota text;

create table if not exists public.productos_precios_historial (
  id               bigint generated always as identity primary key,
  producto_id      bigint not null references public.productos_servicios(id) on delete cascade,
  fecha            timestamptz not null default now(),
  precio_anterior  numeric(14,2),
  precio_nuevo     numeric(14,2),
  costo_anterior   numeric(14,2),
  costo_nuevo      numeric(14,2),
  origen           text not null default 'catalogo', -- alta | catalogo | mercado | manual | importacion | cotizacion
  nota             text,
  usuario          text,
  user_id          uuid default auth.uid()
);
create index if not exists idx_pph_producto_fecha on public.productos_precios_historial(producto_id, fecha desc);

alter table public.productos_precios_historial enable row level security;
drop policy if exists pph_leer on public.productos_precios_historial;
create policy pph_leer on public.productos_precios_historial for select to authenticated using (true);
-- Solo se escribe desde el registro automático (no se puede editar a mano).

create or replace function public.registrar_cambio_precio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quien text := coalesce(auth.jwt() ->> 'email', 'sistema');
  -- El origen vale solo si vino en este mismo cambio.
  origen_cambio text := case when new.precio_origen is distinct from old.precio_origen then new.precio_origen end;
  nota_cambio text := case when new.precio_nota is distinct from old.precio_nota then new.precio_nota end;
begin
  -- Producto en dólares que cambió en pesos sin cambiar su precio en dólares: fue el dólar.
  if origen_cambio is null and (to_jsonb(new) ->> 'moneda') = 'USD'
     and (to_jsonb(new) ->> 'precio_usd') is not distinct from (to_jsonb(old) ->> 'precio_usd')
     and (to_jsonb(new) ->> 'costo_usd') is not distinct from (to_jsonb(old) ->> 'costo_usd') then
    origen_cambio := 'cotizacion';
  end if;
  if new.precio_venta is distinct from old.precio_venta or new.costo_unitario is distinct from old.costo_unitario then
    insert into productos_precios_historial (producto_id, precio_anterior, precio_nuevo, costo_anterior, costo_nuevo, origen, nota, usuario)
    values (new.id, old.precio_venta, new.precio_venta, old.costo_unitario, new.costo_unitario, coalesce(origen_cambio, 'catalogo'), nota_cambio, quien);
  end if;
  new.precio_origen := null;
  new.precio_nota := null;
  return new;
end;
$$;

drop trigger if exists trg_registrar_cambio_precio on public.productos_servicios;
drop trigger if exists trg_registrar_alta_precio on public.productos_servicios;
-- Al cambiar: antes de guardar (así deja vacías las columnas de aviso).
create trigger trg_registrar_cambio_precio
  before update on public.productos_servicios
  for each row execute function public.registrar_cambio_precio();

-- Al dar de alta: después de guardar (el producto ya existe para poder referenciarlo).
create or replace function public.registrar_alta_precio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into productos_precios_historial (producto_id, precio_nuevo, costo_nuevo, origen, nota, usuario)
  values (new.id, new.precio_venta, new.costo_unitario, coalesce(new.precio_origen, 'alta'), new.precio_nota, coalesce(auth.jwt() ->> 'email', 'sistema'));
  return null;
end;
$$;
create trigger trg_registrar_alta_precio
  after insert on public.productos_servicios
  for each row execute function public.registrar_alta_precio();
