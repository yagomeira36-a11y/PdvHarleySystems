import { NextRequest, NextResponse } from "next/server";
import {
  getWhatsAppAdminClient,
  isWhatsAppMigrationMissing,
  migrationRequiredMessage,
  validateWhatsAppStoreSession,
} from "@/lib/whatsapp/server";
import { evolutionInstanceName } from "@/lib/whatsapp/evolution";

export const dynamic = "force-dynamic";

type SettingsRow = {
  instance_name: string;
  ai_enabled: boolean;
  paused: boolean;
  welcome_message: string;
  connection_status: "disconnected" | "connecting" | "connected";
  phone_number: string | null;
  profile_picture_url: string | null;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function settingsResponse(row: Partial<SettingsRow> | null, storeId: string) {
  return {
    instanceName: row?.instance_name || evolutionInstanceName(storeId),
    aiEnabled: row?.ai_enabled === true,
    paused: row?.paused === true,
    welcomeMessage: row?.welcome_message || "",
    connectionStatus: row?.connection_status || "disconnected",
    phoneNumber: row?.phone_number || "",
    profilePictureUrl: row?.profile_picture_url || "",
  };
}

export async function GET(request: NextRequest) {
  const supabase = getWhatsAppAdminClient();
  if (!supabase) {
    return json({
      error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor antes de usar o atendente WhatsApp.",
    }, 503);
  }
  const session = await validateWhatsAppStoreSession(request, supabase);
  if (session.error) return json({ error: session.error }, 503);
  const lojaId = session.storeId;
  if (!lojaId) return json({ error: "Sessão da loja não encontrada." }, 401);

  const { data, error } = await supabase
    .from("whatsapp_ai_settings")
    .select("instance_name,ai_enabled,paused,welcome_message,connection_status,phone_number,profile_picture_url")
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (error) {
    return json({
      error: isWhatsAppMigrationMissing(error)
        ? migrationRequiredMessage()
        : "Não foi possível carregar as configurações do WhatsApp.",
    }, 503);
  }
  return json(settingsResponse(data as SettingsRow | null, lojaId));
}

export async function PATCH(request: NextRequest) {
  const supabase = getWhatsAppAdminClient();
  if (!supabase) {
    return json({
      error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor antes de usar o atendente WhatsApp.",
    }, 503);
  }
  const session = await validateWhatsAppStoreSession(request, supabase);
  if (session.error) return json({ error: session.error }, 503);
  const lojaId = session.storeId;
  if (!lojaId) return json({ error: "Sessão da loja não encontrada." }, 401);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Configuração inválida." }, 400);
  }

  const input = body as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  if ("aiEnabled" in input) {
    if (typeof input.aiEnabled !== "boolean") {
      return json({ error: "Estado da IA inválido." }, 400);
    }
    if (input.aiEnabled) {
      if (!process.env.GEMINI_API_KEY) {
        return json({ error: "Configure GEMINI_API_KEY no servidor para ativar a IA." }, 503);
      }
      if (!process.env.WHATSAPP_WEBHOOK_SECRET) {
        return json({ error: "Configure WHATSAPP_WEBHOOK_SECRET no servidor." }, 503);
      }
    }
    update.ai_enabled = input.aiEnabled;
  }
  if ("paused" in input) {
    if (typeof input.paused !== "boolean") {
      return json({ error: "Estado de pausa inválido." }, 400);
    }
    update.paused = input.paused;
  }
  if ("welcomeMessage" in input) {
    if (typeof input.welcomeMessage !== "string" || input.welcomeMessage.length > 500) {
      return json({ error: "A mensagem de boas-vindas deve ter até 500 caracteres." }, 400);
    }
    update.welcome_message = input.welcomeMessage.trim();
  }
  if (Object.keys(update).length === 0) {
    return json({ error: "Nenhuma configuração válida foi informada." }, 400);
  }

  const { data: current, error: erroAtual } = await supabase
    .from("whatsapp_ai_settings")
    .select("instance_name,ai_enabled,paused,welcome_message,connection_status,phone_number,profile_picture_url")
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (erroAtual) {
    return json({
      error: isWhatsAppMigrationMissing(erroAtual)
        ? migrationRequiredMessage()
        : "Não foi possível carregar as configurações do WhatsApp.",
    }, 503);
  }
  if (update.ai_enabled === true && current?.connection_status !== "connected") {
    return json({ error: "Conecte o WhatsApp desta loja antes de ativar a IA." }, 409);
  }

  const row = {
    loja_id: lojaId,
    instance_name: current?.instance_name || evolutionInstanceName(lojaId),
    ai_enabled: current?.ai_enabled || false,
    paused: current?.paused || false,
    welcome_message: current?.welcome_message || "",
    ...update,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("whatsapp_ai_settings")
    .upsert(row, { onConflict: "loja_id" })
    .select("instance_name,ai_enabled,paused,welcome_message,connection_status,phone_number,profile_picture_url")
    .single();
  if (error) {
    return json({
      error: isWhatsAppMigrationMissing(error)
        ? migrationRequiredMessage()
        : "Não foi possível salvar as configurações do WhatsApp.",
    }, 503);
  }
  return json(settingsResponse(data as SettingsRow, lojaId));
}
