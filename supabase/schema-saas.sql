-- ============================================================
-- SISTEMA SAAS Ponto De Vendas Harley Systems — LOGIN DE LOJAS + PAINEL SUPER ADMIN
-- (Supabase / PostgreSQL)
-- ============================================================
-- COMO USAR:
-- 1. Acesse o painel do seu projeto no Supabase
-- 2. Vá em "SQL Editor" > "New query"
-- 3. Cole TODO este arquivo e clique em "Run"
-- 4. Pronto: login em /login, painel em /admin
--    Loja de demonstração: demo@menuau.com / senha 123456
-- ============================================================
-- O QUE ESTE SCRIPT FAZ:
-- - Recria LIMPO as tabelas do PDV Hamburgueria (products, orders,
--   order_items, motoboys, entregas, clientes, mesas, configuracoes)
--   agora com a coluna loja_id (cada loja vê só os próprios dados)
-- - Adiciona as colunas de SaaS na tabela "lojas" JÁ EXISTENTE do
--   pdv79 (sem apagar nada do outro projeto)
-- - Cria a tabela usuarios_loja
-- - Cria as funções login_loja / criar_loja / admin_atualizar_loja
-- - Cria a loja de demonstração com cardápio, mesas e motoboys
-- É seguro rodar mais de uma vez.
-- ============================================================

-- Extensão para criptografar senhas (SHA-256)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- LIMPEZA: remove as tabelas do PDV Hamburgueria (se existirem)
-- NÃO mexe nas tabelas do outro projeto (produtos/pedidos/lojas)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS entregas CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS contadores_pedido CASCADE;
DROP TABLE IF EXISTS motoboys CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS mesas CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS configuracoes CASCADE;
DROP TABLE IF EXISTS usuarios_loja CASCADE;
DROP TYPE IF EXISTS categoria_produto;

-- ------------------------------------------------------------
-- TABELA "lojas" (JÁ EXISTE, criada pelo pdv79 - colunas id/nome/slug)
-- Adicionamos as colunas do SaaS sem apagar o que já existe.
-- A "Loja Matriz" do pdv79 continua lá, mas sem email_dono,
-- então não aparece no painel /admin nem consegue logar.
-- ------------------------------------------------------------
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS nome_loja TEXT;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS email_dono TEXT;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS senha_hash TEXT;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS status_pagamento TEXT NOT NULL DEFAULT 'ativo';
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS data_vencimento DATE;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS plano TEXT NOT NULL DEFAULT 'basico';
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Integração com o Asaas (cobrança da mensalidade de R$ 49,99/mês)
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT;

-- E-mail do dono único entre as lojas (a linha do pdv79 fica de fora)
CREATE UNIQUE INDEX IF NOT EXISTS lojas_email_dono_uniq
  ON lojas (email_dono) WHERE email_dono IS NOT NULL;

-- Regra dos status de pagamento: ativo | vencido | bloqueado
-- Antes de trocar a regra, converte os valores antigos para os novos.
ALTER TABLE lojas ALTER COLUMN status_pagamento SET DEFAULT 'ativo';
UPDATE public.lojas SET status_pagamento = 'ativo'   WHERE status_pagamento = 'em_dia';
UPDATE public.lojas SET status_pagamento = 'vencido' WHERE status_pagamento = 'atrasado';
UPDATE public.lojas SET status_pagamento = 'ativo'
  WHERE status_pagamento NOT IN ('ativo', 'vencido', 'bloqueado');
ALTER TABLE public.lojas DROP CONSTRAINT IF EXISTS lojas_status_pagamento_check;
ALTER TABLE public.lojas ADD CONSTRAINT lojas_status_pagamento_check
  CHECK (status_pagamento IN ('ativo', 'vencido', 'bloqueado'));

