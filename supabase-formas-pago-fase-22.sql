-- Fase 22: formas de pago que acepta cada presupuesto (solo informativas: no cambian el precio).
-- Ejemplo: {"medios": ["efectivo", "transferencia", "tarjeta"], "nota": "Tarjeta hasta 3 cuotas"}
-- Se puede correr más de una vez sin problema.

alter table public.presupuestos add column if not exists formas_pago jsonb;
