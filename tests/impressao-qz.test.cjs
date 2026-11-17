const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');

function carregar(arquivo, mocks = {}, extras = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, arquivo), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (id) => id in mocks ? mocks[id] : require(id), Uint8Array, TextEncoder, Map, Set, Date, Promise, crypto: webcrypto, btoa: (v) => Buffer.from(v, 'binary').toString('base64'), ...extras }, { filename: arquivo });
  return module.exports;
}

const escpos = carregar('lib/escpos.ts');
const config = { impressoraCliente: 'Térmica 80', impressoraCozinha: 'Térmica 80', colunas: 48, paginaCodigo: 2, rodape: 'Obrigado!' };
const dados = { pedido: { id: '00000000-0000-4000-8000-000000000050', total: 35, delivery_fee: 5, type: 'delivery', status: 'pendente', customer_name: 'João', address: 'Rua São José, 1', complemento: 'Fundos', telefone: '11999999999', created_at: '2026-11-17T12:00:00Z', forma_pagamento: 'Fiado' }, empresa: { nome_empresa: 'Hambúrguer & ação', cnpj: null, telefone: null, endereco: null }, itens: [{ nome: 'Pão\x1b\x70\x00\x1d\x56\x00', quantidade: 2, preco: 15, observacao: 'Sem cebola ' + 'X'.repeat(100) }] };
const cliente = escpos.montarEscPos(dados, config, 'comprovante');
const cozinha = escpos.montarEscPos(dados, config, 'comanda');
for (const bytes of [cliente, cozinha]) {
  assert(escpos.validarBytesEscPos(bytes));
  assert.equal(Buffer.from(bytes).subarray(-7).toString('hex'), '1b64031d564103');
  assert.equal(Buffer.from(bytes).toString('binary').split('\x1d\x56\x41\x03').length - 1, 1);
  const limpo = Buffer.from(bytes).toString('binary').replace(/\x1b(?:@|[aEtM][\x00-\x13]|d\x03)/g, '').replace(/\x1dVA\x03/g, '');
  assert(limpo.split('\n').every((linha) => linha.length <= 48));
}
assert(Buffer.from(cliente).includes(Buffer.from('35,00')));
assert(Buffer.from(cliente).includes(Buffer.from('30,00')));
assert(Buffer.from(cliente).includes(Buffer.from('5,00')));
assert(!Buffer.from(cozinha).includes(Buffer.from('R$')));
assert(!Buffer.from(cozinha).includes(Buffer.from('Pagamento')));
assert(!escpos.validarBytesEscPos(Uint8Array.from([27,64,27,112,0,10,10,10,10,10,29,86,0])));
assert(!escpos.validarBytesEscPos(new Uint8Array(1024 * 1024 + 1)));
for (const paginaCodigo of [2, 3, 19]) assert(escpos.validarBytesEscPos(escpos.montarEscPos(dados, { ...config, paginaCodigo, colunas: 42 }, 'comprovante')));
const semModelo = escpos.montarEscPos({ ...dados, empresa: { nome_empresa: '  ', cnpj: null, telefone: null, endereco: null } }, { ...config, rodape: '' }, 'comprovante');
for (const texto of ['PdvDG', 'COMPROVANTE', '2x ', 'TOTAL', '35,00']) assert(Buffer.from(semModelo).includes(Buffer.from(texto)));
assert(semModelo.length > 0);
for (const alteracao of [
  b => { b[b.length - 5] = 255; },
  b => { b[b.length - 2] = 0x42; },
  b => { b[b.length - 1] = 255; },
]) {
  const bytes = cliente.slice(); alteracao(bytes);
  assert(!escpos.validarBytesEscPos(bytes));
}
assert(!escpos.validarBytesEscPos(Uint8Array.from([...cliente, ...cliente.slice(-7)])));

