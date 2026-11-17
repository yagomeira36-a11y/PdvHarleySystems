-- ============================================================
-- CORREÇÃO DAS FUNÇÕES DE LOGIN (rodar SÓ este arquivo agora)
-- Problema: o digest() do pgcrypto fica no schema "extensions"
-- e as funções antigas forçavam search_path só em "public".
-- Este arquivo só recria as funções — NÃO apaga nenhum dado.
-- ============================================================
-- Como usar: SQL Editor do Supabase > colar TODO este arquivo > Run

-- ------------------------------------------------------------
-- FUNÇÃO: login_loja (e-mail + senha -> dados da loja ou NULL)
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

  -- Loja nova nasce ZERADA: sem produtos, sem mesas e sem motoboys.
  -- O dono cadastra o cardápio, as mesas e os motoboys pelo próprio PDV.

  -- Configuração inicial da empresa
  INSERT INTO public.configuracoes (loja_id, nome_empresa) VALUES (v_loja_id, p_nome);

  RETURN v_loja_id;
END;
$$;

-- ------------------------------------------------------------
-- FUNÇÃO: admin_atualizar_loja (botões do /admin)
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

GRANT EXECUTE ON FUNCTION public.login_loja(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.criar_loja(text, text, text, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_loja(uuid, text, date) TO anon, authenticated;
