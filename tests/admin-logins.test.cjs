"use strict";
// ============================================================
// Testes do painel: edição de login de loja (/api/admin/editar-loja)
// e login editável do super admin (lib/admin.ts).
// ============================================================
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
  loaded.require = (id) => (Object.hasOwn(mocks, id) ? mocks[id] : Module.prototype.require.call(loaded, id));
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}

const hash = (texto) => crypto.createHash("sha256").update(texto).digest("hex");
const funcaoAusenteErro = { message: "Could not find the function public.admin_login(text, text) in the schema cache" };

// ============================================================
// Mock do builder do Supabase para a tabela "lojas"
// ============================================================
function bancoLojas({ loja, duplicada = null, erroUpdate = null }) {
  const gravacoes = [];
  return {
    gravacoes,
    from() {
      const consulta = {
        select() { return consulta; },
        eq(campo, valor) { consulta._eq = [campo, valor]; return consulta; },
        neq() { return consulta; },
        not(campo, op, valor) { consulta._not = [campo, op, valor]; return consulta; },
        ilike(campo, valor) { consulta._ilike = [campo, valor]; return consulta; },
        update(payload) { consulta._update = payload; return consulta; },
        async maybeSingle() {
          if (consulta._ilike) return { data: duplicada, error: null };
          return { data: loja, error: null };
        },
        then(resolve) {
          if (consulta._update) {
            gravacoes.push(consulta._update);
            return Promise.resolve(erroUpdate ? { error: erroUpdate } : { error: null }).then(resolve);
          }
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return consulta;
    },
  };
}

function req(corpo) {
  return new Request("http://localhost/api/admin/editar-loja", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

const rota = (db) =>
  carregar("app/api/admin/editar-loja/route.ts", {
    "@/lib/supabase": { getSupabase: () => db },
  });

test("editar-loja: e-mail inválido ou senha curta são recusados", async () => {
  const r = rota(bancoLojas({ loja: { id: "l1", email_dono: "a@a.com" } }).from ? bancoLojas({ loja: { id: "l1", email_dono: "a@a.com" } }) : null);
  let resposta = await r.POST(req({ id: "l1", email: "sem-arroba", senha: "" }));
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, /e-mail válido/);
  resposta = await r.POST(req({ id: "l1", email: "ok@ok.com", senha: "123" }));
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, /4 caracteres/);
});

test("editar-loja: loja inexistente devolve 404", async () => {
  const r = rota(bancoLojas({ loja: null }));
  const resposta = await r.POST(req({ id: "nao-existe", email: "novo@novo.com", senha: "" }));
  assert.equal(resposta.status, 404);
});

test("editar-loja: e-mail repetido de outra loja é bloqueado", async () => {
  const r = rota(bancoLojas({ loja: { id: "l1", email_dono: "a@a.com" }, duplicada: { id: "l2", nome_loja: "Concorrente" } }));
  const resposta = await r.POST(req({ id: "l1", email: "em-uso@x.com", senha: "" }));
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, /Concorrente/);
});

test("editar-loja: salva e-mail minúsculo e hash da nova senha", async () => {
  const db = bancoLojas({ loja: { id: "l1", email_dono: "a@a.com" } });
  const r = rota(db);
  const resposta = await r.POST(req({ id: "l1", email: "  Novo@X.com ", senha: "senha123" }));
  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.equal(corpo.ok, true);
  assert.equal(corpo.senhaAlterada, true);
  assert.deepEqual(db.gravacoes, [{ email_dono: "novo@x.com", senha_hash: hash("senha123") }]);
});

test("editar-loja: senha vazia mantém a atual (só muda o e-mail)", async () => {
  const db = bancoLojas({ loja: { id: "l1", email_dono: "a@a.com" } });
  const r = rota(db);
  const corpo = await (await r.POST(req({ id: "l1", email: "outro@x.com", senha: "" }))).json();
  assert.equal(corpo.senhaAlterada, false);
  assert.deepEqual(db.gravacoes, [{ email_dono: "outro@x.com" }]);
});

test("editar-loja: erro do banco ao salvar vira 500", async () => {
  const db = bancoLojas({ loja: { id: "l1", email_dono: "a@a.com" }, erroUpdate: { message: "sem permissoes" } });
  const r = rota(db);
  const resposta = await r.POST(req({ id: "l1", email: "novo@x.com", senha: "abcd" }));
  assert.equal(resposta.status, 500);
  assert.match((await resposta.json()).erro, /sem permissoes/);
});

// ============================================================
// lib/admin.ts — login do super admin editável
// ============================================================
function supabaseMock(rpcImpl) {
  return {
    rpc: async (nome, args) => rpcImpl(nome, args),
  };
}

const adminLib = (rpcImpl) =>
  carregar("lib/admin.ts", {
    "./supabase": {
      getSupabase: () => supabaseMock(rpcImpl),
      sha256Hex: async (texto) => hash(texto),
    },
  });

test("validarLoginSuperAdmin: usa o banco quando o SQL já foi rodado", async () => {
  const lib = adminLib((nome, args) => {
    assert.equal(nome, "admin_login");
    assert.equal(args.p_senha_hash, hash("minha-senha"));
    return { data: true, error: null };
  });
  assert.deepEqual(await lib.validarLoginSuperAdmin("Eu@x.com ", "minha-senha"), { ok: true });
});

test("validarLoginSuperAdmin: senha salva no banco não bate -> negado", async () => {
  const lib = adminLib(() => ({ data: false, error: null }));
  assert.deepEqual(await lib.validarLoginSuperAdmin("a@b.com", "errada"), { ok: false });
});

test("validarLoginSuperAdmin: sem o SQL, cai nas credenciais fixas", async () => {
  const lib = adminLib(() => ({ data: null, error: funcaoAusenteErro }));
  assert.equal((await lib.validarLoginSuperAdmin(lib.ADMIN_EMAIL, lib.ADMIN_SENHA)).ok, true);
  assert.equal((await lib.validarLoginSuperAdmin("outro@x.com", lib.ADMIN_SENHA)).ok, false);
});

test("validarLoginSuperAdmin: erro real do banco é mostrado, não virar negado silencioso", async () => {
  const lib = adminLib(() => ({ data: null, error: { message: "timeout connecting" } }));
  const resultado = await lib.validarLoginSuperAdmin("a@b.com", "x");
  assert.equal(resultado.ok, false);
  assert.match(resultado.erro, /Erro no banco: timeout/);
});

test("salvarLoginSuperAdmin: exige confirmação da senha atual no hash", async () => {
  let chamado = null;
  const lib = adminLib((nome, args) => {
    chamado = { nome, args };
    return { data: null, error: null };
  });
  const r = await lib.salvarLoginSuperAdmin({ senhaAtual: "atual123", novoEmail: "novo@x.com", novaSenha: "nova123" });
  assert.equal(r.ok, true);
  assert.equal(chamado.nome, "admin_definir_login");
  assert.equal(chamado.args.p_email, "novo@x.com");
  assert.equal(chamado.args.p_senha_atual_hash, hash("atual123"));
  assert.equal(chamado.args.p_senha_hash, hash("nova123"));
});

test("salvarLoginSuperAdmin: nova senha vazia manda null (mantém a atual)", async () => {
  let args = null;
  const lib = adminLib((nome, a) => { args = a; return { data: null, error: null }; });
  await lib.salvarLoginSuperAdmin({ senhaAtual: "atual123", novoEmail: "novo@x.com", novaSenha: "" });
  assert.equal(args.p_senha_hash, null);
});

test("salvarLoginSuperAdmin: sem o SQL, orienta a rodar o arquivo", async () => {
  const lib = adminLib(() => ({ data: null, error: funcaoAusenteErro }));
  const r = await lib.salvarLoginSuperAdmin({ senhaAtual: "atual123", novoEmail: "novo@x.com" });
  assert.equal(r.ok, false);
  assert.match(r.erro, /admin-super-login\.sql/);
});

test("salvarLoginSuperAdmin: senha atual incorreta devolve o erro do banco", async () => {
  const lib = adminLib(() => ({ data: null, error: { message: "Senha atual incorreta." } }));
  const r = await lib.salvarLoginSuperAdmin({ senhaAtual: "errada", novoEmail: "novo@x.com" });
  assert.equal(r.ok, false);
  assert.match(r.erro, /Senha atual incorreta/);
});

test("salvarLoginSuperAdmin: valida e-mail e tamanho da senha antes de chamar o banco", async () => {
  let chamado = 0;
  const lib = adminLib(() => { chamado++; return { data: null, error: null }; });
  assert.match((await lib.salvarLoginSuperAdmin({ senhaAtual: "x", novoEmail: "sem-arroba" })).erro, /e-mail válido/);
  assert.match((await lib.salvarLoginSuperAdmin({ senhaAtual: "x", novoEmail: "a@b.com", novaSenha: "123" })).erro, /4 caracteres/);
  assert.equal(chamado, 0);
});

test("emailSuperAdmin: usa o banco quando existe, senão a constante", async () => {
  const comBanco = adminLib((nome) => (nome === "admin_obter_email" ? { data: "chefe@x.com", error: null } : { data: null, error: funcaoAusenteErro }));
  assert.equal(await comBanco.emailSuperAdmin(), "chefe@x.com");
  const semBanco = adminLib(() => ({ data: null, error: funcaoAusenteErro }));
  assert.equal(await semBanco.emailSuperAdmin(), semBanco.ADMIN_EMAIL);
});
