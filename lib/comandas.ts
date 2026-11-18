// ============================================================
// COMANDAS (pedidos em andamento do Balcão)
// Permite ter VÁRIOS pedidos abertos ao mesmo tempo (abas),
// deixando cada um em rascunho até ser finalizado.
// Fica salvo no navegador (localStorage) por loja, então um
// pedido em andamento não se perde se a tela for recarregada.
// ============================================================
import type { Product } from "./supabase";

// Item do carrinho: produto + quantidade + observação
export type ItemCarrinho = {
  key: string; // identificador único da linha do carrinho
  product: Product;
  qty: number;
  observacao: string; // ex: "sem cebola", "sem gelo"
};

// Tipo da venda escolhido no carrinho
export type TipoVenda = "balcao" | "delivery" | "mesa";

// Uma comanda (pedido em andamento)
export type Comanda = {
  id: string;
  rotulo: string; // "Pedido 1", "Pedido 2"...
  criadaEm: number;
  tipoVenda: TipoVenda;
  cliente: string;
  telefone: string;
  carrinho: ItemCarrinho[];
  endereco: string;
  complemento: string;
  distanciaKm: number | null; // distância calculada até o cliente (zona de entrega)
  taxa: string;
  motoboyId: string;
  mesaEscolhida: number | null;
  formaPagamento: string;
};

export function chaveComandas(lojaId: string): string {
  return `pdv_comandas_${lojaId}`;
}

// Gera um id único para a comanda
export function novoIdComanda(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Cria uma comanda vazia
export function novaComanda(rotulo: string, formaPagamento: string): Comanda {
  return {
    id: novoIdComanda(),
    rotulo,
    criadaEm: Date.now(),
    tipoVenda: "balcao",
    cliente: "",
    telefone: "",
    carrinho: [],
    endereco: "",
    complemento: "",
    distanciaKm: null,
    taxa: "",
    motoboyId: "",
    mesaEscolhida: null,
    formaPagamento,
  };
}

// Próximo rótulo livre ("Pedido N")
export function proximoRotulo(lista: Comanda[]): string {
  let maior = 0;
  for (const c of lista) {
    const m = /(\d+)\s*$/.exec(c.rotulo);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return `Pedido ${maior + 1}`;
}

// Sem a foto (dataURL): evita estourar o limite do localStorage
function semFoto(product: Product): Product {
  return { ...product, image_url: null };
}

// Lê as comandas salvas da loja (lista vazia se nunca foi salvo)
export function lerComandas(lojaId: string): Comanda[] {
  try {
    const bruto = localStorage.getItem(chaveComandas(lojaId));
    if (!bruto) return [];
    const salvo = JSON.parse(bruto);
    if (!Array.isArray(salvo)) return [];
    return salvo
      .filter((c): c is Comanda => !!c && typeof c.id === "string")
      .map((c) => ({
        ...c,
        carrinho: Array.isArray(c.carrinho)
          ? c.carrinho.map((i) => ({ ...i, product: semFoto(i.product) }))
          : [],
      }));
  } catch {
    return [];
  }
}

export function salvarComandas(lojaId: string, lista: Comanda[]) {
  try {
    const enxuto = lista.map((c) => ({
      ...c,
      carrinho: c.carrinho.map((i) => ({ ...i, product: semFoto(i.product) })),
    }));
    localStorage.setItem(chaveComandas(lojaId), JSON.stringify(enxuto));
  } catch {
    // localStorage cheio ou indisponível: segue sem salvar o rascunho
  }
}
