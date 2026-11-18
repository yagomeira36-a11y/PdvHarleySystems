import {
  cadastrarItemEstoque,
  formatarQuantidade,
  lerEstoque,
  movimentarEstoque,
  UNIDADES_ESTOQUE,
} from "./estoque";

export const AJUDA_ASSISTENTE = `Sou o assistente interno do dono e dos funcionários.

ESTOQUE — listar itens e quantidades.
ESTOQUE 12 — consultar o código 12.
BAIXOS — mostrar itens no mínimo ou sem estoque.
ADICIONAR 12 5 — dar entrada de 5 no código 12.
CADASTRAR 101; Molho; un; 10; 2 — cadastrar código, nome, unidade, saldo inicial e mínimo.

Unidades: un, kg, g, L e ml. Use vírgula ou ponto para decimais.
Também posso orientar sobre caixa, produtos, relatórios, delivery, mesas e fotos.
Os comandos CADASTRAR e ADICIONAR alteram o estoque deste navegador.`;

function numeroQuantidade(texto: string): number {
  if (!/^\d+(?:[.,]\d{1,3})?$/.test(texto)) throw new Error("Informe uma quantidade válida, com até três casas decimais.");
  return Number(texto.replace(",", "."));
}

export async function responderAssistente(lojaId: string, mensagem: string): Promise<string> {
  const original = mensagem.trim();
  if (!original || original.length > 500) throw new Error("Digite uma mensagem com até 500 caracteres.");
  const texto = original.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
  if (/^(ajuda|comandos|menu)$/.test(texto)) return AJUDA_ASSISTENTE;
  if (/^(oi|ola|bom dia|boa tarde|boa noite)[!.?]*$/.test(texto)) {
    return "Olá! Posso consultar e atualizar seu estoque por código e orientar sobre o PDV. Digite AJUDA para ver os comandos.";
  }
  if (/^(estoque|listar estoque|ver estoque|baixos|estoque baixo)$/.test(texto)) {
    let itens = lerEstoque(lojaId).itens.slice().sort((a, b) => a.codigo - b.codigo);
    const baixos = texto === "baixos" || texto === "estoque baixo";
    if (baixos) itens = itens.filter((i) => i.saldo <= i.minimo);
    if (itens.length === 0) return baixos ? "Nenhum item está no mínimo ou sem estoque." : "O estoque está vazio. Cadastre um item na tela Estoque ou use CADASTRAR.";
    return `${baixos ? "Itens que precisam de reposição" : "Estoque atual"}:\n` + itens.map((i) =>
      `${i.codigo} · ${i.nome}: ${formatarQuantidade(i.saldo)} ${i.unidade}${i.saldo <= i.minimo ? " — repor" : ""}`
    ).join("\n");
  }
  const consulta = texto.match(/^(?:estoque|consultar|saldo)(?:\s+codigo)?\s+(\d+)$/);
  if (consulta) {
    const item = lerEstoque(lojaId).itens.find((i) => i.codigo === Number(consulta[1]));
    if (!item) return "Código não encontrado. Confira o código na tela Estoque ou cadastre o item primeiro.";
    return `${item.codigo} · ${item.nome}\nDisponível: ${formatarQuantidade(item.saldo)} ${item.unidade}\nMínimo: ${formatarQuantidade(item.minimo)} ${item.unidade}\n${item.saldo <= item.minimo ? "Precisa de reposição." : "Quantidade acima do mínimo."}`;
  }
  const entrada = texto.match(/^(?:adicionar|entrada)(?:\s+codigo)?\s+(\d+)\s+(\d+(?:[.,]\d{1,3})?)$/);
  if (entrada) {
    const quantidade = numeroQuantidade(entrada[2]);
    const item = await movimentarEstoque(lojaId, {
      codigo: Number(entrada[1]), tipo: "entrada", quantidade, origem: "Assistente interno",
      observacao: "Entrada por comando do assistente",
    });
    return `Entrada registrada: ${formatarQuantidade(quantidade)} ${item.unidade} em ${item.codigo} · ${item.nome}.\nSaldo atual: ${formatarQuantidade(item.saldo)} ${item.unidade}.`;
  }
  if (/^cadastrar\s/.test(texto)) {
    const campos = original.replace(/^cadastrar\s+/i, "").split(";").map((c) => c.trim());
    if (campos.length < 4 || campos.length > 5 || !/^\d+$/.test(campos[0])) {
      return "Use: CADASTRAR 101; Molho; un; 10; 2\nA ordem é código; nome; unidade; quantidade inicial; mínimo (opcional).";
    }
    const unidade = UNIDADES_ESTOQUE.find((u) => u.toLowerCase() === campos[2].toLowerCase());
    if (!unidade) return "Unidade inválida. Use un, kg, g, L ou ml.";
    const item = await cadastrarItemEstoque(lojaId, {
      codigo: Number(campos[0]), nome: campos[1], unidade,
      quantidade: numeroQuantidade(campos[3]), minimo: campos[4] ? numeroQuantidade(campos[4]) : 0,
    }, "Assistente interno");
    return `Item cadastrado: ${item.codigo} · ${item.nome}.\nSaldo inicial: ${formatarQuantidade(item.saldo)} ${item.unidade}.\nMínimo: ${formatarQuantidade(item.minimo)} ${item.unidade}.`;
  }
  if (/^(adicionar|entrada|cadastrar|estoque|consultar|saldo)\b/.test(texto)) {
    return "Não consegui entender o código ou a quantidade. Exemplos:\nESTOQUE 12\nADICIONAR 12 5\nCADASTRAR 101; Molho; un; 10; 2\nNenhuma alteração foi feita.";
  }
  if (/caixa/.test(texto)) {
    return "Para abrir o caixa, entre em Gerenciamento → Caixa, informe o troco inicial e clique em Abrir Caixa. Para fechar, clique em Fechar Caixa e confirme os valores. O Painel de Pedidos só funciona com o caixa aberto; Estoque e este assistente continuam disponíveis com o caixa fechado.";
  }
  if (/relatorio|vendas do dia|vendas do mes|vendas do ano/.test(texto)) {
    return "Entre em Gerenciamento → Relatórios e escolha Dia, Mês ou Ano, junto com a data desejada. O gráfico e o extrato seguem o mesmo período; cancelados não entram nos totais. Se todas as vendas ocorreram no mesmo dia, os totais do dia, mês e ano podem coincidir.";
  }
  if (/foto|imagem|banner|layout/.test(texto)) {
    return "Entre em Gerenciamento → Layout para escolher as fotos dos produtos, logo e fundo do sistema. As fotos dos produtos aparecem no Balcão.";
  }
  if (/delivery|entrega|cozinha/.test(texto)) {
    return "Crie o pedido no Balcão escolhendo Delivery e preencha os dados da entrega. Prepare o pedido na Cozinha; ele aparecerá em Delivery. Voltar retorna à cozinha. Entregue envia o pedido para Pedido Finalizado. Essas funções exigem caixa aberto.";
  }
  if (/mesa/.test(texto)) {
    return "Para conferir as mesas, abra Mesa no Painel de Pedidos. Para criar uma venda de mesa, use o Balcão, escolha Mesa e selecione uma mesa disponível. Abra o caixa antes de usar essas funções.";
  }
  if (/produto|cardapio|categoria/.test(texto)) {
    return "Cadastre os produtos de venda em Gerenciamento → Cadastrar Produto. Itens e ingredientes do estoque são cadastrados separadamente em Estoque. O estoque desta etapa não baixa automaticamente quando uma venda é feita. Para criar uma categoria do cardápio, use o botão + no Balcão.";
  }
  if (/whatsapp/.test(texto)) {
    return "Configure a conexão e o Atendente IA em Configurações → Bot Assistente → Atendente IA / WhatsApp. O atendimento aos clientes usa o número conectado da própria loja; este chat interno continua separado.";
  }
  return "Posso ajudar com estoque, caixa, produtos, relatórios, delivery, mesas e fotos. Para consultar um item, use ESTOQUE seguido do código. Digite AJUDA para ver os comandos disponíveis.";
}
