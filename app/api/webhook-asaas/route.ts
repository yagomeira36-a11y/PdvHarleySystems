import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { buscarAssinaturaAsaas } from "@/lib/asaas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// WEBHOOK DO ASAAS
// O Asaas chama esta rota quando algo acontece com a cobrança:
// - pagou -> loja fica ATIVO e o PDV libera
// - atrasou -> loja fica BLOQUEADO (só a tela de pagamento)
// - estorno/cancelamento -> loja fica BLOQUEADO
// Configure a URL no painel do Asaas:
//   https://SEU-DOMINIO/api/webhook-asaas
// (no sandbox, use um túnel tipo ngrok para o Asaas alcançar
//  a sua máquina — ou use o botão "Já paguei" da tela /pagamento)
// ============================================================

// Eventos que liberam o acesso
const EVENTOS_PAGOS = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_RESTORED"];
// Eventos que bloqueiam o acesso (atraso, estorno, cancelamento)
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
  payment?: {
    customer?: string;
    subscription?: string | null;
    externalReference?: string | null;
  };
  subscription?: {
    id?: string;
    customer?: string;
    externalReference?: string | null;
    nextDueDate?: string;
  };
};

export async function POST(req: Request) {
  // Se ASAAS_WEBHOOK_TOKEN estiver no .env.local, o Asaas precisa
  // mandar o mesmo valor no cabeçalho asaas-access-token
  const tokenEsperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (tokenEsperado && req.headers.get("asaas-access-token") !== tokenEsperado) {
    return NextResponse.json({ erro: "Token do webhook inválido." }, { status: 401 });
  }

  const corpo = (await req.json().catch(() => null)) as CorpoWebhook | null;
  const evento = corpo?.event;
  if (!evento) {
    return NextResponse.json({ ok: true, ignorado: "sem evento" });
  }

  // Descobre qual loja o evento se refere
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ erro: "Banco de dados não configurado." }, { status: 500 });
  }

  const customerId = corpo?.payment?.customer ?? corpo?.subscription?.customer ?? null;
  const subscriptionId =
    corpo?.payment?.subscription ?? corpo?.subscription?.id ?? null;
  const lojaIdRef =
    corpo?.payment?.externalReference ?? corpo?.subscription?.externalReference ?? null;

  let lojaId: string | null = null;

  if (customerId) {
    const { data } = await supabase
      .from("lojas")
      .select("id")
      .eq("asaas_customer_id", customerId)
      .maybeSingle();
    lojaId = (data?.id as string | undefined) ?? null;
  }
  if (!lojaId && subscriptionId) {
    const { data } = await supabase
      .from("lojas")
      .select("id")
      .eq("asaas_subscription_id", subscriptionId)
      .maybeSingle();
    lojaId = (data?.id as string | undefined) ?? null;
  }
  if (!lojaId && lojaIdRef) {
    const { data } = await supabase
      .from("lojas")
      .select("id")
      .eq("id", lojaIdRef)
      .maybeSingle();
    lojaId = (data?.id as string | undefined) ?? null;
  }

  if (!lojaId) {
    // Evento de outra loja/sistema: confirma o recebimento e ignora
    return NextResponse.json({ ok: true, ignorado: "loja não encontrada" });
  }

  // Define o novo status da loja
  let novoStatus: string | null = null;
  if (EVENTOS_PAGOS.includes(evento)) novoStatus = "ativo";
  else if (EVENTOS_BLOQUEIO.includes(evento)) novoStatus = "bloqueado";

  if (!novoStatus) {
    return NextResponse.json({ ok: true, ignorado: evento });
  }

  // Ao confirmar o pagamento, o vencimento passa a ser o próximo
  // vencimento da assinatura no Asaas
  let novoVencimento: string | null = null;
  if (novoStatus === "ativo" && subscriptionId) {
    try {
      const assinatura = await buscarAssinaturaAsaas(subscriptionId);
      novoVencimento = assinatura.nextDueDate ?? null;
    } catch {
      novoVencimento = null; // mantém o vencimento atual no banco
    }
  }

  const { error } = await supabase.rpc("admin_atualizar_loja", {
    p_id: lojaId,
    p_status: novoStatus,
    p_vencimento: novoVencimento,
  });

  if (error) {
    // Devolve erro para o Asaas tentar de novo mais tarde
    return NextResponse.json(
      { erro: "Erro ao atualizar a loja: " + error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, evento, status: novoStatus });
}
