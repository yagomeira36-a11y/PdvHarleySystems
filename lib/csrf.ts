import { NextRequest, NextResponse } from "next/server";

const METODOS_MUTAVEIS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function validarOrigemMutacao(req: NextRequest): boolean {
  const metodo = req.method.toUpperCase();
  if (!METODOS_MUTAVEIS.has(metodo)) return true;

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!host) return false;

  const esperadoHttp = `http://${host}`;
  const esperadoHttps = `https://${host}`;
  if (origin) return origin === esperadoHttp || origin === esperadoHttps;

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      return url.host === host;
    } catch {
      return false;
    }
  }

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite) return secFetchSite === "same-origin" || secFetchSite === "same-site" || secFetchSite === "none";
  return false;
}

export function respostaCsrfInvalido() {
  return NextResponse.json({ error: "Requisição bloqueada por proteção CSRF." }, { status: 403 });
}
