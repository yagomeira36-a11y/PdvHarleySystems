export const UNIDADES_ESTOQUE = ["un", "kg", "g", "L", "ml"] as const;
export type UnidadeEstoque = (typeof UNIDADES_ESTOQUE)[number];
export const EVENTO_ESTOQUE = "pdv-estoque-atualizado";

export type ItemEstoque = {
  id: string;
  codigo: number;
  nome: string;
  unidade: UnidadeEstoque;
  saldo: number;
  minimo: number;
  criadoEm: string;
  atualizadoEm: string;
};

export type MovimentoEstoque = {
  id: string;
  codigo: number;
  nome: string;
  tipo: "entrada" | "saida";
  quantidade: number;
  saldoAnterior: number;
  saldoAtual: number;
  origem: "Estoque" | "Assistente interno";
  observacao: string;
  criadoEm: string;
};

export type DadosEstoque = { itens: ItemEstoque[]; movimentos: MovimentoEstoque[] };

export function chaveEstoque(lojaId: string): string {
  return `pdv_estoque_${lojaId}`;
}

export function lerEstoque(lojaId: string): DadosEstoque {
  const bruto = localStorage.getItem(chaveEstoque(lojaId));
  if (!bruto) return { itens: [], movimentos: [] };
  try {
    const dados = JSON.parse(bruto) as DadosEstoque;
    if (!Array.isArray(dados.itens) || !Array.isArray(dados.movimentos)) throw new Error();
    return dados;
  } catch {
    throw new Error("Os dados salvos do estoque não puderam ser lidos. Não altere nem apague o armazenamento do navegador.");
  }
}

function validarCodigo(codigo: number) {
  if (!Number.isSafeInteger(codigo) || codigo <= 0) throw new Error("Informe um código inteiro maior que zero.");
}

function validarQuantidade(valor: number, unidade: UnidadeEstoque, permitirZero: boolean) {
  if (!Number.isFinite(valor) || valor < 0 || (!permitirZero && valor === 0)) {
    throw new Error(permitirZero ? "Informe uma quantidade igual ou maior que zero." : "Informe uma quantidade maior que zero.");
  }
  if (unidade === "un" && !Number.isInteger(valor)) throw new Error("Itens em unidades precisam de quantidades inteiras.");
  if (!Number.isSafeInteger(Math.round(valor * 1000)) || Math.abs(valor - Math.round(valor * 1000) / 1000) > 0.000000001) {
    throw new Error("Use uma quantidade válida com no máximo três casas decimais.");
  }
}

function salvarEstoque(lojaId: string, dados: DadosEstoque) {
  try {
    localStorage.setItem(chaveEstoque(lojaId), JSON.stringify(dados));
  } catch {
    throw new Error("Não foi possível salvar o estoque. Confira o espaço disponível e as permissões de armazenamento do navegador.");
  }
  window.dispatchEvent(new CustomEvent(EVENTO_ESTOQUE, { detail: { lojaId } }));
}

export function formatarQuantidade(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

export async function cadastrarItemEstoque(
  lojaId: string,
  entrada: { codigo: number; nome: string; unidade: UnidadeEstoque; quantidade: number; minimo: number },
  origem: MovimentoEstoque["origem"] = "Estoque"
): Promise<ItemEstoque> {
  validarCodigo(entrada.codigo);
  const nome = entrada.nome.trim();
  if (!nome || nome.length > 120) throw new Error("Informe um nome com até 120 caracteres.");
  if (!UNIDADES_ESTOQUE.includes(entrada.unidade)) throw new Error("Escolha uma unidade válida.");
  validarQuantidade(entrada.quantidade, entrada.unidade, true);
  validarQuantidade(entrada.minimo, entrada.unidade, true);
  return navigator.locks.request(chaveEstoque(lojaId), () => {
    const dados = lerEstoque(lojaId);
    if (dados.itens.some((i) => i.codigo === entrada.codigo)) throw new Error("Este código já está cadastrado. Use a entrada de estoque para adicionar quantidade.");
    const agora = new Date().toISOString();
    const item: ItemEstoque = {
      id: crypto.randomUUID(), codigo: entrada.codigo, nome, unidade: entrada.unidade,
      saldo: entrada.quantidade, minimo: entrada.minimo, criadoEm: agora, atualizadoEm: agora,
    };
    dados.itens.push(item);
    if (item.saldo > 0) {
      dados.movimentos.unshift({
        id: crypto.randomUUID(), codigo: item.codigo, nome: item.nome, tipo: "entrada", quantidade: item.saldo,
        saldoAnterior: 0, saldoAtual: item.saldo, origem, observacao: "Saldo inicial", criadoEm: agora,
      });
    }
    salvarEstoque(lojaId, dados);
    return item;
  });
}

export async function movimentarEstoque(
  lojaId: string,
  entrada: { codigo: number; tipo: "entrada" | "saida"; quantidade: number; observacao?: string; origem?: MovimentoEstoque["origem"] }
): Promise<ItemEstoque> {
  validarCodigo(entrada.codigo);
  if (entrada.tipo !== "entrada" && entrada.tipo !== "saida") throw new Error("Escolha entrada ou saída.");
  if ((entrada.observacao || "").length > 200) throw new Error("Use uma observação com até 200 caracteres.");
  return navigator.locks.request(chaveEstoque(lojaId), () => {
    const dados = lerEstoque(lojaId);
    const item = dados.itens.find((i) => i.codigo === entrada.codigo);
    if (!item) throw new Error("Código não encontrado. Cadastre o item no Estoque primeiro.");
    validarQuantidade(entrada.quantidade, item.unidade, false);
    if (entrada.tipo === "saida" && entrada.quantidade > item.saldo) throw new Error("A saída não pode ser maior que a quantidade disponível.");
    const saldoAnterior = item.saldo;
    const saldo = Math.round((saldoAnterior + (entrada.tipo === "entrada" ? entrada.quantidade : -entrada.quantidade)) * 1000) / 1000;
    validarQuantidade(saldo, item.unidade, true);
    const agora = new Date().toISOString();
    item.saldo = saldo;
    item.atualizadoEm = agora;
    dados.movimentos.unshift({
      id: crypto.randomUUID(), codigo: item.codigo, nome: item.nome, tipo: entrada.tipo, quantidade: entrada.quantidade,
      saldoAnterior, saldoAtual: saldo, origem: entrada.origem || "Estoque", observacao: (entrada.observacao || "").trim(), criadoEm: agora,
    });
    salvarEstoque(lojaId, dados);
    return item;
  });
}

export async function editarItemEstoque(lojaId: string, entrada: { codigo: number; nome: string; minimo: number }): Promise<ItemEstoque> {
  validarCodigo(entrada.codigo);
  const nome = entrada.nome.trim();
  if (!nome || nome.length > 120) throw new Error("Informe um nome com até 120 caracteres.");
  return navigator.locks.request(chaveEstoque(lojaId), () => {
    const dados = lerEstoque(lojaId);
    const item = dados.itens.find((i) => i.codigo === entrada.codigo);
    if (!item) throw new Error("Código não encontrado.");
    validarQuantidade(entrada.minimo, item.unidade, true);
    item.nome = nome;
    item.minimo = entrada.minimo;
    item.atualizadoEm = new Date().toISOString();
    salvarEstoque(lojaId, dados);
    return item;
  });
}
