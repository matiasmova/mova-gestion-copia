-- Fase 16: Productos y servicios en pesos o dólares.
-- Correr una vez en Supabase → SQL Editor. Se puede volver a correr sin problema.

alter table public.productos_servicios
  add column if not exists moneda text not null default 'ARS',
  add column if not exists costo_usd numeric(14,4),
  add column if not exists precio_usd numeric(14,4),
  add column if not exists nombre_presupuesto text;

do $$ begin
  alter table public.productos_servicios add constraint productos_moneda_chk check (moneda in ('ARS','USD'));
exception when duplicate_object then null; end $$;

-- Recalcula en pesos todos los productos cargados en dólares con la cotización nueva.
create or replace function public.actualizar_precios_usd(p_cotizacion numeric)
returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  update public.productos_servicios
     set precio_venta = round(coalesce(precio_usd, 0) * p_cotizacion, 2),
         costo_unitario = round(coalesce(costo_usd, 0) * p_cotizacion, 2)
   where moneda = 'USD';
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.actualizar_precios_usd(numeric) to authenticated;

-- Cualquier usuario logueado puede guardar la cotización (el resto de la configuración sigue siendo solo de admin).
drop policy if exists configuracion_cotizacion on public.configuracion;
create policy configuracion_cotizacion on public.configuracion
  for all to authenticated using (clave = 'cotizacion') with check (clave = 'cotizacion');
