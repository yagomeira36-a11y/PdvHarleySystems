const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function carregar(relativePath, mocks = {}) {
  const filename = path.join(__dirname, "..", relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : Module.prototype.require.call(loaded, id);
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}

const loja = {
  id: "00000000-0000-4000-8000-000000000001",
  nome_loja: "Loja teste",
  email_dono: "teste@example.com",
  data_vencimento: "2026-01-01",
  status_pagamento: "vencido",
  asaas_customer_id: "cus_antigo",
  asaas_subscription_id: "sub_antiga",
};
const cliente = { id: "cus_atual", name: "Loja teste", email: "teste@example.com" };
const assinatura = { id: "sub_atual", customer: cliente.id, status: "ACTIVE", nextDueDate: "2026-12-19" };
const pagamento = {
  id: "pay_atual", customer: cliente.id, subscription: assinatura.id,
  status: "PENDING", billingType: "BOLETO", value: 49.99, dueDate: "2026-11-19",
  invoiceUrl: "/fatura", bankSlipUrl: "/boleto",
};

function mockAsaas(t, responder) {
  const originalFetch = global.fetch;
  const chave = process.env.ASAAS_API_KEY;
  const urlApi = process.env.ASAAS_API_URL;
  process.env.ASAAS_API_KEY = "chave-somente-teste";
  process.env.ASAAS_API_URL = "https://api.asaas.com/v3";
  const chamadas = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const chamada = { path: url.pathname.replace(/^\/v3/, ""), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null, url };
    chamadas.push(chamada);
    const resultado = await responder(chamada);
    if (resultado === undefined) throw new Error("Chamada não simulada: " + chamada.method + " " + chamada.path);
    return resultado instanceof Response ? resultado : Response.json(resultado);
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (chave === undefined) delete process.env.ASAAS_API_KEY; else process.env.ASAAS_API_KEY = chave;
    if (urlApi === undefined) delete process.env.ASAAS_API_URL; else process.env.ASAAS_API_URL = urlApi;
  });
  return { api: carregar("lib/asaas.ts"), chamadas };
}

function banco(dados = { ...loja }) {
  const gravacoes = [];
  let leituras = 0;
  return {
    gravacoes,
    get leituras() { return leituras; },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { leituras++; return { data: dados, error: null }; },
      };
    },
    async rpc(nome, args) { gravacoes.push({ nome, args }); return { error: null }; },
  };
}

function rota(relativePath, db, asaas) {
  return carregar(relativePath, { "@/lib/supabase": { getSupabase: () => db }, "@/lib/asaas": asaas });
}

