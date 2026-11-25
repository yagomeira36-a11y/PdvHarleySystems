import { NextRequest, NextResponse } from "next/server";
import { limparCookieSessao, obterSessaoRequest, ADMIN_COOKIE, cookieSessaoOptions } from "@/lib/session";
import { respostaCsrfInvalido } from "@/lib/csrf";
import { registrarAuditoria } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    try { const u = new URL(origin); if (u.host !== host) return respostaCsrfInvalido(); } catch { return respostaCsrfInvalido(); }
  }
  const sessao = await obterSessaoRequest(req);
  const res = NextResponse.json({ ok: true });
  limparCookieSessao(res);
  res.cookies.set(ADMIN_COOKIE, "", { ...cookieSessaoOptions(), maxAge: 0 });
  await registrarAuditoria({ lojaId: sessao?.id, usuario: sessao?.email_dono, acao: "logout", ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null });
  return res;
}
