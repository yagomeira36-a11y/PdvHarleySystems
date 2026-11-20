// ============================================================
// REGRA DE ACESSO DA LOJA (SaaS Ponto De Vendas Harley Systems)
// A loja perde o PDV e fica só com a tela de pagamento
// (/pagamento — Pix, copia e cola e boleto) quando:
//  - o admin ou o Asaas marcou como "vencido" ou "bloqueado"; ou
//  - a data de vencimento já passou (o dia do vencimento ainda vale:
//    a loja só perde o acesso no dia seguinte).
// A loja de demonstração (plano "demo") é isenta: nunca precisa pagar.
// Usada no login, no middleware e no menu do PDV.
// ============================================================

// Data de hoje no formato AAAA-MM-DD (horário local do navegador)
export function hojeISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A loja está sem acesso ao PDV?
export function lojaSemAcesso(loja: {
  status_pagamento?: string | null;
  data_vencimento?: string | null;
  plano?: string | null;
}): boolean {
  // Loja de demonstração: nunca cai na tela de pagamento
  if (loja.plano === "demo") return false;
  if (loja.status_pagamento === "vencido" || loja.status_pagamento === "bloqueado") {
    return true;
  }
  // Passou da data de vencimento -> só a tela de pagamento
  // (no próprio dia do vencimento a loja ainda entra normalmente)
  return !!loja.data_vencimento && loja.data_vencimento < hojeISO();
}
