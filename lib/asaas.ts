// ============================================================
// ASAAS — cobrança da mensalidade (R$ 74,90 por mês)
// ============================================================
// ATENÇÃO: a chave secreta ASAAS_API_KEY deve estar nas variáveis
// de ambiente do servidor. Este arquivo NUNCA pode ser importado
// por componente "use client" — só por rotas de API (app/api/**).
// ============================================================

export const VALOR_MENSALIDADE = 74.9;
export const DESCRICAO_MENSALIDADE = "Ponto De Vendas Harley Systems - mensalidade mensal";

export class ErroAsaas extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    detail: string
  ) {
    super(`Asaas: ${method} ${path} HTTP ${status}: ${detail}`);
    this.name = "ErroAsaas";
  }
}

const ASAAS_API_URL_PADRAO = "https://api.asaas.com/v3";

function urlApiAsaas(): string {
  const configurada = process.env.ASAAS_API_URL?.trim();
  return (configurada || ASAAS_API_URL_PADRAO).replace(/\/+$/, "");
}

function validarAmbienteAsaas(chave: string, url: string): void {
  const chaveNormalizada = chave.replace(/^\$/, "");
  const ambienteTeste = /(^|[_-])(?:hmlg|sandbox)([_-]|$)/i.test(chaveNormalizada);

  let hostApi: string;
  try {
    hostApi = new URL(url).hostname;
  } catch {
    throw new Error("ASAAS_API_URL inválida. Informe a URL base da API do Asaas.");
  }

  if (ambienteTeste && hostApi === "api.asaas.com") {
    throw new Error(
      "A ASAAS_API_KEY configurada é de sandbox, mas a ASAAS_API_URL aponta para produção. Configure uma chave de produção nas variáveis de ambiente da Vercel."
    );
  }
}

// ============================================================
// CHAMADA BASE PARA A API
// ============================================================
async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  const chave = process.env.ASAAS_API_KEY?.trim();
  if (!chave) {
    throw new Error("ASAAS_API_KEY não configurada nas variáveis de ambiente.");
  }

  const url = urlApiAsaas();
  validarAmbienteAsaas(chave, url);

  const method = init?.method ?? "GET";
  const resposta = await fetch(url + caminho, {
    method,
    body: init?.body,
    // A chave vai só no cabeçalho, direto do servidor para o Asaas
    headers: { "Content-Type": "application/json", access_token: chave, "User-Agent": "HarleySystems/1.0.0" },
    cache: "no-store",
  });

  const texto = await resposta.text();
  let dados: unknown = null;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = null;
    }
  }

  if (!resposta.ok) {
    const erros = (dados as { errors?: { description?: string }[] } | null)?.errors;
    const detalhe =
      Array.isArray(erros) && erros.length > 0
        ? erros.map((e) => e?.description).filter(Boolean).join(" | ")
        : `HTTP ${resposta.status}`;
    const path = caminho
      .split("?")[0]
      .replace(/\/(?:cus|sub|pay)_[^/]+/g, "/:id");
    throw new ErroAsaas(resposta.status, method, path, detalhe);
  }

  return dados as T;
}

// ============================================================
// TIPOS DE RESPOSTA DO ASAAS
// ============================================================

// Cliente (a loja) no Asaas
export type ClienteAsaas = {
  id: string;
  name: string;
  email: string;
  deleted?: boolean;
};

// Assinatura (cobrança que se repete todo mês)
export type AssinaturaAsaas = {
  id: string;
  customer: string;
  value: number;
  cycle: string;
  status: string; // ACTIVE | INACTIVE | EXPIRED
  nextDueDate: string;
};

// Cobrança (a fatura de um mês) gerada pela assinatura
export type CobrancaAsaas = {
  id: string;
  customer: string;
  subscription: string | null;
  status: string; // PENDING | RECEIVED | CONFIRMED | OVERDUE | REFUNDED...
  value: number;
  dueDate: string;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  billingType?: string | null;
  externalReference?: string | null;
};

// QR Code do Pix
export type PixAsaas = {
  encodedImage: string; // imagem do QR Code em base64 (PNG)
  payload: string; // código "copia e cola"
  expirationDate?: string;
};

