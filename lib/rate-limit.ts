type Entrada = { count: number; resetAt: number; bloqueadoAte?: number };

const memoria = new Map<string, Entrada>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function verificarRateLimit(chave: string, limite: number, janelaMs: number, bloqueioMs: number): RateLimitResult {
  const agora = Date.now();
  const atual = memoria.get(chave);
  if (atual?.bloqueadoAte && atual.bloqueadoAte > agora) {
    return { ok: false, retryAfterSec: Math.ceil((atual.bloqueadoAte - agora) / 1000) };
  }
  if (!atual || atual.resetAt <= agora) {
    memoria.set(chave, { count: 1, resetAt: agora + janelaMs });
    return { ok: true };
  }
  atual.count += 1;
  if (atual.count > limite) {
    atual.bloqueadoAte = agora + bloqueioMs;
    memoria.set(chave, atual);
    return { ok: false, retryAfterSec: Math.ceil(bloqueioMs / 1000) };
  }
  memoria.set(chave, atual);
  return { ok: true };
}

export function ipDoRequest(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
