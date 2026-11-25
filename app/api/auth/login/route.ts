import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { verificarSenha, hashSenha } from "@/lib/password";
import { assinarSessaoLoja, aplicarCookieSessao, assinarSessaoAdmin, aplicarCookieAdmin } from "@/lib/session";
import { verificarRateLimit, ipDoRequest } from "@/lib/rate-limit";
import { registrarAuditoria } from "@/lib/audit";
import { erroGenerico, erroValidacao } from "@/lib/api-security";
import { loginSchema } from "@/lib/validation";
import { validarOrigemMutacao, respostaCsrfInvalido } from "@/lib/csrf";
import { validarLoginSuperAdminServer } from "@/lib/admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!validarOrigemMutacao(req)) return respostaCsrfInvalido();

  const ip = ipDoRequest(req);
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return erroValidacao(parsed.error);

  const email = parsed.data.email.toLowerCase();
  const senha = parsed.data.senha;
  const rl = verificarRateLimit(`login:${ip}:${email}`, 5, 15 * 60 * 1000, 15 * 60 * 1000);
  if (!rl.ok) {
    await registrarAuditoria({ usuario: email, acao: "login_bloqueado_rate_limit", ip, detalhes: { retryAfterSec: rl.retryAfterSec } });
    return NextResponse.json({ error: `Muitas tentativas. Tente novamente em ${Math.ceil(rl.retryAfterSec / 60)} minutos.` }, { status: 429 });
  }

  try {
    const admin = await validarLoginSuperAdminServer(email, senha);
    if (admin.ok) {
      const token = await assinarSessaoAdmin(email);
      const res = NextResponse.json({ ok: true, tipo: "admin" });
      aplicarCookieAdmin(res, token);
      await registrarAuditoria({ usuario: email, acao: "login_admin_sucesso", ip });
      return res;
    }
    if (admin.erro) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data: loja, error } = await supabase
      .from("lojas")
      .select("id,nome_loja,email_dono,status_pagamento,data_vencimento,plano,senha_hash")
      .ilike("email_dono", email)
      .maybeSingle();

    if (error) {
      console.error("[LOGIN_DB]", error.message);
      return erroGenerico(500);
    }
    if (!loja) {
      await registrarAuditoria({ usuario: email, acao: "login_falha", ip, detalhes: { motivo: "usuario_nao_encontrado" } });
      return NextResponse.json({ error: "Acesso negado" }, { status: 401 });
    }

    const verif = await verificarSenha(senha, loja.senha_hash);
    if (!verif.ok) {
      await registrarAuditoria({ lojaId: loja.id, usuario: email, acao: "login_falha", ip, detalhes: { motivo: "senha_invalida" } });
      return NextResponse.json({ error: "Acesso negado" }, { status: 401 });
    }

    if (verif.precisaRehash) {
      const novoHash = await hashSenha(senha);
      await supabase.from("lojas").update({ senha_hash: novoHash }).eq("id", loja.id);
    }

    const sessao = {
      id: String(loja.id),
      nome_loja: String(loja.nome_loja ?? ""),
      email_dono: String(loja.email_dono ?? ""),
      status_pagamento: String(loja.status_pagamento ?? ""),
      data_vencimento: (loja.data_vencimento as string | null) ?? null,
      plano: (loja.plano as string | null) ?? null,
    };

    const token = await assinarSessaoLoja(sessao);
    const res = NextResponse.json({ ok: true, tipo: "loja", sessao });
    aplicarCookieSessao(res, token);
    await registrarAuditoria({ lojaId: loja.id, usuario: email, acao: "login_sucesso", ip });
    return res;
  } catch (err) {
    console.error("[LOGIN]", err);
    return erroGenerico(500);
  }
}
