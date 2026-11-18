import { NextRequest, NextResponse } from "next/server";
import {
  evolutionConfigured,
  evolutionInstanceName,
  evolutionRequest,
  evolutionWebhookConfig,
  EvolutionError,
} from "@/lib/whatsapp/evolution";
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

function qrCodeFrom(payload: Record<string, unknown>): string {
  const nested = payload.qrcode && typeof payload.qrcode === "object"
    ? payload.qrcode as Record<string, unknown>
    : {};
  const candidate = nested.base64 ?? nested.qr ?? payload.base64 ?? payload.qr;
  if (typeof candidate !== "string" || !candidate.trim()) return "";
  const value = candidate.trim();
  return value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`;
}

export async function POST(request: NextRequest) {
  const supabase = getWhatsAppAdminClient();
  if (!supabase) {
    return json({
      error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor antes de conectar o WhatsApp.",
    }, 503);
  }
  const session = await validateWhatsAppStoreSession(request, supabase);
  if (session.error) return json({ error: session.error }, 503);
  const lojaId = session.storeId;
  if (!lojaId) return json({ error: "Sessão da loja não encontrada." }, 401);
  if (!evolutionConfigured()) {
    return json({ error: "Configure EVOLUTION_API_URL e EVOLUTION_API_KEY no servidor." }, 503);
  }
  const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return json({ error: "Configure WHATSAPP_WEBHOOK_SECRET no servidor." }, 503);
  }
  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+/i.test(appUrl)) {
    return json({ error: "Configure APP_URL com o endereço público do sistema para receber os webhooks." }, 503);
  }

  const instanceName = evolutionInstanceName(lojaId);
  const { data: current, error: erroAtual } = await supabase
    .from("whatsapp_ai_settings")
    .select("connection_status")
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (erroAtual) {
    return json({
      error: isWhatsAppMigrationMissing(erroAtual)
        ? migrationRequiredMessage()
        : "Não foi possível carregar as configurações do WhatsApp.",
    }, 503);
  }
  if (current?.connection_status === "connected") {
    return json({ error: "Este WhatsApp já está conectado." }, 409);
  }

  let created: Record<string, unknown> = {};
  try {
    created = await evolutionRequest("/instance/create", "POST", {
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
    });
  } catch (error) {
    if (!(error instanceof EvolutionError) || !/already|exist|in use/i.test(error.message)) {
      return json({
        error: error instanceof Error ? error.message : "Não foi possível criar a instância da loja.",
      }, error instanceof EvolutionError ? error.status : 502);
    }
  }

  try {
    await evolutionRequest(
      `/webhook/set/${encodeURIComponent(instanceName)}`,
      "POST",
      evolutionWebhookConfig(`${appUrl}/api/whatsapp/webhook`, webhookSecret)
    );

    let qrCode = qrCodeFrom(created);
    if (!qrCode) {
      const connected = await evolutionRequest(
        `/instance/connect/${encodeURIComponent(instanceName)}`,
        "GET"
      );
      qrCode = qrCodeFrom(connected);
    }
    if (!qrCode) {
      return json({ error: "A Evolution API não retornou o QR Code. Tente gerar novamente." }, 502);
    }

    const { error: erroSalvar } = await supabase
      .from("whatsapp_ai_settings")
      .upsert({
        loja_id: lojaId,
        instance_name: instanceName,
        connection_status: "connecting",
        ai_enabled: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "loja_id" });
    if (erroSalvar) {
      return json({
        error: isWhatsAppMigrationMissing(erroSalvar)
          ? migrationRequiredMessage()
          : "Instância criada, mas não foi possível salvar o status da conexão.",
      }, 503);
    }
    return json({ instanceName, qrCode });
  } catch (error) {
    return json({
      error: error instanceof Error
        ? error.message
        : "Não foi possível configurar a conexão do WhatsApp.",
    }, error instanceof EvolutionError ? error.status : 502);
  }
}
