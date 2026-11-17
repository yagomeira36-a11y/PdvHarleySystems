// ============================================================
// FORMAS DE PAGAMENTO — lista por loja salva no navegador
// (localStorage), igual ao caixa. Começa com as padrão e o
// dono pode adicionar/remover na tela Configurações.
// ============================================================

export const PAGAMENTOS_PADRAO = ["Dinheiro", "Pix", "Débito", "Crédito"];

export function chavePagamentos(lojaId: string): string {
  return `pdv_pagamentos_${lojaId}`;
}

export function lerPagamentos(lojaId: string): string[] {
  try {
    const bruto = localStorage.getItem(chavePagamentos(lojaId));
    if (!bruto) return [...PAGAMENTOS_PADRAO];
    const lista = JSON.parse(bruto);
    if (!Array.isArray(lista) || lista.length === 0) {
      return [...PAGAMENTOS_PADRAO];
    }
    const limpa = lista
      .filter((p) => typeof p === "string" && p.trim() !== "")
      .map((p) => p.trim());
    return limpa.length > 0 ? limpa : [...PAGAMENTOS_PADRAO];
  } catch {
    return [...PAGAMENTOS_PADRAO];
  }
}

export function salvarPagamentos(lojaId: string, lista: string[]) {
  localStorage.setItem(chavePagamentos(lojaId), JSON.stringify(lista));
}
