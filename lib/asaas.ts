// ============================================================
// ASAAS — cobrança da mensalidade (R$ 79,99 por mês)
// ============================================================
// ATENÇÃO: aqui usamos a chave SECRETA ASAAS_API_KEY, que fica só
// no .env.local do servidor. Este arquivo NUNCA pode ser importado
// por componente "use client" — só por rotas de API (app/api/**).
// ============================================================

export const VALOR_MENSALIDADE = 79.99;
export const DESCRICAO_MENSALIDADE = "PdvDaGalera - mensalidade mensal";

// Endereços da API do Asaas
const URLS = {
  sandbox: "https://sandbox.asaas.com/api/v3",
  producao: "https://api.asaas.com/v3",
};

// Ambiente em uso: "sandbox" (testes) ou "producao"
export function ambienteAsaas(): "sandbox" | "producao" {
  return process.env.ASAAS_AMBIENTE === "producao" ? "producao" : "sandbox";
}

// ============================================================
// CHAMADA BASE PARA A API
// ============================================================
async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  const chave = process.env.ASAAS_API_KEY;
  if (!chave) {
    throw new Error("ASAAS_API_KEY não configurada no .env.local.");
  }

  const resposta = await fetch(URLS[ambienteAsaas()] + caminho, {
    method: init?.method ?? "GET",
    body: init?.body,
    // A chave vai só no cabeçalho, direto do servidor para o Asaas
    headers: { "Content-Type": "application/json", access_token: chave },
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
    throw new Error(`Asaas: ${detalhe}`);
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
  billingType?: string | null;
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

// Data de hoje no formato AAAA-MM-DD (horário local do servidor)
function hojeISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ============================================================
// CRIAR ASSINATURA (R$ 79,99/mês)
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
      // UNDEFINED = o cliente escolhe Pix ou cartão na tela do Asaas
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
  clienteId: string
): Promise<CobrancaAsaas | null> {
  const lista = await listarCobrancasAsaas(clienteId);
  const aberta = lista.find(
    (c) => c.status === "PENDING" || c.status === "OVERDUE"
  );
  return aberta ?? lista[0] ?? null;
}

// QR Code do Pix de uma fatura
export async function buscarPixAsaas(cobrancaId: string): Promise<PixAsaas> {
  return chamar<PixAsaas>(
    `/payments/${encodeURIComponent(cobrancaId)}/pixQrCode`
  );
}

// Dados da assinatura (usado para saber o próximo vencimento)
export async function buscarAssinaturaAsaas(
  assinaturaId: string
): Promise<AssinaturaAsaas> {
  return chamar<AssinaturaAsaas>(
    `/subscriptions/${encodeURIComponent(assinaturaId)}`
  );
}
