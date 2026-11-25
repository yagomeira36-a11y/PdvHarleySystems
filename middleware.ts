import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { lojaSemAcesso } from "@/lib/acesso-loja";

const SESSION_COOKIE = "loja_sessao";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function segredo() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

async function lerSessao(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const key = segredo();
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (payload.tipo !== "loja" || typeof payload.id !== "string") return null;
    return {
      id: String(payload.id),
      nome_loja: String(payload.nome_loja ?? ""),
      email_dono: String(payload.email_dono ?? ""),
      status_pagamento: String(payload.status_pagamento ?? ""),
      data_vencimento: (payload.data_vencimento as string | null | undefined) ?? null,
      plano: (payload.plano as string | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

function csrfInvalido(req: NextRequest): boolean {
  if (!MUTATING.has(req.method.toUpperCase())) return false;
  // Webhooks externos e endpoints com autenticação própria devem ser isentos explicitamente.
  const p = req.nextUrl.pathname;
  if (p === "/api/webhook-asaas") return false;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!host) return true;
  if (origin) return origin !== `http://${host}` && origin !== `https://${host}`;
  const referer = req.headers.get("referer");
  if (referer) {
    try { return new URL(referer).host !== host; } catch { return true; }
  }
  const sec = req.headers.get("sec-fetch-site");
  if (sec) return !(sec === "same-origin" || sec === "same-site" || sec === "none");
  return false;
}

function aplicarHeadersSeguranca(res: NextResponse) {
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=()");
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  res.headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
  ].join("; "));
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (csrfInvalido(req)) {
      return aplicarHeadersSeguranca(NextResponse.json({ error: "Requisição bloqueada por proteção CSRF." }, { status: 403 }));
    }
    return aplicarHeadersSeguranca(NextResponse.next());
  }

  const sessao = await lerSessao(req);
  if (!sessao) {
    return aplicarHeadersSeguranca(NextResponse.redirect(new URL("/login", req.url)));
  }

  if (lojaSemAcesso(sessao) && pathname !== "/pagamento") {
    return aplicarHeadersSeguranca(NextResponse.redirect(new URL("/pagamento", req.url)));
  }

  return aplicarHeadersSeguranca(NextResponse.next());
}

export const config = {
  matcher: ["/pdv", "/mesas", "/", "/pagamento", "/api/:path*"],
};
