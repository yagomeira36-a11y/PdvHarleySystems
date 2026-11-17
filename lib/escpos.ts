import type { ConfigImpressora, DadosExtrato, DadosImpressao, TipoImpressao } from "./impressao";

const MAX_BYTES = 1024 * 1024;
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CP850 =
  "ÇüéâäàåçêëèïîìÄÅ" +
  "ÉæÆôöòûùÿÖÜø£Ø×ƒ" +
  "áíóúñÑªº¿®¬½¼¡«»" +
  "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐" +
  "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤" +
  "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀" +
  "ÓßÔÒõÕµþÞÚÛÙýÝ¯´" +
  "\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0";

const CP860 =
  "ÇüéâãàÁçêÊèÍÔìÃÂ" +
  "ÉÀÈôõòÚùÌÕÜ¢£Ù₧Ó" +
  "áíóúñÑªº¿Ò¬½¼¡«»" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩" +
  "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";

const CP858 = CP850.slice(0, 0x55) + "€" + CP850.slice(0x56);

function limparTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor !== "string") throw new Error("Texto de impressão inválido.");
  if (valor.length > MAX_BYTES) throw new Error("Texto de impressão excede 1 MB.");
  return valor
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "")
    .replace(/[^\S\n]/g, " ");
}

function codificar(texto: unknown, tabela: string): string {
  const caracteres = Array.from(limparTexto(texto));
  const resultado: string[] = [];
  let tamanho = 0;

  function adicionar(caractere: string) {
    const codigo = caractere.charCodeAt(0);
    const indice = tabela.indexOf(caractere);
    const byte = codigo === LF || (codigo >= 32 && codigo < 127)
      ? codigo
      : indice >= 0 ? indice + 128 : 63;
    if (++tamanho > MAX_BYTES) throw new Error("Texto codificado excede 1 MB.");
    resultado.push(String.fromCharCode(byte));
  }

  for (let i = 0; i < caracteres.length; i++) {
    const caractere = caracteres[i];
    if (tabela.indexOf(caractere) >= 0 || caractere.charCodeAt(0) < 128) {
      adicionar(caractere);
    } else {
      const partes = Array.from(
        caractere.normalize("NFD").replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g, "")
      );
      for (let j = 0; j < partes.length; j++) adicionar(partes[j]);
    }
  }
  return resultado.join("");
}

function quebrarLinhas(texto: string, colunas: number): string[] {
  const resultado: string[] = [];
  const paragrafos = texto.split("\n");
  for (let p = 0; p < paragrafos.length; p++) {
    const paragrafo = paragrafos[p].replace(/^ +| +$/g, "");
    if (paragrafo.length <= colunas) {
      resultado.push(paragrafo);
      continue;
    }
    const palavras = paragrafo.split(/ +/);
    let linha = "";
    for (let i = 0; i < palavras.length; i++) {
      const palavra = palavras[i];
      if (!palavra) continue;
      if (linha && linha.length + 1 + palavra.length <= colunas) {
        linha += " " + palavra;
        continue;
      }
      if (linha) resultado.push(linha);
      linha = "";
      let inicio = 0;
      while (palavra.length - inicio > colunas) {
        resultado.push(palavra.slice(inicio, inicio + colunas));
        inicio += colunas;
      }
      linha = palavra.slice(inicio);
    }
    resultado.push(linha);
  }
  return resultado;
}

function numeroValido(valor: number, nome: string, positivo = false): number {
  if (typeof valor !== "number" || !isFinite(valor) || (positivo ? valor <= 0 : valor < 0)) {
    throw new Error(nome + " inválido para impressão.");
  }
  return valor;
}

function moeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function montarEscPos(
  dados: DadosImpressao,
  config: ConfigImpressora,
  tipo: TipoImpressao
): Uint8Array {
  if (!config || (config.colunas !== 42 && config.colunas !== 48) ||
      (config.paginaCodigo !== 2 && config.paginaCodigo !== 3 && config.paginaCodigo !== 19) ||
      typeof config.impressoraCliente !== "string" || typeof config.impressoraCozinha !== "string" ||
      typeof config.rodape !== "string") {
    throw new Error("Configuração ESC/POS inválida.");
  }
  limparTexto(config.impressoraCliente);
  limparTexto(config.impressoraCozinha);
  limparTexto(config.rodape);
  if (tipo !== "comprovante" && tipo !== "comanda") throw new Error("Tipo de impressão inválido.");
  if (!dados || !dados.pedido || !dados.empresa || !Array.isArray(dados.itens) ||
      dados.itens.length > MAX_BYTES || (dados.teste !== undefined && typeof dados.teste !== "boolean")) {
    throw new Error("Dados de impressão inválidos.");
  }

  const pedido = dados.pedido;
  const empresa = dados.empresa;
  if (pedido.type !== "balcao" && pedido.type !== "mesa" && pedido.type !== "delivery") {
    throw new Error("Modalidade do pedido inválida.");
  }
  const total = numeroValido(pedido.total, "Total");
  numeroValido(pedido.delivery_fee, "Taxa de entrega");
  const taxa = pedido.type === "delivery" ? pedido.delivery_fee : 0;
  if (taxa > total) throw new Error("Taxa de entrega maior que o total.");
  for (let i = 0; i < dados.itens.length; i++) {
    const item = dados.itens[i];
    if (!item) throw new Error("Item de impressão inválido.");
    numeroValido(item.quantidade, "Quantidade", true);
    numeroValido(item.preco, "Preço");
    numeroValido(item.quantidade * item.preco, "Total do item");
  }
  if (pedido.type === "mesa" && pedido.mesa_numero !== null && pedido.mesa_numero !== undefined) {
    numeroValido(pedido.mesa_numero, "Mesa", true);
    if (Math.floor(pedido.mesa_numero) !== pedido.mesa_numero) throw new Error("Mesa inválida.");
  }
  const data = new Date(limparTexto(pedido.created_at));
  if (!isFinite(data.getTime())) throw new Error("Data do pedido inválida.");
  const tabela = config.paginaCodigo === 3 ? CP860 : config.paginaCodigo === 19 ? CP858 : CP850;
  const bytes: number[] = [];

  function adicionar(valores: number[]) {
    if (bytes.length + valores.length > MAX_BYTES) throw new Error("Impressão excede 1 MB.");
    for (let i = 0; i < valores.length; i++) bytes.push(valores[i]);
  }

  function escreverCodificado(texto: string, negrito: boolean, centralizado: boolean) {
    const linhas = quebrarLinhas(texto, config.colunas);
    adicionar([ESC, 0x61, centralizado ? 1 : 0, ESC, 0x45, negrito ? 1 : 0]);
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      if (bytes.length + linha.length + 1 > MAX_BYTES) throw new Error("Impressão excede 1 MB.");
      for (let j = 0; j < linha.length; j++) bytes.push(linha.charCodeAt(j));
      bytes.push(LF);
    }
    adicionar([ESC, 0x45, 0, ESC, 0x61, 0]);
  }

  function escrever(texto: unknown, negrito = false, centralizado = false) {
    escreverCodificado(codificar(texto, tabela), negrito, centralizado);
  }

  function par(rotulo: string, valor: string, negrito = false) {
    const esquerda = codificar(rotulo, tabela);
    const direita = codificar(valor, tabela);
    if (esquerda.indexOf("\n") < 0 && direita.indexOf("\n") < 0 &&
        esquerda.length + direita.length < config.colunas) {
      const espacos = new Array(config.colunas - esquerda.length - direita.length + 1).join(" ");
      escreverCodificado(esquerda + espacos + direita, negrito, false);
    } else {
      escreverCodificado(esquerda, negrito, false);
      escreverCodificado(direita, negrito, false);
    }
  }

  function separador() {
    escrever(new Array(config.colunas + 1).join("-"));
  }

  adicionar([ESC, 0x40, ESC, 0x4d, 0, ESC, 0x74, config.paginaCodigo, ESC, 0x45, 0, ESC, 0x61, 0]);
  if (dados.teste) {
    escrever("TESTE DE IMPRESSÃO - SEM VENDA", true, true);
    escrever("NÃO UTILIZAR PARA COBRANÇA", true, true);
  }
  escrever(limparTexto(empresa.nome_empresa).trim() || "PdvDG", true, true);
  if (empresa.cnpj) escrever("CNPJ: " + limparTexto(empresa.cnpj), false, true);
  if (empresa.endereco) escrever(empresa.endereco, false, true);
  if (empresa.telefone) escrever("Tel.: " + limparTexto(empresa.telefone), false, true);
  escrever(tipo === "comanda" ? "COMANDA DE PRODUÇÃO" : "COMPROVANTE NÃO FISCAL", true, true);
  if (limparTexto(pedido.status).trim().toLowerCase() === "cancelado") {
    escrever("PEDIDO CANCELADO", true, true);
  }
  separador();
  const modalidade = pedido.type === "delivery" ? "DELIVERY" : pedido.type === "mesa"
    ? "MESA " + (pedido.mesa_numero === null || pedido.mesa_numero === undefined ? "não informada" : pedido.mesa_numero)
    : "BALCÃO";
  escrever(modalidade, true);
  const numeroPedido = Number(pedido.numero_pedido);
  escrever(dados.teste
    ? "Pedido: TESTE"
    : Number.isSafeInteger(numeroPedido) && numeroPedido > 0
      ? `Pedido ${numeroPedido}`
      : "Pedido sem número");
  escrever("Data: " + data.toLocaleString("pt-BR"));
  if (pedido.customer_name) escrever("Cliente: " + limparTexto(pedido.customer_name));
  if (pedido.telefone) escrever("Telefone: " + limparTexto(pedido.telefone));
  if (pedido.type === "delivery") {
    if (pedido.address) escrever("Entrega: " + limparTexto(pedido.address), true);
    if (pedido.complemento) escrever("Complemento: " + limparTexto(pedido.complemento), true);
  }
  separador();
  if (!dados.itens.length) escrever(dados.teste ? "TESTE - SEM ITENS DE VENDA" : "SEM ITENS", true);
  for (let i = 0; i < dados.itens.length; i++) {
    const item = dados.itens[i];
    escrever(item.quantidade.toString().replace(".", ",") + "x " + limparTexto(item.nome), true);
    if (tipo === "comprovante") {
      par("Unitário:", moeda(item.preco));
      par("Total do item:", moeda(item.quantidade * item.preco));
    }
    if (item.observacao) escrever("OBS.: " + limparTexto(item.observacao), true);
    separador();
  }
  if (tipo === "comprovante") {
    // pedido.total já inclui a taxa; ela não deve ser somada novamente.
    par("Subtotal", moeda(total - taxa));
    if (pedido.type === "delivery") par("Taxa de entrega", moeda(taxa));
    par("TOTAL", moeda(total), true);
    escrever("Pagamento: " + (limparTexto(pedido.forma_pagamento) || "Não informado"));
    if (config.rodape) {
      separador();
      escrever(config.rodape, false, true);
    }
  }
  adicionar([ESC, 0x64, 3, GS, 0x56, 0x41, 3]);
  const resultado = new Uint8Array(bytes);
  if (!validarBytesEscPos(resultado)) throw new Error("Documento ESC/POS inválido.");
  return resultado;
}

