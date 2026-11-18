export type GeminiItem = {
  productId: string;
  quantity: number;
  observation: string;
};

export type GeminiReply = {
  reply: string;
  items: GeminiItem[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

const GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";

export async function responderComGemini(input: {
  history: Array<{ role: "user" | "model"; text: string }>;
  message: string;
  storeContext: string;
}): Promise<GeminiReply> {
  const apiKey = process.env.GEMINI_API_KEY;
  const configuredModel = process.env.GEMINI_MODEL?.trim() || GEMINI_FALLBACK_MODEL;
  if (!apiKey) throw new Error("Configure GEMINI_API_KEY no servidor para ativar a IA.");

  const requestBody = JSON.stringify({
    system_instruction: {
      parts: [{
        text: [
          "Você é o atendente virtual de uma hamburgueria. Responda em português do Brasil, com clareza e brevidade.",
          "Use exclusivamente o cardápio e as informações desta loja. Nunca invente produtos, ingredientes, preços, zonas ou prazos.",
          "Responda sempre como JSON com `reply` (mensagem ao cliente) e `items` (array de itens do pedido).",
          "Para conversa normal, dúvida, saudação ou informação, retorne items vazio.",
          "Quando o cliente demonstrar que quer pedir produtos, retorne apenas IDs exatos do cardápio, quantidades inteiras e observações que ele pediu (por exemplo, sem cebola). Não invente IDs nem observações. Não confirme o pedido.",
          "Se não conseguir mapear um pedido com segurança, faça uma pergunta em `reply` e retorne items vazio.",
          "Não solicite nem repita dados de cartão, senhas ou códigos de autenticação.",
          input.storeContext,
        ].join("\n"),
      }],
    },
    contents: [
      ...input.history.slice(-8).map((message) => ({
        role: message.role,
        parts: [{ text: message.text }],
      })),
      { role: "user", parts: [{ text: input.message }] },
    ],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          reply: { type: "STRING" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                productId: { type: "STRING" },
                quantity: { type: "INTEGER" },
                observation: { type: "STRING" },
              },
              required: ["productId", "quantity", "observation"],
            },
          },
        },
        required: ["reply", "items"],
      },
    },
  });
  const models = Array.from(new Set([configuredModel, GEMINI_FALLBACK_MODEL]));
  let response: Response | undefined;
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      }
    );
    if (response.ok) break;

    console.error("Gemini recusou a solicitação do atendente:", model, response.status);
    if (index < models.length - 1 && [404, 503].includes(response.status)) {
      console.warn("Tentando modelo Gemini alternativo:", models[index + 1]);
      continue;
    }
    throw new Error("A IA não conseguiu responder agora. Tente novamente em instantes.");
  }

  if (!response?.ok) {
    throw new Error("A IA não conseguiu responder agora. Tente novamente em instantes.");
  }

  const payload = await response.json() as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("A IA retornou uma resposta vazia.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("A IA retornou uma resposta inválida.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("A IA retornou uma resposta inválida.");
  }
  const output = parsed as { reply?: unknown; items?: unknown };
  const reply = typeof output.reply === "string" ? output.reply.trim().slice(0, 1200) : "";
  const items = Array.isArray(output.items)
    ? output.items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.productId !== "string" || !Number.isInteger(row.quantity)) return [];
        return [{
          productId: row.productId,
          quantity: Number(row.quantity),
          observation: typeof row.observation === "string"
            ? row.observation.trim().slice(0, 250)
            : "",
        }];
      })
    : [];
  if (!reply) throw new Error("A IA retornou uma resposta inválida.");
  return { reply, items };
}
