import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CENTRO_PADRAO,
  distanciaKm,
  geocodificar,
  normalizarDeliveryZones,
  zonaParaDistancia,
} from "@/lib/zonas";
import {
  extractEvolutionMessageId,
  sendEvolutionText,
} from "@/lib/whatsapp/evolution";
import { responderComGemini } from "@/lib/whatsapp/gemini";
import {
  isFinishItemsMessage,
  isGreetingMessage,
  isMenuRequest,
  normalizeEvolutionEvent,
  ownerManualReplyIsRecent,
  parseAddressFields,
  parseCashChange,
  parseOrderConfirmation,
  parsePaymentMethod,
  type PaymentMethod,
} from "@/lib/whatsapp/logic";

type JsonRecord = Record<string, unknown>;
type ChatMessage = { role: "user" | "model"; text: string };
type PendingItem = {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  cost: number;
  observation: string;
};
type PendingOrder = {
  stage: "items" | "name" | "address" | "payment" | "cash_change" | "confirmation" | "edit";
  customerName: string;
  items: PendingItem[];
  address?: string;
  complement?: string;
  deliveryFee?: number;
  deliveryZone?: string;
  paymentMethod?: PaymentMethod;
  changeFor?: number | null;
};
type Conversation = {
  history: ChatMessage[];
  pendingOrder: PendingOrder | null;
  welcomed: boolean;
  lastOwnerMessageAt: string | null;
};
type ShopProduct = {
  id: string;
  name: string;
  price: number;
  cost: number;
  category: string;
  description: string;
  available: boolean;
};

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, maxLength = 1000): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function messageText(message: unknown): string {
  const content = object(message);
  const extended = object(content.extendedTextMessage);
  const image = object(content.imageMessage);
  const video = object(content.videoMessage);
  const document = object(content.documentMessage);
  const button = object(content.buttonsResponseMessage);
  const list = object(content.listResponseMessage);
  return text(
    content.conversation ??
      extended.text ??
      image.caption ??
      video.caption ??
      document.caption ??
      button.selectedDisplayText ??
      list.title,
    1500
  );
}

function phoneFromJid(jid: string): string {
  return jid.split("@")[0].split(":")[0].replace(/\D/g, "");
}