-- ------------------------------------------------------------
-- TABELA: usuarios_loja (funcionários de cada loja)
-- ------------------------------------------------------------
CREATE TABLE usuarios_loja (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  cargo TEXT NOT NULL DEFAULT 'funcionario'  -- dono | funcionario
    CHECK (cargo IN ('dono', 'funcionario')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- ENUM de categorias de produto
-- ------------------------------------------------------------
CREATE TYPE categoria_produto AS ENUM ('HAMBÚRGUER', 'BEBIDAS', 'PORÇÕES');

-- ------------------------------------------------------------
-- TABELA: products (cardápio — cada loja tem os seus)
-- ------------------------------------------------------------
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                              -- nome do produto
  price NUMERIC(10,2) NOT NULL DEFAULT 0,          -- preço de venda
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,           -- custo de produção (lucro)
  category categoria_produto NOT NULL DEFAULT 'HAMBÚRGUER',
  image_url TEXT,                                  -- foto do produto
  description TEXT,
  available BOOLEAN NOT NULL DEFAULT true,
  code INTEGER NOT NULL,                           -- código interno (ex: 12)
  loja_id UUID NOT NULL,                           -- dona do produto
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX products_loja_id_idx ON products (loja_id);

-- ------------------------------------------------------------
-- TABELA: orders (pedidos do balcão e delivery, por loja)
-- ------------------------------------------------------------
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'balcao'
    CHECK (type IN ('balcao', 'delivery', 'mesa')),
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'pago', 'saiu_entrega', 'entregue', 'cancelado')),
  customer_name TEXT,
  address TEXT,
  complemento TEXT,
  telefone TEXT,
  delivery_fee NUMERIC(10,2) DEFAULT 0,
  mesa_numero INTEGER,                              -- nº da mesa (pedidos tipo 'mesa')
  forma_pagamento TEXT,                             -- forma de pagamento (adicionar-pagamento.sql)
  numero_pedido BIGINT NOT NULL,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX orders_loja_id_idx ON orders (loja_id);
CREATE UNIQUE INDEX orders_loja_numero_pedido_uniq ON orders (loja_id, numero_pedido);

CREATE TABLE contadores_pedido (
  loja_id UUID PRIMARY KEY REFERENCES lojas(id) ON DELETE CASCADE,
  ultimo_numero BIGINT NOT NULL CHECK (ultimo_numero >= 0)
);

CREATE OR REPLACE FUNCTION public.definir_numero_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.numero_pedido IS DISTINCT FROM OLD.numero_pedido THEN
      RAISE EXCEPTION 'O número do pedido não pode ser alterado.';
    END IF;
    RETURN NEW;
  END IF;

  INSERT INTO public.contadores_pedido (loja_id, ultimo_numero)
  VALUES (NEW.loja_id, 1)
  ON CONFLICT (loja_id) DO UPDATE
  SET ultimo_numero = public.contadores_pedido.ultimo_numero + 1
  RETURNING ultimo_numero INTO NEW.numero_pedido;

  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_definir_numero_pedido_insert
BEFORE INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION public.definir_numero_pedido();

CREATE TRIGGER orders_proteger_numero_pedido_update
BEFORE UPDATE OF numero_pedido ON orders
FOR EACH ROW EXECUTE FUNCTION public.definir_numero_pedido();

REVOKE ALL ON TABLE public.contadores_pedido FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.definir_numero_pedido() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- TABELA: order_items (itens de cada pedido)
-- ------------------------------------------------------------
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(10,2) NOT NULL,
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  observacao TEXT,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX order_items_loja_id_idx ON order_items (loja_id);

-- ------------------------------------------------------------
-- TABELA: motoboys (entregadores de cada loja)
-- ------------------------------------------------------------
CREATE TABLE motoboys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT,
  placa TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX motoboys_loja_id_idx ON motoboys (loja_id);

-- ------------------------------------------------------------
-- TABELA: entregas (uma entrega por pedido delivery)
-- ------------------------------------------------------------
CREATE TABLE entregas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  motoboy_id UUID REFERENCES motoboys(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'saiu_entrega', 'entregue')),
  taxa NUMERIC(10,2) DEFAULT 0,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX entregas_loja_id_idx ON entregas (loja_id);

-- ------------------------------------------------------------
-- TABELA: clientes (reconhecidos pelo telefone, por loja)
-- ------------------------------------------------------------
CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  endereco TEXT,
  complemento TEXT,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT clientes_loja_telefone_key UNIQUE (loja_id, telefone)
);
CREATE INDEX clientes_loja_id_idx ON clientes (loja_id);

