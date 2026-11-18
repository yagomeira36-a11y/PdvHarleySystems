-- Execute no SQL Editor do Supabase para salvar o modelo de comanda por loja.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS modelo_comanda TEXT NOT NULL DEFAULT 'modelo1';

ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_modelo_comanda_check;

ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_modelo_comanda_check
  CHECK (modelo_comanda IN ('modelo1', 'modelo2', 'modelo3', 'modelo4'));