// ============================================================
// EXTRATO DO CAIXA — resumo do movimento do caixa (dia de hoje)
// ============================================================
export function montarExtratoEscPos(dados: DadosExtrato, config: ConfigImpressora): Uint8Array {
  if (!config || (config.colunas !== 42 && config.colunas !== 48) ||
      (config.paginaCodigo !== 2 && config.paginaCodigo !== 3 && config.paginaCodigo !== 19) ||
      typeof config.rodape !== "string") {
    throw new Error("Configuração ESC/POS inválida.");
  }
  limparTexto(config.rodape);
  if (!dados || !dados.empresa || !Array.isArray(dados.pagamentos) ||
      !Array.isArray(dados.motoboys) || !Array.isArray(dados.linhas)) {
    throw new Error("Dados do extrato inválidos.");
  }
  const emitido = new Date(limparTexto(dados.emitidoEm));
  if (!isFinite(emitido.getTime())) throw new Error("Data de emissão do extrato inválida.");
  const tabela = config.paginaCodigo === 3 ? CP860 : config.paginaCodigo === 19 ? CP858 : CP850;
  const bytes: number[] = [];

  function adicionar(valores: number[]) {
    if (bytes.length + valores.length > MAX_BYTES) throw new Error("Impressão excede 1 MB.");
    for (let i = 0; i < valores.length; i++) bytes.push(valores[i]);
  }

  function escreverCodificado(texto: string, negrito: boolean, centralizado: boolean) {
    const linhas = quebrarLinhas(texto, config.colunas);
    adicionar([ESC, 0x61, centralizado ? 1 : 0, ESC, 0x45, negrito ? 1 : 0]);
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      if (bytes.length + linha.length + 1 > MAX_BYTES) throw new Error("Impressão excede 1 MB.");
      for (let j = 0; j < linha.length; j++) bytes.push(linha.charCodeAt(j));
      bytes.push(LF);
    }
    adicionar([ESC, 0x45, 0, ESC, 0x61, 0]);
  }

  function escrever(texto: unknown, negrito = false, centralizado = false) {
    escreverCodificado(codificar(texto, tabela), negrito, centralizado);
  }

  function par(rotulo: string, valor: string, negrito = false) {
    const esquerda = codificar(rotulo, tabela);
    const direita = codificar(valor, tabela);
    if (esquerda.indexOf("\n") < 0 && direita.indexOf("\n") < 0 &&
        esquerda.length + direita.length < config.colunas) {
      const espacos = new Array(config.colunas - esquerda.length - direita.length + 1).join(" ");
      escreverCodificado(esquerda + espacos + direita, negrito, false);
    } else {
      escreverCodificado(esquerda, negrito, false);
      escreverCodificado(direita, negrito, false);
    }
  }

  function separador() {
    escrever(new Array(config.colunas + 1).join("-"));
  }

  function grupo(rotulo: string, quantidade: number, total: number) {
    par(`${limparTexto(rotulo)} (${numeroValido(quantidade, "Quantidade")})`, moeda(numeroValido(total, "Total")));
  }

  function dataHora(iso: string | null): string | null {
    if (!iso) return null;
    const data = new Date(limparTexto(iso));
    return isFinite(data.getTime()) ? data.toLocaleString("pt-BR") : null;
  }

  const empresa = dados.empresa;
  const fundo = numeroValido(dados.fundo, "Troco inicial");
  const vendas = numeroValido(dados.vendas, "Vendas");

  adicionar([ESC, 0x40, ESC, 0x4d, 0, ESC, 0x74, config.paginaCodigo, ESC, 0x45, 0, ESC, 0x61, 0]);
  escrever(limparTexto(empresa.nome_empresa).trim() || "PdvDG", true, true);
  if (empresa.cnpj) escrever("CNPJ: " + limparTexto(empresa.cnpj), false, true);
  if (empresa.endereco) escrever(empresa.endereco, false, true);
  if (empresa.telefone) escrever("Tel.: " + limparTexto(empresa.telefone), false, true);
  escrever("EXTRATO DO CAIXA", true, true);
  escrever("Emitido em " + emitido.toLocaleString("pt-BR"), false, true);
  separador();
  const abertura = dataHora(dados.abertoEm);
  escrever("Abertura: " + (abertura || "caixa não localizado"));
  const fechamento = dataHora(dados.fechadoEm);
  if (fechamento) escrever("Último fechamento: " + fechamento);
  separador();
  par("Troco inicial", moeda(fundo));
  par("Vendas do caixa", moeda(vendas), true);
  par("Total esperado", moeda(fundo + vendas));
  par("Lucro estimado", moeda(numeroValido(dados.lucro, "Lucro")));
  par("Taxas de entrega", moeda(numeroValido(dados.taxas, "Taxas")));
  separador();
  escrever("VENDAS POR TIPO", true);
  grupo("Balcão", dados.balcao.quantidade, dados.balcao.total);
  grupo("Delivery (com taxa)", dados.delivery.quantidade, dados.delivery.total);
  grupo("Mesa", dados.mesa.quantidade, dados.mesa.total);
  separador();
  escrever("FORMAS DE PAGAMENTO", true);
  if (!dados.pagamentos.length) escrever("Nenhuma venda registrada neste caixa.");
  for (let i = 0; i < dados.pagamentos.length; i++) {
    grupo(dados.pagamentos[i].nome, dados.pagamentos[i].quantidade, dados.pagamentos[i].total);
  }
  separador();
  escrever("MOTOBOYS - ENTREGAS CONCLUÍDAS", true);
  if (!dados.motoboys.length) escrever("Nenhuma entrega concluída neste caixa.");
  for (let i = 0; i < dados.motoboys.length; i++) {
    grupo(dados.motoboys[i].nome, dados.motoboys[i].quantidade, dados.motoboys[i].total);
  }
  par("Total das entregas", `${numeroValido(dados.entregas, "Entregas")}  ${moeda(numeroValido(dados.ganhosMotoboys, "Ganhos das entregas"))}`, true);
  separador();
  escrever(`PEDIDOS DO EXPEDIENTE (${dados.linhas.length})`, true);
  if (!dados.linhas.length) escrever("Nenhum pedido registrado neste caixa.");
  for (let i = 0; i < dados.linhas.length; i++) {
    const linha = dados.linhas[i];
    par(`${limparTexto(linha.hora)} ${limparTexto(linha.tipo)}`, moeda(numeroValido(linha.total, "Total")));
    const detalhe = [limparTexto(linha.cliente), limparTexto(linha.pagamento)].filter(Boolean).join(" - ");
    if (detalhe) escrever("  " + detalhe);
  }
  separador();
  par("Pedidos cancelados", String(numeroValido(dados.cancelados, "Cancelados")));
  par("Total do caixa", moeda(vendas), true);
  if (config.rodape) {
    separador();
    escrever(config.rodape, false, true);
  }
  adicionar([ESC, 0x64, 3, GS, 0x56, 0x41, 3]);
  const resultado = new Uint8Array(bytes);
  if (!validarBytesEscPos(resultado)) throw new Error("Documento ESC/POS inválido.");
  return resultado;
}

