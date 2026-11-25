export const EXTENSOES_IMAGEM_PERMITIDAS = [".jpg", ".jpeg", ".png", ".webp", ".gif"] as const;
export const MIMES_IMAGEM_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const EXTENSOES_BLOQUEADAS = new Set([".exe", ".js", ".php", ".html", ".htm", ".svg", ".sh", ".bat", ".cmd", ".ps1"]);

function extensao(nome: string): string {
  const i = nome.toLowerCase().lastIndexOf(".");
  return i >= 0 ? nome.slice(i) : "";
}

async function magicBytesOk(file: File): Promise<boolean> {
  const buf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
  const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  return isPng || isJpg || isGif || isWebp;
}

export async function validarImagemUpload(file: File, maxMB: number): Promise<{ ok: true } | { ok: false; erro: string }> {
  const ext = extensao(file.name);
  if (EXTENSOES_BLOQUEADAS.has(ext)) return { ok: false, erro: "Tipo de arquivo não permitido." };
  if (!EXTENSOES_IMAGEM_PERMITIDAS.includes(ext as (typeof EXTENSOES_IMAGEM_PERMITIDAS)[number])) {
    return { ok: false, erro: "Envie apenas imagem JPG, PNG, WEBP ou GIF." };
  }
  if (!MIMES_IMAGEM_PERMITIDOS.has(file.type)) return { ok: false, erro: "Tipo de imagem inválido." };
  if (file.size <= 0 || file.size > maxMB * 1024 * 1024) return { ok: false, erro: `A imagem deve ter até ${maxMB} MB.` };
  const okMagic = await magicBytesOk(file).catch(() => false);
  if (!okMagic) return { ok: false, erro: "Arquivo de imagem inválido ou corrompido." };
  return { ok: true };
}
