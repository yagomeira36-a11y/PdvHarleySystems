import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRole) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.");
  }
  if (!url.startsWith("https://") || url.includes("SEU-PROJETO")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL inválida.");
  }
  if (!admin) {
    admin = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

export function getSupabaseAnonServer(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) throw new Error("Configuração pública do Supabase ausente.");
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
}
