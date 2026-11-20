import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import {
  VALOR_MENSALIDADE,
  buscarCobrancaAberta,
  buscarPixAsaas,
  buscarBoletoAsaas,
} from "@/lib/asaas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// DADOS DA MENSALIDADE (usada pela tela /pagamento)
// Devolve a fatura em aberto com o Pix (QR Code + copia e cola)
// e o link da fatura (onde o cliente paga com cartão).
// ============================================================
export async function GET(req: Request) {
  const lojaId = new URL(req.url).searchParams.get("loja");
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

  const resposta = {
    status: loja.status_pagamento as string,
    valor: VALOR_MENSALIDADE,
    vencimento: (loja.data_vencimento as string | null) ?? null,
    semAssinatura: !loja.asaas_customer_id,
    cobranca: null as {
      id: string;
      status: string;
      valor: number;
      vencimento: string;
      linkFatura: string | null;
      linkBoleto: string | null;
    } | null,
    pix: null as { imagem: string; copiaECola: string } | null,
    pixErro: null as string | null,
    boleto: null as { linhaDigitavel: string; codigoBarras: string } | null,
    boletoErro: null as string | null,
  };

  if (!loja.asaas_customer_id) {
    return NextResponse.json(resposta);
  }

  try {
    const cobranca = await buscarCobrancaAberta(
      loja.asaas_customer_id as string,
      loja.id,
      loja.asaas_subscription_id ?? null
    );
    if (cobranca) {
      resposta.cobranca = {
        id: cobranca.id,
        status: cobranca.status,
        valor: Number(cobranca.value),
        vencimento: cobranca.dueDate,
        linkFatura: cobranca.invoiceUrl ?? null,
        linkBoleto: cobranca.bankSlipUrl ?? null,
      };

      const [pix, boleto] = await Promise.allSettled([
        buscarPixAsaas(cobranca.id),
        buscarBoletoAsaas(cobranca.id),
      ]);
      if (pix.status === "fulfilled") {
        resposta.pix = { imagem: pix.value.encodedImage, copiaECola: pix.value.payload };
      } else {
        resposta.pixErro = (pix.reason as Error).message;
      }
      if (boleto.status === "fulfilled") {
        resposta.boleto = {
          linhaDigitavel: boleto.value.identificationField,
          codigoBarras: boleto.value.barCode,
        };
      } else {
        resposta.boletoErro = (boleto.reason as Error).message;
      }
    }
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 502 });
  }

  return NextResponse.json(resposta);
}
