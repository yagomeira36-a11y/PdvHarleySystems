-- ============================================================
-- CATEGORIAS LIVRES DE PRODUTO (rodar UMA VEZ no SQL Editor)
-- A coluna "category" da tabela products hoje é um enum
-- (categoria_produto), que só aceita HAMBÚRGUER, BEBIDAS e PORÇÕES.
-- Este comando libera a coluna para aceitar qualquer texto,
-- assim o dono da loja pode criar categorias novas (ex: molhos).
-- Nenhum dado existente é perdido ou alterado.
-- ============================================================
BEGIN;

ALTER TABLE public.products
  ALTER COLUMN category DROP DEFAULT,
  ALTER COLUMN category TYPE TEXT USING category::text,
  ALTER COLUMN category SET DEFAULT 'HAMBÚRGUER';

COMMIT;
