import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

function getWhatsAppSession(request: NextRequest): { id: string; email: string } | null {
  const raw = request.cookies.get("loja_sessao")?.value;
  if (!raw) return null;

  const candidates = [raw];
  try {
    candidates.push(decodeURIComponent(raw));
  } catch {
    // Keep checking the original cookie value.
  }
  for (const candidate of candidates) {
    try {
      const session = JSON.parse(candidate) as { id?: unknown; email_dono?: unknown };
      if (
        typeof session.id === "string" &&
        session.id.trim() &&
        typeof session.email_dono === "string" &&
        session.email_dono.trim()
      ) {
        return { id: session.id.trim(), email: session.email_dono.trim() };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function hasWhatsAppServiceRoleKey(key: string | undefined): boolean {
  if (!key?.trim()) return false;
  if (key.startsWith("sb_secret_")) return true;
  if (key.startsWith("sb_publishable_")) return false;

  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { role?: unknown };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function getWhatsAppAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !url?.startsWith("https://") ||
    !serviceKey ||
    !hasWhatsAppServiceRoleKey(serviceKey)
  ) return null;

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function validateWhatsAppStoreSession(
  request: NextRequest,
  supabase: SupabaseClient
): Promise<{ storeId: string | null; error: string | null }> {
  const session = getWhatsAppSession(request);
  if (!session) return { storeId: null, error: null };
  const { data: store, error } = await supabase
    .from("lojas")
    .select("id,email_dono")
    .eq("id", session.id)
    .maybeSingle();
  if (error) {
    return { storeId: null, error: "Não foi possível validar a sessão da loja." };
  }
  if (
    !store ||
    String(store.email_dono || "").toLowerCase() !== session.email.toLowerCase()
  ) {
    return { storeId: null, error: null };
  }
  return { storeId: String(store.id), error: null };
}

export function isWhatsAppMigrationMissing(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /whatsapp_ai_settings|whatsapp_ai_conversations|whatsapp_ai_processed_messages|whatsapp_ai_outbox/i.test(error?.message || "");
}

export function migrationRequiredMessage(): string {
  return "Execute supabase/atendente-ia-whatsapp.sql no SQL Editor do Supabase e configure SUPABASE_SERVICE_ROLE_KEY com a chave service_role (não use a chave publishable).";
}
