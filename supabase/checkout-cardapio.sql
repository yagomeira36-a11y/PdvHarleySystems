-- Salva o checkout público no modelo orders + order_items já usado pelo PDV.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS observacao TEXT;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('novo', 'pendente', 'pago', 'saiu_entrega', 'entregue', 'cancelado'));