// ============================================================
// CRIAR CLIENTE
// ============================================================
export async function criarClienteAsaas(dados: {
  nome: string;
  email: string;
  telefone?: string | null;
  // O Asaas exige CPF ou CNPJ para gerar a cobrança da assinatura
  cpfCnpj: string;
  lojaId: string;
}): Promise<ClienteAsaas> {
  return chamar<ClienteAsaas>("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: dados.nome,
      email: dados.email,
      cpfCnpj: dados.cpfCnpj,
      phone: dados.telefone ?? undefined,
      // Guarda o id da loja no Asaas: é assim que o webhook
      // descobre de qual loja veio o pagamento
      externalReference: dados.lojaId,
    }),
  });
}

export async function buscarClienteAsaas(clienteId: string): Promise<ClienteAsaas> {
  return chamar<ClienteAsaas>(`/customers/${encodeURIComponent(clienteId)}`);
}

export async function buscarClienteAsaasPorReferencia(
  lojaId: string
): Promise<ClienteAsaas | null> {
  const resposta = await chamar<{ data?: ClienteAsaas[] }>(
    `/customers?externalReference=${encodeURIComponent(lojaId)}&limit=100`
  );
  return resposta.data?.find((cliente) => !cliente.deleted) ?? null;
}

export async function buscarClienteAsaasPorDocumento(
  cpfCnpj: string
): Promise<ClienteAsaas | null> {
  const resposta = await chamar<{ data?: ClienteAsaas[] }>(
    `/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}&limit=100`
  );
  return resposta.data?.find((cliente) => !cliente.deleted) ?? null;
}

// Data de hoje no formato AAAA-MM-DD (horário local do servidor)
function hojeISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ============================================================
// CRIAR ASSINATURA (R$ 74,90/mês)
// ============================================================
export async function criarAssinaturaAsaas(dados: {
  clienteId: string;
  lojaId: string;
  vencimento: string; // primeira cobrança, no formato AAAA-MM-DD
  valor?: number;
}): Promise<AssinaturaAsaas> {
  // O Asaas recusa data de vencimento no passado ("Não é permitido data
  // de vencimento inferior a hoje"). Quando a loja é criada já vencida,
  // a primeira cobrança vence hoje — assim o dono entra em /pagamento e
  // recebe o Pix (QR + copia e cola) e o boleto para liberar a loja.
  const hoje = hojeISO();
  const primeiroVencimento = dados.vencimento < hoje ? hoje : dados.vencimento;

  return chamar<AssinaturaAsaas>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      customer: dados.clienteId,
      billingType: "UNDEFINED",
      value: dados.valor ?? VALOR_MENSALIDADE,
      nextDueDate: primeiroVencimento,
      cycle: "MONTHLY",
      description: DESCRICAO_MENSALIDADE,
      externalReference: dados.lojaId,
    }),
  });
}

// ============================================================
// CONSULTAS (usadas pela tela de pagamento e pelo webhook)
// ============================================================

// Todas as faturas do cliente (da mais nova para a mais antiga)
export async function listarCobrancasAsaas(
  clienteId: string,
  limite = 12
): Promise<CobrancaAsaas[]> {
  const resposta = await chamar<{ data?: CobrancaAsaas[] }>(
    `/payments?customer=${encodeURIComponent(clienteId)}&limit=${limite}`
  );
  const lista = resposta.data ?? [];
  return lista.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
}

// A fatura que o cliente precisa pagar agora (em aberto ou atrasada)
export async function buscarCobrancaAberta(
  clienteId: string,
  lojaId: string,
  assinaturaId: string | null
): Promise<CobrancaAsaas | null> {
  const referencia = `pdvdg-mensalidade-${lojaId}`;
  const pagamentosCliente = await chamar<{ data?: CobrancaAsaas[] }>(
    `/payments?customer=${encodeURIComponent(clienteId)}&limit=100`
  );
  let recorrentes: CobrancaAsaas[] = [];

  if (assinaturaId) {
    try {
      const resposta = await chamar<{ data?: CobrancaAsaas[] }>(
        `/subscriptions/${encodeURIComponent(assinaturaId)}/payments?limit=100`
      );
      recorrentes = resposta.data ?? [];
    } catch (e) {
      if (!(e instanceof ErroAsaas) || e.status !== 404) throw e;
    }
  }

  return [...(pagamentosCliente.data ?? []), ...recorrentes]
    .filter((c) => c.customer === clienteId && (c.status === "PENDING" || c.status === "OVERDUE"))
    .filter(
      (c) =>
        (assinaturaId !== null && c.subscription === assinaturaId) ||
        c.externalReference === referencia
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
}

function proximoMesISO(data: string): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(dia, ultimoDia)))
    .toISOString()
    .slice(0, 10);
}

