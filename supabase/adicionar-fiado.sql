-- ============================================================
-- FIADO (crédito da loja)
-- Cada linha é um lançamento: uma dívida (o que o cliente levou)
-- ou um pagamento (o que o cliente pagou). O saldo em aberto é
-- a soma das dívidas menos a soma dos pagamentos, por cliente.
--
-- Como usar: abra o SQL Editor do Supabase, cole este arquivo
-- inteiro e clique em Run.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.fiados (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_nome     TEXT NOT NULL,
  cliente_telefone TEXT,
  tipo             TEXT NOT NULL CHECK (tipo IN ('divida', 'pagamento')),
  valor            NUMERIC(10,2) NOT NULL CHECK (valor >= 0),
  descricao        TEXT,
  data             DATE NOT NULL DEFAULT CURRENT_DATE,
  loja_id          UUID NOT NULL,                    -- dona do lançamento
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fiados_loja_id_idx ON public.fiados (loja_id);
CREATE INDEX IF NOT EXISTS fiados_loja_cliente_idx ON public.fiados (loja_id, cliente_nome);

-- Mesmo padrão de acesso público das outras tabelas do sistema
ALTER TABLE public.fiados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_publico_fiados" ON public.fiados;
CREATE POLICY "acesso_publico_fiados" ON public.fiados
  FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
COMMIT;