function readConversation(value: unknown): Conversation {
  const row = object(value);
  const history = Array.isArray(row.history)
    ? row.history.flatMap((entry): ChatMessage[] => {
        const item = object(entry);
        if ((item.role !== "user" && item.role !== "model") || typeof item.text !== "string") {
          return [];
        }
        return [{ role: item.role, text: item.text.slice(0, 1500) }];
      }).slice(-8)
    : [];
  const pending = object(row.pending_order);
  const validItems = Array.isArray(pending.items)
    ? pending.items.flatMap((entry): PendingItem[] => {
        const item = object(entry);
        if (
          typeof item.productId !== "string" ||
          typeof item.name !== "string" ||
          !Number.isInteger(item.quantity) ||
          !Number.isFinite(Number(item.price))
        ) return [];
        return [{
          productId: item.productId,
          name: item.name,
          quantity: Number(item.quantity),
          price: Number(item.price),
          cost: Number(item.cost) || 0,
          observation: text(item.observation, 250),
        }];
      })
    : [];
  const stageMap: Record<string, PendingOrder["stage"]> = {
    items: "items",
    name: "name",
    address: "address",
    payment: "payment",
    cash_change: "cash_change",
    confirmation: "confirmation",
    edit: "edit",
    confirm_items: "items",
    confirm_delivery: "payment",
  };
  const stage = stageMap[String(pending.stage)];
  const paymentMethod: PaymentMethod | undefined =
    pending.paymentMethod === "Pix" ||
    pending.paymentMethod === "Dinheiro" ||
    pending.paymentMethod === "Cartão"
      ? pending.paymentMethod
      : undefined;
  const pendingOrder = stage && validItems.length > 0
    ? {
        stage,
        customerName: text(pending.customerName, 100),
        items: validItems,
        ...(typeof pending.address === "string" ? { address: pending.address.slice(0, 250) } : {}),
        ...(typeof pending.complement === "string" ? { complement: pending.complement.slice(0, 160) } : {}),
        ...(Number.isFinite(Number(pending.deliveryFee))
          ? { deliveryFee: Number(pending.deliveryFee) }
          : {}),
        ...(typeof pending.deliveryZone === "string" ? { deliveryZone: pending.deliveryZone.slice(0, 80) } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(Number.isFinite(Number(pending.changeFor)) && Number(pending.changeFor) > 0
          ? { changeFor: Number(pending.changeFor) }
          : pending.changeFor === null ? { changeFor: null } : {}),
      }
    : null;
  return {
    history,
    pendingOrder,
    welcomed: row.welcomed === true,
    lastOwnerMessageAt: typeof row.last_owner_message_at === "string"
      ? row.last_owner_message_at
      : null,
  };
}

async function saveConversation(
  supabase: SupabaseClient,
  lojaId: string,
  remoteJid: string,
  conversation: Conversation
): Promise<void> {
  const { error } = await supabase
    .from("whatsapp_ai_conversations")
    .upsert({
      loja_id: lojaId,
      remote_jid: remoteJid,
      history: conversation.history.slice(-8),
      pending_order: conversation.pendingOrder,
      welcomed: conversation.welcomed,
      last_owner_message_at: conversation.lastOwnerMessageAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: "loja_id,remote_jid" });
  if (error) throw new Error("Não foi possível salvar o estado da conversa.");
}

async function loadShopData(supabase: SupabaseClient, lojaId: string) {
  const [productsResult, settingsResult, storeResult] = await Promise.all([
    supabase
      .from("products")
      .select("*")
      .eq("loja_id", lojaId)
      .order("category")
      .order("name"),
    supabase
      .from("store_settings")
      .select("*")
      .eq("loja_id", lojaId)
      .maybeSingle(),
    supabase
      .from("lojas")
      .select("nome,nome_loja")
      .eq("id", lojaId)
      .maybeSingle(),
  ]);
  if (productsResult.error || settingsResult.error || storeResult.error) {
    console.error(
      "Falha ao carregar dados da loja para o atendente WhatsApp:",
      productsResult.error?.message || settingsResult.error?.message || storeResult.error?.message
    );
    throw new Error("Não foi possível carregar o cardápio e as configurações desta loja.");
  }

  const settings = object(settingsResult.data);
  const products: ShopProduct[] = (productsResult.data || [])
    .filter((product) => product.available !== false)
    .slice(0, 120)
    .map((product) => ({
      id: String(product.id),
      name: String(product.name || ""),
      price: Number(product.price) || 0,
      cost: Number(product.cost) || 0,
      category: String(product.category || ""),
      description: String(product.description || ""),
      available: product.available !== false,
    }));
  const centerValue = object(settings.delivery_center);
  const lat = Number(centerValue.lat);
  const lng = Number(centerValue.lng);
  const zonesValue = Array.isArray(settings.raios)
    ? settings.raios
    : settings.taxas_raio;
  const zones = normalizarDeliveryZones(zonesValue);
  const center = {
    lat: Number.isFinite(lat) ? lat : CENTRO_PADRAO.lat,
    lng: Number.isFinite(lng) ? lng : CENTRO_PADRAO.lng,
    zones,
  };
  const store = object(storeResult.data);
  const storeName = text(settings.nome_loja, 120) ||
    text(store.nome_loja, 120) ||
    text(store.nome, 120) ||
    "Nossa loja";
  const allowed = settings.permitir_entrega !== false;
  const preparationMin = positiveInteger(settings.entrega_min, 35);
  const preparationMax = Math.max(preparationMin, positiveInteger(settings.entrega_max, 50));
  const storeContext = [
    `Loja: ${storeName}.`,
    `Entrega permitida: ${allowed ? "sim" : "não"}.`,
    `Zonas ativas: ${zones.filter((zone) => zone.ativo).map((zone) => `até ${zone.raioKm} km por R$ ${zone.taxa.toFixed(2).replace(".", ",")}`).join("; ") || "nenhuma"}.`,
    `Tempo estimado de entrega: ${preparationMin} a ${preparationMax} minutos.`,
    "Cardápio disponível (ID | nome | categoria | preço | descrição):",
    ...products.map((product) =>
      `${product.id} | ${product.name} | ${product.category} | R$ ${product.price.toFixed(2).replace(".", ",")} | ${product.description}`
    ),
  ].join("\n");
  return {
    products,
    settings,
    center,
    storeContext,
    deliveryAllowed: allowed,
    storeName,
    preparationMin,
    preparationMax,
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function money(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function itemLines(items: PendingItem[]): string {
  return items.map((item) => {
    const observation = item.observation ? ` (Obs.: ${item.observation})` : "";
    return `- ${item.quantity}x ${item.name} - ${money(item.price * item.quantity)}${observation}`;
  }).join("\n");
}

function orderSummary(items: PendingItem[]): string {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return `${itemLines(items)}\nSubtotal: ${money(subtotal)}`;
}

function pendingItemsFromCandidates(
  candidates: Array<{ productId: string; quantity: number; observation: string }>,
  products: ShopProduct[]
): PendingItem[] | null {
  const byId = new Map(products.map((product) => [product.id, product]));
  const items = new Map<string, PendingItem>();
  for (const candidate of candidates.slice(0, 10)) {
    const product = byId.get(candidate.productId);
    if (!product || !Number.isInteger(candidate.quantity) || candidate.quantity < 1 || candidate.quantity > 20) {
      continue;
    }
    const observation = text(candidate.observation, 250);
    const key = `${product.id}:${observation.toLowerCase()}`;
    const current = items.get(key);
    const quantity = (current?.quantity || 0) + candidate.quantity;
    if (quantity > 20) return null;
    items.set(key, {
      productId: product.id,
      name: product.name,
      quantity,
      price: product.price,
      cost: product.cost,
      observation,
    });
  }
  return items.size ? Array.from(items.values()) : null;
}

function mergePendingItems(
  currentItems: PendingItem[],
  additions: PendingItem[]
): PendingItem[] {
  const items = new Map<string, PendingItem>();
  for (const item of [...currentItems, ...additions]) {
    const key = `${item.productId}:${item.observation.toLowerCase()}`;
    const current = items.get(key);
    items.set(key, { ...item, quantity: (current?.quantity || 0) + item.quantity });
  }
  return Array.from(items.values());
}

function menuResponse(products: ShopProduct[]): string {
  if (products.length === 0) {
    return "Ainda não encontrei produtos disponíveis no cardápio. A loja precisa atualizar o cadastro dos produtos.";
  }
  const categories = new Map<string, ShopProduct[]>();
  for (const product of products) {
    const category = product.category || "Outros";
    categories.set(category, [...(categories.get(category) || []), product]);
  }
  const sections = Array.from(categories.entries()).map(([category, items]) =>
    `*${category}*\n${items.map((item) =>
      `- ${item.name} — ${money(item.price)}${item.description ? ` · ${item.description}` : ""}`
    ).join("\n")}`
  );
  return `Este é o nosso cardápio:\n${sections.join("\n\n")}\n\nO que você gostaria de pedir?`;
}

function orderReview(pending: PendingOrder, shop: Awaited<ReturnType<typeof loadShopData>>): string {
  const subtotal = pending.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = Number(pending.deliveryFee || 0);
  const total = subtotal + deliveryFee;
  const address = pending.complement
    ? `${pending.address}, complemento: ${pending.complement}`
    : pending.address || "";
  return [
    "Resumo do seu pedido:",
    itemLines(pending.items),
    `Subtotal: ${money(subtotal)}`,
    `Taxa de entrega: ${money(deliveryFee)}`,
    `Total: ${money(total)}`,
    `Tempo de preparo: ${shop.preparationMin}-${shop.preparationMax} min`,
    `Endereço: ${address}`,
    `Pagamento: ${pending.paymentMethod || ""}`,
    ...(pending.paymentMethod === "Dinheiro" && pending.changeFor
      ? [`Troco para: ${money(pending.changeFor)}`]
      : []),
    "Deseja confirmar o pedido? Responda SIM ou NÃO.",
  ].join("\n");
}

async function trackAndSend(
  supabase: SupabaseClient,
  instanceName: string,
  remoteJid: string,
  body: string
): Promise<void> {
  const number = phoneFromJid(remoteJid);
  if (number.length < 10 || number.length > 13) {
    throw new Error("Não foi possível identificar o número do cliente para responder.");
  }
  const { data: outbox, error: erroOutbox } = await supabase
    .from("whatsapp_ai_outbox")
    .insert({ instance_name: instanceName, remote_jid: remoteJid, body })
    .select("id")
    .single();
  if (erroOutbox || !outbox) throw new Error("Não foi possível registrar a resposta do atendente.");

  try {
    const sent = await sendEvolutionText(instanceName, number, body);
    const messageId = extractEvolutionMessageId(sent);
    if (messageId) {
      const { error } = await supabase
        .from("whatsapp_ai_outbox")
        .update({ evolution_message_id: messageId })
        .eq("id", outbox.id);
      if (error) throw new Error("A resposta foi enviada, mas não foi possível registrar o recibo.");
    }
  } catch (error) {
    await supabase.from("whatsapp_ai_outbox").delete().eq("id", outbox.id);
    throw error;
  }
}

async function isRecentOwnerMessage(
  supabase: SupabaseClient,
  lojaId: string,
  remoteJid: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("whatsapp_ai_conversations")
    .select("last_owner_message_at")
    .eq("loja_id", lojaId)
    .eq("remote_jid", remoteJid)
    .maybeSingle();
  if (error) throw new Error("Não foi possível conferir o atendimento manual.");
  const date = data?.last_owner_message_at
    ? new Date(String(data.last_owner_message_at)).getTime()
    : NaN;
  return Number.isFinite(date) && Date.now() - date < 5 * 60 * 1000;
}

async function claimMessage(
  supabase: SupabaseClient,
  instanceName: string,
  messageId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("whatsapp_ai_processed_messages")
    .upsert({
      instance_name: instanceName,
      message_id: messageId,
      status: "processing",
      updated_at: new Date().toISOString(),
    }, { onConflict: "instance_name,message_id", ignoreDuplicates: true })
    .select("message_id");
  if (error) throw new Error("Não foi possível registrar a mensagem recebida.");
  if (data?.length) return true;

  const { data: existing, error: erroLeitura } = await supabase
    .from("whatsapp_ai_processed_messages")
    .select("status")
    .eq("instance_name", instanceName)
    .eq("message_id", messageId)
    .maybeSingle();
  if (erroLeitura) throw new Error("Não foi possível verificar a mensagem recebida.");
  if (existing?.status !== "failed") return false;

  const { error: erroReabrir } = await supabase
    .from("whatsapp_ai_processed_messages")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("instance_name", instanceName)
    .eq("message_id", messageId)
    .eq("status", "failed");
  if (erroReabrir) throw new Error("Não foi possível retomar o processamento da mensagem.");
  return true;
}

async function setMessageStatus(
  supabase: SupabaseClient,
  instanceName: string,
  messageId: string,
  status: "done" | "failed"
): Promise<void> {
  const { error } = await supabase
    .from("whatsapp_ai_processed_messages")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("instance_name", instanceName)
    .eq("message_id", messageId);
  if (error) throw new Error("Não foi possível atualizar o processamento da mensagem.");
}

type DeliveryAddressResult =
  | { error: string }
  | { address: string; complement: string; fee: number; zoneName: string };

async function resolveDeliveryAddress(
  value: string,
  shop: Awaited<ReturnType<typeof loadShopData>>
): Promise<DeliveryAddressResult> {
  if (!shop.deliveryAllowed) {
    return { error: "No momento a loja não está aceitando pedidos para entrega." };
  }
  if (!shop.center.zones.some((zone) => zone.ativo)) {
    return { error: "A loja está sem zonas de entrega ativas. Peça ajuda diretamente à loja." };
  }
  const fields = parseAddressFields(value);
  if (fields.address.length < 8) {
    return { error: "Envie rua, número, bairro e cidade ou CEP para eu calcular a entrega." };
  }

  let location: Awaited<ReturnType<typeof geocodificar>>;
  try {
    location = await geocodificar(fields.address, {
      lat: shop.center.lat,
      lng: shop.center.lng,
    });
  } catch (error) {
    console.error(
      "Falha ao consultar o endereço para entrega:",
      error instanceof Error ? error.message : "Erro desconhecido"
    );
    return { error: "Não consegui consultar esse endereço agora. Tente novamente em instantes." };
  }
  if (!location) {
    return { error: "Não consegui localizar esse endereço. Envie rua, número, bairro e cidade (ou CEP)." };
  }

  const distance = distanciaKm(shop.center.lat, shop.center.lng, location.lat, location.lng);
  const zone = zonaParaDistancia(distance, shop.center.zones);
  if (!zone) {
    return { error: "Esse endereço está fora da área de entrega da loja. Envie outro endereço ou diga CANCELAR." };
  }
  return {
    address: fields.address,
    complement: fields.complement,
    fee: zone.taxa,
    zoneName: zone.nome,
  };
}

function cartContext(items: PendingItem[]): string {
  return items.length > 0
    ? `\nItens já anotados no pedido: ${items.map((item) => `${item.quantity}x ${item.name}${item.observation ? ` (${item.observation})` : ""}`).join("; ")}. Identifique somente itens/quantidades/observações mencionados na mensagem atual.`
    : "";
}

function recordTurn(conversation: Conversation, incoming: string, reply: string): void {
  const history: ChatMessage[] = [
    ...conversation.history,
    { role: "user", text: incoming.slice(0, 1500) },
    { role: "model", text: reply.slice(0, 1500) },
  ];
  conversation.history = history.slice(-8);
}

async function parseRequestedItems(
  incoming: string,
  conversation: Conversation,
  shop: Awaited<ReturnType<typeof loadShopData>>,
  currentItems: PendingItem[] = []
) {
  return responderComGemini({
    history: conversation.history,
    message: incoming,
    storeContext: `${shop.storeContext}${cartContext(currentItems)}`,
  });
}

async function handlePendingOrder(
  supabase: SupabaseClient,
  lojaId: string,
  instanceName: string,
  remoteJid: string,
  incoming: string,
  conversation: Conversation,
  shop: Awaited<ReturnType<typeof loadShopData>>
): Promise<string> {
  const pending = conversation.pendingOrder;
  if (!pending) throw new Error("Estado do pedido inválido.");
  const confirmation = parseOrderConfirmation(incoming);
  const normalized = incoming
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (/^(cancelar|cancela|desistir)( o pedido)?[.! ]*$/i.test(normalized)) {
    conversation.pendingOrder = null;
    return "Tudo bem, cancelei o pedido. Se quiser começar outro, é só me dizer o que gostaria.";
  }

  if (pending.stage === "items") {
    if (isMenuRequest(incoming)) {
      return `${menuResponse(shop.products)}\n\nQuer acrescentar alguma coisa ao pedido?`;
    }
    if (isFinishItemsMessage(incoming)) {
      if (pending.items.length === 0) return "Ainda não anotei nenhum item. O que você gostaria de pedir?";
      pending.stage = "name";
      return "Qual seu nome?";
    }
    const result = await parseRequestedItems(incoming, conversation, shop, pending.items);
    const additions = pendingItemsFromCandidates(result.items, shop.products);
    if (!additions) {
      return result.reply || "Não consegui identificar os itens com segurança. Peça o cardápio ou diga quais produtos e quantidades deseja.";
    }
    const merged = mergePendingItems(pending.items, additions);
    if (merged.some((item) => item.quantity > 20)) {
      return "Posso anotar até 20 unidades por item. Qual quantidade você deseja?";
    }
    pending.items = merged;
    return `Anotei:\n${itemLines(additions)}\n\nQuer acrescentar mais alguma coisa?`;
  }

  if (pending.stage === "name") {
    const customerName = incoming
      .replace(/^\s*(meu nome (?:é|e)|me chamo|sou|nome\s*[:\-])\s*/i, "")
      .trim()
      .slice(0, 100);
    if (customerName.length < 2) return "Não consegui identificar seu nome. Como posso te chamar?";
    pending.customerName = customerName;
    pending.stage = "address";
    return "Qual endereço de entrega completo? Envie rua, número, bairro, complemento e cidade ou CEP.";
  }

  if (pending.stage === "address") {
    const result = await resolveDeliveryAddress(incoming, shop);
    if ("error" in result) return result.error;
    pending.address = result.address;
    pending.complement = result.complement;
    pending.deliveryFee = result.fee;
    pending.deliveryZone = result.zoneName;
    pending.stage = "payment";
    return "Qual a forma de pagamento? Pix, Dinheiro ou Cartão?";
  }

  if (pending.stage === "payment") {
    const paymentMethod = parsePaymentMethod(incoming);
    if (!paymentMethod) return "Escolha uma forma de pagamento: Pix, Dinheiro ou Cartão.";
    pending.paymentMethod = paymentMethod;
    if (paymentMethod === "Dinheiro") {
      pending.stage = "cash_change";
      return "Precisa de troco para quanto?";
    }
    pending.stage = "confirmation";
    return orderReview(pending, shop);
  }

  if (pending.stage === "cash_change") {
    const change = parseCashChange(incoming);
    if (!change.valid) return "Informe o valor para o troco ou diga que não precisa de troco.";
    const total = pending.items.reduce((sum, item) => sum + item.price * item.quantity, 0) +
      Number(pending.deliveryFee || 0);
    if (change.amount !== null && change.amount < total) {
      return `O valor do troco precisa ser maior ou igual ao total de ${money(total)}. Para quanto precisa de troco?`;
    }
    pending.changeFor = change.amount;
    pending.stage = "confirmation";
    return orderReview(pending, shop);
  }

  if (pending.stage === "edit") {
    if (/\b(endereco|rua|bairro)\b/.test(normalized)) {
      const addressInput = incoming
        .replace(/^.*?\bendere[cç]o\b/i, "")
        .replace(/^\s*(?:para|é|e|:|-)\s*/i, "")
        .trim();
      if (!addressInput) return "Envie o novo endereço completo: rua, número, bairro e complemento.";
      const result = await resolveDeliveryAddress(addressInput, shop);
      if ("error" in result) return result.error;
      pending.address = result.address;
      pending.complement = result.complement;
      pending.deliveryFee = result.fee;
      pending.deliveryZone = result.zoneName;
      pending.stage = "confirmation";
      return orderReview(pending, shop);
    }
    if (/\b(nome|cliente)\b/.test(normalized)) {
      const customerName = incoming
        .replace(/^.*?\b(?:nome|cliente)\b/i, "")
        .replace(/^\s*(?:para|é|e|:|-)\s*/i, "")
        .trim()
        .slice(0, 100);
      if (customerName.length < 2) return "Envie o nome correto do cliente.";
      pending.customerName = customerName;
      pending.stage = "confirmation";
      return orderReview(pending, shop);
    }
    if (/\b(troco|pagamento)\b/.test(normalized)) {
      const paymentMethod = parsePaymentMethod(incoming);
      if (paymentMethod) {
        pending.paymentMethod = paymentMethod;
        if (paymentMethod === "Dinheiro") {
          pending.stage = "cash_change";
          return "Precisa de troco para quanto?";
        }
        pending.changeFor = null;
        pending.stage = "confirmation";
        return orderReview(pending, shop);
      }
      if (pending.paymentMethod === "Dinheiro") {
        const change = parseCashChange(incoming);
        if (change.valid) {
          pending.changeFor = change.amount;
          pending.stage = "confirmation";
          return orderReview(pending, shop);
        }
      }
    }
    const result = await parseRequestedItems(incoming, conversation, shop, pending.items);
    const replacement = pendingItemsFromCandidates(result.items, shop.products);
    if (!replacement) {
      return "O que quer alterar? Diga o nome do item, nome do cliente, endereço ou forma de pagamento.";
    }
    pending.items = replacement;
    pending.stage = "confirmation";
    return orderReview(pending, shop);
  }

  if (pending.stage !== "confirmation") {
    throw new Error("Etapa do pedido inválida.");
  }
  if (confirmation === false) {
    pending.stage = "edit";
    return "O que você quer alterar? Pode dizer item, nome, endereço ou pagamento.";
  }
  if (confirmation !== true) return `${orderReview(pending, shop)}\n\nResponda SIM para confirmar ou NÃO para alterar.`;

  const phone = phoneFromJid(remoteJid);
  if (
    phone.length < 10 ||
    phone.length > 13 ||
    !pending.customerName ||
    !pending.address ||
    !pending.paymentMethod
  ) {
    throw new Error("Não foi possível validar os dados do pedido.");
  }
  const subtotal = pending.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = Number(pending.deliveryFee || 0);
  const { data: order, error: erroOrder } = await supabase
    .from("orders")
    .insert({
      loja_id: lojaId,
      type: "delivery",
      status: "pendente",
      total: subtotal + deliveryFee,
      customer_name: pending.customerName,
      telefone: phone,
      address: pending.address,
      complemento: pending.complement || null,
      delivery_fee: deliveryFee,
      forma_pagamento: pending.paymentMethod,
      observacao: pending.paymentMethod === "Dinheiro" && pending.changeFor
        ? `Troco para ${money(pending.changeFor)}`
        : null,
      origem: "IA WhatsApp",
    })
    .select("id,numero_pedido")
    .single();
  if (erroOrder || !order) {
    console.error("Falha ao registrar pedido pelo WhatsApp:", erroOrder?.message || "Sem retorno");
    throw new Error("Não foi possível registrar o pedido no PDV.");
  }

  const { error: erroItens } = await supabase
    .from("order_items")
    .insert(pending.items.map((item) => ({
      order_id: order.id,
      product_id: item.productId,
      qty: item.quantity,
      price: item.price,
      cost: item.cost,
      observacao: item.observation || null,
      loja_id: lojaId,
    })));
  if (erroItens) {
    const { error: erroExcluir } = await supabase
      .from("orders")
      .delete()
      .eq("id", order.id)
      .eq("loja_id", lojaId);
    console.error("Falha ao salvar itens do pedido WhatsApp:", erroItens.message, erroExcluir?.message || "");
    throw new Error("Não foi possível concluir o pedido. A loja foi avisada para conferir o PDV.");
  }

  conversation.pendingOrder = null;
  conversation.history = [];
  await saveConversation(supabase, lojaId, remoteJid, conversation);
  return `Pedido confirmado! Já estamos preparando. Obrigado!`;
}

async function processIncoming(
  supabase: SupabaseClient,
  settings: JsonRecord,
  remoteJid: string,
  incoming: string
): Promise<void> {
  const lojaId = String(settings.loja_id);
  const instanceName = String(settings.instance_name);
  const { data: storedConversation, error } = await supabase
    .from("whatsapp_ai_conversations")
    .select("*")
    .eq("loja_id", lojaId)
    .eq("remote_jid", remoteJid)
    .maybeSingle();
  if (error) throw new Error("Não foi possível carregar a conversa do cliente.");
  const conversation = readConversation(storedConversation);

  if (ownerManualReplyIsRecent(conversation.lastOwnerMessageAt)) return;

  const shop = await loadShopData(supabase, lojaId);
  let reply: string;
  try {
    if (conversation.pendingOrder) {
      reply = await handlePendingOrder(
        supabase,
        lojaId,
        instanceName,
        remoteJid,
        incoming,
        conversation,
        shop
      );
    } else if (isGreetingMessage(incoming)) {
      const greeting = `Olá! Bem-vindo à ${shop.storeName}! Vou te ajudar com seu pedido. Me manda o que você quer do cardápio?`;
      const customWelcome = text(settings.welcome_message, 500);
      reply = customWelcome && customWelcome !== greeting
        ? `${greeting}\n\n${customWelcome}`
        : greeting;
    } else if (isMenuRequest(incoming)) {
      reply = menuResponse(shop.products);
    } else if (isFinishItemsMessage(incoming)) {
      reply = "Ainda não anotei nenhum item. O que você gostaria de pedir?";
    } else {
      console.info("[whatsapp] chamando Gemini", { instanceName });
      const result = await parseRequestedItems(incoming, conversation, shop);
      const items = pendingItemsFromCandidates(result.items, shop.products);
      if (items) {
        conversation.pendingOrder = {
          stage: "items",
          customerName: "",
          items,
        };
        reply = `Anotei:\n${itemLines(items)}\n\nQuer acrescentar mais alguma coisa?`;
      } else if (result.items.length > 0) {
        reply = "Não localizei esses itens no cardápio desta loja. Vou te mostrar as opções disponíveis:\n\n" +
          menuResponse(shop.products);
      } else {
        reply = result.reply || "Não entendi o pedido. Pode me dizer os itens e as quantidades desejadas?";
      }
    }
  } catch (error) {
    const lastMessage = conversation.history[conversation.history.length - 1];
    if (lastMessage?.role !== "user" || lastMessage.text !== incoming) {
      const history: ChatMessage[] = [
        ...conversation.history,
        { role: "user", text: incoming },
      ];
      conversation.history = history.slice(-8);
    }
    await saveConversation(supabase, lojaId, remoteJid, conversation);
    throw error;
  }

  recordTurn(conversation, incoming, reply);
  conversation.welcomed = true;
  await saveConversation(supabase, lojaId, remoteJid, conversation);
  await trackAndSend(supabase, instanceName, remoteJid, reply);
}

async function processMessage(
  supabase: SupabaseClient,
  instanceName: string,
  raw: unknown
): Promise<void> {
  const data = object(raw);
  const key = object(data.key);
  const messageId = text(key.id, 200);
  const remoteJid = text(key.remoteJid, 200);
  const fromMe = key.fromMe === true;
  const body = messageText(data.message);
  if (!messageId || !remoteJid || remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") return;
  if (!fromMe && !body) return;
  if (!(await claimMessage(supabase, instanceName, messageId))) return;

  try {
    const { data: settings, error } = await supabase
      .from("whatsapp_ai_settings")
      .select("*")
      .eq("instance_name", instanceName)
      .maybeSingle();
    if (error || !settings) throw new Error("Não foi possível identificar a loja desta instância.");

    if (fromMe) {
      const since = new Date(Date.now() - 15 * 1000).toISOString();
      const { data: byId, error: erroId } = await supabase
        .from("whatsapp_ai_outbox")
        .select("id")
        .eq("instance_name", instanceName)
        .eq("remote_jid", remoteJid)
        .gte("created_at", since)
        .eq("evolution_message_id", messageId)
        .limit(1)
        .maybeSingle();
      if (erroId) throw new Error("Não foi possível verificar a mensagem enviada pelo assistente.");
      let aiMessage = byId;
      if (!aiMessage && body) {
        const { data: byBody, error: erroBody } = await supabase
          .from("whatsapp_ai_outbox")
          .select("id")
          .eq("instance_name", instanceName)
          .eq("remote_jid", remoteJid)
          .eq("body", body)
          .is("evolution_message_id", null)
          .gte("created_at", since)
          .limit(1)
          .maybeSingle();
        if (erroBody) throw new Error("Não foi possível verificar a mensagem enviada pelo assistente.");
        aiMessage = byBody;
      }
      if (!aiMessage) {
        const { error: erroManual } = await supabase
          .from("whatsapp_ai_conversations")
          .upsert({
            loja_id: settings.loja_id,
            remote_jid: remoteJid,
            last_owner_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "loja_id,remote_jid" });
        if (erroManual) throw new Error("Não foi possível registrar o atendimento manual.");
      }
      await setMessageStatus(supabase, instanceName, messageId, "done");
      return;
    }

    if (settings.ai_enabled !== true || settings.paused === true) {
      await setMessageStatus(supabase, instanceName, messageId, "done");
      return;
    }
    await processIncoming(supabase, settings, remoteJid, body);
    await setMessageStatus(supabase, instanceName, messageId, "done");
  } catch (error) {
    await setMessageStatus(supabase, instanceName, messageId, "failed");
    throw error;
  }
}

async function processConnectionUpdate(
  supabase: SupabaseClient,
  instanceName: string,
  raw: unknown
): Promise<void> {
  const data = object(raw);
  const state = text(data.state ?? data.status, 50).toLowerCase();
  const connected = state === "open" || state === "connected";
  const connectionStatus = connected
    ? "connected"
    : ["connecting", "pairing", "qrcode"].includes(state)
      ? "connecting"
      : "disconnected";
  const owner = text(data.wuid ?? data.ownerJid ?? data.owner, 100);
  const phone = owner.split("@")[0].split(":")[0].replace(/\D/g, "");
  const picture = text(data.profilePictureUrl ?? data.profilePicUrl, 1000);
  const { error } = await supabase
    .from("whatsapp_ai_settings")
    .update({
      connection_status: connectionStatus,
      ...(phone ? { phone_number: phone } : {}),
      ...(picture ? { profile_picture_url: picture } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("instance_name", instanceName);
  if (error) throw new Error("Não foi possível atualizar o status da conexão.");
}

export async function processEvolutionWebhook(
  supabase: SupabaseClient,
  payloadValue: unknown
): Promise<void> {
  const payload = object(payloadValue);
  const instanceName = text(payload.instance, 200);
  const event = normalizeEvolutionEvent(payload.event);
  if (!instanceName.startsWith("loja_")) return;

  if (event === "CONNECTION_UPDATE") {
    await processConnectionUpdate(supabase, instanceName, payload.data);
    return;
  }
  if (event !== "MESSAGES_UPSERT") return;

  const dataValue = payload.data;
  const messages = Array.isArray(dataValue) ? dataValue : [dataValue];
  for (const message of messages) {
    const row = object(message);
    const isFromMe = object(row.key).fromMe === true;
    const remoteJid = text(object(row.key).remoteJid, 200);
    if (!isFromMe && remoteJid) {
      const { data: settings, error } = await supabase
        .from("whatsapp_ai_settings")
        .select("loja_id,instance_name,ai_enabled,paused,welcome_message")
        .eq("instance_name", instanceName)
        .maybeSingle();
      if (error || !settings) {
        throw new Error("Não foi possível associar a mensagem a uma loja.");
      }
      if (settings.ai_enabled === true && settings.paused !== true) {
        const underManualControl = await isRecentOwnerMessage(supabase, settings.loja_id, remoteJid);
        if (underManualControl) {
          const messageId = text(object(row.key).id, 200);
          if (messageId) {
            const claimed = await claimMessage(supabase, instanceName, messageId);
            if (claimed) await setMessageStatus(supabase, instanceName, messageId, "done");
          }
          continue;
        }
      }
    }
    await processMessage(supabase, instanceName, message);
  }
}
