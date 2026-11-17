-- ============================================================
-- CORREÇÃO DO LOGIN — VERSÃO 2 (sem pgcrypto)
-- A senha é criptografada NO NAVEGADOR (SHA-256) e o banco
-- só compara os códigos. Não usa a função digest() que estava
-- causando o erro "function digest(text, unknown) does not exist".
-- Como usar: SQL Editor do Supabase > colar TODO este arquivo > Run
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

GRANT EXECUTE ON FUNCTION public.login_loja_hash(text, text) TO anon, authenticated;
