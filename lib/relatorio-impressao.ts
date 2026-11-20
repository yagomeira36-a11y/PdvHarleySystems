// ============================================================
// RELATÓRIO DE IMPRESSÃO / PDF
// Calcula os 6 blocos do relatório a partir de dados REAIS já
// carregados do Supabase (orders, order_items, products) e monta
// um HTML limpo (A4) para imprimir ou salvar em PDF.
// Sem acesso ao banco e sem mock: recebe só arrays prontos.
// ============================================================

export type CanalNome = "Entrega" | "Mesa" | "Retirada" | "WhatsApp/Bot";
export type PagamentoNome = "Pix" | "Dinheiro" | "Cartão crédito" | "Cartão débito" | "Vale/Outros";

export type PedidoRelatorio = {
  id: string;
  total: number;
  type: string;
  status: string;
  created_at: string;
  forma_pagamento?: string | null;
  customer_name?: string | null;
  telefone?: string | null;
  origem?: string | null;
};

export type ItemRelatorio = {
  order_id: string;
  product_id: string | null;
  qty: number;
  price: number;
  cost: number;
};

export type ProdutoRelatorio = { id: string; name: string; cost?: number };

export type Linha = { rotulo: string; total: number; qtd: number; ticket: number };

export type RelatorioImpressao = {
  resumo: {
    totalVendido: number;
    qtdPedidos: number;
    ticketMedio: number;
    lucroBruto: number | null; // null = custo não cadastrado
    melhorDia: { rotulo: string; total: number } | null;
  };
  canais: Linha[];
  pagamentos: Linha[];
  produtos: {
    top5: { nome: string; qtd: number; total: number }[];
    bottom5: { nome: string; qtd: number; total: number }[];
    maiorLucro: { nome: string; lucro: number; qtd: number } | null;
  };
  clientes: {
    novos: number;
    voltaram: number;
    pararam: number;
    ativos: number;
    top: { nome: string; qtd: number; total: number } | null;
  };
  horarios: { picoHora: string | null; melhorDiaSemana: string | null };
};

