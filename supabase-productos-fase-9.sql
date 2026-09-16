-- =====================================================================
--  MOVA Gestión — Fase 9: Productos (proveedor, stock mínimo, descuento de stock)
-- =====================================================================

alter table public.productos_servicios
  add column if not exists proveedor text,
  add column if not exists stock_minimo integer not null default 5;

-- Descuento atómico de stock al cargar un presupuesto (solo productos).
create or replace function public.descontar_stock(p_id bigint, p_cant numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update public.productos_servicios
     set stock = greatest(0, coalesce(stock, 0) - coalesce(p_cant, 0))
   where id = p_id and tipo = 'producto';
$$;

grant execute on function public.descontar_stock(bigint, numeric) to authenticated;
