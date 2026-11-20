import { getSessao, getSupabase } from "./supabase";
import type { Configuracao, Order, OrderItem } from "./supabase";

export type ConfigImpressora = {
  impressoraCliente: string;
  impressoraCozinha: string;
  colunas: 42 | 48;
  paginaCodigo: 2 | 3 | 19;
  rodape: string;
};
export type ModeloComanda = "modelo1" | "modelo2" | "modelo3" | "modelo4";
export type LinhaComanda = {
  texto: string;
  negrito?: boolean;
  centralizado?: boolean;
  grande?: boolean;
};
export const MODELOS_COMANDA: { valor: ModeloComanda; rotulo: string }[] = [
  { valor: "modelo1", rotulo: "MODELO 1 - SIMPLES" },
  { valor: "modelo2", rotulo: "MODELO 2 - COMPLETO" },
  { valor: "modelo3", rotulo: "MODELO 3 - COZINHA" },
  { valor: "modelo4", rotulo: "MODELO 4 - DELIVERY" },
];
export type ItemImpressao = { nome: string; quantidade: number; preco: number; observacao?: string | null };
export type DadosImpressao = {
  pedido: Order;
  empresa: Pick<Configuracao, "nome_empresa" | "cnpj" | "telefone" | "endereco" | "modelo_comanda">;
  itens: ItemImpressao[];
  modeloComanda?: ModeloComanda;
  tempoPreparo?: string;
  teste?: boolean;
};
export type TipoImpressao = "comprovante" | "comanda";

export function normalizarModeloComanda(value: unknown): ModeloComanda {
  return MODELOS_COMANDA.some((modelo) => modelo.valor === value)
    ? value as ModeloComanda
    : "modelo1";
}

export function montarConteudoComanda(
  dados: DadosImpressao,
  modelo: ModeloComanda = normalizarModeloComanda(dados.modeloComanda)
): LinhaComanda[] {
  const { pedido, empresa } = dados;
  const lines: LinhaComanda[] = [];
  const add = (texto: string, options: Omit<LinhaComanda, "texto"> = {}) => {
    lines.push({ texto, ...options });
  };
  const money = (value: number) => value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const numero = dados.teste
    ? "Pedido: TESTE"
    : `Pedido ${Number.isSafeInteger(Number(pedido.numero_pedido)) ? pedido.numero_pedido : "—"}`;
  const taxa = pedido.type === "delivery" ? Number(pedido.delivery_fee) || 0 : 0;
  const subtotal = Number(pedido.total) - taxa;
  const endereco = [pedido.address, pedido.complemento].filter(Boolean).join(" · ");
  const observacaoTroco = pedido.observacao?.match(/\btroco(?:\s+para)?\s*[:\-]?\s*(.+)/i)?.[1]?.trim();
  const imprimirItens = (exibirPreco: boolean, grande = false) => {
    for (const item of dados.itens) {
      add(`${item.quantidade.toLocaleString("pt-BR")}x ${item.nome}`, { negrito: true, grande });
      if (exibirPreco) add(money(item.preco * item.quantidade));
      if (modelo === "modelo3" && item.observacao) {
        add(`Obs.: ${item.observacao}`, { negrito: true, grande });
      }
    }
  };

  if (dados.teste && modelo !== "modelo3") {
    add("TESTE DE IMPRESSÃO - SEM VENDA", { negrito: true, centralizado: true });
    add("NÃO UTILIZAR PARA COBRANÇA", { negrito: true, centralizado: true });
  }

  switch (modelo) {
    case "modelo1":
      add(numero, { negrito: true });
      imprimirItens(true);
      add(`TOTAL: ${money(Number(pedido.total))}`, { negrito: true });
      break;
    case "modelo2":
      add(empresa.nome_empresa || "Ponto De Vendas Harley Systems", { negrito: true, centralizado: true });
      add(numero, { negrito: true });
      if (pedido.customer_name) add(`Cliente: ${pedido.customer_name}`);
      if (endereco) add(`Endereço: ${endereco}`);
      imprimirItens(true);
      add(`Subtotal: ${money(subtotal)}`);
      add(`Taxa: ${money(taxa)}`);
      add(`TOTAL: ${money(Number(pedido.total))}`, { negrito: true });
      add(`Pagamento: ${pedido.forma_pagamento || "Não informado"}`);
      add(`Tempo de preparo: ${dados.tempoPreparo || "35 a 50 min"}`);
      add("Obrigado!", { negrito: true, centralizado: true });
      break;
    case "modelo3":
      add(numero, { negrito: true, grande: true, centralizado: true });
      imprimirItens(false, true);
      break;
    case "modelo4":
      if (endereco) add(endereco, { negrito: true, grande: true, centralizado: true });
      if (pedido.telefone) add(`Telefone: ${pedido.telefone}`, { negrito: true });
      if (observacaoTroco) add(`Troco: ${observacaoTroco}`, { negrito: true });
      imprimirItens(true);
      add(`TOTAL: ${money(Number(pedido.total))}`, { negrito: true });
      add(`Pagamento: ${pedido.forma_pagamento || "Não informado"}`);
      break;
  }
  return lines;
}