// ---- formato pt-BR ----
const brl = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const diaSemana = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function diaBrasil(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function semAcento(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ---- classificação ----
export function classificarCanal(p: PedidoRelatorio): CanalNome {
  const origem = semAcento(p.origem || "");
  if (origem.includes("whatsapp") || origem.includes("bot")) return "WhatsApp/Bot";
  if (p.type === "delivery") return "Entrega";
  if (p.type === "mesa") return "Mesa";
  return "Retirada"; // balcão = retirada no local
}

export function classificarPagamento(forma?: string | null): PagamentoNome {
  const s = semAcento(forma || "");
  if (s.includes("pix")) return "Pix";
  if (s.includes("dinhe")) return "Dinheiro";
  if (s.includes("debit")) return "Cartão débito";
  if (s.includes("credit") || s.includes("creditar")) return "Cartão crédito";
  return "Vale/Outros";
}

function chaveCliente(p: PedidoRelatorio): string | null {
  const tel = (p.telefone || "").replace(/\D/g, "");
  if (tel.length >= 10) return `tel:${tel}`;
  const nome = (p.customer_name || "").trim().toLowerCase();
  if (nome) return `nome:${nome}`;
  return null;
}

function nomeCliente(p: PedidoRelatorio): string {
  const nome = (p.customer_name || "").trim();
  if (nome) return nome;
  const tel = (p.telefone || "").replace(/\D/g, "");
  return tel ? `Cliente ${tel}` : "Cliente";
}

// Agrupa pedidos por dia / hora / dia da semana e devolve o maior.
function maiorPor(fn: (p: PedidoRelatorio) => string | number, ordens: PedidoRelatorio[]) {
  const acum = new Map<string | number, number>();
  for (const p of ordens) {
    const k = fn(p);
    acum.set(k, (acum.get(k) || 0) + Number(p.total));
  }
  let melhor: { chave: string | number; total: number } | null = null;
  for (const [chave, total] of acum) {
    if (!melhor || total > melhor.total) melhor = { chave, total };
  }
  return melhor;
}

export function montarRelatorio(args: {
  pedidos: PedidoRelatorio[];
  itens: ItemRelatorio[];
  produtos: ProdutoRelatorio[];
  inicio: number;
  fim: number; // exclusivo
  inicioAnterior: number;
  fimAnterior: number; // exclusivo
}): RelatorioImpressao {
  const { pedidos, itens, produtos, inicio, fim, inicioAnterior, fimAnterior } = args;
  const dentro = (iso: string, a: number, b: number) => {
    const t = new Date(iso).getTime();
    return t >= a && t < b;
  };
  const validos = pedidos.filter((p) => p.status !== "cancelado");
  const doPeriodo = validos.filter((p) => dentro(p.created_at, inicio, fim));
  const idsPeriodo = new Set(doPeriodo.map((p) => p.id));

  // custo por produto (fallback quando o item veio com custo 0)
  const custoProduto = new Map(produtos.map((x) => [String(x.id), Number(x.cost || 0)]));
  const nomeProduto = new Map(produtos.map((x) => [String(x.id), x.name]));

  // lucro por pedido (e se existe algum custo cadastrado)
  let existeCusto = false;
  const lucroPorPedido = new Map<string, number>();
  const agregadoProduto = new Map<string, { qtd: number; total: number; lucro: number }>();
  for (const it of itens) {
    if (!idsPeriodo.has(it.order_id)) continue;
    const preco = Number(it.price) || 0;
    const custoBruto = Number(it.cost) || 0;
    const custo = custoBruto > 0 ? custoBruto : custoProduto.get(String(it.product_id)) || 0;
    if (custoBruto > 0 || custo > 0) existeCusto = true;
    const qtd = Number(it.qty) || 0;
    const linha = preco * qtd;
    const lucro = (preco - custo) * qtd;
    lucroPorPedido.set(it.order_id, (lucroPorPedido.get(it.order_id) || 0) + lucro);
    const nome = nomeProduto.get(String(it.product_id)) || (it.product_id ? "Produto removido" : "Item");
    const atual = agregadoProduto.get(nome) || { qtd: 0, total: 0, lucro: 0 };
    atual.qtd += qtd;
    atual.total += linha;
    atual.lucro += lucro;
    agregadoProduto.set(nome, atual);
  }

  const totalVendido = doPeriodo.reduce((s, p) => s + Number(p.total), 0);
  const qtdPedidos = doPeriodo.length;

  // ---- RESUMO ----
  const melhorDiaBruto = maiorPor((p) => p.created_at.slice(0, 10), doPeriodo);
  const resumo = {
    totalVendido,
    qtdPedidos,
    ticketMedio: qtdPedidos ? totalVendido / qtdPedidos : 0,
    lucroBruto: existeCusto ? [...lucroPorPedido.values()].reduce((s, v) => s + v, 0) : null,
    melhorDia: melhorDiaBruto
      ? { rotulo: diaBrasil(melhorDiaBruto.chave + "T00:00:00"), total: melhorDiaBruto.total }
      : null,
  };

  // ---- CANAL / PAGAMENTO ----
  const linhaBucket = <T extends string>(nomes: readonly T[], chave: (p: PedidoRelatorio) => T): Linha[] =>
    nomes.map((nome) => {
      const grupo = doPeriodo.filter((p) => chave(p) === nome);
      const total = grupo.reduce((s, p) => s + Number(p.total), 0);
      return { rotulo: nome, total, qtd: grupo.length, ticket: grupo.length ? total / grupo.length : 0 };
    });
  const canais = linhaBucket<CanalNome>(["Entrega", "Mesa", "Retirada", "WhatsApp/Bot"], classificarCanal);
  const pagamentos = linhaBucket<PagamentoNome>(
    ["Pix", "Dinheiro", "Cartão crédito", "Cartão débito", "Vale/Outros"],
    (p) => classificarPagamento(p.forma_pagamento)
  );

  // ---- PRODUTOS ----
  const linhasProdutos = [...agregadoProduto.entries()].map(([nome, v]) => ({ nome, ...v }));
  const porQtdDesc = [...linhasProdutos].sort((a, b) => b.qtd - a.qtd);
  const porQtdAsc = [...linhasProdutos].filter((p) => p.qtd > 0).sort((a, b) => a.qtd - b.qtd);
  const maiorLucro = existeCusto
    ? [...linhasProdutos].sort((a, b) => b.lucro - a.lucro)[0] || null
    : null;
  const produtosBloco = {
    top5: porQtdDesc.slice(0, 5).map((p) => ({ nome: p.nome, qtd: p.qtd, total: p.total })),
    bottom5: porQtdAsc.slice(0, 5).map((p) => ({ nome: p.nome, qtd: p.qtd, total: p.total })),
    maiorLucro: maiorLucro ? { nome: maiorLucro.nome, lucro: maiorLucro.lucro, qtd: maiorLucro.qtd } : null,
  };

  // ---- CLIENTES ----
  const porChave = new Map<string, { nome: string; instantes: { t: number; total: number }[] }>();
  for (const p of validos) {
    const chave = chaveCliente(p);
    if (!chave) continue;
    const reg = porChave.get(chave) || { nome: nomeCliente(p), instantes: [] };
    reg.instantes.push({ t: new Date(p.created_at).getTime(), total: Number(p.total) });
    if (reg.nome === "Cliente") reg.nome = nomeCliente(p);
    porChave.set(chave, reg);
  }
  let novos = 0, voltaram = 0, pararam = 0, ativos = 0;
  let top: { nome: string; qtd: number; total: number } | null = null;
  for (const { nome, instantes } of porChave.values()) {
    const noPeriodo = instantes.filter((i) => i.t >= inicio && i.t < fim);
    const antesDoPeriodo = instantes.some((i) => i.t < inicio);
    const primeira = Math.min(...instantes.map((i) => i.t));
    const noAnterior = instantes.some((i) => i.t >= inicioAnterior && i.t < fimAnterior);
    if (noPeriodo.length) {
      ativos++;
      if (primeira >= inicio && primeira < fim) novos++;
      if (antesDoPeriodo) voltaram++;
      const somaPeriodo = noPeriodo.reduce((s, i) => s + i.total, 0);
      if (!top || somaPeriodo > top.total) top = { nome, qtd: noPeriodo.length, total: somaPeriodo };
    } else if (noAnterior) {
      pararam++;
    }
  }

  // ---- HORÁRIOS ----
  const pico = maiorPor((p) => new Date(p.created_at).getHours(), doPeriodo);
  const diaSem = maiorPor((p) => new Date(p.created_at).getDay(), doPeriodo);
  const horarios = {
    picoHora: pico ? `${String(pico.chave).padStart(2, "0")}h` : null,
    melhorDiaSemana: diaSem ? diaSemana[Number(diaSem.chave)] : null,
  };

  return {
    resumo,
    canais,
    pagamentos,
    produtos: produtosBloco,
    clientes: { novos, voltaram, pararam, ativos, top },
    horarios,
  };
}

// ---- HTML limpo (A4) ----
function esc(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

function tabelaLinhas(linhas: Linha[]): string {
  if (linhas.every((l) => l.qtd === 0 && l.total === 0))
    return `<p class="vazio">Sem vendas neste período.</p>`;
  return `<table><thead><tr><th>Forma</th><th class="n">Qtd</th><th class="n">Total</th><th class="n">Ticket médio</th></tr></thead><tbody>
    ${linhas
      .map(
        (l) =>
          `<tr><td>${esc(l.rotulo)}</td><td class="n">${l.qtd}</td><td class="n">${brl(l.total)}</td><td class="n">${brl(l.ticket)}</td></tr>`
      )
      .join("")}
  </tbody></table>`;
}

function tabelaProdutos(rows: { nome: string; qtd: number; total: number }[]): string {
  if (!rows.length) return `<p class="vazio">Nenhum produto vendido.</p>`;
  return `<table><thead><tr><th>Produto</th><th class="n">Qtd</th><th class="n">Total</th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td>${esc(p.nome)}</td><td class="n">${p.qtd}</td><td class="n">${brl(p.total)}</td></tr>`).join("")}
  </tbody></table>`;
}

export function renderHtmlRelatorio(
  r: RelatorioImpressao,
  meta: { nomeLoja: string; periodo: string }
): string {
  const lucroTxt = r.resumo.lucroBruto === null ? "—" : brl(r.resumo.lucroBruto);
  const css = `
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:0}
    .doc{padding:16px 18px}
    h1{font-size:18px;margin:0}h2{font-size:13px;margin:16px 0 6px;border-bottom:2px solid #111;padding-bottom:3px}
    .topo{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:4px}
    .periodo{font-size:14px;font-weight:bold}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:4px}
    th,td{padding:5px 6px;border-bottom:1px solid #ccc;text-align:left}
    th{background:#f0f0f0}td.n,th.n{text-align:right}
    .cards{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
    .card{flex:1 1 28%;border:1px solid #bbb;border-radius:6px;padding:8px}
    .card .k{font-size:10px;text-transform:uppercase;color:#555}
    .card .v{font-size:16px;font-weight:bold;margin-top:3px}
    .vazio{color:#777;font-size:12px;margin:2px 0}
    .grid{display:flex;gap:14px}.grid>div{flex:1}
    .foot{margin-top:14px;font-size:10px;color:#666;text-align:center}
    @page{size:A4;margin:12mm}
  `;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Relatório ${esc(meta.periodo)} - ${esc(meta.nomeLoja)}</title><style>${css}</style></head>
    <body><div class="doc">
      <div class="topo"><h1>${esc(meta.nomeLoja)}</h1><div class="periodo">${esc(meta.periodo)}</div></div>

      <h2>1. Resumo</h2>
      <div class="cards">
        <div class="card"><div class="k">Total vendido</div><div class="v">${brl(r.resumo.totalVendido)}</div></div>
        <div class="card"><div class="k">Qtd pedidos</div><div class="v">${r.resumo.qtdPedidos}</div></div>
        <div class="card"><div class="k">Ticket médio</div><div class="v">${brl(r.resumo.ticketMedio)}</div></div>
        <div class="card"><div class="k">Lucro bruto</div><div class="v">${lucroTxt}</div></div>
        <div class="card"><div class="k">Dia que mais vendeu</div><div class="v">${r.resumo.melhorDia ? esc(r.resumo.melhorDia.rotulo) + " · " + brl(r.resumo.melhorDia.total) : "—"}</div></div>
        <div class="card"><div class="k">Horário de pico / Dia forte</div><div class="v">${esc(r.horarios.picoHora || "—")} · ${esc(r.horarios.melhorDiaSemana || "—")}</div></div>
      </div>

      <h2>2. Por canal</h2>
      ${tabelaLinhas(r.canais)}

      <h2>3. Pagamento</h2>
      ${tabelaLinhas(r.pagamentos)}

      <h2>4. Produtos</h2>
      <div class="grid">
        <div><p><b>Top 5 mais vendidos</b></p>${tabelaProdutos(r.produtos.top5)}</div>
        <div><p><b>Top 5 menos vendidos</b></p>${tabelaProdutos(r.produtos.bottom5)}</div>
      </div>
      <p style="font-size:12px;margin-top:6px"><b>Maior lucro:</b> ${
        r.produtos.maiorLucro
          ? `${esc(r.produtos.maiorLucro.nome)} — ${brl(r.produtos.maiorLucro.lucro)} (${r.produtos.maiorLucro.qtd} un.)`
          : "— (custo não cadastrado nos produtos)"
      }</p>

      <h2>5. Clientes</h2>
      <div class="cards">
        <div class="card"><div class="k">Novos (1ª compra)</div><div class="v">${r.clientes.novos}</div></div>
        <div class="card"><div class="k">Voltaram</div><div class="v">${r.clientes.voltaram}</div></div>
        <div class="card"><div class="k">Pararam</div><div class="v">${r.clientes.pararam}</div></div>
        <div class="card"><div class="k">Total ativos</div><div class="v">${r.clientes.ativos}</div></div>
      </div>
      <p style="font-size:12px"><b>Cliente que mais comprou:</b> ${
        r.clientes.top
          ? `${esc(r.clientes.top.nome)} — ${r.clientes.top.qtd} pedido(s), ${brl(r.clientes.top.total)}`
          : "—"
      }</p>

      <h2>6. Horários</h2>
      <div class="cards">
        <div class="card"><div class="k">Horário de pico</div><div class="v">${esc(r.horarios.picoHora || "—")}</div></div>
        <div class="card"><div class="k">Dia da semana que mais vende</div><div class="v">${esc(r.horarios.melhorDiaSemana || "—")}</div></div>
      </div>

      <div class="foot">Gerado em ${new Date().toLocaleString("pt-BR")} · Ponto De Vendas Harley Systems</div>
    </div></body></html>`;
}
