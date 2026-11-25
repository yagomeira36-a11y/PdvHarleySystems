import "server-only";
import { getSupabaseAdmin } from "./supabase-server";

export type AuditEvent = {
  lojaId?: string | null;
  usuario?: string | null;
  acao: string;
  entidade?: string | null;
  entidadeId?: string | null;
  detalhes?: Record<string, unknown> | null;
  ip?: string | null;
};

export async function registrarAuditoria(evento: AuditEvent): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("audit_logs").insert({
      loja_id: evento.lojaId ?? null,
      usuario: evento.usuario ?? null,
      acao: evento.acao,
      entidade: evento.entidade ?? null,
      entidade_id: evento.entidadeId ?? null,
      detalhes: evento.detalhes ?? null,
      ip: evento.ip ?? null,
    });
  } catch (err) {
    console.error("[AUDIT_FAIL]", err);
  }
}
