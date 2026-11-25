import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "./supabase";

const DATABASE_NAME = "harley-systems-pdv";
const DATABASE_VERSION = 2;
const ORDERS_STORE = "offline-orders";
const CACHE_STORE = "offline-cache";
const UPDATES_STORE = "offline-updates";

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

export type OfflineEntrega = {
  id: string;
  order_id: string;
  motoboy_id: string | null;
  status: "pendente" | "saiu_entrega" | "entregue";
  taxa: number;
  loja_id: string;
};

export type OfflineOrderRecord = {
  id: string;
  lojaId: string;
  pedido: Order;
  itens: OfflineOrderItem[];
  entrega?: OfflineEntrega;
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
  atualizadoEm?: string;
  ultimoErro?: string;
  numeroExibicao: string;
  statusLocal?: string;
  sincronizado?: boolean;
  sincronizadoEm?: string;
  falhaImpressao?: boolean;
};

export type OfflineUpdateRecord = {
  id: string;
  lojaId: string;
  orderId: string;
  tipo: "order_status" | "entrega_status" | "entrega_motoboy";
  payload: Record<string, unknown>;
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

function ehErroRedeSync(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = error instanceof Error ? error.message : String(error || "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|offline|timeout|econn|socket/i.test(msg) || error instanceof TypeError;
}

let sincronizacaoEmCurso: Promise<ResultadoSincronizacaoOffline> | null = null;

function chaveUltimoNumero(lojaId: string) {
  return `pdv_last_order_number_${lojaId}`;
}

export function proximoNumeroExibicaoOffline(lojaId: string): string {
  if (typeof localStorage === "undefined") return `OFF-${Date.now()}`;
  const chave = chaveUltimoNumero(lojaId);
  const atual = Number.parseInt(localStorage.getItem(chave) || "0", 10);
  const proximo = Number.isFinite(atual) && atual >= 0 ? atual + 1 : 1;
  localStorage.setItem(chave, String(proximo));
  return `OFF-${proximo}`;
}

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
      if (!database.objectStoreNames.contains(UPDATES_STORE)) {
        database.createObjectStore(UPDATES_STORE, { keyPath: "id" });
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

function normalizarPedidoExibicao(pedido: Order, numeroExibicao?: string): Order {
  const exibicao = (numeroExibicao ?? (pedido as Order & { numero_exibicao?: string }).numero_exibicao ?? "").trim();
  return exibicao ? { ...pedido, numero_exibicao: exibicao } : { ...pedido };
}

function normalizarRegistro(record: OfflineOrderRecord): OfflineOrderRecord {
  const numeroExibicao = (record.numeroExibicao || record.pedido.numero_exibicao || "").trim() || `OFF-${record.id.slice(0, 6)}`;
  const statusLocal = record.statusLocal || record.pedido.status || "em_preparo";
  const pedido = { ...normalizarPedidoExibicao(record.pedido, numeroExibicao), status: statusLocal };
  return {
    ...record,
    numeroExibicao,
    pedido,
    statusLocal,
    sincronizado: Boolean(record.sincronizado),
  };
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
  const normalizado = normalizarRegistro(record);
  transaction.objectStore(ORDERS_STORE).put({
    ...normalizado,
    atualizadoEm: normalizado.atualizadoEm || new Date().toISOString(),
  });
  await transacaoConcluida(transaction);
  database.close();
  avisarFilaAtualizada();
}

export async function atualizarPedidoOffline(
  id: string,
  atualizador: (record: OfflineOrderRecord) => OfflineOrderRecord
): Promise<OfflineOrderRecord | null> {
  const database = await abrirBanco();
  const transaction = database.transaction(ORDERS_STORE, "readwrite");
  const store = transaction.objectStore(ORDERS_STORE);
  const atual = await requisicao(store.get(id) as IDBRequest<OfflineOrderRecord | undefined>);
  if (!atual) {
    await transacaoConcluida(transaction);
    database.close();
    return null;
  }
  const atualizado = normalizarRegistro(atualizador(normalizarRegistro(atual)));
  store.put({ ...atualizado, atualizadoEm: new Date().toISOString() });
  await transacaoConcluida(transaction);
  database.close();
  avisarFilaAtualizada();
  return atualizado;
}

export async function listarPedidosOffline(lojaId: string): Promise<OfflineOrderRecord[]> {
  const database = await abrirBanco();
  const transaction = database.transaction(ORDERS_STORE, "readonly");
  const records = await requisicao(
    transaction.objectStore(ORDERS_STORE).getAll() as IDBRequest<OfflineOrderRecord[]>
  );
  await transacaoConcluida(transaction);
  database.close();
  return records
    .filter((record) => record.lojaId === lojaId)
    .map(normalizarRegistro)
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

export async function contarPedidosOffline(lojaId: string): Promise<number> {
  const registros = await listarPedidosOffline(lojaId);
  return registros.filter((record) => !record.sincronizado).length;
}

export async function contarPendenciasOffline(lojaId: string): Promise<number> {
  const [pedidos, updates] = await Promise.all([listarPedidosOffline(lojaId), listarUpdatesOffline(lojaId)]);
  const updatesPendentes = updates.filter((u) => {
    if (!u.ultimoErro) return true;
    // erros de rede não contam como falha definitiva visível; ainda aguardam retry
    return !/failed to fetch|networkerror|network request failed|load failed|fetch failed|offline|timeout|econn|socket/i.test(String(u.ultimoErro));
  }).length;
  const pedidosPendentes = pedidos.filter((record) => {
    if (!record.sincronizado) return true;
    if (!record.ultimoErro) return false;
    return !/failed to fetch|networkerror|network request failed|load failed|fetch failed|offline|timeout|econn|socket/i.test(String(record.ultimoErro));
  }).length;
  return pedidosPendentes + updatesPendentes;
}

export async function listarUpdatesOffline(lojaId: string): Promise<OfflineUpdateRecord[]> {
  const database = await abrirBanco();
  const transaction = database.transaction(UPDATES_STORE, "readonly");
  const records = await requisicao(
    transaction.objectStore(UPDATES_STORE).getAll() as IDBRequest<OfflineUpdateRecord[]>
  );
  await transacaoConcluida(transaction);
  database.close();
  return records.filter((record) => record.lojaId === lojaId).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

export async function enfileirarUpdateOffline(update: OfflineUpdateRecord): Promise<void> {
  const database = await abrirBanco();
  const transaction = database.transaction(UPDATES_STORE, "readwrite");
  transaction.objectStore(UPDATES_STORE).put(update);
  await transacaoConcluida(transaction);
  database.close();
  avisarFilaAtualizada();
}

export async function removerUpdateOffline(id: string): Promise<void> {
  const database = await abrirBanco();
  const transaction = database.transaction(UPDATES_STORE, "readwrite");
  transaction.objectStore(UPDATES_STORE).delete(id);
  await transacaoConcluida(transaction);
  database.close();
  avisarFilaAtualizada();
}

async function pedidoExistente(
  supabase: SupabaseClient,
  id: string,
  lojaId: string
): Promise<Order | null> {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .eq("loja_id", lojaId)
      .maybeSingle();
    if (error) throw error;
    return data as Order | null;
  } catch (error) {
    // Se offline/falha de rede, não bloquear sync com erro definitivo: deixa retry no próximo ciclo
    if (ehErroRedeSync(error)) throw error;
    throw new Error(`Não foi possível verificar o pedido ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function pedidoParaBanco(record: OfflineOrderRecord): Record<string, unknown> {
  const pedidoBanco = { ...record.pedido } as Record<string, unknown>;
  delete pedidoBanco.items;
  delete pedidoBanco.numero_exibicao;
  delete pedidoBanco.numero_pedido; // servidor/trigger define
  return { ...pedidoBanco, loja_id: record.lojaId, status: record.statusLocal || record.pedido.status || "pendente" };
}

async function sincronizarUmPedido(
  supabase: SupabaseClient,
  record: OfflineOrderRecord
): Promise<Order> {
  let pedido = await pedidoExistente(supabase, record.pedido.id, record.lojaId);

  if (!pedido) {
    const { data, error } = await supabase
      .from("orders")
      .insert(pedidoParaBanco(record))
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

  return { ...pedido, items: record.pedido.items, numero_exibicao: record.numeroExibicao };
}

async function aplicarUpdateOffline(supabase: SupabaseClient, update: OfflineUpdateRecord): Promise<void> {
  if (update.tipo === "order_status") {
    const status = String(update.payload.status || "");
    const { error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", update.orderId)
      .eq("loja_id", update.lojaId);
    if (error) throw new Error(`Não foi possível sincronizar o status do pedido: ${error.message}`);
    return;
  }
  if (update.tipo === "entrega_status") {
    const status = String(update.payload.status || "");
    const { error: erroPedido } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", update.orderId)
      .eq("loja_id", update.lojaId)
      .eq("type", "delivery");
    if (erroPedido) throw new Error(`Não foi possível sincronizar o status do pedido delivery: ${erroPedido.message}`);
    const { error: erroEntrega } = await supabase
      .from("entregas")
      .update({ status })
      .eq("order_id", update.orderId)
      .eq("loja_id", update.lojaId);
    if (erroEntrega) throw new Error(`Não foi possível sincronizar a entrega: ${erroEntrega.message}`);
    return;
  }
  if (update.tipo === "entrega_motoboy") {
    const motoboyId = (update.payload.motoboy_id ?? null) as string | null;
    const entregaId = String(update.payload.entrega_id || "");
    const taxa = Number(update.payload.taxa || 0);
    if (motoboyId) {
      const { error } = await supabase.from("entregas").upsert(
        {
          id: entregaId || undefined,
          order_id: update.orderId,
          motoboy_id: motoboyId,
          status: String(update.payload.status || "pendente"),
          taxa,
          loja_id: update.lojaId,
        },
        { onConflict: "id" }
      );
      if (error) throw new Error(`Não foi possível sincronizar o motoboy da entrega: ${error.message}`);
    } else if (entregaId) {
      const { error } = await supabase.from("entregas").update({ motoboy_id: null }).eq("id", entregaId).eq("loja_id", update.lojaId);
      if (error) throw new Error(`Não foi possível sincronizar o motoboy da entrega: ${error.message}`);
    }
  }
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
    if (record.sincronizado && !record.ultimoErro) continue;
    try {
      const pedidoServidor = await sincronizarUmPedido(supabase, record);
      const atualizado: OfflineOrderRecord = {
        ...record,
        pedido: {
          ...record.pedido,
          id: pedidoServidor.id,
          items: record.pedido.items,
          numero_exibicao: record.numeroExibicao,
          status: record.statusLocal || record.pedido.status,
        },
        sincronizado: true,
        sincronizadoEm: new Date().toISOString(),
        ultimoErro: undefined,
      };
      await guardarPedidoOffline(atualizado);
      sincronizados.push({ ...pedidoServidor, numero_exibicao: record.numeroExibicao });
    } catch (error) {
      // Erro de rede: mantém na fila silenciosamente para retry automático (15s), sem toast/erro vermelho
      if (ehErroRedeSync(error) || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        if (record.ultimoErro) {
          await guardarPedidoOffline({ ...record, ultimoErro: undefined });
        }
        continue;
      }
      const mensagem = error instanceof Error ? error.message : "Erro desconhecido ao sincronizar.";
      await guardarPedidoOffline({ ...record, ultimoErro: mensagem });
      falhas.push({ id: record.id, mensagem });
    }
  }

  const updates = await listarUpdatesOffline(lojaId);
  for (const update of updates) {
    const pedido = registros.find((r) => r.id === update.orderId);
    if (pedido && !pedido.sincronizado) continue; // pedido base ainda precisa subir
    try {
      await aplicarUpdateOffline(supabase, update);
      await removerUpdateOffline(update.id);
    } catch (error) {
      if (ehErroRedeSync(error) || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        // mantém update na fila para retry silencioso
        if (update.ultimoErro) {
          const database = await abrirBanco();
          const transaction = database.transaction(UPDATES_STORE, "readwrite");
          transaction.objectStore(UPDATES_STORE).put({ ...update, ultimoErro: undefined });
          await transacaoConcluida(transaction);
          database.close();
        }
        continue;
      }
      const mensagem = error instanceof Error ? error.message : "Erro desconhecido ao sincronizar atualização.";
      const database = await abrirBanco();
      const transaction = database.transaction(UPDATES_STORE, "readwrite");
      transaction.objectStore(UPDATES_STORE).put({ ...update, ultimoErro: mensagem });
      await transacaoConcluida(transaction);
      database.close();
      falhas.push({ id: update.id, mensagem });
    }
  }

  if (falhas.length > 0 || sincronizados.length > 0) avisarFilaAtualizada();
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
