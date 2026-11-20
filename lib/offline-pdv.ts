import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "./supabase";

const DATABASE_NAME = "harley-systems-pdv";
const DATABASE_VERSION = 1;
const ORDERS_STORE = "offline-orders";
const CACHE_STORE = "offline-cache";

export type OfflineOrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  qty: number;
  price: number;
  cost: number;
  observacao: string | null;
  loja_id: string;
};

export type OfflineOrderRecord = {
  id: string;
  lojaId: string;
  pedido: Order;
  itens: OfflineOrderItem[];
  entrega?: {
    id: string;
    order_id: string;
    motoboy_id: string | null;
    status: "pendente";
    taxa: number;
    loja_id: string;
  };
  cliente?: {
    nome: string;
    telefone: string;
    endereco: string | null;
    complemento: string | null;
    loja_id: string;
  };
  fiado?: {
    id: string;
    cliente_nome: string;
    cliente_telefone: string | null;
    tipo: "divida";
    valor: number;
    descricao: string;
    data: string;
    loja_id: string;
  };
  mesaNumero?: number;
  criadoEm: string;
  ultimoErro?: string;
};

export type ResultadoSincronizacaoOffline = {
  sincronizados: Order[];
  falhas: Array<{ id: string; mensagem: string }>;
};

type CacheOffline<T> = {
  id: string;
  dados: T;
  atualizadoEm: string;
};

let sincronizacaoEmCurso: Promise<ResultadoSincronizacaoOffline> | null = null;

function abrirBanco(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("O armazenamento offline não está disponível neste dispositivo."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ORDERS_STORE)) {
        database.createObjectStore(ORDERS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(CACHE_STORE)) {
        database.createObjectStore(CACHE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento offline."));
    request.onblocked = () => reject(new Error("Feche as outras janelas do PDV para atualizar o armazenamento offline."));
  });
}

function requisicao<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao acessar o armazenamento offline."));
  });
}

function transacaoConcluida(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Falha ao salvar dados offline."));
    transaction.onabort = () => reject(transaction.error ?? new Error("A gravação offline foi cancelada."));
  });
}

function avisarFilaAtualizada(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("pdv-offline-orders-changed"));
  }
}

export async function guardarCacheOffline<T>(lojaId: string, nome: string, dados: T): Promise<void> {
  const database = await abrirBanco();
  const transaction = database.transaction(CACHE_STORE, "readwrite");
  transaction.objectStore(CACHE_STORE).put({
    id: `${lojaId}:${nome}`,
    dados,
    atualizadoEm: new Date().toISOString(),
  } satisfies CacheOffline<T>);
  await transacaoConcluida(transaction);
  database.close();
}

export async function lerCacheOffline<T>(lojaId: string, nome: string): Promise<T | null> {
  const database = await abrirBanco();
  const transaction = database.transaction(CACHE_STORE, "readonly");
  const result = await requisicao(
    transaction.objectStore(CACHE_STORE).get(`${lojaId}:${nome}`) as IDBRequest<CacheOffline<T> | undefined>
  );
  await transacaoConcluida(transaction);
  database.close();
  return result?.dados ?? null;
}

export async function guardarPedidoOffline(record: OfflineOrderRecord): Promise<void> {
  const database = await abrirBanco();
  const transaction = database.transaction(ORDERS_STORE, "readwrite");
  transaction.objectStore(ORDERS_STORE).put(record);
  await transacaoConcluida(transaction);
  database.close();
  avisarFilaAtualizada();
}

export async function listarPedidosOffline(lojaId: string): Promise<OfflineOrderRecord[]> {
  const database = await abrirBanco();
  const transaction = database.transaction(ORDERS_STORE, "readonly");
  const records = await requisicao(
    transaction.objectStore(ORDERS_STORE).getAll() as IDBRequest<OfflineOrderRecord[]>
  );
  await transacaoConcluida(transaction);
  database.close();
  return records.filter((record) => record.lojaId === lojaId);
}

export async function contarPedidosOffline(lojaId: string): Promise<number> {
  return (await listarPedidosOffline(lojaId)).length;
}

