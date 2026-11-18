const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function carregarTypeScript(relativePath) {
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
  loaded._compile(compiled.outputText, sourcePath);
  return loaded.exports;
}

const { filtrarPedidosCancelados } = carregarTypeScript("lib/pedidos.ts");
const { resumirMovimentoCaixa } = carregarTypeScript("lib/caixa.ts");

test("cancellation report filters by cancellation date and preserves legacy rows", () => {
  const pedidos = [
    { id: "c1", status: "cancelado", created_at: "2026-10-31T12:00:00Z", cancelado_em: "2026-11-01T10:00:00Z" },
    { id: "c2", status: "cancelado", created_at: "2026-11-02T10:00:00Z", cancelado_em: null },
    { id: "p1", status: "pago", created_at: "2026-11-02T11:00:00Z", cancelado_em: null },
  ];

  assert.deepEqual(
    filtrarPedidosCancelados(pedidos, [
      Date.parse("2026-11-01T00:00:00Z"),
      Date.parse("2026-11-02T00:00:00Z"),
    ]).map((pedido) => pedido.id),
    ["c1"]
  );
  assert.deepEqual(
    filtrarPedidosCancelados(pedidos).map((pedido) => pedido.id),
    ["c2", "c1"]
  );
});

test("cancelled orders remain counted but are excluded from cash revenue", () => {
  const resumo = resumirMovimentoCaixa([
    { id: "p1", status: "pago", total: 25, forma_pagamento: "Dinheiro" },
    { id: "c1", status: "cancelado", total: 90, forma_pagamento: "Dinheiro" },
  ], [], []);

  const dinheiro = resumo.pagamentos.find((pagamento) => pagamento.nome === "Dinheiro");
  assert.equal(dinheiro.pedidos, 1);
  assert.equal(dinheiro.total, 25);
  assert.equal(resumo.cancelados, 1);
});
