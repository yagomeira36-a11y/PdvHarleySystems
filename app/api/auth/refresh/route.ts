import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { obterSessaoRequest, assinarSessaoLoja, aplicarCookieSessao } from "@/lib/session";
import { erroGenerico } from "@/lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const sessao = await obterSessaoRequest(req);
    if (!sessao?.id) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data: loja, error } = await supabase
      .from("lojas")
      .select("id,nome_loja,email_dono,status_pagamento,data_vencimento,plano")
      .eq("id", sessao.id)
      .maybeSingle();

    if (error) {
      console.error("[AUTH_REFRESH]", error.message);
      return erroGenerico(500);
    }
    if (!loja) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

    const nova = {
      id: String(loja.id),
      nome_loja: String(loja.nome_loja ?? ""),
      email_dono: String(loja.email_dono ?? ""),
      status_pagamento: String(loja.status_pagamento ?? ""),
      data_vencimento: (loja.data_vencimento as string | null) ?? null,
      plano: (loja.plano as string | null) ?? null,
    };
    const token = await assinarSessaoLoja(nova);
    const res = NextResponse.json({ ok: true, sessao: nova });
    aplicarCookieSessao(res, token);
    return res;
  } catch (err) {
    console.error("[AUTH_REFRESH]", err);
    return erroGenerico(500);
  }
}
