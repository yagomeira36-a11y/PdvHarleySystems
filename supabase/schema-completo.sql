-- ============================================================
-- PdvDaGalera — SCHEMA COMPLETO (Supabase / PostgreSQL)
-- ============================================================
-- ARQUIVO ÚNICO: cria o banco inteiro do zero, sem erro.
--
-- COMO USAR:
--   1. Painel do Supabase > "SQL Editor" > "New query"
--   2. Cole TODO este arquivo e clique em "Run"
--   3. Pronto: login em /login, painel em /admin
--      Loja de demonstração: demo@menuau.com / senha 123456
--
-- O QUE ESTE ARQUIVO CRIA (na ordem certa):
--   extensão pgcrypto;
--   tabelas: lojas, usuarios_loja, products, orders, contadores_pedido,
--            order_items, motoboys, entregas, clientes, configuracoes, mesas;
--   triggers de numeração de pedido;
--   segurança (RLS + políticas);
--   funções: login_loja_hash, login_loja, criar_loja,
--            admin_atualizar_loja, admin_salvar_asaas;
--   permissões (GRANT) e a loja de demonstração.
--
-- É SEGURO RODAR MAIS DE UMA VEZ: ele apaga e recria tudo limpo.
-- (Atenção: rodar de novo ZERA os dados existentes.)
-- ============================================================

-- Criptografia de senha (SHA-256)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- LIMPEZA (ordem inversa de dependência) — começa do zero
-- ------------------------------------------------------------
DROP TABLE IF EXISTS public.entregas        CASCADE;
DROP TABLE IF EXISTS public.order_items     CASCADE;
DROP TABLE IF EXISTS public.orders          CASCADE;
DROP TABLE IF EXISTS public.contadores_pedido CASCADE;
DROP TABLE IF EXISTS public.motoboys        CASCADE;
DROP TABLE IF EXISTS public.mesas           CASCADE;
DROP TABLE IF EXISTS public.clientes        CASCADE;
DROP TABLE IF EXISTS public.products        CASCADE;
DROP TABLE IF EXISTS public.configuracoes   CASCADE;
DROP TABLE IF EXISTS public.usuarios_loja   CASCADE;
DROP TABLE IF EXISTS public.lojas           CASCADE;
DROP TYPE  IF EXISTS public.categoria_produto CASCADE;

DROP FUNCTION IF EXISTS public.login_loja_hash(text, text)          CASCADE;
DROP FUNCTION IF EXISTS public.login_loja(text, text)               CASCADE;
DROP FUNCTION IF EXISTS public.criar_loja(text, text, text, date)   CASCADE;
DROP FUNCTION IF EXISTS public.admin_atualizar_loja(uuid, text, date) CASCADE;
DROP FUNCTION IF EXISTS public.admin_salvar_asaas(uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.definir_numero_pedido()              CASCADE;

-- ============================================================
-- TABELA: lojas (cada loja assinante do SaaS)
-- ============================================================
CREATE TABLE public.lojas (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                   TEXT,                       -- nome/rótulo curto da loja
  slug                   TEXT,                       -- versão do nome para URL
  nome_loja              TEXT,                       -- nome exibido no sistema
  email_dono             TEXT,                       -- login (e-mail do dono)
  senha_hash             TEXT,                       -- senha em SHA-256 (hex)
  status_pagamento       TEXT NOT NULL DEFAULT 'ativo'
    CONSTRAINT lojas_status_pagamento_check
    CHECK (status_pagamento IN ('ativo', 'vencido', 'bloqueado')),
  data_vencimento        DATE,                       -- vencimento da mensalidade
  plano                  TEXT NOT NULL DEFAULT 'basico',
  asaas_customer_id      TEXT,                       -- id do cliente no Asaas
  asaas_subscription_id  TEXT,                       -- id da assinatura no Asaas
  created_at             TIMESTAMPTZ DEFAULT now()
);

-- E-mail do dono único entre as lojas (linhas sem e-mail ficam de fora)
CREATE UNIQUE INDEX lojas_email_dono_uniq
  ON public.lojas (email_dono) WHERE email_dono IS NOT NULL;

-- ============================================================
-- TABELA: usuarios_loja (funcionários de cada loja)
-- ============================================================
CREATE TABLE public.usuarios_loja (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id    UUID NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  cargo      TEXT NOT NULL DEFAULT 'funcionario'
    CHECK (cargo IN ('dono', 'funcionario')),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX usuarios_loja_loja_id_idx ON public.usuarios_loja (loja_id);

-- ============================================================
-- TABELA: products (cardápio — cada loja tem os seus)
-- A categoria é TEXTO LIVRE (o dono pode criar novas categorias).
-- ============================================================
CREATE TABLE public.products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,                         -- nome do produto
  price      NUMERIC(10,2) NOT NULL DEFAULT 0,      -- preço de venda
  cost       NUMERIC(10,2) NOT NULL DEFAULT 0,      -- custo de produção (lucro)
  category   TEXT NOT NULL DEFAULT 'HAMBÚRGUER',    -- categoria (texto livre)
  image_url  TEXT,                                  -- foto do produto
  description TEXT,
  available  BOOLEAN NOT NULL DEFAULT true,
  code       INTEGER NOT NULL,                      -- código interno (ex: 12)
  loja_id    UUID NOT NULL,                         -- dona do produto
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX products_loja_id_idx ON public.products (loja_id);

-- ============================================================
-- TABELA: orders (pedidos: balcão, delivery e mesa — por loja)
-- ============================================================
CREATE TABLE public.orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total           NUMERIC(10,2) NOT NULL DEFAULT 0, -- total (inclui taxa no delivery)
  type            TEXT NOT NULL DEFAULT 'balcao'
    CHECK (type IN ('balcao', 'delivery', 'mesa')),
  status          TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'pago', 'saiu_entrega', 'entregue', 'cancelado')),
  customer_name   TEXT,                             -- nome do cliente
  address         TEXT,                             -- rua e número (delivery)
  complemento     TEXT,                             -- complemento do endereço
  telefone        TEXT,                             -- telefone do cliente
  delivery_fee    NUMERIC(10,2) DEFAULT 0,          -- taxa de entrega
  mesa_numero     INTEGER,                          -- nº da mesa (type = 'mesa')
  forma_pagamento TEXT,                             -- dinheiro, pix, débito...
  numero_pedido   BIGINT NOT NULL,                  -- nº sequencial por loja
  loja_id         UUID NOT NULL,                    -- dona do pedido
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX orders_loja_id_idx ON public.orders (loja_id);
CREATE UNIQUE INDEX orders_loja_numero_pedido_uniq
  ON public.orders (loja_id, numero_pedido);

