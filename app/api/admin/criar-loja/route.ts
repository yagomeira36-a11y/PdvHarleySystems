import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { obterAdminRequest } from "@/lib/session";
import { criarClienteAsaas, criarAssinaturaAsaas } from "@/lib/asaas";
import { erroGenerico } from "@/lib/api-security";
import { criarLojaSchema } from "@/lib/validation";
import { hashSenha } from "@/lib/password";
import { registrarAuditoria } from "@/lib/audit";
import { ipDoRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const admin = await obterAdminRequest(req);
    if (!admin) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

    const corpo = await req.json().catch(() => null);
    const parsed = criarLojaSchema.safeParse(corpo);
    if (!parsed.success) {
      return NextResponse.json({ erro: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
    }

    const { nome, email, senha, vencimento, cpfCnpj } = parsed.data;
    const supabase = getSupabaseAdmin();
    const senhaHash = await hashSenha(senha);

    const { data: lojaId, error } = await supabase.rpc("criar_loja", {
      p_nome: nome,
      p_email: email,
      p_senha_hash: senhaHash,
      p_vencimento: vencimento,
    });

    if (error || !lojaId) {
      console.error("[CRIAR_LOJA]", error?.message);
      return NextResponse.json({ erro: "Não foi possível criar a loja." }, { status: 400 });
    }

    let aviso: string | null = null;
    try {
      const cliente = await criarClienteAsaas({ nome, email, cpfCnpj, lojaId: String(lojaId) });
      const assinatura = await criarAssinaturaAsaas({ clienteId: cliente.id, lojaId: String(lojaId), vencimento });
      const { error: erroSalvar } = await supabase.rpc("admin_salvar_asaas", {
        p_id: lojaId,
        p_customer_id: cliente.id,
        p_subscription_id: assinatura.id,
      });
      if (erroSalvar) {
        console.error("[CRIAR_LOJA_ASAAS_SAVE]", erroSalvar.message);
        aviso = "Loja criada, mas houve falha ao vincular assinatura.";
      }
    } catch (e) {
      console.error("[CRIAR_LOJA_ASAAS]", e);
      aviso = "Loja criada, mas houve falha ao criar assinatura no Asaas.";
    }

    await registrarAuditoria({ usuario: admin.email, acao: "admin_criar_loja", entidade: "lojas", entidadeId: String(lojaId), ip: ipDoRequest(req), detalhes: { email } });
    return NextResponse.json({ ok: true, lojaId, aviso });
  } catch (err) {
    console.error("[CRIAR_LOJA]", err);
    return erroGenerico(500);
  }
}
