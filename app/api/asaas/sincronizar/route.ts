import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { obterSessaoRequest } from "@/lib/session";
import { erroGenerico } from "@/lib/api-security";
import { listarCobrancasAsaas, buscarAssinaturaAsaas } from "@/lib/asaas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hojeISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function POST(req: NextRequest) {
  try {
    const sessao = await obterSessaoRequest(req);
    const corpo = (await req.json().catch(() => null)) as { loja?: string } | null;
    const lojaId = corpo?.loja;
    if (!sessao?.id || !lojaId || sessao.id !== lojaId) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data: loja, error } = await supabase
      .from("lojas")
      .select("id,status_pagamento,data_vencimento,asaas_customer_id,asaas_subscription_id")
      .eq("id", lojaId)
      .maybeSingle();
    if (error || !loja) return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });
    if (!loja.asaas_customer_id) return NextResponse.json({ status: loja.status_pagamento, vencimento: loja.data_vencimento });

    let novoStatus = loja.status_pagamento as string;
    let vencimento = (loja.data_vencimento as string | null) ?? null;

    const cobrancas = await listarCobrancasAsaas(loja.asaas_customer_id as string);
    const hoje = hojeISO();
    const atrasada = cobrancas.some((c) => c.status === "OVERDUE" || (c.status === "PENDING" && c.dueDate < hoje));
    const paga = cobrancas.some((c) => c.status === "RECEIVED" || c.status === "CONFIRMED");

    if (atrasada) {
      novoStatus = "bloqueado";
    } else if (paga) {
      novoStatus = "ativo";
      if (loja.asaas_subscription_id) {
        try {
          const assinatura = await buscarAssinaturaAsaas(loja.asaas_subscription_id as string);
          if (assinatura.nextDueDate) vencimento = assinatura.nextDueDate;
        } catch {}
      }
    }

    if (novoStatus !== loja.status_pagamento || vencimento !== loja.data_vencimento) {
      await supabase.rpc("admin_atualizar_loja", { p_id: lojaId, p_status: novoStatus, p_vencimento: vencimento });
    }

    return NextResponse.json({ status: novoStatus, vencimento });
  } catch (err) {
    console.error("[ASAAS_SINCRONIZAR]", err);
    return erroGenerico(500, "Não foi possível sincronizar o pagamento.");
  }
}
