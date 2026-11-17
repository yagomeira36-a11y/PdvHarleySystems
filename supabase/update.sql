-- ============================================================
-- ATUALIZAÇÃO: CUSTOS + CONFIGURAÇÕES (caixa/lucro/empresa)
-- ============================================================
-- Rode este arquivo APENAS se você já tinha rodado o schema.sql
-- antigo (sem custos/configurações). Ele é seguro para rodar
-- mais de uma vez (usa IF NOT EXISTS / ON CONFLICT).
-- Se ainda não rodou nada, use o schema.sql completo.
-- ============================================================

-- 1) Custo de produção nos produtos (para calcular o lucro)
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost NUMERIC(10,2) NOT NULL DEFAULT 0;

-- 2) Custo congelado no momento da venda (lucro histórico não muda)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost NUMERIC(10,2) NOT NULL DEFAULT 0;

-- 3) Tabela de configurações da empresa (linha única, id = 1)
CREATE TABLE IF NOT EXISTS configuracoes (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nome_empresa TEXT NOT NULL DEFAULT 'PDV Hamburgueria',
  cnpj TEXT,
  telefone TEXT,
  endereco TEXT,
  taxa_entrega_padrao NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4) Política de acesso público (demonstração)
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso_publico_configuracoes" ON configuracoes FOR ALL USING (true) WITH CHECK (true);

-- 5) Linha inicial de configuração
INSERT INTO configuracoes (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 6) Custos de exemplo nos produtos já cadastrados
UPDATE products SET cost = 12.00 WHERE code = 1;
UPDATE products SET cost = 13.50 WHERE code = 2;
UPDATE products SET cost = 16.50 WHERE code = 3;
UPDATE products SET cost = 14.00 WHERE code = 4;
UPDATE products SET cost = 3.00  WHERE code = 5;
UPDATE products SET cost = 3.00  WHERE code = 6;
UPDATE products SET cost = 4.50  WHERE code = 7;
UPDATE products SET cost = 1.20  WHERE code = 8;
UPDATE products SET cost = 8.00  WHERE code = 9;
UPDATE products SET cost = 12.50 WHERE code = 10;
UPDATE products SET cost = 9.00  WHERE code = 11;
UPDATE products SET cost = 10.00 WHERE code = 12;
