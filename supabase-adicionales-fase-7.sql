-- =====================================================================
--  MOVA Gestión — Fase 7: Adicionales / Modificaciones de obra
--  Historial de cambios post-aprobación. Solo los APROBADOS suman al
--  "valor actualizado" de la obra. Aditivo y seguro.
-- =====================================================================

create table if not exists public.adicionales (
  id            bigint generated always as identity primary key,
  obra_id       bigint not null references public.obras(id) on delete cascade,
  tipo          text not null default 'adicional'
                check (tipo in ('adicional','producto','servicio','bonificacion','ajuste','cambio')),
  descripcion   text not null,
  motivo        text,
  importe       numeric(14,2) not null default 0,  -- puede ser negativo (bonificación)
  estado        text not null default 'pendiente'
                check (estado in ('pendiente','aprobado','rechazado')),
  fecha         date not null default current_date,
  observaciones text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_adicionales_obra on public.adicionales(obra_id);

-- Seguridad (igual que el resto de las tablas)
alter table public.adicionales enable row level security;
drop policy if exists adicionales_auth_all on public.adicionales;
create policy adicionales_auth_all on public.adicionales
  for all to authenticated using (true) with check (true);
