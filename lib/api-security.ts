import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function erroGenerico(status = 500, mensagem = "Ocorreu um erro interno. Tente novamente.") {
  return NextResponse.json({ error: mensagem }, { status });
}

export function erroValidacao(err: ZodError) {
  return NextResponse.json(
    { error: "Dados inválidos.", detalhes: err.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })) },
    { status: 400 }
  );
}

export function sanitizarTexto(valor: unknown, max = 500): string {
  if (typeof valor !== "string") return "";
  return valor
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

export function isUploadImagemSeguro(file: File): { ok: true } | { ok: false; erro: string } {
  const nome = (file.name || "").toLowerCase();
  const tipo = (file.type || "").toLowerCase();
  const extensoesBloqueadas = [".exe", ".js", ".mjs", ".cjs", ".php", ".phtml", ".phar", ".sh", ".bat", ".cmd", ".ps1", ".html", ".htm", ".svg"];
  if (extensoesBloqueadas.some((ext) => nome.endsWith(ext))) {
    return { ok: false, erro: "Tipo de arquivo não permitido." };
  }
  const tiposPermitidos = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
  if (!tiposPermitidos.has(tipo)) {
    return { ok: false, erro: "Apenas imagens JPG, PNG, WEBP, GIF ou AVIF são permitidas." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, erro: "Imagem muito grande (máx. 5MB)." };
  }
  return { ok: true };
}

export async function arquivoImagemValido(file: File): Promise<{ ok: true } | { ok: false; erro: string }> {
  const basico = isUploadImagemSeguro(file);
  if (!basico.ok) return basico;
  const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const assinatura =
    (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ? "image/jpeg" :
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ? "image/png" :
    (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) ? "image/gif" :
    (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) ? "image/webp" :
    (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70 && buf[8] === 0x61 && buf[9] === 0x76 && buf[10] === 0x69) ? "image/avif" :
    null;
  if (!assinatura) return { ok: false, erro: "Conteúdo do arquivo não corresponde a uma imagem permitida." };
  return { ok: true };
}