export function validarBytesEscPos(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES || bytes.length < 10 ||
      bytes[0] !== ESC || bytes[1] !== 0x40) return false;
  let cortes = 0;
  let i = 2;
  while (i < bytes.length) {
    const byte = bytes[i];
    if (byte === ESC) {
      if (i + 1 >= bytes.length) return false;
      const comando = bytes[i + 1];
      if (comando === 0x40) {
        i += 2;
        continue;
      }
      if (i + 2 >= bytes.length) return false;
      const parametro = bytes[i + 2];
      if (comando === 0x74 ? parametro !== 2 && parametro !== 3 && parametro !== 19 :
          comando === 0x61 || comando === 0x45 ? parametro !== 0 && parametro !== 1 :
          comando === 0x4d ? parametro !== 0 :
          comando === 0x64 ? parametro !== 3 || i !== bytes.length - 7 : true) return false;
      i += 3;
      continue;
    }
    if (byte === GS) {
      if (i !== bytes.length - 4 || bytes[i + 1] !== 0x56 || bytes[i + 2] !== 0x41 || bytes[i + 3] !== 3 ||
          bytes[i - 3] !== ESC || bytes[i - 2] !== 0x64 || bytes[i - 1] !== 3) return false;
      cortes++;
      i += 4;
      continue;
    }
    if (byte !== LF && (byte < 32 || byte === 127)) return false;
    i++;
  }
  return cortes === 1;
}
