import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processEvolutionWebhook } from "@/lib/whatsapp/handler";
import { normalizeEvolutionEvent } from "@/lib/whatsapp/logic";
import { getWhatsAppAdminClient } from "@/lib/whatsapp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function correspondeSecret(recebido: string, esperado: string): boolean {
  const recebidoBuffer = Buffer.from(recebido);
  const esperadoBuffer = Buffer.from(esperado);
  return recebidoBuffer.length === esperadoBuffer.length &&
    timingSafeEqual(recebidoBuffer, esperadoBuffer);
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }
  const providedSecret = request.headers.get("x-whatsapp-webhook-secret") || "";
  if (!correspondeSecret(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabase = getWhatsAppAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Integração de dados indisponível." }, { status: 503 });
  }

  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) {
    return NextResponse.json({ error: "Evento muito grande." }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Evento JSON inválido." }, { status: 400 });
  }

  const event = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  console.info("[whatsapp] webhook recebido", {
    instance: typeof event.instance === "string" ? event.instance : "unknown",
    event: normalizeEvolutionEvent(event.event) || "unknown",
  });

  try {
    await processEvolutionWebhook(supabase, payload);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(
      "Falha ao processar evento do atendente WhatsApp:",
      error instanceof Error ? error.message : "Erro desconhecido"
    );
    return NextResponse.json({ error: "Não foi possível processar o evento." }, { status: 500 });
  }
}
