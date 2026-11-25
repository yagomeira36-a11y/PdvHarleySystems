import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "node:crypto";

const BCRYPT_ROUNDS = 12;

export async function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, BCRYPT_ROUNDS);
}

export function isBcryptHash(hash: string | null | undefined): boolean {
  return typeof hash === "string" && /^\$2[aby]\$\d{2}\$/.test(hash);
}

export function sha256Hex(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

export function timingSafeHexEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

export async function verificarSenha(senha: string, hashArmazenado: string | null | undefined): Promise<{ ok: boolean; precisaRehash: boolean }> {
  if (!hashArmazenado) return { ok: false, precisaRehash: false };
  if (isBcryptHash(hashArmazenado)) {
    const ok = await bcrypt.compare(senha, hashArmazenado);
    return { ok, precisaRehash: ok && !/^\$2[aby]\$12\$/.test(hashArmazenado) };
  }
  // Compatibilidade legada SHA-256 (demo/login antigo). Migra para bcrypt no próximo login bem-sucedido.
  if (/^[a-f0-9]{64}$/i.test(hashArmazenado)) {
    const calculado = sha256Hex(senha);
    const ok = timingSafeHexEqual(calculado.toLowerCase(), hashArmazenado.toLowerCase());
    return { ok, precisaRehash: ok };
  }
  return { ok: false, precisaRehash: false };
}