-- ------------------------------------------------------------
-- TABELA: configuracoes (dados da empresa — uma linha POR LOJA)
-- ------------------------------------------------------------
CREATE TABLE configuracoes (
  id SERIAL PRIMARY KEY,
  loja_id UUID NOT NULL UNIQUE,
  nome_empresa TEXT NOT NULL DEFAULT 'PDV Hamburgueria',
  cnpj TEXT,
  telefone TEXT,
  endereco TEXT,
  taxa_entrega_padrao NUMERIC(10,2) NOT NULL DEFAULT 0,
  modelo_comanda TEXT NOT NULL DEFAULT 'modelo1'
    CHECK (modelo_comanda IN ('modelo1', 'modelo2', 'modelo3', 'modelo4')),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- TABELA: mesas (mesas do salão — número único POR LOJA)
-- ------------------------------------------------------------
CREATE TABLE mesas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'disponivel'
    CHECK (status IN ('disponivel', 'ocupada')),
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT mesas_loja_numero_key UNIQUE (loja_id, numero)
);
CREATE INDEX mesas_loja_id_idx ON mesas (loja_id);

-- ------------------------------------------------------------
-- SEGURANÇA (Row Level Security)
-- ATENÇÃO: acesso público total - apenas para demonstração.
-- Em produção, use autenticação real e políticas restritas.
-- (A tabela "lojas" do pdv79 NÃO é alterada aqui de propósito.)
-- ------------------------------------------------------------
ALTER TABLE products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoboys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE entregas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mesas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios_loja ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acesso_publico_products"      ON products      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_orders"        ON orders        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_order_items"   ON order_items   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_motoboys"      ON motoboys      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_entregas"      ON entregas      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_clientes"      ON clientes      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_mesas"         ON mesas         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_configuracoes" ON configuracoes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_usuarios_loja" ON usuarios_loja FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- FUNÇÃO: login_loja (e-mail + senha -> dados da loja ou NULL)
-- A senha é conferida em SHA-256 DENTRO do banco.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.login_loja(p_email text, p_senha text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_loja lojas%ROWTYPE;
BEGIN
  SELECT * INTO v_loja
  FROM public.lojas
  WHERE lower(email_dono) = lower(trim(p_email))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_loja.senha_hash IS DISTINCT FROM encode(digest(p_senha, 'sha256'), 'hex') THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'id', v_loja.id,
    'nome_loja', v_loja.nome_loja,
    'email_dono', v_loja.email_dono,
    'status_pagamento', v_loja.status_pagamento,
    'data_vencimento', v_loja.data_vencimento,
    'plano', v_loja.plano
  );
