"use client";

import type Qz from "qz-tray";
import type { PrinterDetails, PrinterEvent } from "qz-tray";
import { getSessao } from "./supabase";
import type { Order } from "./supabase";
import { caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "./caixa";
import { carregarDadosImpressao, lerImpressora, validarConfig } from "./impressao";
import type { ConfigImpressora, DadosExtrato, DadosImpressao, TipoImpressao } from "./impressao";
import { montarEscPos, montarExtratoEscPos } from "./escpos";

type EstadoQz = { conectado: boolean; conectando: boolean; impressoras: string[]; detalhes: PrinterDetails[]; eventos: Record<string, PrinterEvent>; assinatura: boolean; mensagemAssinatura: string; avisoStatus: string };
let estado: EstadoQz = { conectado: false, conectando: false, impressoras: [], detalhes: [], eventos: {}, assinatura: false, mensagemAssinatura: "Conecte para verificar a assinatura.", avisoStatus: "" };
const ouvintes = new Set<() => void>();
let modulo: Promise<typeof Qz> | null = null;
let conexao: Promise<typeof Qz> | null = null;
let monitoradas = "";
let fila: Promise<unknown> = Promise.resolve();

function rotuloPedidoQz(pedido: Pick<Order, "numero_pedido">): string {
  const numero = Number(pedido.numero_pedido);
  return Number.isSafeInteger(numero) && numero > 0 ? `Pedido ${numero}` : "Pedido sem número";
}

export function estadoQz() { return estado; }
export function observarQz(callback: () => void) { ouvintes.add(callback); return () => { ouvintes.delete(callback); }; }
function atualizar(novo: Partial<EstadoQz>) { estado = { ...estado, ...novo }; ouvintes.forEach((callback) => callback()); }

async function carregarQz() {
  if (!modulo) modulo = import("qz-tray").then(({ default: qz }) => {
    qz.websocket.setClosedCallbacks(() => {
      monitoradas = "";
      atualizar({ conectado: false, eventos: {}, impressoras: [], detalhes: [] });
    });
    qz.printers.setPrinterCallbacks((evento) => {
      if (evento.eventType === "PRINTER") atualizar({ eventos: { ...estado.eventos, [evento.printerName]: evento } });
    });
    return qz;
  });
  return modulo;
}

async function configurarAssinatura(qz: typeof Qz) {
  const resposta = await fetch("/api/qz", { cache: "no-store", headers: { "x-pdv-qz": "1" } });
  const seguranca = await resposta.json();
  if (!resposta.ok) throw new Error(seguranca.message || "Não foi possível preparar a assinatura QZ.");
  atualizar({ assinatura: seguranca.configured, mensagemAssinatura: seguranca.message });
  qz.security.setCertificatePromise((resolve) => resolve(seguranca.certificate));
  qz.security.setSignatureAlgorithm("SHA512");
  const requisicoes = new Map<string, string>();
  qz.api.setSha256Type(async (request) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request));
    const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (seguranca.configured) requisicoes.set(hash, request);
    return hash;
  });
  qz.security.setSignaturePromise((hash) => (resolve, reject) => {
    if (!seguranca.configured) { resolve(""); return; }
    const request = requisicoes.get(hash);
    requisicoes.delete(hash);
    if (!request) { reject(new Error("Requisição QZ não reconhecida para assinatura.")); return; }
    fetch("/api/qz", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "x-pdv-qz": "1" }, body: JSON.stringify({ request }) })
      .then(async (response) => {
        const resultado = await response.json();
        if (!response.ok) throw new Error(resultado.message || "Assinatura QZ recusada.");
        resolve(resultado.signature);
      }).catch(reject);
  });
}

export async function conectarQz(): Promise<typeof Qz> {
  if (conexao) return conexao;
  conexao = (async () => {
    atualizar({ conectando: true });
    const qz = await carregarQz();
    if (!qz.websocket.isActive()) {
      await configurarAssinatura(qz);
      try { await qz.websocket.connect({ retries: 0 }); }
      catch { throw new Error("Não foi possível conectar ao QZ Tray. Instale e abra o QZ Tray neste computador e autorize o PDV na solicitação do QZ."); }
    }
    atualizar({ conectado: true });
    const detalhes = await qz.printers.details();
    atualizar({ impressoras: detalhes.map(({ name }) => name), detalhes });
    return qz;
  })().finally(() => { conexao = null; atualizar({ conectando: false }); });
  return conexao;
}

function problemaDriver(nome: string): string | null {
  const driver = estado.detalhes.find((impressora) => impressora.name === nome)?.driver;
  return /\bPDF\b|\bXPS\b|OneNote/i.test(driver || nome)
    ? `${nome}: o driver ${driver || nome} não aceita cupom RAW ESC/POS. Use uma térmica compatível ou Generic / Text Only na porta FILE: para gerar .prn; drivers PDF/XPS podem gerar arquivos de 0 bytes.`
    : null;
}