// ============================================================
// EXTRATO DO CAIXA
// Resumo impresso do movimento do caixa aberto (dia de hoje).
// ============================================================
export type GrupoExtrato = { nome: string; quantidade: number; total: number };
export type LinhaExtrato = { hora: string; tipo: string; cliente: string; pagamento: string; total: number };
export type DadosExtrato = {
  empresa: Pick<Configuracao, "nome_empresa" | "cnpj" | "telefone" | "endereco">;
  emitidoEm: string; // data/hora da emissão (ISO)
  abertoEm: string | null; // abertura do caixa (ISO)
  fechadoEm: string | null; // último fechamento (ISO, null = aberto)
  fundo: number; // troco inicial
  vendas: number; // total das vendas do caixa
  lucro: number; // lucro estimado
  taxas: number; // taxas de entrega
  cancelados: number;
  balcao: GrupoExtrato;
  delivery: GrupoExtrato;
  mesa: GrupoExtrato;
  pagamentos: GrupoExtrato[]; // por forma de pagamento
  motoboys: GrupoExtrato[]; // entregas concluídas por motoboy
  entregas: number;
  ganhosMotoboys: number;
  linhas: LinhaExtrato[]; // pedidos do expediente
};

export const IMPRESSORA_PADRAO: ConfigImpressora = { impressoraCliente: "", impressoraCozinha: "", colunas: 48, paginaCodigo: 2, rodape: "Obrigado pela preferência!" };

export function chaveImpressora(lojaId: string): string {
  return `pdv_impressora_${lojaId}`;
}

export function validarConfig(config: ConfigImpressora) {
  if (!config || ![42, 48].includes(config.colunas) || ![2, 3, 19].includes(config.paginaCodigo) || typeof config.rodape !== "string" || config.rodape.length > 200 || [config.impressoraCliente, config.impressoraCozinha].some((nome) => typeof nome !== "string" || nome.length > 240 || /[\x00-\x1f]/.test(nome))) {
    throw new Error("Configuração de impressão inválida. Configure as impressoras ESC/POS novamente.");
  }
}

export function lerImpressora(lojaId: string): ConfigImpressora {
  const bruto = localStorage.getItem(chaveImpressora(lojaId));
  if (!bruto) return { ...IMPRESSORA_PADRAO };
  try {
    const config = JSON.parse(bruto) as ConfigImpressora;
    validarConfig(config);
    return config;
  } catch {
    throw new Error("Selecione e salve as impressoras QZ Tray em Configurações. Preferências antigas do navegador não conectam a impressora.");
  }
}

export function salvarImpressora(lojaId: string, config: ConfigImpressora) {
  validarConfig(config);
  if (!config.impressoraCliente || !config.impressoraCozinha) throw new Error("Selecione a impressora do cliente e da cozinha; pode ser a mesma.");
  localStorage.setItem(chaveImpressora(lojaId), JSON.stringify({ ...config, rodape: config.rodape.trim() }));
}

