// Proteção das páginas do PDV:
// - sem sessão no cookie -> redireciona para /login
// - loja vencida (data atingida), "vencido" ou "bloqueado" -> /pagamento
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { lojaSemAcesso } from "@/lib/acesso-loja";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const cookie = req.cookies.get("loja_sessao");

  if (!cookie) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const dados = JSON.parse(decodeURIComponent(cookie.value));
    if (lojaSemAcesso(dados) && pathname !== "/pagamento") {
      return NextResponse.redirect(new URL("/pagamento", req.url));
    }
  } catch {
    // cookie corrompido -> trata como sem sessão
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

// Só protege as rotas do PDV (/login, /admin e /bloqueado ficam livres)
export const config = {
  matcher: ["/pdv", "/mesas", "/", "/pagamento"],
};