export function problemaImpressora(nome: string): string | null {
  const driver = problemaDriver(nome);
  if (driver) return driver;
  const evento = estado.eventos[nome];
  if (!evento) return null;
  if (["WARN", "ERROR", "FATAL"].includes(evento.severity || "")) return `${nome}: ${evento.statusText || evento.message || "o driver informou um problema"}`;
  return null;
}

export async function verificarImpressoras(config: ConfigImpressora, tipos: TipoImpressao[] = ["comprovante", "comanda"]) {
  validarConfig(config);
  const nomes = Array.from(new Set(tipos.map((tipo) => tipo === "comprovante" ? config.impressoraCliente : config.impressoraCozinha)));
  if (!nomes.length || nomes.some((nome) => !nome)) throw new Error("Configure e salve a impressora do cliente e da cozinha em Configurações.");
  const qz = await conectarQz();
  for (const nome of nomes) {
    if (!estado.impressoras.includes(nome)) throw new Error(`Impressora não encontrada no Windows: ${nome}. Confira a seleção em Configurações.`);
    const problema = problemaDriver(nome);
    if (problema) throw new Error(problema);
  }
  try {
    const chave = JSON.stringify(nomes);
    if (monitoradas !== chave) {
      if (monitoradas) await qz.printers.stopListening();
      await qz.printers.startListening(nomes);
      monitoradas = chave;
      atualizar({ eventos: {} });
    }
    await qz.printers.getStatus();
    atualizar({ avisoStatus: "" });
  } catch {
    atualizar({ avisoStatus: "O QZ está conectado, mas não foi possível consultar o estado físico pelo driver." });
  }
  for (const nome of nomes) {
    const problema = problemaImpressora(nome);
    if (problema) throw new Error(problema);
  }
  return qz;
}

type RegistroImpressao = Partial<Record<TipoImpressao, { estado: "enviando" | "enviado" | "incerto"; data: string }>>;
export function chaveRegistroImpressao(lojaId: string, pedidoId: string) { return `pdv_impressao_${lojaId}_${pedidoId}`; }
function registroImpressao(chave: string): RegistroImpressao {
  const bruto = localStorage.getItem(chave);
  if (!bruto) return {};
  try {
    const registro = JSON.parse(bruto);
    if (!registro || typeof registro !== "object" || Array.isArray(registro)) throw new Error();
    return registro;
  } catch { throw new Error("Registro de impressão ilegível. Confira o pedido antes de reimprimir."); }
}

function base64(bytes: Uint8Array) {
  let binario = "";
  for (let inicio = 0; inicio < bytes.length; inicio += 8192) binario += String.fromCharCode(...Array.from(bytes.slice(inicio, inicio + 8192)));
  return btoa(binario);
}

