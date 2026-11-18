const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const arquivo = path.resolve(__dirname, "..", "lib", "cardapio-foto.ts");
const codigo = ts.transpileModule(fs.readFileSync(arquivo, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const modulo = { exports: {} };
vm.runInNewContext(
  codigo,
  {
    module: modulo,
    exports: modulo.exports,
    require,
    console,
    Promise,
    Uint8Array,
    Float64Array,
    Uint32Array,
    Math,
  },
  { filename: arquivo }
);

const { extrairItens } = modulo.exports;

test("extrai itens do texto OCR contínuo do cardápio", () => {
  const texto =
    "X- Burger SERRADA 8 00 ... Pão, Carne, Queijo, Salada, Maionese Verde e Ketchup ... X-Bacon TERRENA 13,00 ... X-Calabresa 15,00 ... X- Tudo 18,00 ... Duplo-XTudo 75 00 ... Batata Turbinada - P 15,00 ... 400 de Batata, Cheddar, Calabresa e Farofa de Bacon";
  const itens = extrairItens(texto);

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        itens.map((item) => [
          item.nome,
          item.preco.toFixed(2).replace(".", ","),
        ])
      )
    ),
    [
      ["X-Burger", "8,00"],
      ["X-Bacon", "13,00"],
      ["X-Calabresa", "15,00"],
      ["X-Tudo", "18,00"],
      ["Duplo-XTudo", "28,00"],
      ["Batata Turbinada - P", "15,00"],
    ]
  );
  assert.match(itens[0].descricao, /Pão, Carne/);
  assert.doesNotMatch(itens[0].descricao, /X-Bacon/);
  assert.match(itens[5].descricao, /Batata, Cheddar/);
});

test("corrige erros comuns do OCR nas descrições", () => {
  const [item] = extrairItens("X-Burger 10,00 Pio, Ow e Carne");
  assert.equal(item.descricao, "Pão, Ovo e Carne");
});
