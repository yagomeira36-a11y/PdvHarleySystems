-- ============================================================
-- SCHEMA DO PDV HAMBURGUERIA (Supabase / PostgreSQL)
-- ============================================================
-- COMO USAR:
-- 1. Acesse o painel do seu projeto no Supabase
-- 2. Vá em "SQL Editor" > "New query"
-- 3. Cole TODO este arquivo e clique em "Run"
-- ============================================================

-- ------------------------------------------------------------
-- ENUM de categorias de produto (apenas estas 3 categorias)
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE categoria_produto AS ENUM ('HAMBÚRGUER', 'BEBIDAS', 'PORÇÕES');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- TABELA: products (produtos do cardápio)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- identificador único
  name TEXT NOT NULL,                              -- nome do produto
  price NUMERIC(10,2) NOT NULL DEFAULT 0,          -- preço de venda
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,           -- custo de produção (para calcular o lucro)
  category categoria_produto NOT NULL DEFAULT 'TODOS', -- categoria (enum)
  image_url TEXT,                                  -- foto do produto
  description TEXT,
  available BOOLEAN NOT NULL DEFAULT true,
  code INTEGER NOT NULL,                           -- código interno (ex: 12)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- TABELA: orders (pedidos do balcão e delivery)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total NUMERIC(10,2) NOT NULL DEFAULT 0,          -- total (inclui taxa no delivery)
  type TEXT NOT NULL DEFAULT 'balcao'              -- balcao | delivery
    CHECK (type IN ('balcao', 'delivery')),
  status TEXT NOT NULL DEFAULT 'pendente'          -- pendente | pago | saiu_entrega | entregue | cancelado
    CHECK (status IN ('pendente', 'pago', 'saiu_entrega', 'entregue', 'cancelado')),
  customer_name TEXT,                              -- nome do cliente
  address TEXT,                                    -- rua e número (obrigatório no delivery)
  complemento TEXT,                                -- complemento do endereço (delivery)
  telefone TEXT,                                   -- telefone do cliente (delivery)
  delivery_fee NUMERIC(10,2) DEFAULT 0,            -- taxa de entrega
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- TABELA: order_items (itens de cada pedido)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 1,                  -- quantidade
  price NUMERIC(10,2) NOT NULL,                    -- preço unitário no momento da venda
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,           -- custo unitário congelado na venda
  observacao TEXT,                                 -- observação do cliente no item
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- TABELA: motoboys (entregadores)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS motoboys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT,
  placa TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,             -- disponível para entrega?
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- TABELA: entregas (uma entrega por pedido delivery)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entregas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  motoboy_id UUID REFERENCES motoboys(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente'          -- pendente | saiu_entrega | entregue
    CHECK (status IN ('pendente', 'saiu_entrega', 'entregue')),
  taxa NUMERIC(10,2) DEFAULT 0,                    -- taxa cobrada do cliente
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- TABELA: configuracoes (dados da empresa - linha única id=1)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracoes (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- sempre 1 (uma empresa só)
  nome_empresa TEXT NOT NULL DEFAULT 'PDV Hamburgueria',
  cnpj TEXT,
  telefone TEXT,
  endereco TEXT,
  taxa_entrega_padrao NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- TABELA: mesas (mesas do salão - tela /mesas)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mesas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero INTEGER NOT NULL UNIQUE,                  -- número da mesa (1, 2, 3...)
  status TEXT NOT NULL DEFAULT 'disponivel'        -- disponivel | ocupada
    CHECK (status IN ('disponivel', 'ocupada')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- TABELA: clientes (salvos no sistema, reconhecidos pelo telefone)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL UNIQUE,                   -- só números (ex: 11999990000)
  endereco TEXT,                                   -- rua e número
  complemento TEXT,                                -- apto, bloco, referência...
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- SEGURANÇA (Row Level Security)
-- ATENÇÃO: acesso público total - apenas para demonstração.
-- Em produção, use autenticação e políticas restritas.
-- ------------------------------------------------------------
ALTER TABLE products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoboys     ENABLE ROW LEVEL SECURITY;
ALTER TABLE entregas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mesas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acesso_publico_products"     ON products     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_orders"       ON orders       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_order_items"  ON order_items  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_motoboys"     ON motoboys     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_entregas"     ON entregas     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_clientes"     ON clientes     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_mesas"        ON mesas        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_configuracoes" ON configuracoes FOR ALL USING (true) WITH CHECK (true);

-- Linha única de configurações da empresa
INSERT INTO configuracoes (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 9 mesas padrão do salão (4 ocupadas)
INSERT INTO mesas (numero, status) VALUES
  (1,'disponivel'), (2,'ocupada'), (3,'disponivel'), (4,'ocupada'),
  (5,'disponivel'), (6,'ocupada'), (7,'disponivel'), (8,'ocupada'),
  (9,'disponivel')
ON CONFLICT (numero) DO NOTHING;

-- Loja nova come?a sem produtos cadastrados

-- ------------------------------------------------------------
-- DADOS DE EXEMPLO: 3 motoboys para teste
-- ------------------------------------------------------------
INSERT INTO motoboys (nome, telefone, placa, ativo) VALUES
  ('João Motoboy',  '(11) 99999-0001', 'ABC-1234', true),
  ('Pedro Motoboy', '(11) 99999-0002', 'DEF-5678', true),
  ('Carlos Motoboy','(11) 99999-0003', 'GHI-9012', true)
ON CONFLICT DO NOTHING;