export async function imprimirDadosQz(dados: DadosImpressao, config: ConfigImpressora, tipos: TipoImpressao[] = ["comprovante", "comanda"], automatico = false) {
  const sessao = getSessao();
  if (!sessao) throw new Error("Sessão da loja não encontrada.");
  const lojaId = sessao.id;
  if (!dados.teste && !caixaEstaAberto(lojaId)) throw new Error(MENSAGEM_CAIXA_FECHADO);
  validarConfig(config);
  if (!tipos.length) throw new Error("Nenhum documento selecionado. Nada foi enviado ao QZ Tray.");
  const documentos = Array.from(new Set(tipos)).map((tipo) => ({ tipo, nome: tipo === "comprovante" ? config.impressoraCliente : config.impressoraCozinha, bytes: montarEscPos(dados, config, tipo) }));
  if (documentos.some(({ bytes }) => bytes.length === 0)) throw new Error("Cupom vazio. Nada foi enviado ao QZ Tray.");
  const chave = chaveRegistroImpressao(lojaId, dados.pedido.id);
  const executar = async () => {
    const verificarSessao = () => {
      if (getSessao()?.id !== lojaId) throw new Error("A sessão da loja mudou. Impressão interrompida.");
      if (!dados.teste && !caixaEstaAberto(lojaId)) throw new Error(MENSAGEM_CAIXA_FECHADO);
    };
    verificarSessao();
    const registro = dados.teste ? {} : registroImpressao(chave);
    if (automatico && documentos.some(({ tipo }) => registro[tipo])) throw new Error("Este pedido já teve uma tentativa de impressão. Confira o papel e use Reimprimir em Caixa se necessário; não finalize outra venda.");
    const qz = await verificarImpressoras(config, tipos);
    const grupos = documentos.reduce<{ nome: string; documentos: typeof documentos }[]>((lista, documento) => {
      const grupo = lista.find((item) => item.nome === documento.nome);
      if (grupo) grupo.documentos.push(documento);
      else lista.push({ nome: documento.nome, documentos: [documento] });
      return lista;
    }, []);
    const enviados: string[] = [];
    const destinos: string[] = [];
    for (const grupo of grupos) {
      verificarSessao();
      const problema = problemaImpressora(grupo.nome);
      if (problema) throw new Error(`${problema}. Já enviado nesta tentativa: ${enviados.join(", ") || "nenhum"}. Confira a fila antes de reimprimir.`);
      if (!dados.teste) {
        grupo.documentos.forEach(({ tipo }) => { registro[tipo] = { estado: "enviando", data: new Date().toISOString() }; });
        localStorage.setItem(chave, JSON.stringify(registro));
      }
      const bytes = grupo.documentos.reduce((total, documento) => total + documento.bytes.length, 0);
      try {
        const configuracao = qz.configs.create(grupo.nome, { copies: 1, jobName: `PDVDG ${dados.teste ? "TESTE" : rotuloPedidoQz(dados.pedido)}`, encoding: "ISO-8859-1" });
        const data = grupo.documentos.map(({ bytes }) => ({ type: "raw" as const, format: "command" as const, flavor: "base64" as const, data: base64(bytes) }));
        console.info("[PDVDG QZ] Chamando qz.print", { impressora: grupo.nome, documentos: data.length, bytes });
        await qz.print(configuracao, data);
        console.info("[PDVDG QZ] Envio aceito pelo QZ", { impressora: grupo.nome, bytes });
      } catch (erro) {
        if (!dados.teste) {
          grupo.documentos.forEach(({ tipo }) => { registro[tipo] = { estado: "incerto", data: new Date().toISOString() }; });
          try { localStorage.setItem(chave, JSON.stringify(registro)); } catch { /* O registro anterior impede reenvio automático. */ }
        }
        throw new Error(`QZ não confirmou o envio de ${grupo.documentos.map(({ tipo }) => tipo).join(" + ")}. ${erro instanceof Error ? erro.message : String(erro)} Já enviado: ${enviados.join(", ") || "nenhum"}. Confira papel/fila antes de reimprimir; não há repetição automática.`);
      }
      enviados.push(...grupo.documentos.map(({ tipo }) => tipo));
      destinos.push(`${grupo.nome}: ${bytes} bytes`);
      if (!dados.teste) {
        grupo.documentos.forEach(({ tipo }) => { registro[tipo] = { estado: "enviado", data: new Date().toISOString() }; });
        try { localStorage.setItem(chave, JSON.stringify(registro)); }
        catch { throw new Error("QZ aceitou a impressão, mas o registro local não foi atualizado. Confira o papel antes de reimprimir."); }
      }
    }
    return `${enviados.join(" + ")} enviados ao QZ Tray, com corte (${destinos.join("; ")}). O retorno confirma o envio à fila, não a saída física do papel nem o tamanho do arquivo .prn; confira o destino.`;
  };
  const comTrava = async (): Promise<string> => navigator.locks ? await navigator.locks.request(chave, executar) : await executar();
  const operacao = fila.then(comTrava, comTrava);
  fila = operacao.catch(() => undefined);
  return operacao;
}

export async function imprimirExtratoQz(dados: DadosExtrato, config: ConfigImpressora) {
  const sessao = getSessao();
  if (!sessao) throw new Error("Sessão da loja não encontrada.");
  validarConfig(config);
  const bytes = montarExtratoEscPos(dados, config);
  if (bytes.length === 0) throw new Error("Extrato vazio. Nada foi enviado ao QZ Tray.");
  const executar = async () => {
    if (getSessao()?.id !== sessao.id) throw new Error("A sessão da loja mudou. Impressão interrompida.");
    const qz = await verificarImpressoras(config, ["comprovante"]);
    const problema = problemaImpressora(config.impressoraCliente);
    if (problema) throw new Error(problema);
    const configuracao = qz.configs.create(config.impressoraCliente, { copies: 1, jobName: "PDVDG EXTRATO", encoding: "ISO-8859-1" });
    const data = [{ type: "raw" as const, format: "command" as const, flavor: "base64" as const, data: base64(bytes) }];
    console.info("[PDVDG QZ] Chamando qz.print (extrato)", { impressora: config.impressoraCliente, bytes: bytes.length });
    await qz.print(configuracao, data);
    return `Extrato enviado ao QZ Tray (${config.impressoraCliente}: ${bytes.length} bytes). O retorno confirma o envio à fila, não a saída física do papel; confira o destino.`;
  };
  const comTrava = async (): Promise<string> => navigator.locks ? await navigator.locks.request("pdv_impressao_extrato", executar) : await executar();
  const operacao = fila.then(comTrava, comTrava);
  fila = operacao.catch(() => undefined);
  return operacao;
}

export async function imprimirPedidoAutomatico(pedido: Order): Promise<{ mensagem: string; erro: boolean }> {
  try {
    const sessao = getSessao();
    if (!sessao) throw new Error("Sessão da loja não encontrada.");
    const config = lerImpressora(sessao.id);
    const dados = await carregarDadosImpressao(pedido.id);
    const mensagem = await imprimirDadosQz(dados, config, ["comprovante", "comanda"], true);
    return { mensagem, erro: false };
  } catch (erro) {
    return { mensagem: `${rotuloPedidoQz(pedido)} salvo. Impressão pendente: ${erro instanceof Error ? erro.message : "falha de comunicação"} Não crie o pedido novamente. Use Imprimir em Caixa.`, erro: true };
  }
}
