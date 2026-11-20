-- ============================================================
-- Ponto De Vendas Harley Systems — esquema completo consolidado (Supabase/PostgreSQL)
-- ============================================================
-- Este arquivo não apaga tabelas nem registros existentes.
-- Ele consolida o esquema SaaS, pedidos, cardápio online, impressão,
ru-- fiado usados atualmente pelo projeto.
--
-- IMPORTANTE SOBRE DADOS:
-- Os produtos, pedidos, clientes, credenciais e configurações reais
-- ficam no banco Supabase, não no repositório. Não foram inventados
-- nem copiados para este arquivo. Os INSERTs ao final apenas completam
-- configurações e contadores ausentes sem sobrescrever dados existentes.
--
-- Categorias não têm tabela própria: são os valores de products.category.
-- Impressoras/página de código são preferências locais do navegador;
-- o modelo de comanda fica em configuracoes.modelo_comanda.
--
-- As policies públicas abaixo preservam o comportamento atual do projeto,
-- que usa políticas permissivas de demonstração. Revise-as antes de uso
-- em produção com autenticação/RLS por loja.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- LOJAS / SAAS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lojas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT,
  slug TEXT,
  nome_loja TEXT,
  email_dono TEXT,
  senha_hash TEXT,
  status_pagamento TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status_pagamento IN ('ativo', 'vencido', 'bloqueado')),
  data_vencimento DATE,
  plano TEXT NOT NULL DEFAULT 'basico',
  asaas_customer_id TEXT,
  asaas_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.lojas
  ADD COLUMN IF NOT EXISTS nome TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS nome_loja TEXT,
  ADD COLUMN IF NOT EXISTS email_dono TEXT,
  ADD COLUMN IF NOT EXISTS senha_hash TEXT,
  ADD COLUMN IF NOT EXISTS status_pagamento TEXT NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS data_vencimento DATE,
  ADD COLUMN IF NOT EXISTS plano TEXT NOT NULL DEFAULT 'basico',
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.lojas
  DROP CONSTRAINT IF EXISTS lojas_status_pagamento_check;
UPDATE public.lojas SET status_pagamento = 'ativo' WHERE status_pagamento = 'em_dia';
UPDATE public.lojas SET status_pagamento = 'vencido' WHERE status_pagamento = 'atrasado';
UPDATE public.lojas SET status_pagamento = 'ativo'
WHERE status_pagamento NOT IN ('ativo', 'vencido', 'bloqueado');
ALTER TABLE public.lojas
  ADD CONSTRAINT lojas_status_pagamento_check
  CHECK (status_pagamento IN ('ativo', 'vencido', 'bloqueado'));

CREATE UNIQUE INDEX IF NOT EXISTS lojas_email_dono_uniq
  ON public.lojas (email_dono) WHERE email_dono IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.usuarios_loja (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id UUID NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  cargo TEXT NOT NULL DEFAULT 'funcionario'
    CHECK (cargo IN ('dono', 'funcionario')),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usuarios_loja_loja_id_idx
  ON public.usuarios_loja (loja_id);

-- ------------------------------------------------------------
-- PRODUTOS / CARDÁPIO
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'HAMBÚRGUER',
  image_url TEXT,
  description TEXT,
  available BOOLEAN NOT NULL DEFAULT true,
  code INTEGER NOT NULL,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT true;

-- Migra instalações antigas que ainda usam o enum categoria_produto.
ALTER TABLE public.products
  ALTER COLUMN category DROP DEFAULT,
  ALTER COLUMN category TYPE TEXT USING category::TEXT,
  ALTER COLUMN category SET DEFAULT 'HAMBÚRGUER';

CREATE INDEX IF NOT EXISTS products_loja_id_idx
  ON public.products (loja_id);

-- ------------------------------------------------------------
-- PEDIDOS / ITENS / NUMERAÇÃO
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'balcao',
  status TEXT NOT NULL DEFAULT 'pendente',
  customer_name TEXT,
  address TEXT,
  complemento TEXT,
  telefone TEXT,
  delivery_fee NUMERIC(10,2) DEFAULT 0,
  mesa_numero INTEGER,
  forma_pagamento TEXT,
  numero_pedido BIGINT,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  origem TEXT NOT NULL DEFAULT 'PDV',
  observacao TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  motivo_cancelamento TEXT,
  cancelado_em TIMESTAMPTZ,
  cancelado_por TEXT
);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS mesa_numero INTEGER,
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT,
  ADD COLUMN IF NOT EXISTS numero_pedido BIGINT,
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'PDV',
  ADD COLUMN IF NOT EXISTS observacao TEXT,
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT,
  ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelado_por TEXT;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_type_check,
  DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_type_check
    CHECK (type IN ('balcao', 'delivery', 'mesa')),
  ADD CONSTRAINT orders_status_check
    CHECK (status IN ('novo', 'pendente', 'pago', 'saiu_entrega', 'entregue', 'cancelado'));

