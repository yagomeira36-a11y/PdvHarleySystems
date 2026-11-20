-- ============================================================
-- LOGIN DO SUPER ADMIN EDITÁVEL
-- Rode este arquivo UMA VEZ no SQL Editor do Supabase.
--
-- Cria a tabela admin_config (linha única) já com o login que o
-- sistema usava (admin@menUau.com / admin123) e as funções que o
-- painel usa para conferir e alterar esse login.
--
-- SEM rodar este SQL nada quebra: o painel continua usando as
-- credenciais fixas do código (lib/admin.ts). É ele que permite
-- trocar o e-mail/senha do super admin pela tela do painel.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email text NOT NULL,
  senha_hash text NOT NULL,
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

-- A linha só é lida/alterada pelas funções abaixo (RLS sem política)
ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

-- Começa com o mesmo login que o sistema já usava
INSERT INTO public.admin_config (id, email, senha_hash)
VALUES (1, 'admin@menuau.com', encode(sha256('admin123'::bytea), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- FUNÇÃO: admin_login (consegue o e-mail + hash da senha digitada)
-- Usada pela tela de login antes de abrir o painel.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_login(
  p_email text,
  p_senha_hash text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_config
    WHERE id = 1
      AND lower(email) = lower(trim(p_email))
      AND senha_hash = p_senha_hash
  );
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: admin_obter_email (mostra o e-mail atual nos formulários)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_obter_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT email FROM public.admin_config WHERE id = 1;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: admin_definir_login (altera e-mail e/ou senha do painel)
-- Exige o hash da senha atual; senha nova vazia = manter a atual.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_definir_login(
  p_email text,
  p_senha_hash text DEFAULT NULL,
  p_senha_atual_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_config
    WHERE id = 1 AND senha_hash = p_senha_atual_hash
  ) THEN
    RAISE EXCEPTION 'Senha atual incorreta.';
  END IF;
  IF p_email IS NULL OR position('@' in lower(trim(p_email))) < 2
     OR right(trim(p_email), 1) = '@' THEN
    RAISE EXCEPTION 'Informe um e-mail válido.';
  END IF;

  UPDATE public.admin_config
  SET email        = lower(trim(p_email)),
      senha_hash   = COALESCE(NULLIF(p_senha_hash, ''), senha_hash),
      atualizado_em = now()
  WHERE id = 1;
END;
$$;

-- Permite o app (chave pública) chamar as funções via RPC
GRANT EXECUTE ON FUNCTION public.admin_login(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_obter_email() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_definir_login(text, text, text) TO anon, authenticated;
