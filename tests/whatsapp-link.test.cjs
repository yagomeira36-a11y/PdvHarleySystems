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

const { linkWhatsApp } = carregar("lib/supabase.ts");

test("monta wa.me com código do Brasil quando falta DDI", () => {
  assert.equal(linkWhatsApp("(11) 98888-7777"), "https://wa.me/5511988887777");
  assert.equal(linkWhatsApp("11988887777"), "https://wa.me/5511988887777");
});

test("não duplica o 55 quando o número já tem DDI", () => {
  assert.equal(linkWhatsApp("5511988887777"), "https://wa.me/5511988887777");
});

test("retorna null sem telefone válido (sem DDD)", () => {
  assert.equal(linkWhatsApp(null), null);
  assert.equal(linkWhatsApp(""), null);
  assert.equal(linkWhatsApp("12345"), null);
  assert.equal(linkWhatsApp("123456789"), null); // 9 dígitos sem DDD
});
