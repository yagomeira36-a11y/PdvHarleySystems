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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function fieldString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === "string" && !!value.trim())?.trim() || "";
}

function telefoneDono(value: string): string {
  return value.split("@")[0].split(":")[0].replace(/\D/g, "");
}

export async function GET(request: NextRequest) {
  const supabase = getWhatsAppAdminClient();
  if (!supabase) {
    return json({ error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor." }, 503);
  }
  const session = await validateWhatsAppStoreSession(request, supabase);
  if (session.error) return json({ error: session.error }, 503);
  const lojaId = session.storeId;
  if (!lojaId) return json({ error: "Sessão da loja não encontrada." }, 401);

  const { data: settings, error } = await supabase
    .from("whatsapp_ai_settings")
    .select("instance_name,connection_status,phone_number,profile_picture_url")
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (error) {
    return json({
      error: isWhatsAppMigrationMissing(error)
        ? migrationRequiredMessage()
        : "Não foi possível consultar a conexão do WhatsApp.",
    }, 503);
  }
  if (!settings?.instance_name) {
    return json({
      connectionStatus: "disconnected",
      phoneNumber: "",
      profilePictureUrl: "",
    });
  }

  try {
    const result = await evolutionRequest(
      `/instance/connectionState/${encodeURIComponent(settings.instance_name)}`,
      "GET"
    );
    const instance = object(result.instance);
    const data = object(result.data);
    const rawState = fieldString(instance.state, result.state, data.state).toLowerCase();
    const connectionStatus = ["open", "connected"].includes(rawState)
      ? "connected"
      : ["connecting", "pairing", "qrcode"].includes(rawState)
        ? "connecting"
        : "disconnected";
    const owner = fieldString(
      instance.ownerJid,
      instance.owner,
      instance.wuid,
      result.ownerJid,
      result.wuid,
      data.ownerJid,
      data.wuid
    );
    const phoneNumber = owner ? telefoneDono(owner) : settings.phone_number || "";
    let profilePictureUrl = fieldString(
      instance.profilePictureUrl,
      instance.profilePicUrl,
      result.profilePictureUrl,
      result.profilePicUrl,
      data.profilePictureUrl,
      settings.profile_picture_url
    );
    if (connectionStatus === "connected" && phoneNumber && !profilePictureUrl) {
      try {
        const picture = await evolutionRequest(
          `/chat/fetchProfilePictureUrl/${encodeURIComponent(settings.instance_name)}?number=${encodeURIComponent(phoneNumber)}`,
          "GET"
        );
        profilePictureUrl = fieldString(
          picture.profilePictureUrl,
          picture.profilePicUrl,
          picture.pictureUrl
        );
      } catch (failure) {
        console.error(
          "Não foi possível carregar a foto do WhatsApp:",
          failure instanceof Error ? failure.message : "Erro desconhecido"
        );
      }
    }

    const { error: erroSalvar } = await supabase
      .from("whatsapp_ai_settings")
      .update({
        connection_status: connectionStatus,
        phone_number: phoneNumber || null,
        profile_picture_url: profilePictureUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq("loja_id", lojaId);
    if (erroSalvar) {
      return json({ error: "Conectado, mas não foi possível atualizar o status salvo." }, 503);
    }
    return json({ connectionStatus, phoneNumber, profilePictureUrl });
  } catch (failure) {
    return json({
      error: failure instanceof Error
        ? failure.message
        : "Não foi possível consultar a Evolution API.",
    }, 502);
  }
}
