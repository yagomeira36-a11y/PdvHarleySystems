import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { criarClienteAsaas, criarAssinaturaAsaas } from "@/lib/asaas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Data de hoje no formato AAAA-MM-DD (horário local do servidor)
function hojeISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ============================================================
// GERAR A COBRANÇA DA LOJA (usada pela tela /pagamento)
// Serve para as lojas sem assinatura no Asaas (ex: criadas com a
// data já vencida antes da correção). Com o CPF/CNPJ do dono aqui,
// o servidor:
// 1. cria o cliente no Asaas (se ainda não existir)
// 2. cria a assinatura de R$ 79,99/mês (primeira fatura vence hoje)
// 3. guarda os ids na loja
// Depois disso a tela já mostra o Pix (QR + copia e cola) e o boleto.
// ============================================================
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    loja?: string;
    cpfCnpj?: string;
  } | null;
  const lojaId = corpo?.loja;
  const cpfCnpj = (corpo?.cpfCnpj ?? "").replace(/\D/g, "");

  if (!lojaId) {
    return NextResponse.json({ erro: "Informe a loja." }, { status: 400 });
  }
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return NextResponse.json(
      { erro: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido." },
      { status: 400 }
    );
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
    .select("id,nome_loja,email_dono,data_vencimento,asaas_customer_id,asaas_subscription_id")
    .eq("id", lojaId)
    .maybeSingle();

  if (error || !loja) {
    return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });
  }

  try {
    // 1. Cliente no Asaas (reaproveita o que já existe)
    let customerId = (loja.asaas_customer_id as string | null) ?? "";
    if (!customerId) {
      const cliente = await criarClienteAsaas({
        nome: (loja.nome_loja as string) ?? "Loja",
        email: (loja.email_dono as string) ?? "",
        cpfCnpj,
        lojaId: String(loja.id),
      });
      customerId = cliente.id;
    }

    // 2. Assinatura mensal (a primeira fatura vence hoje se a data já passou)
    const vencimento = (loja.data_vencimento as string | null) ?? hojeISO();
    const assinatura = await criarAssinaturaAsaas({
      clienteId: customerId,
      lojaId: String(loja.id),
      vencimento,
    });

    // 3. Guarda os ids na loja
    const { error: erroSalvar } = await supabase.rpc("admin_salvar_asaas", {
      p_id: loja.id,
      p_customer_id: customerId,
      p_subscription_id: assinatura.id,
    });
    if (erroSalvar) {
      return NextResponse.json(
        { erro: "Cobrança criada, mas não foi possível salvar na loja: " + erroSalvar.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 502 });
  }
}
