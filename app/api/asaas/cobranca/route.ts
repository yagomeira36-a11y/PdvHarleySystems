import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import {
  VALOR_MENSALIDADE,
  buscarCobrancaAberta,
  buscarPixAsaas,
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
    .select("id,status_pagamento,data_vencimento,asaas_customer_id")
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
    } | null,
    pix: null as { imagem: string; copiaECola: string } | null,
  };

  if (!loja.asaas_customer_id) {
    return NextResponse.json(resposta);
  }

  try {
    const cobranca = await buscarCobrancaAberta(loja.asaas_customer_id as string);
    if (cobranca) {
      resposta.cobranca = {
        id: cobranca.id,
        status: cobranca.status,
        valor: Number(cobranca.value),
        vencimento: cobranca.dueDate,
        linkFatura: cobranca.invoiceUrl ?? null,
      };

      // O QR Code do Pix pode não existir (fatura só de cartão) — nesse
      // caso a tela mostra apenas o link da fatura
      try {
        const pix = await buscarPixAsaas(cobranca.id);
        resposta.pix = { imagem: pix.encodedImage, copiaECola: pix.payload };
      } catch {
        resposta.pix = null;
      }
    }
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 502 });
  }

  return NextResponse.json(resposta);
}
