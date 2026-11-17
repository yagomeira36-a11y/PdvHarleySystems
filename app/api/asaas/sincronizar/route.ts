import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { listarCobrancasAsaas, buscarAssinaturaAsaas } from "@/lib/asaas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Data de hoje no formato AAAA-MM-DD (fuso local do servidor)
function hojeISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ============================================================
// SINCRONIZAR STATUS COM O ASAAS
// Confere as faturas no Asaas e acerta o status da loja:
// - tem fatura atrasada  -> bloqueado
// - tem fatura paga      -> ativo
// É o botão "Já paguei" da tela /pagamento (serve para testar
// no sandbox, sem depender do webhook chegar até a sua máquina).
// ============================================================
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { loja?: string } | null;
  const lojaId = corpo?.loja;
  if (!lojaId) {
    return NextResponse.json({ erro: "Informe a loja." }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { erro: "Banco de dados não configurado." },
      { status: 500 }
    );
  }

  const { data: loja, error } = await supabase
    .from("lojas")
    .select("id,status_pagamento,data_vencimento,asaas_customer_id,asaas_subscription_id")
    .eq("id", lojaId)
    .maybeSingle();

  if (error || !loja) {
    return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });
  }

  if (!loja.asaas_customer_id) {
    return NextResponse.json({
      status: loja.status_pagamento,
      vencimento: loja.data_vencimento,
    });
  }

  let novoStatus = loja.status_pagamento as string;
  let vencimento = (loja.data_vencimento as string | null) ?? null;

  try {
    const cobrancas = await listarCobrancasAsaas(loja.asaas_customer_id as string);
    const hoje = hojeISO();
    const atrasada = cobrancas.some(
      (c) => c.status === "OVERDUE" || (c.status === "PENDING" && c.dueDate < hoje)
    );
    const paga = cobrancas.some(
      (c) => c.status === "RECEIVED" || c.status === "CONFIRMED"
    );

    if (atrasada) {
      novoStatus = "bloqueado";
    } else if (paga) {
      novoStatus = "ativo";
      // Usa o próximo vencimento da assinatura (não a data da fatura paga,
      // que pode estar no passado e deixaria a loja "vencida" de novo)
      if (loja.asaas_subscription_id) {
        try {
          const assinatura = await buscarAssinaturaAsaas(
            loja.asaas_subscription_id as string
          );
          if (assinatura.nextDueDate) vencimento = assinatura.nextDueDate;
        } catch {
          // mantém o vencimento atual do banco
        }
      }
    }
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 502 });
  }

  if (novoStatus !== loja.status_pagamento || vencimento !== loja.data_vencimento) {
    await supabase.rpc("admin_atualizar_loja", {
      p_id: lojaId,
      p_status: novoStatus,
      p_vencimento: vencimento,
    });
  }

  return NextResponse.json({ status: novoStatus, vencimento });
}