async function testesTransporte() {
  const store = new Map();
  let ativo = false, conectar = 0, busca = 0, failPrint = false, evento = null, fechado, impressaoNumero = 0;
  const jobs = [], logs = [];
  const detalhes = [{ name: 'Térmica 80', driver: 'Generic / Text Only' }, { name: 'Cozinha', driver: 'Generic / Text Only' }, { name: 'Termica 80mm Teste', driver: 'Microsoft Print To PDF' }, { name: 'Termica Texto', driver: 'Generic / Text Only' }];
  const qz = {
    api: { setSha256Type() {} },
    security: { setCertificatePromise() {}, setSignatureAlgorithm() {}, setSignaturePromise() {} },
    websocket: { isActive: () => ativo, connect: async () => { conectar++; ativo = true; }, setClosedCallbacks: (cb) => { fechado = cb; } },
    printers: { details: async () => { busca++; return detalhes; }, setPrinterCallbacks: (cb) => { evento = cb; }, startListening: async () => {}, stopListening: async () => {}, getStatus: async () => {} },
    configs: { create: (name, options) => ({ name, options }) },
    print: async (config, data) => { impressaoNumero++; jobs.push({ config, data }); if (failPrint === true || failPrint === impressaoNumero) throw new Error('offline teste'); },
  };
  let loja = 'loja-a', aberto = true;
  const localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const service = carregar('lib/qz.ts', {
    'qz-tray': qz,
    './supabase': { getSessao: () => ({ id: loja }) },
    './caixa': { caixaEstaAberto: () => aberto, MENSAGEM_CAIXA_FECHADO: 'Caixa fechado' },
    './impressao': { carregarDadosImpressao: async () => dados, lerImpressora: () => config, validarConfig: () => {} },
    './escpos': escpos,
  }, { localStorage, console: { info: (...args) => logs.push(args) }, navigator: { locks: { request: async (_, cb) => cb() } }, fetch: async () => ({ ok: true, json: async () => ({ configured: false, certificate: null, message: 'Sem certificado' }) }) });
  await Promise.all([service.conectarQz(), service.conectarQz()]);
  assert.equal(conectar, 1);
  await service.imprimirDadosQz(dados, config, ['comprovante', 'comanda'], true);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].config.options.copies, 1);
  assert.equal(jobs[0].data.length, 2);
  assert(jobs[0].data.every((d) => d.type === 'raw' && d.flavor === 'base64' && escpos.validarBytesEscPos(new Uint8Array(Buffer.from(d.data, 'base64')))));
  await assert.rejects(service.imprimirDadosQz(dados, config, ['comprovante', 'comanda'], true), /já teve uma tentativa/);
  assert.equal(jobs.length, 1);
  await service.imprimirDadosQz(dados, config, ['comanda']);
  assert.equal(jobs[1].data.length, 1);
  const before = new Map(store);
  await service.imprimirDadosQz({ ...dados, teste: true }, config);
  assert.deepEqual(store, before);
  evento({ printerName: 'Térmica 80', eventType: 'PRINTER', severity: 'FATAL', statusText: 'OFFLINE' });
  await assert.rejects(service.imprimirDadosQz({ ...dados, teste: true }, config), /OFFLINE/);
  evento({ printerName: 'Térmica 80', eventType: 'PRINTER', severity: 'INFO', statusText: 'OK' });
  const antesFalha = jobs.length;
  failPrint = impressaoNumero + 2;
  const outro = { ...dados, pedido: { ...dados.pedido, id: 'pedido-parcial' } };
  await assert.rejects(service.imprimirDadosQz(outro, { ...config, impressoraCozinha: 'Cozinha' }, ['comprovante', 'comanda'], true), /Já enviado: comprovante/);
  assert.equal(jobs.length, antesFalha + 2);
  const registro = JSON.parse(store.get(service.chaveRegistroImpressao(loja, outro.pedido.id)));
  assert.equal(registro.comprovante.estado, 'enviado');
  assert.equal(registro.comanda.estado, 'incerto');
  await assert.rejects(service.imprimirDadosQz(outro, config, ['comprovante', 'comanda'], true), /já teve uma tentativa/);
  failPrint = false;
  await service.imprimirDadosQz(outro, { ...config, impressoraCozinha: 'Cozinha' }, ['comanda']);
  assert.equal(jobs.at(-1).config.name, 'Cozinha');
  aberto = false;
  await assert.rejects(service.imprimirDadosQz(dados, config), /Caixa fechado/);
  aberto = true;
  await assert.rejects(service.imprimirDadosQz(dados, { ...config, impressoraCliente: 'Não existe' }), /não encontrada/);
  const beforeQuota = jobs.length;
  localStorage.setItem = () => { throw new Error('Quota'); };
  await assert.rejects(service.imprimirDadosQz({ ...dados, pedido: { ...dados.pedido, id: 'quota' } }, config), /Quota/);
  assert.equal(jobs.length, beforeQuota);
  const antesBloqueios = jobs.length;
  await assert.rejects(service.imprimirDadosQz({ ...dados, teste: true }, config, []), /Nenhum documento/);
  const montar = escpos.montarEscPos;
  escpos.montarEscPos = () => new Uint8Array();
  try { await assert.rejects(service.imprimirDadosQz({ ...dados, teste: true }, config), /Cupom vazio/); }
  finally { escpos.montarEscPos = montar; }
  await assert.rejects(service.imprimirDadosQz({ ...dados, teste: true }, { ...config, impressoraCliente: 'Termica 80mm Teste' }), /Microsoft Print To PDF/);
  assert.equal(jobs.length, antesBloqueios);
  assert.match(service.problemaImpressora('Termica 80mm Teste'), /0 bytes/);
  const mensagem = await service.imprimirDadosQz({ ...dados, teste: true }, { ...config, impressoraCliente: 'Termica Texto', impressoraCozinha: 'Termica Texto' });
  assert.equal(jobs.at(-1).config.name, 'Termica Texto');
  const tamanho = jobs.at(-1).data.reduce((n, d) => n + Buffer.from(d.data, 'base64').length, 0);
  assert(tamanho > 0);
  assert(mensagem.includes(`Termica Texto: ${tamanho} bytes`));
  assert(logs.some(([msg, meta]) => msg.includes('Chamando qz.print') && meta.impressora === 'Termica Texto' && meta.bytes === tamanho));
  ativo = false;
  fechado();
  assert.equal(service.estadoQz().conectado, false);
  assert.equal(service.estadoQz().impressoras.length, 0);
  console.log('OK: ESC/POS, acentos, cortes, injeção, QZ, duplicidade, falha parcial, reimpressão, caixa e quota.');
}
async function testesAssinatura() {
  const crypto = require('node:crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = { QZ_CERTIFICATE_PATH: 'cert-test', QZ_PRIVATE_KEY_PATH: 'key-test', QZ_ALLOWED_PRINTERS: JSON.stringify(['Térmica 80']) };
  class CertificadoTeste {
    constructor() { this.publicKey = publicKey; this.validFrom = '2026-01-01'; this.validTo = '2030-01-01'; }
    checkPrivateKey(key) { return crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }) === publicKey.export({ type: 'spki', format: 'pem' }); }
    toString() { return 'CERTIFICADO PUBLICO SIMULADO'; }
  }
  const route = carregar('app/api/qz/route.ts', {
    'node:crypto': { ...crypto, X509Certificate: CertificadoTeste },
    'node:fs/promises': { readFile: async (p) => p === 'key-test' ? privateKey.export({ type: 'pkcs8', format: 'pem' }) : 'cert' },
    '@/lib/escpos': escpos,
  }, { process: { env }, Buffer, URL, TextDecoder });
  const { NextRequest } = require('next/server');
  const request = (payload, headers = {}) => new NextRequest('http://localhost:3001/api/qz', { method: 'POST', headers: { host: 'localhost:3001', origin: 'http://localhost:3001', 'sec-fetch-site': 'same-origin', 'x-pdv-qz': '1', 'content-type': 'application/json', cookie: 'loja_sessao=' + encodeURIComponent(JSON.stringify({ id: 'e4976b39-6302-43e1-95bb-47f9a0b83d91', status_pagamento: 'ativo' })), ...headers }, body: JSON.stringify({ request: JSON.stringify(payload) }) });
  const valid = { call: 'print', timestamp: Date.now(), params: { printer: { name: 'Térmica 80' }, options: { copies: 1, encoding: 'ISO-8859-1', jobName: 'PDVDG TESTE' }, data: [cliente, cozinha].map(bytes => ({ type: 'raw', format: 'command', flavor: 'base64', data: Buffer.from(bytes).toString('base64') })) } };
  const res = await route.POST(request(valid));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const result = await res.json();
  assert(crypto.verify('RSA-SHA512', Buffer.from(crypto.createHash('sha256').update(JSON.stringify(valid)).digest('hex')), publicKey, Buffer.from(result.signature, 'base64')));
  assert.equal((await route.POST(request(valid, { origin: 'https://example.invalid' }))).status, 403);
  assert.equal((await route.POST(request(valid, { cookie: '' }))).status, 403);
  assert.equal((await route.POST(request({ call: 'printers.detail', timestamp: Date.now() }))).status, 200);
  assert.equal((await route.POST(request({ call: 'printers.detail', timestamp: Date.now(), params: { file: 'C:/bad' } }))).status, 400);
  for (const alter of [
    p => p.call = 'file.read', p => p.call = 'printers.clearQueue', p => p.timestamp -= 120000,
    p => p.params.printer = { file: 'C:/bad' }, p => p.params.printer.name = 'Não permitida',
    p => p.params.options.copies = 2, p => p.params.options.forceRaw = true,
    p => p.params.data[0].flavor = 'file', p => p.params.data[0].data = Buffer.from([27,64,27,112,0,10,10,10,10,10,29,86,0]).toString('base64'),
  ]) {
    const payload = JSON.parse(JSON.stringify(valid)); alter(payload);
    assert.equal((await route.POST(request(payload))).status, 400);
  }
  console.log('OK: assinatura SHA256/RSA-SHA512, origem, sessão, destinos, bytes e comandos restritos.');
}
// Extrai somente as funções de produção; não monta React nem carrega serviços reais.
function carregarFinalizacoesBalcao() {
  const arquivo = 'components/Balcao.tsx';
  const fonte = ts.createSourceFile(arquivo, fs.readFileSync(path.join(root, arquivo), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nomes = ['mensagemErroCriacao', 'finalizarPedido', 'finalizarBalcao', 'finalizarMesa', 'confirmarDelivery'];
  const declaracoes = new Map();
  function visitar(no) {
    if (ts.isFunctionDeclaration(no) && no.name) {
      const nome = no.name.text;
      assert.notEqual(nome, 'tentarSalvarPagamento', 'Não deve existir salvamento posterior do pagamento');
      if (nomes.includes(nome)) {
        assert(!declaracoes.has(nome), `Função duplicada: ${nome}`);
        declaracoes.set(nome, no.getText(fonte));
      }
    }
    ts.forEachChild(no, visitar);
  }
  visitar(fonte);
  for (const nome of nomes) assert(declaracoes.has(nome), `Função real não encontrada: ${nome}`);
  return ts.transpileModule([...declaracoes.values()].join('\n') + '\nmodule.exports = { finalizarPedido };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

function simularFinalizacao(codigo, fluxo, pagamento, { manual = false, falha = null } = {}) {
  const copiar = (valor) => JSON.parse(JSON.stringify(valor));
  const chamadas = [], gravacoes = [], conclusoes = [], impressoes = [], avisos = [];
  const carrinho = [
    { key: 'linha-teste-1', product: { id: 'produto-teste-1', price: 15, cost: '7.50' }, qty: 2, observacao: 'Sem cebola' },
    { key: 'linha-teste-2', product: { id: 'produto-teste-2', price: 10, cost: null }, qty: 1, observacao: '' },
  ];
  const original = copiar(carrinho);
  const estado = { carrinho, cliente: ' Cliente simulado ', telefoneCliente: '(11) 99999-0000', enviando: false, erroBalcao: null, erroMesa: null, erroForm: null };
  const setters = {};
  const pedidoGravado = { current: null }, finalizacaoEmCurso = { current: false };
  const contexto = {
    module: { exports: {} },
    // Error compartilhado mantém o instanceof usado no catch da função real.
    Error,
    carrinho, cliente: estado.cliente, telefoneCliente: estado.telefoneCliente,
    total: 40, tipoVenda: fluxo.tipo, formaPagamento: pagamento, enviando: false,
    endereco: ' Rua de teste, 123 ', complemento: ' Fundos ', taxa: '5,50',
    motoboyId: 'motoboy-teste', motoboys: [{ id: 'motoboy-teste', nome: 'Entregador simulado' }], mesaEscolhida: 7,
    pedidoGravado, finalizacaoEmCurso,
    getSessao: () => ({ id: 'loja-teste' }),
    caixaEstaAberto: () => true,
    MENSAGEM_CAIXA_FECHADO: 'Caixa fechado',
    normalizarTelefone: (telefone) => telefone.replace(/\D/g, ''),
    formatarMoeda: (valor) => `R$ ${valor.toFixed(2)}`,
    rotuloPedido: (pedido) => Number.isSafeInteger(Number(pedido.numero_pedido)) && Number(pedido.numero_pedido) > 0 ? `Pedido ${pedido.numero_pedido}` : 'Pedido sem número',
    aoPedidoCriado: (...args) => avisos.push(args),
    imprimirPedidoAutomatico: async (...args) => { impressoes.push(args); return { erro: false, mensagem: 'simulado' }; },
    concluirPedido: async (pedido, texto) => {
      conclusoes.push({ pedido: copiar(pedido), texto, gravacoes: copiar(gravacoes) });
    },
  };
  for (const campo of ['carrinho', 'cliente', 'telefoneCliente', 'enviando', 'erroBalcao', 'erroMesa', 'erroForm', 'endereco', 'complemento', 'taxa', 'motoboyId', 'avisoCliente', 'mesaEscolhida']) {
    setters[campo] = [];
    contexto['set' + campo[0].toUpperCase() + campo.slice(1)] = (valor) => {
      setters[campo].push(valor);
      estado[campo] = typeof valor === 'function' ? valor(estado[campo]) : valor;
    };
  }
  // A resposta deriva do INSERT para não inventar um pagamento ausente.
  contexto.supabase = {
    from(tabela) {
      function escrever(metodo, payload, opcoes) {
        const chamada = { tabela, metodo, payload: copiar(payload), opcoes, filtros: [], concluida: false };
        chamadas.push(chamada);
        let liberar;
        const resposta = new Promise((resolve) => { liberar = resolve; }).then(() => {
          const error = falha?.tabela === tabela ? falha.erro : null;
          chamada.concluida = true;
          if (!error) gravacoes.push({ tabela, metodo, payload: copiar(payload) });
          return { data: error ? null : tabela === 'orders' ? { id: 'pedido-simulado-001', numero_pedido: 1, ...copiar(payload) } : null, error };
        });
        chamada.liberar = liberar;
        if (!manual) liberar();
        const query = {
          select() { return query; },
          single() { return resposta; },
          eq(campo, valor) { chamada.filtros.push([campo, valor]); return query; },
          then(resolve, reject) { return resposta.then(resolve, reject); },
        };
        return query;
      }
      return {
        insert: (payload) => escrever('insert', payload),
        update: (payload) => escrever('update', payload),
        upsert: (payload, opcoes) => escrever('upsert', payload, opcoes),
      };
    },
  };
  vm.runInNewContext(codigo, contexto, { filename: 'Balcao.finalizacoes.test.js' });
  return { executar: () => contexto.module.exports.finalizarPedido(), chamadas, gravacoes, conclusoes, impressoes, avisos, estado, setters, carrinho, original, pedidoGravado, finalizacaoEmCurso };
}

function verificarSemPatchPagamento(cenario) {
  assert(!cenario.chamadas.some(({ tabela, metodo }) => tabela === 'orders' && metodo === 'update'), 'Pagamento não pode ser corrigido por PATCH posterior');
  assert.equal(cenario.chamadas.filter(({ tabela }) => tabela === 'orders').length, 1, 'Não deve repetir INSERT sem pagamento');
}

function verificarCriacaoInterrompida(cenario, fluxo, mensagem) {
  verificarSemPatchPagamento(cenario);
  assert.deepEqual(cenario.chamadas.map(({ tabela, metodo }) => [tabela, metodo]), [['orders', 'insert']], `${fluxo.tipo}: não deve gravar itens, cliente, entrega ou mesa`);
  assert.deepEqual(cenario.gravacoes, [], 'INSERT rejeitado não persiste pedido');
  assert.equal(cenario.pedidoGravado.current, null);
  assert.equal(cenario.conclusoes.length, 0);
  assert.equal(cenario.impressoes.length, 0);
  assert.equal(cenario.avisos.length, 0, 'Não deve anunciar sucesso');
  assert.equal(cenario.setters.carrinho.length, 0, 'Não deve sequer solicitar limpeza do carrinho');
  assert.deepEqual(cenario.carrinho, cenario.original, 'Não deve alterar o carrinho por mutação');
  assert.deepEqual(cenario.estado.carrinho, cenario.original);
  assert.equal(cenario.setters.cliente.length, 0);
  assert.equal(cenario.setters.telefoneCliente.length, 0);
  assert.equal(cenario.estado.enviando, false);
  assert.equal(cenario.finalizacaoEmCurso.current, false);
  if (mensagem) assert.equal(cenario.estado[fluxo.erro], mensagem);
}

async function testesPagamentoNaCriacao() {
  const codigo = carregarFinalizacoesBalcao();
  const fluxos = [
    { tipo: 'balcao', erro: 'erroBalcao', etapas: [['orders', 'insert'], ['order_items', 'insert'], ['clientes', 'upsert']] },
    { tipo: 'mesa', erro: 'erroMesa', etapas: [['orders', 'insert'], ['order_items', 'insert'], ['mesas', 'update']] },
    { tipo: 'delivery', erro: 'erroForm', etapas: [['orders', 'insert'], ['order_items', 'insert'], ['clientes', 'upsert'], ['entregas', 'insert']] },
  ];
  const errosColuna = [
    { code: 'PGRST204', message: "Could not find the 'forma_pagamento' column of 'orders' in the schema cache" },
    { code: '42703', message: 'column orders.forma_pagamento does not exist' },
  ];
  const outrosErros = [
    { code: '42501', message: 'new row violates row-level security policy for table orders' },
    { code: 'PGRST204', message: "Could not find the 'outra_coluna' column of 'orders' in the schema cache" },
    { code: '42703', message: 'column orders.outra_coluna does not exist' },
    { code: '23514', message: 'forma_pagamento viola uma restrição de teste' },
    { code: '42703', message: 'column orders.outra_forma_pagamento does not exist' },
  ];
  let cenarios = 0;
  for (const fluxo of fluxos) {
    for (const pagamento of ['Pix', 'Cartão de crédito', 'Fiado']) {
      // Cada resposta é liberada separadamente para detectar conclusão antecipada.
      const sucesso = simularFinalizacao(codigo, fluxo, pagamento, { manual: true });
      const execucao = sucesso.executar();
      for (const [indice, etapa] of fluxo.etapas.entries()) {
        await new Promise(setImmediate);
        assert.equal(sucesso.chamadas.length, indice + 1, `${fluxo.tipo}: deve aguardar ${etapa[0]}`);
        const chamada = sucesso.chamadas[indice];
        assert.deepEqual([chamada.tabela, chamada.metodo], etapa);
        assert.equal(chamada.concluida, false);
        assert.equal(sucesso.gravacoes.length, indice);
        assert.equal(sucesso.conclusoes.length, 0, `${fluxo.tipo}: conclusão antecipada`);
        assert.equal(sucesso.setters.carrinho.length, 0, `${fluxo.tipo}: limpeza antecipada`);
        chamada.liberar();
      }
      await execucao;
      verificarSemPatchPagamento(sucesso);
      const pedidoEsperado = {
        total: fluxo.tipo === 'delivery' ? 45.5 : 40,
        type: fluxo.tipo, status: 'pendente', forma_pagamento: pagamento,
        customer_name: 'Cliente simulado', telefone: '11999990000',
        address: fluxo.tipo === 'delivery' ? 'Rua de teste, 123' : null,
        delivery_fee: fluxo.tipo === 'delivery' ? 5.5 : 0, loja_id: 'loja-teste',
        ...(fluxo.tipo === 'mesa' ? { mesa_numero: 7 } : {}),
        ...(fluxo.tipo === 'delivery' ? { complemento: 'Fundos' } : {}),
      };
      assert.deepEqual(sucesso.chamadas[0].payload, pedidoEsperado);
      assert.deepEqual(sucesso.chamadas[1].payload, [
        { order_id: 'pedido-simulado-001', product_id: 'produto-teste-1', qty: 2, price: 15, cost: 7.5, observacao: 'Sem cebola', loja_id: 'loja-teste' },
        { order_id: 'pedido-simulado-001', product_id: 'produto-teste-2', qty: 1, price: 10, cost: 0, observacao: null, loja_id: 'loja-teste' },
      ]);
      if (fluxo.tipo === 'mesa') {
        assert.deepEqual(sucesso.chamadas[2].payload, { status: 'ocupada' });
        assert.deepEqual(sucesso.chamadas[2].filtros, [['loja_id', 'loja-teste'], ['numero', 7]]);
      }
      if (fluxo.tipo === 'delivery') {
        assert.deepEqual(sucesso.chamadas[3].payload, { order_id: 'pedido-simulado-001', motoboy_id: 'motoboy-teste', status: 'pendente', taxa: 5.5, loja_id: 'loja-teste' });
      }
      assert.equal(sucesso.conclusoes.length, 1);
      assert.deepEqual(sucesso.conclusoes[0].pedido, { id: 'pedido-simulado-001', numero_pedido: 1, ...pedidoEsperado });
      assert.match(sucesso.conclusoes[0].texto, /Pedido 1/);
      assert.deepEqual(sucesso.conclusoes[0].gravacoes, sucesso.gravacoes);
      assert.deepEqual(sucesso.gravacoes.map(({ tabela, metodo }) => [tabela, metodo]), fluxo.etapas);
      assert.equal(sucesso.pedidoGravado.current.forma_pagamento, pagamento);
      assert.equal(sucesso.setters.carrinho.length, 1);
      assert.equal(sucesso.estado.carrinho.length, 0);
      assert.equal(sucesso.estado[fluxo.erro], null);
      assert.equal(sucesso.estado.enviando, false);
      assert.equal(sucesso.finalizacaoEmCurso.current, false);
      assert.equal(sucesso.avisos.length, 0, 'A finalização não deve cair no catch');
      assert.equal(sucesso.impressoes.length, 0, 'A impressão deve passar exclusivamente por concluirPedido (simulado)');
      cenarios++;
    }
    for (const erro of errosColuna) {
      const cenario = simularFinalizacao(codigo, fluxo, 'Fiado', { falha: { tabela: 'orders', erro } });
      await cenario.executar();
      verificarCriacaoInterrompida(cenario, fluxo);
      assert.equal(cenario.chamadas[0].payload.forma_pagamento, 'Fiado');
      const mensagem = cenario.estado[fluxo.erro];
      assert.match(mensagem, /coluna forma_pagamento/);
      assert.match(mensagem, /supabase\/adicionar-pagamento\.sql/);
      assert.match(mensagem, /SQL Editor do Supabase/);
      assert.match(mensagem, /Nenhum pedido foi criado/);
      assert.match(mensagem, /carrinho foi preservado/);
      cenarios++;
    }
    for (const erro of outrosErros) {
      const cenario = simularFinalizacao(codigo, fluxo, 'Pix', { falha: { tabela: 'orders', erro } });
      await cenario.executar();
      verificarCriacaoInterrompida(cenario, fluxo, 'Erro ao criar pedido: ' + erro.message);
      assert.equal(cenario.chamadas[0].payload.forma_pagamento, 'Pix');
      assert.doesNotMatch(cenario.estado[fluxo.erro], /adicionar-pagamento\.sql/);
      cenarios++;
    }
    const falhasObrigatorias = [
      { tabela: 'order_items', mensagem: 'Não foi possível salvar os itens' },
      ...(fluxo.tipo === 'mesa' ? [{ tabela: 'mesas', mensagem: 'Não foi possível ocupar a mesa' }] : []),
      ...(fluxo.tipo === 'delivery' ? [{ tabela: 'entregas', mensagem: 'Não foi possível criar a entrega' }] : []),
    ];
    for (const { tabela, mensagem } of falhasObrigatorias) {
      const erro = { code: '42501', message: `Falha simulada em ${tabela}` };
      const cenario = simularFinalizacao(codigo, fluxo, 'Cartão de crédito', { falha: { tabela, erro } });
      await cenario.executar();
      verificarSemPatchPagamento(cenario);
      const indice = fluxo.etapas.findIndex(([nome]) => nome === tabela);
      assert.deepEqual(cenario.chamadas.map(({ tabela, metodo }) => [tabela, metodo]), fluxo.etapas.slice(0, indice + 1));
      assert.deepEqual(cenario.gravacoes.map(({ tabela, metodo }) => [tabela, metodo]), fluxo.etapas.slice(0, indice));
      assert.equal(cenario.pedidoGravado.current.forma_pagamento, 'Cartão de crédito');
      assert.equal(cenario.conclusoes.length, 0);
      assert.equal(cenario.impressoes.length, 0);
      assert(cenario.estado[fluxo.erro].includes(`${mensagem}: ${erro.message}`));
      assert.equal(cenario.avisos.length, 1);
      assert.equal(cenario.avisos[0][0], cenario.estado[fluxo.erro]);
      assert.equal(cenario.avisos[0][1], 'erro');
      assert.equal(cenario.estado.enviando, false);
      assert.equal(cenario.finalizacaoEmCurso.current, false);
      cenarios++;
    }
  }
  assert.equal(cenarios, 35);
  console.log(`OK: ${cenarios} cenários de pagamento no INSERT, sem PATCH, schema ausente, carrinho preservado e conclusão após gravações obrigatórias nos três fluxos.`);
}

(async () => { await testesTransporte(); await testesAssinatura(); await testesPagamentoNaCriacao(); })().catch((error) => { console.error(error); process.exitCode = 1; });
