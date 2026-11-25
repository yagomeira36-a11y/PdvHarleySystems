import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { obterAdminRequest } from "@/lib/session";
import { erroGenerico } from "@/lib/api-security";
import { editarLojaSchema } from "@/lib/validation";
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
    const parsed = editarLojaSchema.safeParse(corpo);
    if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });

    const { id, email } = parsed.data;
    const senha = parsed.data.senha ?? "";
    const supabase = getSupabaseAdmin();

    const { data: loja, error: erroBuscar } = await supabase
      .from("lojas")
      .select("id,email_dono")
      .eq("id", id)
      .not("email_dono", "is", null)
      .maybeSingle();
    if (erroBuscar) {
      console.error("[EDITAR_LOJA_BUSCAR]", erroBuscar.message);
      return erroGenerico(500);
    }
    if (!loja) return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });

    const { data: duplicada, error: erroDup } = await supabase
      .from("lojas")
      .select("id,nome_loja")
      .neq("id", id)
      .ilike("email_dono", email)
      .maybeSingle();
    if (erroDup) {
      console.error("[EDITAR_LOJA_DUP]", erroDup.message);
      return erroGenerico(500);
    }
    if (duplicada) return NextResponse.json({ erro: "Já existe outra loja com este e-mail." }, { status: 400 });

    const mudancas: Record<string, string> = { email_dono: email.toLowerCase() };
    if (senha) {
      if (senha.length < 4) return NextResponse.json({ erro: "A nova senha precisa de pelo menos 4 caracteres." }, { status: 400 });
      mudancas.senha_hash = await hashSenha(senha);
    }

    const { error: erroSalvar } = await supabase.from("lojas").update(mudancas).eq("id", id);
    if (erroSalvar) {
      console.error("[EDITAR_LOJA_SALVAR]", erroSalvar.message);
      return erroGenerico(500);
    }

    await registrarAuditoria({ usuario: admin.email, acao: "admin_editar_loja", entidade: "lojas", entidadeId: id, ip: ipDoRequest(req), detalhes: { email, senhaAlterada: Boolean(senha) } });
    return NextResponse.json({ ok: true, email, senhaAlterada: Boolean(senha) });
  } catch (err) {
    console.error("[EDITAR_LOJA]", err);
    return erroGenerico(500);
  }
}