CREATE INDEX IF NOT EXISTS orders_loja_id_idx
  ON public.orders (loja_id);

-- Preenche números de pedidos existentes sem alterar números já definidos.
WITH maximos AS (
  SELECT loja_id, COALESCE(MAX(numero_pedido), 0) AS ultimo_numero
  FROM public.orders
  WHERE loja_id IS NOT NULL
  GROUP BY loja_id
),
numerados AS (
  SELECT o.id,
    m.ultimo_numero + ROW_NUMBER() OVER (
      PARTITION BY o.loja_id ORDER BY o.created_at, o.id
    ) AS numero_pedido
  FROM public.orders o
  JOIN maximos m ON m.loja_id = o.loja_id
  WHERE o.numero_pedido IS NULL
)
UPDATE public.orders o
SET numero_pedido = n.numero_pedido
FROM numerados n
WHERE o.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS orders_loja_numero_pedido_uniq
  ON public.orders (loja_id, numero_pedido);

ALTER TABLE public.orders
  ALTER COLUMN numero_pedido SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.contadores_pedido (
  loja_id UUID PRIMARY KEY REFERENCES public.lojas(id) ON DELETE CASCADE,
  ultimo_numero BIGINT NOT NULL CHECK (ultimo_numero >= 0)
);

INSERT INTO public.contadores_pedido (loja_id, ultimo_numero)
SELECT l.id, COALESCE(MAX(o.numero_pedido), 0)
FROM public.lojas l
LEFT JOIN public.orders o ON o.loja_id = l.id
GROUP BY l.id
ON CONFLICT (loja_id) DO UPDATE
SET ultimo_numero = GREATEST(
  public.contadores_pedido.ultimo_numero,
  EXCLUDED.ultimo_numero
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

DROP TRIGGER IF EXISTS orders_definir_numero_pedido_insert ON public.orders;
CREATE TRIGGER orders_definir_numero_pedido_insert
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.definir_numero_pedido();

DROP TRIGGER IF EXISTS orders_proteger_numero_pedido_update ON public.orders;
CREATE TRIGGER orders_proteger_numero_pedido_update
BEFORE UPDATE OF numero_pedido ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.definir_numero_pedido();

REVOKE ALL ON TABLE public.contadores_pedido FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.definir_numero_pedido() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(10,2) NOT NULL,
  cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  observacao TEXT,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_items_loja_id_idx
  ON public.order_items (loja_id);

-- ------------------------------------------------------------
-- ENTREGAS / CLIENTES / MESAS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.motoboys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT,
  placa TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS motoboys_loja_id_idx
  ON public.motoboys (loja_id);

CREATE TABLE IF NOT EXISTS public.entregas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  motoboy_id UUID REFERENCES public.motoboys(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'saiu_entrega', 'entregue')),
  taxa NUMERIC(10,2) DEFAULT 0,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entregas_loja_id_idx
  ON public.entregas (loja_id);

CREATE TABLE IF NOT EXISTS public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  endereco TEXT,
  complemento TEXT,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT clientes_loja_telefone_key UNIQUE (loja_id, telefone)
);
CREATE INDEX IF NOT EXISTS clientes_loja_id_idx
  ON public.clientes (loja_id);

