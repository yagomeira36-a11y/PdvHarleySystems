import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE = "loja_sessao";
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h - expiração curta

export type SessaoLoja = {
  id: string;
  nome_loja: string;
  email_dono: string;
  status_pagamento: string;
  data_vencimento?: string | null;
  plano?: string | null;
};

type SessaoJwt = SessaoLoja & { tipo: "loja"; exp?: number; iat?: number };

function segredoSession(): Uint8Array {
  const segredo = process.env.SESSION_SECRET?.trim();
  if (!segredo || segredo.length < 32) {
    throw new Error("SESSION_SECRET ausente ou fraco. Defina uma chave com pelo menos 32 caracteres.");
  }
  return new TextEncoder().encode(segredo);
}

export async function assinarSessaoLoja(sessao: SessaoLoja): Promise<string> {
  return await new SignJWT({ ...sessao, tipo: "loja" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(segredoSession());
}

export async function verificarSessaoLoja(token: string | undefined | null): Promise<SessaoLoja | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, segredoSession(), { algorithms: ["HS256"] });
    if (payload.tipo !== "loja" || typeof payload.id !== "string" || !payload.id) return null;
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

export async function obterSessaoRequest(req: NextRequest): Promise<SessaoLoja | null> {
  return verificarSessaoLoja(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function obterSessaoServidor(): Promise<SessaoLoja | null> {
  try {
    const jar = await cookies();
    return verificarSessaoLoja(jar.get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
}

export function cookieSessaoOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: false,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

// Decodifica payload sem verificar assinatura (uso apenas no cliente para UI).
// A autorização real sempre é validada no servidor via verificarSessaoLoja.
export function decodificarSessaoToken(token: string | undefined | null): SessaoLoja | null {
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length < 2) return null;
  try {
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = typeof atob === "function"
      ? decodeURIComponent(Array.from(atob(padded), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""))
      : Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json) as SessaoJwt;
    if (payload.tipo !== "loja" || typeof payload.id !== "string" || !payload.id) return null;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
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

export function aplicarCookieSessao(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, cookieSessaoOptions());
}

export function limparCookieSessao(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieSessaoOptions(), maxAge: 0 });
}

export const ADMIN_COOKIE = "admin_sessao";
export type SessaoAdmin = { tipo: "admin"; email: string };

export async function assinarSessaoAdmin(email: string): Promise<string> {
  return await new SignJWT({ tipo: "admin", email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(segredoSession());
}

export async function verificarSessaoAdmin(token: string | undefined | null): Promise<SessaoAdmin | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, segredoSession(), { algorithms: ["HS256"] });
    if (payload.tipo !== "admin" || typeof payload.email !== "string") return null;
    return { tipo: "admin", email: payload.email };
  } catch { return null; }
}

export async function obterAdminRequest(req: NextRequest): Promise<SessaoAdmin | null> {
  return verificarSessaoAdmin(req.cookies.get(ADMIN_COOKIE)?.value);
}

export function aplicarCookieAdmin(response: NextResponse, token: string): void {
  response.cookies.set(ADMIN_COOKIE, token, cookieSessaoOptions());
}
