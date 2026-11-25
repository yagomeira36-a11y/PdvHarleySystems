import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { buscarAssinaturaAsaas } from "@/lib/asaas";
import { erroGenerico } from "@/lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENTOS_PAGOS = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_RESTORED"];
const EVENTOS_BLOQUEIO = [
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "SUBSCRIPTION_INACTIVATED",
  "SUBSCRIPTION_DELETED",
];

type CorpoWebhook = {
  event?: string;
  payment?: { customer?: string; subscription?: string | null; externalReference?: string | null };
  subscription?: { id?: string; customer?: string; externalReference?: string | null; nextDueDate?: string };
};

export async function POST(req: NextRequest) {
  try {
    const tokenEsperado = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
    if (tokenEsperado && req.headers.get("asaas-access-token") !== tokenEsperado) {
      return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
    }

    const corpo = (await req.json().catch(() => null)) as CorpoWebhook | null;
    const evento = corpo?.event;
    if (!evento) return NextResponse.json({ ok: true, ignorado: "sem evento" });

    const supabase = getSupabaseAdmin();
    const customerId = corpo?.payment?.customer ?? corpo?.subscription?.customer ?? null;
    let subscriptionId = corpo?.payment?.subscription ?? corpo?.subscription?.id ?? null;
    const lojaIdRef = (corpo?.payment?.externalReference ?? corpo?.subscription?.externalReference ?? null)?.replace(/^pdvdg-mensalidade-/, "") ?? null;

    let lojaId: string | null = null;
    if (customerId) {
      const { data } = await supabase.from("lojas").select("id,asaas_subscription_id").eq("asaas_customer_id", customerId).maybeSingle();
      lojaId = (data?.id as string | undefined) ?? null;
      if (lojaId) subscriptionId ??= (data?.asaas_subscription_id as string | undefined) ?? null;
    }
    if (!lojaId && subscriptionId) {
      const { data } = await supabase.from("lojas").select("id,asaas_subscription_id").eq("asaas_subscription_id", subscriptionId).maybeSingle();
      lojaId = (data?.id as string | undefined) ?? null;
      if (lojaId) subscriptionId ??= (data?.asaas_subscription_id as string | undefined) ?? null;
    }
    if (!lojaId && lojaIdRef) {
      const { data } = await supabase.from("lojas").select("id,asaas_subscription_id").eq("id", lojaIdRef).maybeSingle();
      lojaId = (data?.id as string | undefined) ?? null;
      if (lojaId) subscriptionId ??= (data?.asaas_subscription_id as string | undefined) ?? null;
    }
    if (!lojaId) return NextResponse.json({ ok: true, ignorado: "loja não encontrada" });

    let novoStatus: string | null = null;
    if (EVENTOS_PAGOS.includes(evento)) novoStatus = "ativo";
    else if (EVENTOS_BLOQUEIO.includes(evento)) novoStatus = "bloqueado";
    if (!novoStatus) return NextResponse.json({ ok: true, ignorado: evento });

    let novoVencimento: string | null = null;
    if (novoStatus === "ativo" && subscriptionId) {
      try {
        const assinatura = await buscarAssinaturaAsaas(subscriptionId);
        novoVencimento = assinatura.nextDueDate ?? null;
      } catch {}
    }

    const { error } = await supabase.rpc("admin_atualizar_loja", { p_id: lojaId, p_status: novoStatus, p_vencimento: novoVencimento });
    if (error) {
      console.error("[WEBHOOK_ASAAS_UPDATE]", error.message);
      return erroGenerico(500, "Não foi possível processar o webhook.");
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[WEBHOOK_ASAAS]", err);
    return erroGenerico(500, "Não foi possível processar o webhook.");
  }
}
