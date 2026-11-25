// Cliente do Supabase (conexão com o banco de dados)
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// URL e chave pública do Supabase (vêm do arquivo .env.local)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Cliente leve que roteia operações sensíveis para rotas server (service_role no servidor).
type PdvResult = { data: any; error: any };
class PdvQuery {
  private body: any;
  private execPromise: Promise<PdvResult> | null = null;
  constructor(table: string, action: string) { this.body = { table, action, filters: [], order: [] }; }
  select(cols: string = "*") { this.body.select = cols; return this; }
  eq(col: string, val: unknown) { this.body.filters.push({ op: "eq", col, val }); return this; }
  neq(col: string, val: unknown) { this.body.filters.push({ op: "neq", col, val }); return this; }
  in(col: string, val: unknown[]) { this.body.filters.push({ op: "in", col, val }); return this; }
  not(col: string, notOp: string, notVal: unknown) { this.body.filters.push({ op: "not", col, notOp, notVal }); return this; }
  gte(col: string, val: unknown) { this.body.filters.push({ op: "gte", col, val }); return this; }
  lte(col: string, val: unknown) { this.body.filters.push({ op: "lte", col, val }); return this; }
  gt(col: string, val: unknown) { this.body.filters.push({ op: "gt", col, val }); return this; }
  lt(col: string, val: unknown) { this.body.filters.push({ op: "lt", col, val }); return this; }
  ilike(col: string, val: unknown) { this.body.filters.push({ op: "ilike", col, val }); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.body.order.push({ col, ascending: opts?.ascending !== false }); return this; }
  limit(n: number) { this.body.limit = n; return this; }
  range(from: number, to: number) { this.body.range = [from, to]; return this; }
  single() { this.body.single = true; return this; }
  maybeSingle() { this.body.maybeSingle = true; return this; }
  insert(data: any) { this.body.action = "insert"; this.body.data = data; return this; }
  update(data: any) { this.body.action = "update"; this.body.data = data; return this; }
  delete() { this.body.action = "delete"; return this; }
  upsert(data: any, opts?: { onConflict?: string }) { this.body.action = "upsert"; this.body.data = data; if (opts?.onConflict) this.body.onConflict = opts.onConflict; return this; }
  private exec(): Promise<PdvResult> {
    if (!this.execPromise) {
      this.execPromise = fetch("/api/pdv", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.body),
      }).then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) return { data: null, error: { message: j?.error ?? "Erro de servidor", code: j?.error?.code } };
        return { data: j?.data ?? null, error: j?.error ?? null };
      }).catch((e) => ({ data: null, error: { message: e instanceof Error ? e.message : "Erro de rede" } }));
    }
    return this.execPromise;
  }
  then<TResult1 = PdvResult, TResult2 = never>(onfulfilled?: ((value: PdvResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) {
    return this.exec().then(onfulfilled, onrejected);
  }
}
class PdvClient {
  from(table: string) { return new PdvQuery(table, "select"); }
  rpc(fn: string, args?: Record<string, unknown>) {
    return fetch("/api/pdv/rpc", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn, args: args ?? {} }),
    }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!r.ok) return { data: null, error: { message: j?.error ?? "Erro de servidor" } };
      return { data: j?.data ?? null, error: j?.error ?? null };
    }).catch((e) => ({ data: null, error: { message: e instanceof Error ? e.message : "Erro de rede" } }));
  }
}
let client: PdvClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (!client) client = new PdvClient();
  return client as unknown as SupabaseClient;
}

// Cliente real somente para casos públicos/legados que precisem acesso direto (evitar em dados sensíveis).
export function getSupabasePublic(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseKey) return null;
  if (!supabaseUrl.startsWith("https://") || supabaseUrl.includes("SEU-PROJETO")) return null;
  return createClient(supabaseUrl, supabaseKey);
}

// ============================================================
// TIPOS DAS TABELAS
// ============================================================

// Categoria do produto — texto livre, o dono da loja pode criar novas
// (ex: "molhos"). A coluna no banco é `category` (text).
export type Categoria = string;

// Produto do cardápio (tabela "products")
export type Product = {
  id: string;
  name: string;
  price: number;
  category: Categoria;
  image_url: string | null;
  description?: string | null;
  available?: boolean;
  code: number;
  cost?: number; // custo de produção (para calcular o lucro)
  created_at?: string;
};

// Pedido (tabela "orders")
export type Order = {
  id: string;
  total: number;
  type: "balcao" | "delivery" | "mesa";
  status: string;
  customer_name: string | null;
  address: string | null;
  complemento?: string | null; // complemento do endereço (delivery)
  telefone?: string | null; // telefone do cliente (delivery)
  delivery_fee: number;
  mesa_numero?: number | null; // número da mesa (pedidos tipo 'mesa')
  forma_pagamento?: string | null; // forma de pagamento (dinheiro, pix...)
  numero_pedido?: number | null;
  observacao?: string | null;
  motivo_cancelamento?: string | null;
  cancelado_em?: string | null;
  cancelado_por?: string | null;
  origem?: string | null; // canal de entrada (PDV, WhatsApp, Bot...)
  items?: Array<{
    product_id: string;
    name: string;
    qty: number;
    price: number;
    observacao: string | null;
  }>;
  numero_exibicao?: string | null; // rótulo local (ex.: OFF-1) para pedidos offline
  created_at: string;
};

