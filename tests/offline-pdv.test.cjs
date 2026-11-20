const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { indexedDB } = require("../electron/node_modules/fake-indexeddb");

const root = path.resolve(__dirname, "..");
const code = ts.transpileModule(
  fs.readFileSync(path.join(root, "lib/offline-pdv.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText;
const offlineModule = { exports: {} };
const browser = {
  indexedDB,
  navigator: { onLine: false },
  window: { dispatchEvent() {} },
  CustomEvent: class CustomEvent {
    constructor(name) { this.type = name; }
  },
};
vm.runInNewContext(code, {
  module: offlineModule,
  exports: offlineModule.exports,
  ...browser,
}, { filename: "lib/offline-pdv.ts" });

const offline = offlineModule.exports;

async function main() {
  await offline.guardarCacheOffline("loja-a", "products", [{ id: "produto-a" }]);
  assert.deepEqual(
    await offline.lerCacheOffline("loja-a", "products"),
    [{ id: "produto-a" }]
  );

  const pedido = {
    id: "00000000-0000-4000-8000-000000000001",
    total: 25,
    type: "balcao",
    status: "pendente",
    customer_name: null,
    address: null,
    delivery_fee: 0,
    forma_pagamento: "Dinheiro",
    created_at: "2026-11-20T12:00:00.000Z",
    items: [{ product_id: "produto-a", name: "Hambúrguer", qty: 1, price: 25, observacao: null }],
  };
  await offline.guardarPedidoOffline({
    id: pedido.id,
    lojaId: "loja-a",
    pedido,
    itens: [{
      id: "00000000-0000-4000-8000-000000000002",
      order_id: pedido.id,
      product_id: "produto-a",
      qty: 1,
      price: 25,
      cost: 8,
      observacao: null,
      loja_id: "loja-a",
    }],
    criadoEm: pedido.created_at,
  });
  assert.equal(await offline.contarPedidosOffline("loja-a"), 1);
  assert.equal((await offline.listarPedidosOffline("loja-a"))[0].pedido.status, "pendente");

  let consultas = 0;
  const desconectado = await offline.sincronizarPedidosOffline({
    from() { consultas += 1; throw new Error("Não deveria acessar a rede offline."); },
  }, "loja-a");
  assert.equal(consultas, 0);
  assert.equal(desconectado.sincronizados.length, 0);

  const tabelas = { orders: [], order_items: [] };
  let falharItensUmaVez = true;
  function clienteMemoria() {
    return {
      from(tabela) {
        const consulta = { filtros: [], valores: null, operacao: "" };
        return {
          select() { consulta.operacao = "select"; return this; },
          eq(chave, valor) { consulta.filtros.push([chave, valor]); return this; },
          maybeSingle: async () => ({
            data: tabelas[tabela].find((linha) =>
              consulta.filtros.every(([chave, valor]) => linha[chave] === valor)
            ) ?? null,
            error: null,
          }),
          insert(valores) { consulta.operacao = "insert"; consulta.valores = valores; return this; },
          single: async () => {
            const linha = { ...consulta.valores, numero_pedido: 1 };
            tabelas[tabela].push(linha);
            return { data: linha, error: null };
          },
          upsert: async (valores) => {
            if (tabela === "order_items" && falharItensUmaVez) {
              falharItensUmaVez = false;
              return { error: { message: "falha temporária de rede" } };
            }
            for (const valor of Array.isArray(valores) ? valores : [valores]) {
              const existente = tabelas[tabela].findIndex((linha) => linha.id === valor.id);
              if (existente === -1) tabelas[tabela].push(valor);
              else tabelas[tabela][existente] = valor;
            }
            return { error: null };
          },
        };
      },
    };
  }

  browser.navigator.onLine = true;
  const primeiraTentativa = await offline.sincronizarPedidosOffline(clienteMemoria(), "loja-a");
  assert.equal(primeiraTentativa.falhas.length, 1);
  assert.equal(tabelas.orders.length, 1);
  assert.equal(await offline.contarPedidosOffline("loja-a"), 1);

  const segundaTentativa = await offline.sincronizarPedidosOffline(clienteMemoria(), "loja-a");
  assert.equal(segundaTentativa.falhas.length, 0);
  assert.equal(segundaTentativa.sincronizados.length, 1);
  assert.equal(tabelas.orders.length, 1);
  assert.equal(tabelas.order_items.length, 1);
  assert.equal(await offline.contarPedidosOffline("loja-a"), 0);
  console.log("OK: cache local, fila offline, modo desconectado e sincronização repetível sem duplicar pedidos.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