function req(corpo) {
  return new Request("http://localhost/api/asaas/gerar-cobranca", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
}

const naoEncontrado = () => Response.json({ errors: [{ description: "Não encontrado" }] }, { status: 404 });

test("recupera cliente e assinatura da conta atual sem exigir CPF novamente", async (t) => {
  const { api, chamadas } = mockAsaas(t, ({ path }) => {
    if (path === "/customers/cus_antigo" || path === "/subscriptions/sub_antiga") return naoEncontrado();
    if (path === "/customers") return { data: [cliente] };
    if (path === "/subscriptions") return { data: [assinatura] };
  });
  assert.deepEqual(await api.garantirVinculoAsaas(loja, ""), { clienteId: cliente.id, assinaturaId: assinatura.id });
  assert.equal(chamadas.some((c) => c.method !== "GET"), false);
  assert.equal(chamadas.find((c) => c.path === "/customers").url.searchParams.get("externalReference"), loja.id);
});

test("recupera cadastro pela referência mesmo sem IDs salvos", async (t) => {
  const { api, chamadas } = mockAsaas(t, ({ path }) => {
    if (path === "/customers") return { data: [cliente] };
    if (path === "/subscriptions") return { data: [assinatura] };
  });
  const resultado = await api.garantirVinculoAsaas({ ...loja, asaas_customer_id: null, asaas_subscription_id: null }, "");
  assert.equal(resultado.clienteId, cliente.id);
  assert.equal(chamadas.filter((c) => c.method === "POST").length, 0);
});

test("documento ausente solicita cadastro sem criar cliente ou cobrança", async (t) => {
  const { api, chamadas } = mockAsaas(t, ({ path }) => {
    if (path === "/customers/cus_antigo") return naoEncontrado();
    if (path === "/customers") return { data: [] };
  });
  assert.deepEqual(await api.garantirVinculoAsaas(loja, ""), { requerCpf: true });
  assert.equal(chamadas.filter((c) => c.method === "POST").length, 0);
});

test("CPF informado cria cliente atual e assinatura para Pix e boleto", async (t) => {
  const { api, chamadas } = mockAsaas(t, ({ path, method }) => {
    if (path === "/customers/cus_antigo" || path === "/subscriptions/sub_antiga") return naoEncontrado();
    if (path === "/customers") return method === "POST" ? cliente : { data: [] };
    if (path === "/subscriptions") return method === "POST" ? assinatura : { data: [] };
  });
  assert.deepEqual(await api.garantirVinculoAsaas(loja, "12345678909"), { clienteId: cliente.id, assinaturaId: assinatura.id });
  assert.equal(chamadas.find((c) => c.path === "/customers" && c.method === "POST").body.externalReference, loja.id);
  // UNDEFINED é o que permite mostrar o Pix (pixQrCode) e a linha do boleto
  // (identificationField) ao mesmo tempo na tela /pagamento.
  assert.equal(chamadas.find((c) => c.path === "/subscriptions" && c.method === "POST").body.billingType, "UNDEFINED");
});

test("reaproveita cliente por documento em vez de cadastrar duplicado", async (t) => {
  const { api, chamadas } = mockAsaas(t, ({ path, url }) => {
    if (path === "/customers/cus_antigo" || path === "/subscriptions/sub_antiga") return naoEncontrado();
    if (path === "/customers") return { data: url.searchParams.has("cpfCnpj") ? [cliente] : [] };
    if (path === "/subscriptions") return { data: [assinatura] };
  });
  await api.garantirVinculoAsaas(loja, "12345678909");
  assert.equal(chamadas.some((c) => c.method === "POST"), false);
});

test("ignora cliente excluído e assinatura de outro cliente", async (t) => {
  const { api } = mockAsaas(t, ({ path }) => {
    if (path === "/customers/cus_antigo") return { ...cliente, id: "cus_antigo", deleted: true };
    if (path === "/customers") return { data: [{ ...cliente, id: "cus_excluido", deleted: true }, cliente] };
    if (path === "/subscriptions/sub_antiga") return { ...assinatura, customer: "cus_outro" };
    if (path === "/subscriptions") return { data: [assinatura] };
  });
  assert.equal((await api.garantirVinculoAsaas(loja, "")).assinaturaId, assinatura.id);
});

test("erro de autenticação não é tratado como cliente inexistente", async (t) => {
  const { api, chamadas } = mockAsaas(t, () => Response.json({ errors: [{ description: "Chave inválida" }] }, { status: 401 }));
  await assert.rejects(api.garantirVinculoAsaas(loja, "12345678909"), (e) => e instanceof api.ErroAsaas && e.status === 401);
  assert.equal(chamadas.length, 1);
});

test("reutiliza a cobrança da assinatura sem criar uma cobrança avulsa", async (t) => {
  const { api, chamadas } = mockAsaas(t, ({ path }) => {
    if (path === "/payments") return { data: [] };
    if (path === "/subscriptions/sub_atual/payments") return { data: [pagamento] };
    if (path === "/subscriptions/sub_atual") return assinatura;
  });
  const resultado = await api.criarCobrancaMensalAsaas({ clienteId: cliente.id, assinaturaId: assinatura.id, lojaId: loja.id, vencimento: loja.data_vencimento });
  assert.equal(resultado.id, pagamento.id);
  assert.equal(chamadas.some((c) => c.method !== "GET"), false);
});

test("não mostra fatura paga e prioriza a mensalidade mais antiga em aberto", async (t) => {
  const { api } = mockAsaas(t, ({ path }) => {
    if (path === "/payments") return { data: [{ ...pagamento, id: "pay_paga", status: "RECEIVED" }] };
    if (path.endsWith("/payments")) return { data: [pagamento, { ...pagamento, id: "pay_atrasada", status: "OVERDUE", dueDate: "2026-10-19" }] };
  });
  assert.equal((await api.buscarCobrancaAberta(cliente.id, loja.id, assinatura.id)).id, "pay_atrasada");
});

test("lista somente de faturas pagas não retorna cobrança para pagamento", async (t) => {
  const { api } = mockAsaas(t, () => ({ data: [{ ...pagamento, status: "CONFIRMED" }] }));
  assert.equal(await api.buscarCobrancaAberta(cliente.id, loja.id, assinatura.id), null);
});

test("cobrança pendente UNDEFINED é mantida sem reconfigurar o pagamento", async (t) => {
  const { api, chamadas } = mockAsaas(t, ({ path }) => {
    if (path === "/payments") return { data: [] };
    if (path.endsWith("/payments")) return { data: [{ ...pagamento, billingType: "UNDEFINED", bankSlipUrl: null }] };
    if (path === "/subscriptions/sub_atual") return assinatura;
  });
  const resultado = await api.criarCobrancaMensalAsaas({ clienteId: cliente.id, assinaturaId: assinatura.id, lojaId: loja.id, vencimento: null });
  // A tela /pagamento obtém Pix (pixQrCode) e boleto (identificationField) da
  // cobrança UNDEFINED, então ela é reaproveitada sem nenhum POST ou PUT.
  assert.equal(resultado.id, pagamento.id);
  assert.equal(chamadas.some((c) => c.method === "POST" || c.method === "PUT"), false);
});

test("sem parcela emitida cria apenas uma cobrança e ajusta o próximo vencimento", async (t) => {
  let criada = null;
  let atualizada = { ...assinatura, nextDueDate: "2026-01-01" };
  const { api, chamadas } = mockAsaas(t, ({ path, method, body }) => {
    // O Asaas real devolve a cobrança com os campos enviados no POST.
    if (path === "/payments" && method === "POST") return criada = { ...pagamento, subscription: null, billingType: body.billingType, externalReference: body.externalReference, dueDate: body.dueDate };
    if (path === "/payments") return { data: criada ? [criada] : [] };
    if (path.endsWith("/payments")) return { data: [] };
    if (path === "/subscriptions/sub_atual") {
      if (method === "PUT") atualizada = { ...atualizada, ...body };
      return atualizada;
    }
  });
  const dados = { clienteId: cliente.id, assinaturaId: assinatura.id, lojaId: loja.id, vencimento: "2026-01-01" };
  const primeira = await api.criarCobrancaMensalAsaas(dados);
  const segunda = await api.criarCobrancaMensalAsaas(dados);
  assert.equal(primeira.id, segunda.id);
  assert.equal(chamadas.filter((c) => c.method === "POST").length, 1);
  assert.equal(chamadas.filter((c) => c.method === "PUT").length, 1);
  assert.equal(chamadas.find((c) => c.method === "POST").body.billingType, "UNDEFINED");
});

test("requisições simultâneas compartilham uma única preparação", async () => {
  const db = banco();
  let vinculacoes = 0;
  let cobrancas = 0;
  const { POST } = rota("app/api/asaas/gerar-cobranca/route.ts", db, {
    async garantirVinculoAsaas() { vinculacoes++; return { clienteId: cliente.id, assinaturaId: assinatura.id }; },
    async criarCobrancaMensalAsaas() { cobrancas++; return pagamento; },
  });
  const respostas = await Promise.all([POST(req({ loja: loja.id })), POST(req({ loja: loja.id }))]);
  assert.ok(respostas.every((r) => r.status === 200));
  assert.equal(vinculacoes, 1);
  assert.equal(cobrancas, 1);
  assert.equal(db.leituras, 1);
  assert.equal(db.gravacoes.length, 1);
  assert.equal(db.gravacoes[0].args.p_customer_id, cliente.id);
  assert.equal(db.gravacoes[0].args.p_subscription_id, assinatura.id);
});

test("rota retorna requerCpf e não persiste IDs inválidos", async () => {
  const db = banco();
  const { POST } = rota("app/api/asaas/gerar-cobranca/route.ts", db, {
    garantirVinculoAsaas: async () => ({ requerCpf: true }),
    criarCobrancaMensalAsaas: async () => assert.fail("Não deve criar cobrança"),
  });
  const resposta = await POST(req({ loja: loja.id }));
  assert.equal(resposta.status, 409);
  assert.equal((await resposta.json()).requerCpf, true);
  assert.equal(db.gravacoes.length, 0);
});

test("erro de salvamento impede criação de cobrança e permite nova tentativa", async () => {
  const db = banco();
  let falhar = true;
  db.rpc = async () => ({ error: falhar ? { message: "Falha simulada" } : null });
  let cobrancas = 0;
  const { POST } = rota("app/api/asaas/gerar-cobranca/route.ts", db, {
    garantirVinculoAsaas: async () => ({ clienteId: cliente.id, assinaturaId: assinatura.id }),
    criarCobrancaMensalAsaas: async () => { cobrancas++; return pagamento; },
  });
  assert.equal((await POST(req({ loja: loja.id }))).status, 502);
  assert.equal(cobrancas, 0);
  falhar = false;
  assert.equal((await POST(req({ loja: loja.id }))).status, 200);
  assert.equal(cobrancas, 1);
});

test("loja inexistente e documento inválido retornam status correto", async () => {
  const { POST } = rota("app/api/asaas/gerar-cobranca/route.ts", banco(null), {});
  assert.equal((await POST(req({ loja: loja.id }))).status, 404);
  assert.equal((await POST(req({ loja: loja.id, cpfCnpj: "123" }))).status, 400);
  assert.equal((await POST(req({}))).status, 400);
});

for (const falha of [null, "pix", "boleto"]) {
  test(`consulta entrega Pix e boleto independentemente (falha: ${falha})`, async () => {
    const db = banco({ ...loja, asaas_customer_id: cliente.id, asaas_subscription_id: assinatura.id });
    const { GET } = rota("app/api/asaas/cobranca/route.ts", db, {
      VALOR_MENSALIDADE: 49.99,
      buscarCobrancaAberta: async (...args) => { assert.deepEqual(args, [cliente.id, loja.id, assinatura.id]); return pagamento; },
      buscarPixAsaas: async () => { if (falha === "pix") throw new Error("Pix indisponível"); return { encodedImage: "imagem", payload: "codigo-pix" }; },
      buscarBoletoAsaas: async () => { if (falha === "boleto") throw new Error("Boleto indisponível"); return { identificationField: "linha-boleto", barCode: "codigo-barras" }; },
    });
    const resposta = await GET(new Request(`http://localhost/api/asaas/cobranca?loja=${loja.id}`));
    assert.equal(resposta.status, 200);
    const corpo = await resposta.json();
    assert.equal(corpo.pix?.copiaECola ?? null, falha === "pix" ? null : "codigo-pix");
    assert.equal(corpo.boleto?.linhaDigitavel ?? null, falha === "boleto" ? null : "linha-boleto");
    assert.equal(corpo.cobranca.linkBoleto, pagamento.bankSlipUrl);
    assert.equal(Boolean(corpo.pixErro), falha === "pix");
    assert.equal(Boolean(corpo.boletoErro), falha === "boleto");
  });
}

test("webhook de cobrança avulsa renova vencimento usando assinatura salva", async (t) => {
  const token = process.env.ASAAS_WEBHOOK_TOKEN;
  process.env.ASAAS_WEBHOOK_TOKEN = "token-teste-local";
  t.after(() => { if (token === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN; else process.env.ASAAS_WEBHOOK_TOKEN = token; });
  const db = banco({ id: loja.id, asaas_subscription_id: assinatura.id });
  const { POST } = rota("app/api/webhook-asaas/route.ts", db, {
    buscarAssinaturaAsaas: async (id) => { assert.equal(id, assinatura.id); return assinatura; },
  });
  const resposta = await POST(new Request("http://localhost/api/webhook-asaas", {
    method: "POST", headers: { "Content-Type": "application/json", "asaas-access-token": "token-teste-local" },
    body: JSON.stringify({ event: "PAYMENT_RECEIVED", payment: { customer: cliente.id, subscription: null, externalReference: `pdvdg-mensalidade-${loja.id}` } }),
  }));
  assert.equal(resposta.status, 200);
  assert.equal(db.gravacoes[0].args.p_status, "ativo");
  assert.equal(db.gravacoes[0].args.p_vencimento, assinatura.nextDueDate);
});
