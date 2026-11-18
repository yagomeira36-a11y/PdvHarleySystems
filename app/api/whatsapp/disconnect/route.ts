import { NextRequest, NextResponse } from "next/server";
import { evolutionRequest } from "@/lib/whatsapp/evolution";
import {
  getWhatsAppAdminClient,
  isWhatsAppMigrationMissing,
  migrationRequiredMessage,
  validateWhatsAppStoreSession,
} from "@/lib/whatsapp/server";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  const supabase = getWhatsAppAdminClient();
  if (!supabase) return json({ error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor." }, 503);
  const session = await validateWhatsAppStoreSession(request, supabase);
  if (session.error) return json({ error: session.error }, 503);
  const lojaId = session.storeId;
  if (!lojaId) return json({ error: "Sessão da loja não encontrada." }, 401);

  const { data: settings, error } = await supabase
    .from("whatsapp_ai_settings")
    .select("instance_name")
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (error) {
    return json({
      error: isWhatsAppMigrationMissing(error)
        ? migrationRequiredMessage()
        : "Não foi possível carregar a conexão do WhatsApp.",
    }, 503);
  }

  if (settings?.instance_name) {
    try {
      await evolutionRequest(
        `/instance/logout/${encodeURIComponent(settings.instance_name)}`,
        "DELETE"
      );
    } catch (failure) {
      return json({
        error: failure instanceof Error
          ? failure.message
          : "Não foi possível desconectar o WhatsApp.",
      }, 502);
    }
  }

  const { error: erroSalvar } = await supabase
    .from("whatsapp_ai_settings")
    .update({
      connection_status: "disconnected",
      ai_enabled: false,
      phone_number: null,
      profile_picture_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq("loja_id", lojaId);
  if (erroSalvar) {
    return json({ error: "WhatsApp desconectado, mas não foi possível atualizar o status salvo." }, 503);
  }
  return json({ disconnected: true });
}
