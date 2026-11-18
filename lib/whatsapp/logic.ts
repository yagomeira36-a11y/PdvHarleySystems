export function normalizeEvolutionEvent(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, 80).toUpperCase().replace(/[.\s-]+/g, "_")
    : "";
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/g, "");
}

export function isGreetingMessage(value: string): boolean {
  return /^(oi|ola|bom dia|boa tarde|boa noite|opa|e ai|eae)$/.test(normalizeText(value));
}

export function isMenuRequest(value: string): boolean {
  return /\b(cardapio|menu|o que tem|que tem ai|opcoes|lista de produtos|me mostra)\b/.test(
    normalizeText(value)
  );
}

export function isFinishItemsMessage(value: string): boolean {
  return /^(so isso|so isso mesmo|e isso|era isso|fechar pedido|pode fechar|finalizar pedido|pode finalizar|nada mais|nao quero mais)$/.test(
    normalizeText(value)
  );
}

export type PaymentMethod = "Pix" | "Dinheiro" | "Cartão";

export function parsePaymentMethod(value: string): PaymentMethod | null {
  const normalized = normalizeText(value);
  if (/\bpix\b/.test(normalized)) return "Pix";
  if (/\b(dinheiro|cash)\b/.test(normalized)) return "Dinheiro";
  if (/\b(cartao|credito|debito)\b/.test(normalized)) return "Cartão";
  return null;
}

export function parseCashChange(value: string): { valid: boolean; amount: number | null } {
  const normalized = normalizeText(value);
  if (/\b(sem troco|nao precisa|nao quero troco|nao)\b/.test(normalized)) {
    return { valid: true, amount: null };
  }
  const match = normalized.match(
    /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:[,.]\d{2})?)/
  );
  if (!match) return { valid: false, amount: null };
  const amount = Number(match[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(amount) && amount > 0
    ? { valid: true, amount }
    : { valid: false, amount: null };
}

export function parseAddressFields(value: string): { address: string; complement: string } {
  const complementMatch = value.match(/\bcomplemento\s*[:\-]?\s*(.+)$/i);
  const complement = complementMatch?.[1]?.trim().slice(0, 160) || "";
  const address = value
    .replace(/\bcomplemento\s*[:\-]?\s*.+$/i, "")
    .trim()
    .replace(/[,\s]+$/g, "")
    .slice(0, 250);
  return { address, complement };
}

export function parseOrderConfirmation(value: string): boolean | null {
  const normalized = normalizeText(value);
  if (/^(sim|s|confirmo|confirmar|pode|pode ser|fechado|ok|beleza|isso)(?:[.! ,].*)?$/.test(normalized)) {
    return true;
  }
  if (/^(nao|n|cancelar|cancela|desistir|deixa)(?:[.! ,].*)?$/.test(normalized)) {
    return false;
  }
  return null;
}

export function ownerManualReplyIsRecent(
  timestamp: string | null | undefined,
  now = Date.now()
): boolean {
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && now - time < 5 * 60 * 1000;
}
