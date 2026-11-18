-- Execute no SQL Editor do Supabase para registrar o motivo e a data do cancelamento.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT,
  ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS orders_cancelados_loja_data_idx
  ON public.orders (loja_id, cancelado_em DESC)
  WHERE status = 'cancelado';
