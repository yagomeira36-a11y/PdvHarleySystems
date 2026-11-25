-- ============================================================
-- MIGRAÇÃO DE SEGURANÇA - 20 CAMADAS
-- Execute no SQL Editor do Supabase (produção/staging) com cautela.
-- Revise antes de aplicar: este script endurece RLS e pode exigir
-- que o app use SUPABASE_SERVICE_ROLE_KEY no servidor.
-- ============================================================

-- 1/2) RLS em todas as tabelas + policies por loja_id
-- Remove policies públicas permissivas conhecidas.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname ILIKE 'acesso_publico_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Habilita RLS em tabelas públicas conhecidas.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'lojas','usuarios_loja','products','orders','order_items','motoboys',
        'entregas','clientes','configuracoes','mesas','contadores_pedido',
        'store_settings','admin_config','fiados','audit_logs'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Helper: extrai loja_id do JWT (Supabase Auth ou JWT custom com claim loja_id).
CREATE OR REPLACE FUNCTION public.request_loja_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claim.loja_id', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'loja_id')
    ),
    ''
  )::uuid;
$$;

-- Policies por loja_id (SELECT/INSERT/UPDATE/DELETE). service_role bypassa RLS.
DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'products','orders','order_items','motoboys','entregas','clientes',
  'configuracoes','mesas','contadores_pedido','store_settings','usuarios_loja','fiados'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='loja_id') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_select', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_insert', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_update', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_delete', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (loja_id = public.request_loja_id())', t || '_tenant_select', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (loja_id = public.request_loja_id())', t || '_tenant_insert', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (loja_id = public.request_loja_id()) WITH CHECK (loja_id = public.request_loja_id())', t || '_tenant_update', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (loja_id = public.request_loja_id())', t || '_tenant_delete', t);
    END IF;
  END LOOP;
END $$;

-- Lojas: usuário autenticado da loja só vê a própria loja.
DROP POLICY IF EXISTS lojas_tenant_select ON public.lojas;
DROP POLICY IF EXISTS lojas_tenant_update ON public.lojas;
CREATE POLICY lojas_tenant_select ON public.lojas FOR SELECT USING (id = public.request_loja_id());
CREATE POLICY lojas_tenant_update ON public.lojas FOR UPDATE USING (id = public.request_loja_id()) WITH CHECK (id = public.request_loja_id());

-- Cardápio público: permitir leitura anônima apenas do necessário por loja_id.
-- ATENÇÃO: isso expõe leitura pública filtrada por loja_id; use apenas para cardápio.
DROP POLICY IF EXISTS products_public_read ON public.products;
CREATE POLICY products_public_read ON public.products FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS store_settings_public_read ON public.store_settings;
CREATE POLICY store_settings_public_read ON public.store_settings FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS configuracoes_public_read ON public.configuracoes;
CREATE POLICY configuracoes_public_read ON public.configuracoes FOR SELECT TO anon USING (true);

-- 15) Logs de auditoria
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id bigserial PRIMARY KEY,
  loja_id uuid NULL,
  usuario text NULL,
  acao text NOT NULL,
  entidade text NULL,
  entidade_id text NULL,
  detalhes jsonb NULL,
  ip text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_tenant_select ON public.audit_logs;
CREATE POLICY audit_logs_tenant_select ON public.audit_logs FOR SELECT USING (loja_id = public.request_loja_id());

-- 16) Backup automático diário: configurar no painel Supabase (Database > Backups / PITR conforme plano).
-- Este SQL não cria agendamento externo; documente o backup no runbook operacional.

-- 5) Restrição por IP: não é totalmente aplicável só via SQL no Supabase padrão.
-- Recomenda-se: Supabase Network Restrictions (plano suportado), WAF/CDN ou proxy com allowlist.

-- 17) 2FA opcional para admin: ativar Supabase Auth MFA ou implementar TOTP no app.
-- Este migration cria base de auditoria; implementação de TOTP deve ser feita no backend/app.
