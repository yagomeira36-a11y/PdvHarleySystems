const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function carregarTypeScript(relativePath, mocks = {}) {
  const sourcePath = path.join(__dirname, "..", relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const loaded = new Module(sourcePath, module);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (id) => Object.prototype.hasOwnProperty.call(mocks, id)
    ? mocks[id]
    : originalRequire(id);
  loaded._compile(compiled.outputText, sourcePath);
  return loaded.exports;
}

const impressao = carregarTypeScript("lib/impressao.ts", {
  "./supabase": {
    getSessao: () => ({ id: "loja-teste", nome_loja: "Hamburgueria Teste" }),
    getSupabase: () => null,
  },
});
const escpos = carregarTypeScript("lib/escpos.ts", { "./impressao": impressao });
const config = {
  impressoraCliente: "Térmica 80",
  impressoraCozinha: "Térmica 80",
  colunas: 48,
  paginaCodigo: 2,
  rodape: "Obrigado pela preferência!",
};
const dados = {
  modeloComanda: "modelo1",
  tempoPreparo: "30 a 40 min",
  empresa: {
    nome_empresa: "Hamburgueria Teste",
    cnpj: null,
    telefone: null,
    endereco: null,
    modelo_comanda: "modelo1",
  },
  pedido: {
    id: "pedido-teste",
    numero_pedido: 42,
    total: 41,
    type: "delivery",
    status: "pendente",
    customer_name: "Ana Cliente",
    telefone: "11999999999",
    address: "Rua das Flores, 123",
    complemento: "Casa 2",
    delivery_fee: 6,
    forma_pagamento: "Dinheiro",
    observacao: "Troco para R$ 50,00",
    created_at: "2026-11-18T12:00:00.000Z",
  },
  itens: [{
    nome: "X-Bacon",
    quantidade: 2,
    preco: 17.5,
    observacao: "Sem cebola",
  }],
};

function texto(bytes) {
  return Buffer.from(bytes).toString("latin1");
}

test("the four templates produce distinct ESC/POS receipts on the selected code page", () => {
  const modelos = ["modelo1", "modelo2", "modelo3", "modelo4"];
  const cupons = modelos.map((modeloComanda) =>
    escpos.montarEscPos({ ...dados, modeloComanda }, config, "comanda")
  );
  assert.equal(new Set(cupons.map((bytes) => Buffer.from(bytes).toString("hex"))).size, 4);
  for (const bytes of cupons) {
    assert.equal(bytes[7], 2);
    assert.equal(escpos.validarBytesEscPos(bytes), true);
  }
});

test("simple and complete templates include the selected totals and order details", () => {
  const simples = texto(escpos.montarEscPos({ ...dados, modeloComanda: "modelo1" }, config, "comanda"));
  assert.match(simples, /Pedido 42/);
  assert.match(simples, /2x X-Bacon/);
  assert.match(simples, /35,00/);
  assert.match(simples, /41,00/);

  const completo = texto(escpos.montarEscPos({ ...dados, modeloComanda: "modelo2" }, config, "comanda"));
  for (const detalhe of [
    "Hamburgueria Teste",
    "Pedido 42",
    "Ana Cliente",
    "Rua das Flores, 123",
    "Subtotal",
    "Taxa:",
    "41,00",
    "Pagamento: Dinheiro",
    "30 a 40 min",
    "Obrigado!",
  ]) assert(completo.includes(detalhe), `Modelo completo deve incluir ${detalhe}`);
});

test("kitchen and delivery templates show only their relevant information", () => {
  const cozinha = texto(escpos.montarEscPos({ ...dados, modeloComanda: "modelo3" }, config, "comanda"));
  assert.match(cozinha, /Pedido 42/);
  assert.match(cozinha, /2x X-Bacon/);
  assert.match(cozinha, /Sem cebola/);
  assert.doesNotMatch(cozinha, /R\$/);
  assert.doesNotMatch(cozinha, /Rua das Flores|Pagamento|11999999999|Hamburgueria Teste/);
  assert(Buffer.from(escpos.montarEscPos(
    { ...dados, modeloComanda: "modelo3" },
    config,
    "comanda"
  )).includes(Buffer.from([0x1b, 0x21, 0x30])));

  const delivery = texto(escpos.montarEscPos({ ...dados, modeloComanda: "modelo4" }, config, "comanda"));
  for (const detalhe of [
    "Rua das Flores, 123",
    "11999999999",
    "Troco: R$ 50,00",
    "2x X-Bacon",
    "41,00",
    "Pagamento: Dinheiro",
  ]) assert(delivery.includes(detalhe), `Modelo delivery deve incluir ${detalhe}`);
  assert(Buffer.from(escpos.montarEscPos(
    { ...dados, modeloComanda: "modelo4" },
    config,
    "comanda"
  )).includes(Buffer.from([0x1b, 0x21, 0x30])));
});