async function pedidoExistente(
  supabase: SupabaseClient,
  id: string,
  lojaId: string
): Promise<Order | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível verificar o pedido ${id}: ${error.message}`);
  return data as Order | null;
}

async function sincronizarUmPedido(
  supabase: SupabaseClient,
  record: OfflineOrderRecord
): Promise<Order> {
  const pedidoBanco = { ...record.pedido };
  delete pedidoBanco.items;
  let pedido = await pedidoExistente(supabase, record.pedido.id, record.lojaId);

  if (!pedido) {
    const { data, error } = await supabase
      .from("orders")
      .insert({ ...pedidoBanco, loja_id: record.lojaId })
      .select()
      .single();
    if (error) {
      if (error.code !== "23505") {
        throw new Error(`Não foi possível sincronizar o pedido: ${error.message}`);
      }
      pedido = await pedidoExistente(supabase, record.pedido.id, record.lojaId);
      if (!pedido) throw new Error(`O pedido ${record.pedido.id} já existe, mas não pertence à loja.`);
    } else {
      pedido = data as Order;
    }
  }

  if (record.itens.length > 0) {
    const { error } = await supabase
      .from("order_items")
      .upsert(record.itens, { onConflict: "id" });
    if (error) throw new Error(`Não foi possível sincronizar os itens do pedido: ${error.message}`);
  }

  if (record.cliente) {
    const { error } = await supabase
      .from("clientes")
      .upsert(record.cliente, { onConflict: "loja_id,telefone" });
    if (error) throw new Error(`Não foi possível sincronizar o cliente: ${error.message}`);
  }

  if (record.entrega) {
    const { error } = await supabase
      .from("entregas")
      .upsert(record.entrega, { onConflict: "id" });
    if (error) throw new Error(`Não foi possível sincronizar a entrega: ${error.message}`);
  }

  if (record.fiado) {
    const { error } = await supabase
      .from("fiados")
      .upsert(record.fiado, { onConflict: "id" });
    if (error) throw new Error(`Não foi possível sincronizar o fiado: ${error.message}`);
  }

  if (record.mesaNumero) {
    const { data, error } = await supabase
      .from("mesas")
      .update({ status: "ocupada" })
      .eq("loja_id", record.lojaId)
      .eq("numero", record.mesaNumero)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      throw new Error(`Não foi possível sincronizar a mesa: ${error?.message ?? "Mesa não encontrada."}`);
    }
  }

  return { ...pedido, items: record.pedido.items };
}

async function removerPedidoOffline(id: string): Promise<void> {
  const database = await abrirBanco();
  const transaction = database.transaction(ORDERS_STORE, "readwrite");
  transaction.objectStore(ORDERS_STORE).delete(id);
  await transacaoConcluida(transaction);
  database.close();
  avisarFilaAtualizada();
}

async function registrarFalhaOffline(record: OfflineOrderRecord, mensagem: string): Promise<void> {
  await guardarPedidoOffline({ ...record, ultimoErro: mensagem });
}

async function executarSincronizacao(
  supabase: SupabaseClient,
  lojaId: string
): Promise<ResultadoSincronizacaoOffline> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { sincronizados: [], falhas: [] };
  }

  const registros = await listarPedidosOffline(lojaId);
  const sincronizados: Order[] = [];
  const falhas: ResultadoSincronizacaoOffline["falhas"] = [];

  for (const record of registros) {
    try {
      const pedido = await sincronizarUmPedido(supabase, record);
      await removerPedidoOffline(record.id);
      sincronizados.push(pedido);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Erro desconhecido ao sincronizar.";
      await registrarFalhaOffline(record, mensagem);
      falhas.push({ id: record.id, mensagem });
    }
  }

  return { sincronizados, falhas };
}

export function sincronizarPedidosOffline(
  supabase: SupabaseClient,
  lojaId: string
): Promise<ResultadoSincronizacaoOffline> {
  if (sincronizacaoEmCurso) return sincronizacaoEmCurso;
  sincronizacaoEmCurso = executarSincronizacao(supabase, lojaId).finally(() => {
    sincronizacaoEmCurso = null;
  });
  return sincronizacaoEmCurso;
}
