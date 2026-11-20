const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function carregar(relativePath) {
  const filename = path.join(__dirname, "..", relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}

const { classificarCanal, classificarPagamento, montarRelatorio, renderHtmlRelatorio } =
  carregar("lib/relatorio-impressao.ts");

// Data/hora local (sem fuso) para o cálculo ser independente do timezone da máquina.
function iso(y, m, d, h = 0) {
  const p = (n) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}T${p(h)}:00:00`;
}
const ts0 = (y, m, d) => new Date(y, m - 1, d).getTime();

// ---- classificação ----
test("classifica canal a partir de type e origem", () => {
  assert.equal(classificarCanal({ type: "delivery", origem: "PDV" }), "Entrega");
  assert.equal(classificarCanal({ type: "mesa", origem: "PDV" }), "Mesa");
  assert.equal(classificarCanal({ type: "balcao", origem: "PDV" }), "Retirada");
  assert.equal(classificarCanal({ type: "delivery", origem: "WhatsApp" }), "WhatsApp/Bot");
  assert.equal(classificarCanal({ type: "balcao", origem: "Bot automático" }), "WhatsApp/Bot");
});

test("classifica pagamento com acentos e variações", () => {
  assert.equal(classificarPagamento("Pix"), "Pix");
  assert.equal(classificarPagamento("dinheiro"), "Dinheiro");
  assert.equal(classificarPagamento("Cartão de Crédito"), "Cartão crédito");
  assert.equal(classificarPagamento("cartão débito"), "Cartão débito");
  assert.equal(classificarPagamento("Vale refeição"), "Vale/Outros");
  assert.equal(classificarPagamento(null), "Vale/Outros");
});

// ---- cenário real ----
const pedidos = [
  { id: "o1", type: "delivery", status: "entregue", total: 50, created_at: iso(2026, 11, 5, 14), forma_pagamento: "Pix", customer_name: "Ana", telefone: "11988887777", origem: "PDV" },
  { id: "o2", type: "balcao", status: "entregue", total: 30, created_at: iso(2026, 11, 5, 14), forma_pagamento: "Dinheiro", customer_name: "Bruno", telefone: "21977776666", origem: "PDV" },
  { id: "o3", type: "mesa", status: "entregue", total: 70, created_at: iso(2026, 11, 10, 20), forma_pagamento: "Cartão de crédito", customer_name: "Carla", telefone: "31966665555", origem: "PDV" },
  { id: "o4", type: "delivery", status: "entregue", total: 40, created_at: iso(2026, 11, 10, 20), forma_pagamento: "Pix", customer_name: "Ana", telefone: "11988887777", origem: "WhatsApp" },
  // fora do período (outubro): Diego para; Ana já é antiga
  { id: "o5", type: "delivery", status: "entregue", total: 25, created_at: iso(2026, 10, 10, 12), forma_pagamento: "Dinheiro", customer_name: "Diego", telefone: "41955554444", origem: "PDV" },
  { id: "o6", type: "balcao", status: "entregue", total: 20, created_at: iso(2026, 10, 3, 12), forma_pagamento: "Dinheiro", customer_name: "Ana", telefone: "11988887777", origem: "PDV" },
  // cancelado no período: não entra
  { id: "o7", type: "mesa", status: "cancelado", total: 999, created_at: iso(2026, 11, 6, 15), forma_pagamento: "Pix", customer_name: "Zeca", telefone: "51944443333", origem: "PDV" },
];

const produtos = [
  { id: "p1", name: "X-Burger", cost: 10 },
  { id: "p2", name: "Suco", cost: 3 },
  { id: "p3", name: "Batata", cost: 5 },
];

const itens = [
  { order_id: "o1", product_id: "p1", qty: 2, price: 20, cost: 10 }, // 40 / lucro 20
  { order_id: "o2", product_id: "p2", qty: 1, price: 8, cost: 3 },   // 8  / lucro 5
  { order_id: "o3", product_id: "p3", qty: 3, price: 10, cost: 5 },  // 30 / lucro 15
  { order_id: "o4", product_id: "p1", qty: 1, price: 40, cost: 10 }, // 40 / lucro 30
  { order_id: "o7", product_id: "p1", qty: 9, price: 99, cost: 1 },  // cancelado: ignorado
];

const periodo = (y, m) => {
  const ini = new Date(y, m - 1, 1);
  const fim = new Date(y, m, 1);
  const iniAnt = new Date(y, m - 2, 1);
  const fimAnt = new Date(y, m - 1, 1);
  return { inicio: ini.getTime(), fim: fim.getTime(), inicioAnterior: iniAnt.getTime(), fimAnterior: fimAnt.getTime() };
};

const r = montarRelatorio({ pedidos, itens, produtos, ...periodo(2026, 11) });

test("resumo: total, qtd, ticket e melhor dia (cancelado excluído)", () => {
  assert.equal(r.resumo.totalVendido, 190); // 50+30+70+40
  assert.equal(r.resumo.qtdPedidos, 4);
  assert.equal(r.resumo.ticketMedio, 47.5);
  assert.equal(r.resumo.lucroBruto, 70); // 20+5+15+30
  assert.equal(r.resumo.melhorDia.rotulo, "10/11");
  assert.equal(r.resumo.melhorDia.total, 110);
});

test("canais: o pedido com origem WhatsApp sai de Entrega", () => {
  const por = Object.fromEntries(r.canais.map((c) => [c.rotulo, c]));
  assert.equal(por["Entrega"].qtd, 1);
  assert.equal(por["Entrega"].total, 50);
  assert.equal(por["WhatsApp/Bot"].qtd, 1);
  assert.equal(por["Mesa"].total, 70);
  assert.equal(por["Retirada"].total, 30);
});

test("pagamentos somam por forma", () => {
  const por = Object.fromEntries(r.pagamentos.map((c) => [c.rotulo, c]));
  assert.equal(por["Pix"].total, 90);
  assert.equal(por["Pix"].qtd, 2);
  assert.equal(por["Dinheiro"].total, 30);
  assert.equal(por["Cartão crédito"].total, 70);
  assert.equal(por["Cartão débito"].qtd, 0);
});

test("produtos: top, piores e maior lucro", () => {
  assert.equal(r.produtos.top5.length, 3);
  assert.equal(r.produtos.top5[0].qtd, 3);
  assert.equal(r.produtos.bottom5[0].nome, "Suco");
  assert.equal(r.produtos.maiorLucro.nome, "X-Burger");
  assert.equal(r.produtos.maiorLucro.lucro, 50);
});

test("clientes: novos, voltaram, pararam, ativos e top", () => {
  assert.equal(r.clientes.ativos, 3); // Ana, Bruno, Carla
  assert.equal(r.clientes.novos, 2);  // Bruno, Carla
  assert.equal(r.clientes.voltaram, 1); // Ana (comprou em outubro também)
  assert.equal(r.clientes.pararam, 1);  // Diego (só outubro)
  assert.equal(r.clientes.top.nome, "Ana");
  assert.equal(r.clientes.top.total, 90);
  assert.equal(r.clientes.top.qtd, 2);
});

test("horários: pico e dia da semana de maior venda", () => {
  assert.equal(r.horarios.picoHora, "20h"); // 110 > 80 às 14h
  const nomes = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  assert.equal(r.horarios.melhorDiaSemana, nomes[new Date(iso(2026, 11, 10)).getDay()]);
});

test("sem custo cadastrado => lucro bruto null e sem maior lucro", () => {
  const semCusto = montarRelatorio({
    pedidos,
    itens: itens.map((i) => ({ ...i, cost: 0 })),
    produtos: produtos.map((p) => ({ id: p.id, name: p.name })),
    ...periodo(2026, 11),
  });
  assert.equal(semCusto.resumo.lucroBruto, null);
  assert.equal(semCusto.produtos.maiorLucro, null);
});

test("período vazio => zeros e nada de null quebrar", () => {
  const vazio = montarRelatorio({ pedidos, itens, produtos, ...periodo(2020, 1) });
  assert.equal(vazio.resumo.qtdPedidos, 0);
  assert.equal(vazio.resumo.ticketMedio, 0);
  assert.equal(vazio.resumo.melhorDia, null);
  assert.equal(vazio.clientes.top, null);
  assert.equal(vazio.horarios.picoHora, null);
});

test("html limpo: cabeçalho loja + período, 6 blocos, sem botões do app", () => {
  const html = renderHtmlRelatorio(r, { nomeLoja: "Burger da Praça", periodo: "Novembro/2026" });
  assert.match(html, /Burger da Praça/);
  assert.match(html, /Novembro\/2026/);
  ["1. Resumo", "2. Por canal", "3.", "4.", "5.", "6."].forEach((s) => assert.ok(html.includes(s), s));
  assert.doesNotMatch(html, /Imprimir \/ Salvar PDF/); // botão do app não vai para o papel
  assert.doesNotMatch(html, /<nav|menu-lateral/);
});

test("html escapa conteúdo do cliente (anti-XSS)", () => {
  const sujo = montarRelatorio({
    pedidos: [{ id: "x", type: "mesa", status: "entregue", total: 10, created_at: iso(2026, 11, 5, 12), forma_pagamento: "Pix", customer_name: "<script>alert(1)</script>", telefone: "11900000000" }],
    itens: [],
    produtos: [],
    ...periodo(2026, 11),
  });
  const html = renderHtmlRelatorio(sujo, { nomeLoja: "<b>Loja</b>", periodo: "Novembro/2026" });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("<b>Loja</b>"));
  assert.match(html, /&lt;script&gt;/);
});
