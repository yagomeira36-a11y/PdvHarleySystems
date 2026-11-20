import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { criarClienteAsaas, criarAssinaturaAsaas } from "@/lib/asaas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// CRIAR LOJA (chamada pelo painel /admin)
// 1. cria a loja no banco (função criar_loja)
// 2. cria o cliente no Asaas
// 3. cria a assinatura de R$ 49,99/mês
// 4. guarda os ids do Asaas na loja
// A chave do Asaas fica só aqui no servidor.
// ============================================================
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    nome?: string;
    email?: string;
    senha?: string;
    vencimento?: string;
    cpfCnpj?: string;
  } | null;

  const nome = corpo?.nome?.trim() ?? "";
  const email = corpo?.email?.trim() ?? "";
  const senha = corpo?.senha ?? "";
  const vencimento = corpo?.vencimento ?? "";
  // O Asaas só gera a cobrança com CPF ou CNPJ: aceita só dígitos
  const cpfCnpj = (corpo?.cpfCnpj ?? "").replace(/\D/g, "");

  if (!nome || !email || !senha || !vencimento) {
    return NextResponse.json(
      { erro: "Informe nome, e-mail, senha e vencimento." },
      { status: 400 }
    );
  }
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return NextResponse.json(
      { erro: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido do dono da loja." },
      { status: 400 }
    );
  }
  if (senha.length < 4) {
    return NextResponse.json(
      { erro: "A senha inicial precisa de pelo menos 4 caracteres." },
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

  // A senha vai para o banco só como hash SHA-256 (igual ao login)
  const hash = createHash("sha256").update(senha).digest("hex");

  const { data: lojaId, error } = await supabase.rpc("criar_loja", {
    p_nome: nome,
    p_email: email,
    p_senha_hash: hash,
    p_vencimento: vencimento,
  });

  if (error || !lojaId) {
    return NextResponse.json(
      { erro: "Erro ao criar loja: " + (error?.message ?? "sem retorno do banco") },
      { status: 400 }
    );
  }

  // ---- Asaas: cliente + assinatura de R$ 49,99/mês ----
  // Se o Asaas falhar, a loja continua existindo: devolvemos um
  // aviso para o admin saber que a cobrança não foi criada.
  let aviso: string | null = null;
  try {
    const cliente = await criarClienteAsaas({
      nome,
      email,
      cpfCnpj,
      lojaId: String(lojaId),
    });
    const assinatura = await criarAssinaturaAsaas({
      clienteId: cliente.id,
      lojaId: String(lojaId),
      vencimento,
    });

    const { error: erroSalvar } = await supabase.rpc("admin_salvar_asaas", {
      p_id: lojaId,
      p_customer_id: cliente.id,
      p_subscription_id: assinatura.id,
    });
    if (erroSalvar) {
      aviso = "Cliente e assinatura criados no Asaas, mas não foi possível salvar os ids na loja: " + erroSalvar.message;
    }
  } catch (e) {
    aviso = "Loja criada, mas a assinatura no Asaas falhou: " + (e as Error).message;
  }

  return NextResponse.json({ ok: true, lojaId, aviso });
}