-- ============================================================
-- TABELA + TRIGGERS: numeração sequencial de pedido por loja
-- ============================================================
CREATE TABLE public.contadores_pedido (
  loja_id       UUID PRIMARY KEY REFERENCES public.lojas(id) ON DELETE CASCADE,
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
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.definir_numero_pedido();

CREATE TRIGGER orders_proteger_numero_pedido_update
BEFORE UPDATE OF numero_pedido ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.definir_numero_pedido();

REVOKE ALL ON TABLE public.contadores_pedido FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.definir_numero_pedido() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- TABELA: order_items (itens de cada pedido)
-- ============================================================
CREATE TABLE public.order_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  qty        INTEGER NOT NULL DEFAULT 1,            -- quantidade
  price      NUMERIC(10,2) NOT NULL,                -- preço unitário na venda
  cost       NUMERIC(10,2) NOT NULL DEFAULT 0,      -- custo congelado na venda
  observacao TEXT,                                  -- observação do cliente
  loja_id    UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX order_items_loja_id_idx ON public.order_items (loja_id);

-- ============================================================
-- TABELA: motoboys (entregadores de cada loja)
-- ============================================================
CREATE TABLE public.motoboys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  telefone   TEXT,
  placa      TEXT,
  ativo      BOOLEAN NOT NULL DEFAULT true,         -- disponível para entrega?
  loja_id    UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX motoboys_loja_id_idx ON public.motoboys (loja_id);

-- ============================================================
-- TABELA: entregas (uma entrega por pedido delivery)
-- ============================================================
CREATE TABLE public.entregas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  motoboy_id UUID REFERENCES public.motoboys(id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'saiu_entrega', 'entregue')),
  taxa       NUMERIC(10,2) DEFAULT 0,               -- taxa cobrada do cliente
  loja_id    UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX entregas_loja_id_idx ON public.entregas (loja_id);

-- ============================================================
-- TABELA: clientes (reconhecidos pelo telefone, por loja)
-- ============================================================
CREATE TABLE public.clientes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  telefone    TEXT NOT NULL,
  endereco    TEXT,
  complemento TEXT,
  loja_id     UUID NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT clientes_loja_telefone_key UNIQUE (loja_id, telefone)
);
CREATE INDEX clientes_loja_id_idx ON public.clientes (loja_id);

