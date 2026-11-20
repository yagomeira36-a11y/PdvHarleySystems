import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// EDITAR LOGIN DA LOJA (chamada pelo painel /admin)
// Muda o e-mail e/ou a senha do dono de uma loja existente.
// A senha vira hash SHA-256 aqui no servidor (igual ao criar_loja),
// então o login normal da loja passa a valer com o novo cadastro.
// ============================================================
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as {
    id?: string;
    email?: string;
    senha?: string;
  } | null;

  const id = String(corpo?.id ?? "").trim();
  const email = String(corpo?.email ?? "").trim().toLowerCase();
  const senha = corpo?.senha ?? "";

  if (!id) {
    return NextResponse.json({ erro: "Loja não informada." }, { status: 400 });
  }
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return NextResponse.json({ erro: "Informe um e-mail válido." }, { status: 400 });
  }
  // Senha vazia = manter a atual
  if (senha && senha.length < 4) {
    return NextResponse.json(
      { erro: "A nova senha precisa de pelo menos 4 caracteres." },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ erro: "Banco de dados não configurado." }, { status: 500 });
  }

  const { data: loja, error: erroBuscar } = await supabase
    .from("lojas")
    .select("id,email_dono")
    .eq("id", id)
    .not("email_dono", "is", null)
    .maybeSingle();
  if (erroBuscar) {
    return NextResponse.json({ erro: "Erro ao buscar a loja: " + erroBuscar.message }, { status: 500 });
  }
  if (!loja) {
    return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });
  }

  const { data: duplicada, error: erroDup } = await supabase
    .from("lojas")
    .select("id,nome_loja")
    .neq("id", id)
    .ilike("email_dono", email)
    .maybeSingle();
  if (erroDup) {
    return NextResponse.json({ erro: "Erro ao conferir o e-mail: " + erroDup.message }, { status: 500 });
  }
  if (duplicada) {
    return NextResponse.json(
      { erro: `Já existe outra loja com este e-mail (${duplicada.nome_loja ?? email}).` },
      { status: 400 }
    );
  }

  const mudancas: Record<string, string> = { email_dono: email };
  if (senha) {
    mudancas.senha_hash = createHash("sha256").update(senha).digest("hex");
  }

  const { error: erroSalvar } = await supabase
    .from("lojas")
    .update(mudancas)
    .eq("id", id);
  if (erroSalvar) {
    return NextResponse.json({ erro: "Erro ao salvar o novo login: " + erroSalvar.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    email,
    senhaAlterada: Boolean(senha),
  });
}
