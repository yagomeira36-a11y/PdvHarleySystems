// Cliente do Supabase (conexão com o banco de dados)
import { createClient, SupabaseClient } from "@supabase/supabase-js/dist/index.cjs";

// URL e chave pública do Supabase (vêm do arquivo .env.local)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Instância única do cliente (singleton)
let client: SupabaseClient | null = null;

// Retorna o cliente Supabase, ou null se o .env.local não estiver configurado
export function getSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseKey) return null;
  if (!supabaseUrl.startsWith("https://") || supabaseUrl.includes("SEU-PROJETO")) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabaseKey);
  }
  return client;
}

// ============================================================
// TIPOS DAS TABELAS
// ============================================================

// Categoria do produto — texto livre, o dono da loja pode criar novas
// (ex: "molhos"). O banco precisa ter a coluna como TEXT; se ainda for
// enum, rode supabase/categorias-livres.sql uma vez.
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
  items?: Array<{
    product_id: string;
    name: string;
    qty: number;
    price: number;
    observacao: string | null;
  }>;
  created_at: string;
};

export function rotuloPedido(
  pedido: Pick<Order, "numero_pedido"> & { customer_name?: string | null }
): string {
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

// ============================================================
// SESSÃO DA LOJA (cookie simples — demonstração)
// O login grava os dados da loja em um cookie; o middleware
// protege as telas e cada consulta filtra por loja_id.
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

// Lê a sessão salva no cookie (null se não estiver logado)
export function getSessao(): Sessao | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(
    new RegExp("(?:^|;\\s*)" + COOKIE_SESSAO + "=([^;]+)")
  );
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1])) as Sessao;
  } catch {
    return null;
  }
}

// Salva a sessão no cookie (7 dias)
export function salvarSessao(s: Sessao): void {
  document.cookie =
    COOKIE_SESSAO +
    "=" +
    encodeURIComponent(JSON.stringify(s)) +
    "; path=/; max-age=" +
    60 * 60 * 24 * 7;
}

// Apaga o cookie (logout)
export function limparSessao(): void {
  document.cookie = COOKIE_SESSAO + "=; path=/; max-age=0";
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
