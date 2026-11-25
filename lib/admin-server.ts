import "server-only";
import { getSupabaseAdmin } from "./supabase-server";
import { verificarSenha, hashSenha } from "./password";

export const ADMIN_EMAIL_FALLBACK = "admin@menUau.com";
export const ADMIN_SENHA_FALLBACK = "admin123";

export type ResultadoLogin = { ok: boolean; erro?: string };

export async function validarLoginSuperAdminServer(email: string, senha: string): Promise<ResultadoLogin> {
  const emailNorm = email.trim().toLowerCase();
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("admin_config")
      .select("id,email,senha_hash")
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      const emailBanco = String(data.email ?? "").trim().toLowerCase();
      if (emailBanco !== emailNorm) return { ok: false };
      const verif = await verificarSenha(senha, String(data.senha_hash ?? ""));
      if (!verif.ok) return { ok: false };
      if (verif.precisaRehash) {
        await supabase.from("admin_config").update({ senha_hash: await hashSenha(senha), updated_at: new Date().toISOString() }).eq("id", data.id);
      }
      return { ok: true };
    }
    // Se tabela não existe ou erro de schema, cai no fallback local
    if (error && !String(error.message).includes("relation") && !String(error.message).includes("Could not find")) {
      return { ok: false, erro: "Erro ao validar login do administrador." };
    }
  } catch {
    // fallback abaixo
  }

  const ok = emailNorm === ADMIN_EMAIL_FALLBACK.toLowerCase() && senha === ADMIN_SENHA_FALLBACK;
  return { ok };
}