CREATE TABLE IF NOT EXISTS public.mesas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'disponivel'
    CHECK (status IN ('disponivel', 'ocupada')),
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT mesas_loja_numero_key UNIQUE (loja_id, numero)
);
CREATE INDEX IF NOT EXISTS mesas_loja_id_idx
  ON public.mesas (loja_id);

CREATE INDEX IF NOT EXISTS orders_cancelados_loja_data_idx
  ON public.orders (loja_id, cancelado_em DESC)
  WHERE status = 'cancelado';

-- ------------------------------------------------------------
-- CONFIGURAÇÕES / CARDÁPIO ONLINE / IMPRESSÃO
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.configuracoes (
  id SERIAL PRIMARY KEY,
  loja_id UUID NOT NULL UNIQUE,
  nome_empresa TEXT NOT NULL DEFAULT 'PDV Hamburgueria',
  cnpj TEXT,
  telefone TEXT,
  endereco TEXT,
  taxa_entrega_padrao NUMERIC(10,2) NOT NULL DEFAULT 0,
  modelo_comanda TEXT NOT NULL DEFAULT 'modelo1'
    CHECK (modelo_comanda IN ('modelo1', 'modelo2', 'modelo3', 'modelo4')),
  whatsapp TEXT,
  logo_url TEXT,
  cardapio_aberto BOOLEAN NOT NULL DEFAULT true,
  store_settings_json JSONB,
  abre_as TEXT,
  fecha_as TEXT,
  horario_semana JSONB,
  taxas_raio JSONB,
  links_apps JSONB,
  banner_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS modelo_comanda TEXT NOT NULL DEFAULT 'modelo1',
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS cardapio_aberto BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS store_settings_json JSONB,
  ADD COLUMN IF NOT EXISTS abre_as TEXT,
  ADD COLUMN IF NOT EXISTS fecha_as TEXT,
  ADD COLUMN IF NOT EXISTS horario_semana JSONB,
  ADD COLUMN IF NOT EXISTS taxas_raio JSONB,
  ADD COLUMN IF NOT EXISTS links_apps JSONB,
  ADD COLUMN IF NOT EXISTS banner_url TEXT;

ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_modelo_comanda_check;
ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_modelo_comanda_check
  CHECK (modelo_comanda IN ('modelo1', 'modelo2', 'modelo3', 'modelo4'));

CREATE TABLE IF NOT EXISTS public.store_settings (
  loja_id UUID PRIMARY KEY REFERENCES public.lojas(id) ON DELETE CASCADE,
  nome_loja TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL DEFAULT '',
  telefone_fixo TEXT,
  whatsapp TEXT,
  endereco TEXT,
  maps_link TEXT,
  instagram TEXT,
  facebook TEXT,
  banner_url TEXT,
  logo_url TEXT,
  cor_principal TEXT NOT NULL DEFAULT '#2E9E4A',
  status_manual TEXT NOT NULL DEFAULT 'aberto'
    CHECK (status_manual IN ('aberto', 'fechado')),
  abre_as TEXT NOT NULL DEFAULT '00:00',
  fecha_as TEXT NOT NULL DEFAULT '23:59',
  horario_automatico BOOLEAN NOT NULL DEFAULT false,
  horario_semana JSONB,
  horarios JSONB,
  entrega_min INTEGER NOT NULL DEFAULT 35,
  entrega_max INTEGER NOT NULL DEFAULT 50,
  retirada_min INTEGER NOT NULL DEFAULT 20,
  retirada_max INTEGER NOT NULL DEFAULT 35,
  taxa_entrega NUMERIC(10,2) NOT NULL DEFAULT 0,
  taxas_raio JSONB,
  raios JSONB,
  entrega_gratis_acima NUMERIC(10,2) NOT NULL DEFAULT 0,
  fora_raio_tipo TEXT NOT NULL DEFAULT 'nao_atender',
  fora_raio_taxa NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_center JSONB,
  permitir_entrega BOOLEAN NOT NULL DEFAULT true,
  permitir_retirada BOOLEAN NOT NULL DEFAULT true,
  links_apps JSONB,
  apps JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS horario_semana JSONB,
  ADD COLUMN IF NOT EXISTS horarios JSONB,
  ADD COLUMN IF NOT EXISTS taxas_raio JSONB,
  ADD COLUMN IF NOT EXISTS raios JSONB,
  ADD COLUMN IF NOT EXISTS entrega_gratis_acima NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fora_raio_tipo TEXT NOT NULL DEFAULT 'nao_atender',
  ADD COLUMN IF NOT EXISTS fora_raio_taxa NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_center JSONB,
  ADD COLUMN IF NOT EXISTS links_apps JSONB,
  ADD COLUMN IF NOT EXISTS apps JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ------------------------------------------------------------
-- FIADO
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fiados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_nome TEXT NOT NULL,
  cliente_telefone TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('divida', 'pagamento')),
  valor NUMERIC(10,2) NOT NULL CHECK (valor >= 0),
  descricao TEXT,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  loja_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fiados_loja_id_idx ON public.fiados (loja_id);
CREATE INDEX IF NOT EXISTS fiados_loja_cliente_idx
  ON public.fiados (loja_id, cliente_nome);

-- ------------------------------------------------------------
-- ATENDENTE IA WHATSAPP
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_settings (
  loja_id UUID PRIMARY KEY REFERENCES public.lojas(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL UNIQUE,
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  paused BOOLEAN NOT NULL DEFAULT false,
  welcome_message TEXT NOT NULL DEFAULT '',
  connection_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (connection_status IN ('disconnected', 'connecting', 'connected')),
  phone_number TEXT,
  profile_picture_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id UUID NOT NULL REFERENCES public.lojas(id) ON DELETE CASCADE,
  remote_jid TEXT NOT NULL,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  pending_order JSONB,
  welcomed BOOLEAN NOT NULL DEFAULT false,
  last_owner_message_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_ai_conversations_loja_remote_key
    UNIQUE (loja_id, remote_jid)
);
CREATE INDEX IF NOT EXISTS whatsapp_ai_conversations_updated_idx
  ON public.whatsapp_ai_conversations (loja_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.whatsapp_ai_processed_messages (
  instance_name TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'done', 'failed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_name, message_id)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_ai_outbox (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  instance_name TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  body TEXT NOT NULL,
  evolution_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_ai_outbox_match_idx
  ON public.whatsapp_ai_outbox (instance_name, remote_jid, created_at DESC);

-- ------------------------------------------------------------
-- FUNÇÕES USADAS PELO APP (login, provisionamento e admin)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.login_loja_hash(p_email TEXT, p_senha_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loja public.lojas%ROWTYPE;
BEGIN
  SELECT * INTO v_loja
  FROM public.lojas
  WHERE lower(email_dono) = lower(trim(p_email))
  LIMIT 1;
  IF NOT FOUND OR v_loja.senha_hash IS DISTINCT FROM lower(trim(p_senha_hash)) THEN
    RETURN NULL;
  END IF;
  RETURN json_build_object(
    'id', v_loja.id, 'nome_loja', v_loja.nome_loja,
    'email_dono', v_loja.email_dono, 'status_pagamento', v_loja.status_pagamento,
    'data_vencimento', v_loja.data_vencimento, 'plano', v_loja.plano
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.login_loja(p_email TEXT, p_senha TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_loja public.lojas%ROWTYPE;
BEGIN
  SELECT * INTO v_loja
  FROM public.lojas
  WHERE lower(email_dono) = lower(trim(p_email))
  LIMIT 1;
  IF NOT FOUND OR v_loja.senha_hash IS DISTINCT FROM encode(digest(p_senha, 'sha256'), 'hex') THEN
    RETURN NULL;
  END IF;
  RETURN json_build_object(
    'id', v_loja.id, 'nome_loja', v_loja.nome_loja,
    'email_dono', v_loja.email_dono, 'status_pagamento', v_loja.status_pagamento,
    'data_vencimento', v_loja.data_vencimento, 'plano', v_loja.plano
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.criar_loja(
  p_nome TEXT, p_email TEXT, p_senha_hash TEXT, p_vencimento DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loja_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.lojas WHERE lower(email_dono) = lower(trim(p_email))
  ) THEN
    RAISE EXCEPTION 'Já existe uma loja com este e-mail.';
  END IF;

  INSERT INTO public.lojas (
    nome, slug, nome_loja, email_dono, senha_hash,
    status_pagamento, data_vencimento, plano
  )
  VALUES (
    p_nome, lower(regexp_replace(p_nome, '[^a-zA-Z0-9]+', '-', 'g')),
    p_nome, lower(trim(p_email)), lower(trim(p_senha_hash)),
    'ativo', p_vencimento, 'basico'
  )
  RETURNING id INTO v_loja_id;

  INSERT INTO public.configuracoes (loja_id, nome_empresa)
  VALUES (v_loja_id, p_nome);
  RETURN v_loja_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_atualizar_loja(
  p_id UUID, p_status TEXT DEFAULT NULL, p_vencimento DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.lojas
  SET status_pagamento = COALESCE(p_status, status_pagamento),
      data_vencimento = COALESCE(p_vencimento, data_vencimento)
  WHERE id = p_id AND email_dono IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_salvar_asaas(
  p_id UUID, p_customer_id TEXT, p_subscription_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.lojas
  SET asaas_customer_id = COALESCE(p_customer_id, asaas_customer_id),
      asaas_subscription_id = COALESCE(p_subscription_id, asaas_subscription_id)
  WHERE id = p_id AND email_dono IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.login_loja_hash(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_loja(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.criar_loja(TEXT, TEXT, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_loja(UUID, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_salvar_asaas(UUID, TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- RLS / POLICIES (mesmas permissões públicas do esquema atual)
-- ------------------------------------------------------------
ALTER TABLE public.lojas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_loja ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contadores_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoboys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entregas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acesso_publico_lojas ON public.lojas;
CREATE POLICY acesso_publico_lojas ON public.lojas
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_usuarios_loja ON public.usuarios_loja;
CREATE POLICY acesso_publico_usuarios_loja ON public.usuarios_loja
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_products ON public.products;
CREATE POLICY acesso_publico_products ON public.products
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_orders ON public.orders;
CREATE POLICY acesso_publico_orders ON public.orders
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_order_items ON public.order_items;
CREATE POLICY acesso_publico_order_items ON public.order_items
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_motoboys ON public.motoboys;
CREATE POLICY acesso_publico_motoboys ON public.motoboys
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_entregas ON public.entregas;
CREATE POLICY acesso_publico_entregas ON public.entregas
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_clientes ON public.clientes;
CREATE POLICY acesso_publico_clientes ON public.clientes
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_configuracoes ON public.configuracoes;
CREATE POLICY acesso_publico_configuracoes ON public.configuracoes
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_mesas ON public.mesas;
CREATE POLICY acesso_publico_mesas ON public.mesas
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_store_settings ON public.store_settings;
CREATE POLICY acesso_publico_store_settings ON public.store_settings
  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS acesso_publico_fiados ON public.fiados;
CREATE POLICY acesso_publico_fiados ON public.fiados
  FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- INSERTS DE INICIALIZAÇÃO SEGUROS
-- Mantêm configurações existentes e criam apenas as que faltam.
-- ------------------------------------------------------------
INSERT INTO public.configuracoes (loja_id, nome_empresa)
SELECT l.id, COALESCE(NULLIF(l.nome_loja, ''), NULLIF(l.nome, ''), 'PDV Hamburgueria')
FROM public.lojas l
ON CONFLICT (loja_id) DO NOTHING;

-- Categories/produtos/clientes/pedidos reais não estão no repositório.
-- Este script não inventa nem duplica esses registros.

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ============================================================
-- COMO RODAR NO SUPABASE:
-- 1. Abra Supabase > SQL Editor > New Query.
-- 2. Cole o conteúdo deste arquivo e clique em Run.
-- 3. Este arquivo não contém os registros reais do seu projeto.
--    Para cloná-los, exporte os dados do Supabase separadamente;
--    não use os dados de demonstração de schema.sql como produção.
-- ============================================================
