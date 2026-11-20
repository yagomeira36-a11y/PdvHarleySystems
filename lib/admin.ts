// ============================================================
// CREDENCIAIS DO SUPER ADMIN
// As constantes abaixo são o login INICIAL (admin@menUau.com /
// admin123). Depois de rodar supabase/admin-super-login.sql no
// Supabase, o painel passa a conferir e alterar o login pela
// tabela admin_config; as constantes só valem enquanto o SQL
// não foi rodado (sem ele, nada muda no comportamento de antes).
// Usadas na tela /login (que redireciona para /admin) e na
// página /admin (tela de login própria do painel).
// ============================================================
import { getSupabase, sha256Hex } from "./supabase";

export const ADMIN_EMAIL = "admin@menUau.com";
export const ADMIN_SENHA = "admin123";

export type ResultadoLogin = { ok: boolean; erro?: string };

// O PostgREST avisa assim quando a função ainda não existe no banco
// (SQL do painel não foi rodado) — nesse caso caímos nas constantes.
function funcaoAusente(mensagem: string): boolean {
  return mensagem.includes("Could not find the function");
}

// Confere o login do super admin: primeiro no banco (editável pelo
// painel); se o SQL ainda não foi rodado, nas constantes acima.
export async function validarLoginSuperAdmin(email: string, senha: string): Promise<ResultadoLogin> {
  const supabase = getSupabase();
  if (supabase) {
    const hash = await sha256Hex(senha);
    const { data, error } = await supabase.rpc("admin_login", {
      p_email: email.trim(),
      p_senha_hash: hash,
    });
    if (!error) return { ok: data === true };
    if (!funcaoAusente(error.message)) {
      return { ok: false, erro: "Erro no banco: " + error.message };
    }
  }
  return {
    ok: email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase() && senha === ADMIN_SENHA,
  };
}

// E-mail atual do super admin (para pré-checar os formulários).
export async function emailSuperAdmin(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) return ADMIN_EMAIL;
  const { data, error } = await supabase.rpc("admin_obter_email");
  if (error || typeof data !== "string" || !data) return ADMIN_EMAIL;
  return data;
}

// Altera o login do painel. A senha atual é obrigatória; a nova
// senha vazia mantém a atual.
export async function salvarLoginSuperAdmin(dados: {
  senhaAtual: string;
  novoEmail: string;
  novaSenha?: string;
}): Promise<ResultadoLogin> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, erro: "Banco de dados não configurado." };
  const email = dados.novoEmail.trim().toLowerCase();
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return { ok: false, erro: "Informe um e-mail válido." };
  }
  const novaSenha = dados.novaSenha ?? "";
  if (novaSenha && novaSenha.length < 4) {
    return { ok: false, erro: "A nova senha precisa de pelo menos 4 caracteres." };
  }
  const senhaAtualHash = await sha256Hex(dados.senhaAtual);
  const novaSenhaHash = novaSenha ? await sha256Hex(novaSenha) : null;
  const { error } = await supabase.rpc("admin_definir_login", {
    p_email: email,
    p_senha_hash: novaSenhaHash,
    p_senha_atual_hash: senhaAtualHash,
  });
  if (!error) return { ok: true };
  if (funcaoAusente(error.message)) {
    return {
      ok: false,
      erro:
        "Para mudar o login do painel, rode o arquivo supabase/admin-super-login.sql " +
        "no SQL Editor do Supabase (uma única vez).",
    };
  }
  return { ok: false, erro: "Erro ao salvar o novo login: " + error.message };
}
