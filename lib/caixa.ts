// ============================================================
// CAIXA — sessões de abertura/fechamento do caixa por loja.
// Ficam salvas no navegador (localStorage), igual ao Layout,
// então funcionam sem precisar rodar SQL no Supabase.
// ============================================================

import type { Entrega, Motoboy, Order } from "./supabase";

export type ResumoPagamentoCaixa = { nome: string; pedidos: number; total: number };
export type ResumoMotoboyCaixa = { id: string | null; nome: string; entregas: number; total: number };

export function pedidosDoCaixa(pedidos: Order[], caixa: Caixa | null): Order[] {
  if (!caixa) return [];
  const inicio = new Date(caixa.abertoEm).getTime();
  const reaberto = caixaReaberto(caixa);
  const fimOriginal = caixa.fechadoEm ? new Date(caixa.fechadoEm).getTime() : null;
  const novaAbertura = caixa.reabertoEm ? new Date(caixa.reabertoEm).getTime() : null;
  return pedidos.filter((pedido) => {
    const criado = new Date(pedido.created_at).getTime();
    if (reaberto) return (criado >= inicio && criado <= fimOriginal!) || criado >= novaAbertura!;
    return criado >= inicio && (fimOriginal === null || criado <= fimOriginal);
  });
}

export function resumirMovimentoCaixa(pedidos: Order[], entregas: Entrega[], motoboys: Motoboy[]) {
  const pagamentos = new Map<string, ResumoPagamentoCaixa>();
  const padrao = ["Débito", "Dinheiro", "Crédito", "VR", "Fiado", "Pix"];
  const normalizar = (nome: string) => nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-\s]+/g, " ").trim();
  for (const nome of padrao) pagamentos.set(normalizar(nome), { nome, pedidos: 0, total: 0 });
  const validos = pedidos.filter((pedido) => pedido.status !== "cancelado");
  for (const pedido of validos) {
    const nome = pedido.forma_pagamento?.trim() || "Não informado";
    const forma = normalizar(nome);
    const chave = forma === "vale refeicao" ? "vr" : forma;
    const grupo = pagamentos.get(chave) || { nome, pedidos: 0, total: 0 };
    grupo.pedidos++;
    grupo.total += Number(pedido.total);
    pagamentos.set(chave, grupo);
  }

  const porMotoboy = new Map<string | null, ResumoMotoboyCaixa>();
  for (const motoboy of motoboys) porMotoboy.set(motoboy.id, { id: motoboy.id, nome: motoboy.nome, entregas: 0, total: 0 });
  const porPedido = new Map(validos.map((pedido) => [pedido.id, pedido]));
  for (const entrega of entregas) {
    const pedido = porPedido.get(entrega.order_id);
    if (!pedido || pedido.type !== "delivery" || pedido.status !== "entregue" || entrega.status !== "entregue") continue;
    const grupo = porMotoboy.get(entrega.motoboy_id) || {
      id: entrega.motoboy_id,
      nome: entrega.motoboy_id ? "Motoboy não encontrado" : "Sem motoboy vinculado",
      entregas: 0,
      total: 0,
    };
    grupo.entregas++;
    grupo.total += Number(entrega.taxa);
    porMotoboy.set(entrega.motoboy_id, grupo);
  }
  const resumoMotoboys = Array.from(porMotoboy.values()).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return {
    pagamentos: Array.from(pagamentos.values()),
    cancelados: pedidos.length - validos.length,
    motoboys: resumoMotoboys,
    entregasQtd: resumoMotoboys.reduce((soma, motoboy) => soma + motoboy.entregas, 0),
    ganhosMotoboys: resumoMotoboys.reduce((soma, motoboy) => soma + motoboy.total, 0),
  };
}

export type Caixa = {
  id: string;
  abertoEm: string; // data/hora da abertura ORIGINAL (ISO)
  fechadoEm: string | null; // último fechamento (null = nunca fechado)
  reabertoEm?: string | null; // quando foi reaberto (restaura as vendas do expediente)
  fundo: number; // troco inicial (R$)
  vendas: number | null; // valor das vendas SALVO no fechamento
  dinheiro: number | null; // valor em dinheiro conferido no fechamento
  obs: string; // observação do fechamento
};

export function chaveCaixas(lojaId: string): string {
  return `pdv_caixas_${lojaId}`;
}

export function lerCaixas(lojaId: string): Caixa[] {
  try {
    const bruto = localStorage.getItem(chaveCaixas(lojaId));
    if (!bruto) return [];
    const lista = JSON.parse(bruto) as Caixa[];
    if (!Array.isArray(lista)) return [];
    return lista
      .filter(
        (c) => c && typeof c.id === "string" && typeof c.abertoEm === "string"
      )
      // Caixas antigos (antes do campo vendas) ganham vendas = null
      .map((c) => ({ ...c, vendas: typeof c.vendas === "number" ? c.vendas : null }));
  } catch {
    return [];
  }
}

export function salvarCaixas(lojaId: string, caixas: Caixa[]) {
  localStorage.setItem(chaveCaixas(lojaId), JSON.stringify(caixas));
  window.dispatchEvent(new CustomEvent("pdv-caixa-atualizado"));
}

// Caixa reaberto = tem fechamento antigo, mas foi reaberto depois dele
// (mantém as vendas do expediente salvas e soma as vendas novas)
export function caixaReaberto(c: Caixa): boolean {
  return Boolean(
    c.fechadoEm &&
      c.reabertoEm &&
      new Date(c.reabertoEm).getTime() > new Date(c.fechadoEm).getTime()
  );
}

export function caixaAberto(caixas: Caixa[]): Caixa | null {
  return (
    caixas.find((c) => !c.fechadoEm || caixaReaberto(c)) ?? null
  );
}

export const MENSAGEM_CAIXA_FECHADO =
  "Caixa fechado. Abra o caixa antes de usar as funções de pedidos.";

export function caixaEstaAberto(lojaId: string): boolean {
  return caixaAberto(lerCaixas(lojaId)) !== null;
}

// Formata data/hora ISO para exibição (dd/mm/aaaa hh:mm)
export function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