export function rotuloPedido(
  pedido: Pick<Order, "numero_pedido" | "numero_exibicao"> & { customer_name?: string | null }
): string {
  const exibicao = (pedido.numero_exibicao ?? "").trim();
  if (exibicao) {
    const base = /^pedido\b/i.test(exibicao) ? exibicao : `Pedido ${exibicao}`;
    const nome = (pedido.customer_name ?? "").trim();
    return nome ? `${base} - ${nome}` : base;
  }
  const numero = Number(pedido.numero_pedido);
  const base =
    Number.isSafeInteger(numero) && numero > 0
      ? `Pedido ${numero}`
      : "Pedido sem número";
  // Junta o nome do cliente ao número: "Pedido 1 - caroline"
  const nome = (pedido.customer_name ?? "").trim();
  return nome ? `${base} - ${nome}` : base;
}

// Item de pedido (tabela "order_items")
export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  qty: number;
  price: number;
  cost: number; // custo congelado no momento da venda
  observacao?: string | null; // observação do cliente no item
  product_name?: string;
};

// Motoboy (tabela "motoboys")
export type Motoboy = {
  id: string;
  nome: string;
  telefone: string | null;
  placa: string | null;
  ativo: boolean;
};

// Entrega (tabela "entregas")
export type Entrega = {
  id: string;
  order_id: string;
  motoboy_id: string | null;
  status: string;
  taxa: number;
  created_at: string;
};

// Configurações da empresa (tabela "configuracoes" - linha única)
export type Configuracao = {
  id: number;
  nome_empresa: string;
  cnpj: string | null;
  telefone: string | null;
  endereco: string | null;
  taxa_entrega_padrao: number;
  modelo_comanda?: string | null;
  whatsapp?: string | null;
  logo_url?: string | null;
  cardapio_aberto?: boolean;
  updated_at?: string;
};

// Cliente salvo (tabela "clientes" - reconhecido pelo telefone)
export type Cliente = {
  id: string;
  nome: string;
  telefone: string;
  endereco: string | null;
  complemento: string | null;
  created_at?: string;
};

// Deixa o telefone só com números (ex: "(11) 98888-7777" -> "11988887777")
export function normalizarTelefone(telefone: string): string {
  return telefone.replace(/\D/g, "");
}

// Monta o link de conversa wa.me a partir do telefone do cliente.
// Sem DDD (menos de 10 dígitos) retorna null — não abre conversa.
export function linkWhatsApp(telefone: string | null | undefined): string | null {
  const digitos = normalizarTelefone(telefone || "");
  if (digitos.length < 10) return null;
  const comCodigoPais = digitos.startsWith("55") ? digitos : `55${digitos}`;
  return `https://wa.me/${comCodigoPais}`;
}

// ============================================================
// SESSÃO DA LOJA (cookie simples — demonstração)
// O login grava os dados da loja em um cookie; o middleware
// protege as telas e cada consulta filtra por loja_id.
// ============================================================
// SESSÃO DA LOJA
// O login do servidor emite um JWT assinado com expiração curta.
// O cookie é legível no cliente apenas para UI; a autorização
// real é validada no servidor (middleware/API) pela assinatura.
// ============================================================
export type Sessao = {
  id: string;
  nome_loja: string;
  email_dono: string;
  status_pagamento: string; // ativo | vencido | bloqueado
  data_vencimento?: string | null;
  plano?: string | null;
};

const COOKIE_SESSAO = "loja_sessao";

function decodificarJwtSessao(token: string): Sessao | null {
  const partes = token.split(".");
  if (partes.length < 2) return null;
  try {
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = decodeURIComponent(
      Array.from(atob(padded), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")
    );
    const payload = JSON.parse(json) as Record<string, unknown>;
    if (payload.tipo !== "loja" || typeof payload.id !== "string" || !payload.id) return null;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return {
      id: String(payload.id),
      nome_loja: String(payload.nome_loja ?? ""),
      email_dono: String(payload.email_dono ?? ""),
      status_pagamento: String(payload.status_pagamento ?? ""),
      data_vencimento: (payload.data_vencimento as string | null | undefined) ?? null,
      plano: (payload.plano as string | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

// Lê a sessão salva no cookie (null se não estiver logado/expirada)
export function getSessao(): Sessao | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(
    new RegExp("(?:^|;\\s*)" + COOKIE_SESSAO + "=([^;]+)")
  );
  if (!m) return null;
  const valor = decodeURIComponent(m[1]);
  const jwt = decodificarJwtSessao(valor);
  if (jwt) return jwt;
  // Compatibilidade legada temporária: cookie JSON antigo
  try {
    const legado = JSON.parse(valor) as Sessao;
    return legado?.id ? legado : null;
  } catch {
    return null;
  }
}

// Sessão é emitida/rotacionada apenas pelo servidor. Esta função mantém
// compatibilidade com chamadas antigas sem permitir forjar autenticação.
export function salvarSessao(_s: Sessao): void {
  // Sessão é emitida pelo servidor. Atualiza cookie JWT a partir do banco.
  if (typeof window !== "undefined") {
    void fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" }).catch(() => {});
  }
}

export function limparSessao(): void {
  document.cookie = COOKIE_SESSAO + "=; path=/; max-age=0; SameSite=Lax";
}

// Hash SHA-256 em hexadecimal (usado ao criar loja no /admin)
export async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

// Formata um número como moeda brasileira (ex: 29.9 -> "R$ 29,90")
export function formatarMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
