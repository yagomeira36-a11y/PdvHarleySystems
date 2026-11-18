type EvolutionResponse = Record<string, unknown>;

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "EvolutionError";
  }
}

export function evolutionConfigured(): boolean {
  return !!process.env.EVOLUTION_API_URL?.trim() &&
    !!process.env.EVOLUTION_API_KEY?.trim();
}

export async function evolutionRequest(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>
): Promise<EvolutionResponse> {
  const baseUrl = process.env.EVOLUTION_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new EvolutionError("Configure EVOLUTION_API_URL e EVOLUTION_API_KEY no servidor.", 503);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", apikey: apiKey },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  } catch {
    throw new EvolutionError("Não foi possível acessar a Evolution API.", 502);
  }

  const raw = await response.text();
  let result: EvolutionResponse = {};
  if (raw) {
    try {
      result = JSON.parse(raw) as EvolutionResponse;
    } catch {
      result = { message: raw.slice(0, 300) };
    }
  }

  if (!response.ok) {
    const message = typeof result.message === "string"
      ? result.message.slice(0, 240)
      : `Evolution API respondeu HTTP ${response.status}.`;
    throw new EvolutionError(message, response.status);
  }
  return result;
}

export function evolutionInstanceName(storeId: string): string {
  return `loja_${storeId}`;
}

export function evolutionWebhookConfig(url: string, secret: string) {
  return {
    webhook: {
      enabled: true,
      url,
      byEvents: false,
      base64: false,
      headers: {
        "x-whatsapp-webhook-secret": secret,
        "ngrok-skip-browser-warning": "true",
      },
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
    },
  };
}

export function extractEvolutionMessageId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const key = root.key && typeof root.key === "object"
    ? root.key as Record<string, unknown>
    : null;
  return typeof key?.id === "string" ? key.id : null;
}

export async function sendEvolutionText(
  instanceName: string,
  number: string,
  text: string
): Promise<EvolutionResponse> {
  return evolutionRequest(
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    "POST",
    { number, text }
  );
}
