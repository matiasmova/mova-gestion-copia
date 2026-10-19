-- Fase 34: la app se actualiza sola cuando se cambia algo desde otro dispositivo.
-- Suma las tablas principales a Supabase Realtime (solo las que existen y todavía no están).
do $$
declare t text;
begin
  foreach t in array array[
    'productos_servicios', 'presupuestos', 'presupuesto_items', 'obras', 'Clientes', 'pagos', 'costos',
    'materiales', 'gastos_generales', 'recordatorios', 'personal', 'obra_asignaciones', 'jornales',
    'adicionales', 'obra_avances', 'relevamientos'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t)
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
