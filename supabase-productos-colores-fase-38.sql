-- =====================================================================
--  MOVA Gestión — Fase 38: colores disponibles con stock por color
--  Ej.: Tecla 1 módulo → Negro 3, Blanco 2, Gris 0.
--  · productos_servicios.colores: lista [{ "color": "Negro", "stock": 3 }, …]
--    (el stock total del producto es la suma).
--  · descontar_stock_color: al aceptar un presupuesto, descuenta del color elegido.
--  Se puede correr más de una vez.
-- =====================================================================
alter table public.productos_servicios add column if not exists colores jsonb;

create or replace function public.descontar_stock_color(p_id bigint, p_color text, p_cant numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update public.productos_servicios
     set colores = (
       select jsonb_agg(
         case when lower(trim(e->>'color')) = lower(trim(p_color))
              then jsonb_set(e, '{stock}', to_jsonb(greatest(0, coalesce((e->>'stock')::numeric, 0) - coalesce(p_cant, 0))))
              else e end)
       from jsonb_array_elements(colores) e)
   where id = p_id and tipo = 'producto' and jsonb_typeof(colores) = 'array';
$$;

grant execute on function public.descontar_stock_color(bigint, text, numeric) to authenticated;
