import { getSupabase } from "./supabase";

export const ADMIN_EMAIL = "admin@menUau.com";
export const ADMIN_SENHA = "admin123";

export type ResultadoLogin = { ok: boolean; erro?: string };

export async function validarLoginSuperAdmin(email: string, senha: string): Promise<ResultadoLogin> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), senha }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return { ok: false, erro: data?.error ?? "Acesso negado" };
    if (data.tipo !== "admin") return { ok: false, erro: "Acesso negado" };
    return { ok: true };
  } catch {
    return { ok: false, erro: "Erro de rede ao entrar." };
  }
}

export async function emailSuperAdmin(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) return ADMIN_EMAIL;
  const { data, error } = await (supabase as any).rpc("admin_obter_email");
  if (error || typeof data !== "string" || !data) return ADMIN_EMAIL;
  return data;
}

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
  const hash = async (texto: string) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const senhaAtualHash = await hash(dados.senhaAtual);
  const novaSenhaHash = novaSenha ? await hash(novaSenha) : null;
  const { error } = await (supabase as any).rpc("admin_definir_login", {
    p_email: email,
    p_senha_hash: novaSenhaHash,
    p_senha_atual_hash: senhaAtualHash,
  });
  if (!error) return { ok: true };
  return { ok: false, erro: "Erro ao salvar o novo login." };
}
