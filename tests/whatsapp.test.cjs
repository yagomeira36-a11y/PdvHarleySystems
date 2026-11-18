const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "lib", "whatsapp", "logic.ts");
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
const {
  isFinishItemsMessage,
  isGreetingMessage,
  isMenuRequest,
  normalizeEvolutionEvent,
  ownerManualReplyIsRecent,
  parseAddressFields,
  parseCashChange,
  parseOrderConfirmation,
  parsePaymentMethod,
} = loaded.exports;
const evolutionPath = path.join(__dirname, "..", "lib", "whatsapp", "evolution.ts");
const evolutionCompiled = ts.transpileModule(fs.readFileSync(evolutionPath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
});
const evolutionModule = new Module(evolutionPath, module);
evolutionModule.filename = evolutionPath;
evolutionModule.paths = Module._nodeModulePaths(path.dirname(evolutionPath));
evolutionModule._compile(evolutionCompiled.outputText, evolutionPath);
const { evolutionWebhookConfig } = evolutionModule.exports;
const geminiPath = path.join(__dirname, "..", "lib", "whatsapp", "gemini.ts");
const geminiCompiled = ts.transpileModule(fs.readFileSync(geminiPath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
});
const geminiModule = new Module(geminiPath, module);
geminiModule.filename = geminiPath;
geminiModule.paths = Module._nodeModulePaths(path.dirname(geminiPath));
geminiModule._compile(geminiCompiled.outputText, geminiPath);
const { responderComGemini } = geminiModule.exports;

test("a recent manual reply suppresses the AI for five minutes", () => {
  const now = Date.parse("2026-11-18T13:00:00.000Z");
  assert.equal(ownerManualReplyIsRecent("2026-11-18T12:55:01.000Z", now), true);
  assert.equal(ownerManualReplyIsRecent("2026-11-18T12:55:00.000Z", now), false);
  assert.equal(ownerManualReplyIsRecent("not-a-date", now), false);
});

test("order confirmation accepts Portuguese yes/no responses", () => {
  assert.equal(parseOrderConfirmation("Sim, pode"), true);
  assert.equal(parseOrderConfirmation("NÃO"), false);
  assert.equal(parseOrderConfirmation("Qual o prazo?"), null);
});

test("order flow recognizes greetings, menu requests, and checkout completion", () => {
  assert.equal(isGreetingMessage("Oi!"), true);
  assert.equal(isMenuRequest("Me mostra o cardápio"), true);
  assert.equal(isFinishItemsMessage("Pode fechar"), true);
});

test("order flow parses payment, change, and address complement", () => {
  assert.equal(parsePaymentMethod("Dinheiro"), "Dinheiro");
  assert.deepEqual(parseCashChange("Troco para R$ 50,00"), {
    valid: true,
    amount: 50,
  });
  assert.deepEqual(parseAddressFields("Rua A, 123, complemento: casa 2"), {
    address: "Rua A, 123",
    complement: "casa 2",
  });
});

test("Evolution event names normalize across v2 payload formats", () => {
  assert.equal(normalizeEvolutionEvent("messages.upsert"), "MESSAGES_UPSERT");
  assert.equal(normalizeEvolutionEvent("CONNECTION_UPDATE"), "CONNECTION_UPDATE");
});

test("Evolution webhook uses its documented property names and authenticates events", () => {
  assert.deepEqual(evolutionWebhookConfig(
    "https://app.example/api/whatsapp/webhook",
    "secret"
  ), {
    webhook: {
      enabled: true,
      url: "https://app.example/api/whatsapp/webhook",
      byEvents: false,
      base64: false,
      headers: {
        "x-whatsapp-webhook-secret": "secret",
        "ngrok-skip-browser-warning": "true",
      },
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
    },
  });
});

test("Gemini falls back when the configured model is unavailable", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalError = console.error;
  const originalWarn = console.warn;
  const calls = [];
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "retired-model";
  console.error = () => {};
  console.warn = () => {};
  global.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"reply":"Oi!","items":[]}' }] } }],
    }), { status: 200 });
  };

  try {
    const result = await responderComGemini({
      history: [],
      message: "oi",
      storeContext: "Hamburgueria",
    });
    assert.deepEqual(result, { reply: "Oi!", items: [] });
    assert.equal(calls.length, 2);
    assert.match(calls[0], /models\/retired-model:generateContent/);
    assert.match(calls[1], /models\/gemini-3\.1-flash-lite:generateContent/);
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
    console.warn = originalWarn;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
  }
});
