-- EMERGÊNCIA: corrigir RLS para login funcionar com RLS ligado em lojas/usuarios
-- Execute no SQL Editor do Supabase. Seguro para rodar antes de religar RLS nas demais tabelas.
-- Objetivo: service_role (server) continua lendo lojas; anon/authenticated NÃO precisam ler lojas para login.

-- LOJAS: login usa service_role no servidor (/api/auth/login), então anon não precisa SELECT.
ALTER TABLE public.lojas ENABLE ROW LEVEL SECURITY;

-- Remove policies permissivas/públicas antigas em lojas
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lojas'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.lojas', r.policyname);
  END LOOP;
END $$;

-- Sem policy para anon/authenticated = acesso negado por padrão sob RLS.
-- service_role bypassa RLS automaticamente no Supabase.

-- USUARIOS_LOJA (se existir): mesma regra de emergência.
DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='usuarios_loja') THEN
    EXECUTE 'ALTER TABLE public.usuarios_loja ENABLE ROW LEVEL SECURITY';
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'usuarios_loja'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.usuarios_loja', r.policyname);
    END LOOP;
  END IF;
END $$;

-- USERS (se existir no projeto): mesma regra de emergência.
DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='users') THEN
    EXECUTE 'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY';
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'users'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', r.policyname);
    END LOOP;
  END IF;
END $$;

-- Verificação rápida (rode após aplicar):
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN ('lojas','usuarios_loja','users');
-- SELECT tablename, policyname, roles, cmd FROM pg_policies WHERE schemaname='public' AND tablename IN ('lojas','usuarios_loja','users');
