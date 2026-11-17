-- ============================================================
-- PEDIDOS COM MESA (rodar SÓ este arquivo agora)
-- Permite o tipo 'mesa' na tabela orders e guarda o nº da mesa.
-- NÃO apaga nenhum dado.
-- Como usar: SQL Editor do Supabase > colar TODO este arquivo > Run
-- ============================================================

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_type_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_type_check
  CHECK (type IN ('balcao', 'delivery', 'mesa'));

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS mesa_numero INTEGER;