export function dadosTesteImpressao(
  empresa?: Configuracao | null,
  modeloComanda?: ModeloComanda
): DadosImpressao {
  const sessao = getSessao();
  if (!sessao) throw new Error("Sessão da loja não encontrada.");
  return {
    teste: true,
    empresa: empresa || { nome_empresa: sessao.nome_loja, cnpj: null, telefone: null, endereco: null, modelo_comanda: "modelo1" },
    modeloComanda: modeloComanda || normalizarModeloComanda(empresa?.modelo_comanda),
    tempoPreparo: "35 a 50 min",
    pedido: { id: "TESTE000", numero_pedido: 1, total: 35, type: "delivery", status: "pendente", customer_name: "Cliente de teste", telefone: "(11) 99999-0000", address: "Rua de teste, 123", complemento: "Teste sem venda", delivery_fee: 5, forma_pagamento: "Dinheiro", observacao: "Troco para R$ 50,00", created_at: new Date().toISOString() },
    itens: [{ nome: "Hambúrguer de teste", quantidade: 2, preco: 15, observacao: "Sem cebola - ação, pão, açúcar" }],
  };
}

export async function carregarDadosImpressao(pedidoId: string): Promise<DadosImpressao> {
  const sessao = getSessao();
  const supabase = getSupabase();
  if (!sessao || !supabase) throw new Error("Sessão ou banco indisponível para impressão.");
  const buscarItens = async () => {
    const lista: OrderItem[] = [];
    for (let inicio = 0; ; inicio += 1000) {
      const { data, error } = await supabase.from("order_items").select("*").eq("loja_id", sessao.id).eq("order_id", pedidoId).order("id").range(inicio, inicio + 999);
      if (error) throw new Error(error.message);
      lista.push(...(data || []) as OrderItem[]);
      if (!data || data.length < 1000) return lista;
    }
  };
  const [resPedido, resEmpresa, resTempo, itens] = await Promise.all([
    supabase.from("orders").select("*").eq("loja_id", sessao.id).eq("id", pedidoId).maybeSingle(),
    supabase.from("configuracoes").select("*").eq("loja_id", sessao.id).maybeSingle(),
    supabase.from("store_settings").select("entrega_min,entrega_max").eq("loja_id", sessao.id).maybeSingle(),
    buscarItens(),
  ]);
  if (resPedido.error) throw new Error(resPedido.error.message);
  if (resEmpresa.error) throw new Error(resEmpresa.error.message);
  if (resTempo.error) throw new Error(resTempo.error.message);
  if (!resPedido.data) throw new Error("Pedido não encontrado.");
  if (!itens.length) throw new Error("O pedido não possui itens. Confira os dados antes de imprimir.");
  const ids = Array.from(new Set(itens.map((item) => item.product_id).filter((id): id is string => !!id)));
  const nomes = new Map<string, string>();
  for (let inicio = 0; inicio < ids.length; inicio += 500) {
    const { data, error } = await supabase.from("products").select("id,name").eq("loja_id", sessao.id).in("id", ids.slice(inicio, inicio + 500));
    if (error) throw new Error(error.message);
    for (const produto of data || []) nomes.set(produto.id, produto.name);
  }
  if (getSessao()?.id !== sessao.id) throw new Error("A sessão da loja mudou durante a leitura.");
  const empresa = (resEmpresa.data as Configuracao | null) || {
    nome_empresa: sessao.nome_loja,
    cnpj: null,
    telefone: null,
    endereco: null,
    modelo_comanda: "modelo1",
  };
  const tempoMin = Number(resTempo.data?.entrega_min) || 35;
  const tempoMax = Number(resTempo.data?.entrega_max) || 50;
  return {
    pedido: resPedido.data as Order,
    empresa,
    modeloComanda: normalizarModeloComanda(empresa.modelo_comanda),
    tempoPreparo: `${tempoMin} a ${tempoMax} min`,
    itens: itens.map((item) => ({ nome: item.product_id ? nomes.get(item.product_id) || "Produto removido" : "Produto removido", quantidade: item.qty, preco: Number(item.price), observacao: item.observacao })),
  };
}
