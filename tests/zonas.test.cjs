const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "lib", "zonas.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = new Module(sourcePath, module);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(output, sourcePath);
const { carregarDeliveryZones, zonaParaDistancia } = loaded.exports;

test("calcula o frete usando as zonas compartilhadas da loja", async () => {
  const localStorageAnterior = global.localStorage;
  const fetchAnterior = global.fetch;
  const itensLocais = new Map();
  global.localStorage = {
    getItem: (chave) => itensLocais.get(chave) || null,
    setItem: (chave, valor) => itensLocais.set(chave, valor),
  };
  let urlSolicitada = "";
  global.fetch = async (url) => {
    urlSolicitada = url;
    return {
      ok: true,
      json: async () => ({
        delivery_center: { lat: -23.55, lng: -46.63 },
        raios: [
          { id: "zona-1", nome: "Zona 1", cor: "#22c55e", raioKm: 3, taxa: 5, ativo: true },
          { id: "zona-2", nome: "Zona 2", cor: "#3b82f6", raioKm: 5, taxa: 9, ativo: false },
        ],
      }),
    };
  };

  try {
    const config = await carregarDeliveryZones("loja-teste", false);

    assert.equal(urlSolicitada, "/api/store-settings?loja=loja-teste");
    assert.equal(config.lat, -23.55);
    assert.equal(config.lng, -46.63);
    assert.equal(zonaParaDistancia(2.9, config.zonas).taxa, 5);
    assert.equal(zonaParaDistancia(3.1, config.zonas), null);
  } finally {
    if (localStorageAnterior === undefined) delete global.localStorage;
    else global.localStorage = localStorageAnterior;
    if (fetchAnterior === undefined) delete global.fetch;
    else global.fetch = fetchAnterior;
  }
});
