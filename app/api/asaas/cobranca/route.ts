import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { obterSessaoRequest } from "@/lib/session";
import { erroGenerico } from "@/lib/api-security";
import { VALOR_MENSALIDADE, buscarCobrancaAberta, buscarPixAsaas, buscarBoletoAsaas } from "@/lib/asaas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sessao = await obterSessaoRequest(req);
    const lojaId = new URL(req.url).searchParams.get("loja");
    if (!sessao?.id || !lojaId || sessao.id !== lojaId) {
      return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data: loja, error } = await supabase
      .from("lojas")
      .select("id,status_pagamento,data_vencimento,asaas_customer_id,asaas_subscription_id")
      .eq("id", lojaId)
      .maybeSingle();

    if (error || !loja) return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });

    const resposta = {
      status: loja.status_pagamento as string,
      valor: VALOR_MENSALIDADE,
      vencimento: (loja.data_vencimento as string | null) ?? null,
      semAssinatura: !loja.asaas_customer_id,
      cobranca: null as { id: string; status: string; valor: number; vencimento: string; linkFatura: string | null; linkBoleto: string | null } | null,
      pix: null as { imagem: string; copiaECola: string } | null,
      pixErro: null as string | null,
      boleto: null as { linhaDigitavel: string; codigoBarras: string } | null,
      boletoErro: null as string | null,
    };

    if (!loja.asaas_customer_id) return NextResponse.json(resposta);

    const cobranca = await buscarCobrancaAberta(loja.asaas_customer_id as string, loja.id, loja.asaas_subscription_id ?? null);
    if (cobranca) {
      resposta.cobranca = {
        id: cobranca.id,
        status: cobranca.status,
        valor: Number(cobranca.value),
        vencimento: cobranca.dueDate,
        linkFatura: cobranca.invoiceUrl ?? null,
        linkBoleto: cobranca.bankSlipUrl ?? null,
      };
      const [pix, boleto] = await Promise.allSettled([buscarPixAsaas(cobranca.id), buscarBoletoAsaas(cobranca.id)]);
      if (pix.status === "fulfilled") resposta.pix = { imagem: pix.value.encodedImage, copiaECola: pix.value.payload };
      else resposta.pixErro = "Não foi possível gerar o Pix no momento.";
      if (boleto.status === "fulfilled") resposta.boleto = { linhaDigitavel: boleto.value.identificationField, codigoBarras: boleto.value.barCode };
      else resposta.boletoErro = "Não foi possível gerar o boleto no momento.";
    }
    return NextResponse.json(resposta);
  } catch (err) {
    console.error("[ASAAS_COBRANCA]", err);
    return erroGenerico(500, "Não foi possível consultar a cobrança.");
  }
}