-- ============================================================
-- TABELA: configuracoes (dados da empresa — uma linha POR LOJA)
-- ============================================================
CREATE TABLE public.configuracoes (
  id                  SERIAL PRIMARY KEY,
  loja_id             UUID NOT NULL UNIQUE,
  nome_empresa        TEXT NOT NULL DEFAULT 'PDV Hamburgueria',
  cnpj                TEXT,
  telefone            TEXT,
  endereco            TEXT,
  taxa_entrega_padrao NUMERIC(10,2) NOT NULL DEFAULT 0,
  modelo_comanda      TEXT NOT NULL DEFAULT 'modelo1'
    CHECK (modelo_comanda IN ('modelo1', 'modelo2', 'modelo3', 'modelo4')),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- TABELA: mesas (mesas do salão — número único POR LOJA)
-- ============================================================
CREATE TABLE public.mesas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero     INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'disponivel'
    CHECK (status IN ('disponivel', 'ocupada')),
  loja_id    UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT mesas_loja_numero_key UNIQUE (loja_id, numero)
);
CREATE INDEX mesas_loja_id_idx ON public.mesas (loja_id);

-- ============================================================
-- SEGURANÇA (Row Level Security)
-- ATENÇÃO: acesso público total — apenas para demonstração.
-- Em produção, use autenticação real e políticas restritas.
-- ============================================================
ALTER TABLE public.products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoboys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entregas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mesas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_loja ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lojas         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acesso_publico_products"      ON public.products      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_orders"        ON public.orders        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_order_items"   ON public.order_items   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_motoboys"      ON public.motoboys      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_entregas"      ON public.entregas      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_clientes"      ON public.clientes      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_mesas"         ON public.mesas         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_configuracoes" ON public.configuracoes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_usuarios_loja" ON public.usuarios_loja FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "acesso_publico_lojas"         ON public.lojas         FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- FUNÇÃO: login_loja_hash (usada pelo app — e-mail + hash SHA-256)
-- A senha é criptografada no navegador e o banco só compara os códigos.
-- ============================================================
CREATE OR REPLACE FUNCTION public.login_loja_hash(p_email text, p_senha_hash text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  IF v_loja.senha_hash IS DISTINCT FROM lower(trim(p_senha_hash)) THEN
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

-- ============================================================
-- FUNÇÃO: login_loja (alternativa — recebe a senha em texto puro)
-- Usa o digest() do pgcrypto (por isso o search_path com "extensions").
-- ============================================================
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

-- ============================================================
-- FUNÇÃO: criar_loja (usada pelo painel /admin)
-- Cria a loja + login. A loja nova nasce ZERADA:
-- sem produtos, sem mesas e sem motoboys (o dono cadastra pelo PDV).
-- ============================================================
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
    lower(trim(p_senha_hash)),
    'ativo',
    p_vencimento,
    'basico'
  )
  RETURNING id INTO v_loja_id;

  -- Configuração inicial da empresa
  INSERT INTO public.configuracoes (loja_id, nome_empresa)
  VALUES (v_loja_id, p_nome);

  RETURN v_loja_id;
END;
$$;

-- ============================================================
-- FUNÇÃO: admin_atualizar_loja (botões do /admin e sincronização)
-- Marca como paga, bloqueia acesso ou muda o vencimento.
-- ============================================================
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

-- ============================================================
-- FUNÇÃO: admin_salvar_asaas (guarda os ids do Asaas na loja)
-- Usada pela rota /api/admin/criar-loja depois de criar o
-- cliente e a assinatura no Asaas.
-- ============================================================
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

-- ============================================================
-- PERMISSÕES (o app usa a chave pública e chama as funções via RPC)
-- ============================================================
GRANT EXECUTE ON FUNCTION public.login_loja_hash(text, text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_loja(text, text)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.criar_loja(text, text, text, date)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_loja(uuid, text, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_salvar_asaas(uuid, text, text) TO anon, authenticated;

-- ============================================================
-- LOJA DE DEMONSTRAÇÃO (para testar o login na hora)
-- E-mail: demo@menuau.com | Senha: 123456
-- ============================================================
DO $$
BEGIN
  PERFORM set_config('search_path', 'public, extensions', true);
  IF NOT EXISTS (SELECT 1 FROM public.lojas WHERE lower(email_dono) = 'demo@menuau.com') THEN
    PERFORM public.criar_loja(
      'Hamburgueria Demo',
      'demo@menuau.com',
      encode(digest('123456', 'sha256'), 'hex'),
      CURRENT_DATE + 30
    );
  END IF;
END $$;

-- Avisa o PostgREST (a API do Supabase) para recarregar o schema
NOTIFY pgrst, 'reload schema';