END;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: criar_loja (usada pelo painel /admin)
-- Cria a loja + login e já monta o cardápio padrão,
-- 9 mesas, 3 motoboys e a configuração da empresa.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_loja(
  p_nome text,
  p_email text,
  p_senha_hash text,
  p_vencimento date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_loja_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.lojas WHERE lower(email_dono) = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'Já existe uma loja com este e-mail.';
  END IF;

  INSERT INTO public.lojas (nome, slug, nome_loja, email_dono, senha_hash,
                            status_pagamento, data_vencimento, plano)
  VALUES (
    p_nome,
    lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g')),
    p_nome,
    lower(trim(p_email)),
    p_senha_hash,
    'ativo',
    p_vencimento,
    'basico'
  )
  RETURNING id INTO v_loja_id;

  -- Cardápio padrão (12 produtos)
  INSERT INTO public.products (name, price, cost, category, image_url, code, loja_id) VALUES
    ('X-Burger Clássico',      29.90, 12.00, 'HAMBÚRGUER', '/placeholder.svg', 1,  v_loja_id),
    ('X-Salada',               32.90, 13.50, 'HAMBÚRGUER', '/placeholder.svg', 2,  v_loja_id),
    ('X-Bacon Duplo',          39.90, 16.50, 'HAMBÚRGUER', '/placeholder.svg', 3,  v_loja_id),
    ('Burger da Casa',         34.90, 14.00, 'HAMBÚRGUER', '/placeholder.svg', 4,  v_loja_id),
    ('Coca-Cola Lata 350ml',    6.00,  3.00, 'BEBIDAS',     '/placeholder.svg', 5,  v_loja_id),
    ('Guaraná Lata 350ml',      6.00,  3.00, 'BEBIDAS',     '/placeholder.svg', 6,  v_loja_id),
    ('Suco de Laranja 500ml',   9.90,  4.50, 'BEBIDAS',     '/placeholder.svg', 7,  v_loja_id),
    ('Água Mineral 500ml',      4.00,  1.20, 'BEBIDAS',     '/placeholder.svg', 8,  v_loja_id),
    ('Batata Frita Grande',    19.90,  8.00, 'PORÇÕES',     '/placeholder.svg', 9,  v_loja_id),
    ('Batata Cheddar e Bacon', 29.90, 12.50, 'PORÇÕES',     '/placeholder.svg', 10, v_loja_id),
    ('Onion Rings',            22.90,  9.00, 'PORÇÕES',     '/placeholder.svg', 11, v_loja_id),
    ('Nuggets 12un',           24.90, 10.00, 'PORÇÕES',     '/placeholder.svg', 12, v_loja_id);

  -- 9 mesas padrão do salão (4 ocupadas)
  INSERT INTO public.mesas (numero, status, loja_id) VALUES
    (1,'disponivel',v_loja_id), (2,'ocupada',v_loja_id), (3,'disponivel',v_loja_id),
    (4,'ocupada',v_loja_id), (5,'disponivel',v_loja_id), (6,'ocupada',v_loja_id),
    (7,'disponivel',v_loja_id), (8,'ocupada',v_loja_id), (9,'disponivel',v_loja_id);

  -- 3 motoboys de exemplo
  INSERT INTO public.motoboys (nome, telefone, placa, ativo, loja_id) VALUES
    ('João Motoboy',   '(11) 99999-0001', 'ABC-1234', true, v_loja_id),
    ('Pedro Motoboy',  '(11) 99999-0002', 'DEF-5678', true, v_loja_id),
    ('Carlos Motoboy', '(11) 99999-0003', 'GHI-9012', true, v_loja_id);

  -- Configuração inicial da empresa
  INSERT INTO public.configuracoes (loja_id, nome_empresa) VALUES (v_loja_id, p_nome);

  RETURN v_loja_id;
END;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: admin_atualizar_loja (usada pelos botões do /admin)
-- Marca como paga, bloqueia acesso ou muda o vencimento.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_atualizar_loja(
  p_id uuid,
  p_status text DEFAULT NULL,
  p_vencimento date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.lojas
  SET status_pagamento = COALESCE(p_status, status_pagamento),
      data_vencimento  = COALESCE(p_vencimento, data_vencimento)
  WHERE id = p_id AND email_dono IS NOT NULL;
END;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: admin_salvar_asaas (guarda os ids do Asaas na loja)
-- Usada pela rota /api/admin/criar-loja depois de criar o
-- cliente e a assinatura no Asaas.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_salvar_asaas(
  p_id uuid,
  p_customer_id text,
  p_subscription_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.lojas
  SET asaas_customer_id     = COALESCE(p_customer_id, asaas_customer_id),
      asaas_subscription_id = COALESCE(p_subscription_id, asaas_subscription_id)
  WHERE id = p_id AND email_dono IS NOT NULL;
END;
$$;

-- Permite o app (chave pública) chamar as funções via RPC
GRANT EXECUTE ON FUNCTION public.login_loja(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.criar_loja(text, text, text, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_loja(uuid, text, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_salvar_asaas(uuid, text, text) TO anon, authenticated;

-- ------------------------------------------------------------
-- LOJA DE DEMONSTRAÇÃO (para testar o login na hora)
-- E-mail: demo@menuau.com | Senha: 123456
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lojas WHERE lower(email_dono) = 'demo@menuau.com') THEN
    PERFORM public.criar_loja(
      'Hamburgueria Demo',
      'demo@menuau.com',
      encode(digest('123456', 'sha256'), 'hex'),
      CURRENT_DATE + 30
    );
  END IF;
END $$;