export async function criarCobrancaMensalAsaas(dados: {
  clienteId: string;
  assinaturaId: string;
  lojaId: string;
  vencimento: string | null;
}): Promise<CobrancaAsaas> {
  const referencia = `pdvdg-mensalidade-${dados.lojaId}`;
  let cobranca = await buscarCobrancaAberta(
    dados.clienteId,
    dados.lojaId,
    dados.assinaturaId
  );
  const assinatura = await buscarAssinaturaAsaas(dados.assinaturaId);

  if (!cobranca) {
    const hoje = hojeISO();
    const vencimentoBase = dados.vencimento ?? assinatura.nextDueDate ?? hoje;
    const vencimento = [hoje, vencimentoBase, assinatura.nextDueDate]
      .filter(Boolean)
      .sort()
      .pop()!;
    cobranca = await chamar<CobrancaAsaas>("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: dados.clienteId,
        billingType: "UNDEFINED",
        value: VALOR_MENSALIDADE,
        dueDate: vencimento,
        description: DESCRICAO_MENSALIDADE,
        externalReference: referencia,
      }),
    });
  }

  // Uma cobrança avulsa substitui a parcela ainda não emitida da assinatura.
  if (!cobranca.subscription && assinatura.nextDueDate <= cobranca.dueDate) {
    await chamar<AssinaturaAsaas>(
      `/subscriptions/${encodeURIComponent(dados.assinaturaId)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          nextDueDate: proximoMesISO(cobranca.dueDate),
          value: VALOR_MENSALIDADE,
        }),
      }
    );
  }

  return cobranca;
}

// QR Code do Pix de uma fatura
export async function buscarPixAsaas(cobrancaId: string): Promise<PixAsaas> {
  return chamar<PixAsaas>(
    `/payments/${encodeURIComponent(cobrancaId)}/pixQrCode`
  );
}

export async function buscarBoletoAsaas(cobrancaId: string): Promise<{
  identificationField: string;
  barCode: string;
}> {
  return chamar(`/payments/${encodeURIComponent(cobrancaId)}/identificationField`);
}

export async function garantirVinculoAsaas(loja: {
  id: string;
  nome_loja: string;
  email_dono: string;
  data_vencimento: string | null;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
}, cpfCnpj: string): Promise<
  { requerCpf: true } | { clienteId: string; assinaturaId: string }
> {
  let cliente: ClienteAsaas | null = null;
  if (loja.asaas_customer_id) {
    try {
      cliente = await buscarClienteAsaas(loja.asaas_customer_id);
      if (cliente.deleted) cliente = null;
    } catch (e) {
      if (!(e instanceof ErroAsaas) || e.status !== 404) throw e;
    }
  }
  cliente ??= await buscarClienteAsaasPorReferencia(loja.id);
  if (!cliente) {
    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) return { requerCpf: true };
    cliente = await buscarClienteAsaasPorDocumento(cpfCnpj) ?? await criarClienteAsaas({
      nome: loja.nome_loja,
      email: loja.email_dono,
      cpfCnpj,
      lojaId: loja.id,
    });
  }

  let assinatura: AssinaturaAsaas | null = null;
  if (loja.asaas_subscription_id) {
    try {
      assinatura = await buscarAssinaturaAsaas(loja.asaas_subscription_id);
      if (assinatura.customer !== cliente.id || assinatura.status !== "ACTIVE") {
        assinatura = null;
      }
    } catch (e) {
      if (!(e instanceof ErroAsaas) || e.status !== 404) throw e;
    }
  }
  if (!assinatura) {
    const existentes = await chamar<{ data?: AssinaturaAsaas[] }>(
      `/subscriptions?customer=${encodeURIComponent(cliente.id)}&externalReference=${encodeURIComponent(loja.id)}&limit=100`
    );
    assinatura = existentes.data?.find(
      (item) => item.customer === cliente.id && item.status === "ACTIVE"
    ) ?? await criarAssinaturaAsaas({
      clienteId: cliente.id,
      lojaId: loja.id,
      vencimento: loja.data_vencimento ?? hojeISO(),
    });
  }
  return { clienteId: cliente.id, assinaturaId: assinatura.id };
}

// Dados da assinatura (usado para saber o próximo vencimento)
export async function buscarAssinaturaAsaas(
  assinaturaId: string
): Promise<AssinaturaAsaas> {
  return chamar<AssinaturaAsaas>(
    `/subscriptions/${encodeURIComponent(assinaturaId)}`
  );
}
