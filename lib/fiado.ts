// ============================================================
// FIADO (crédito da loja) — dívidas e pagamentos dos clientes
// Os lançamentos ficam no Supabase, na tabela "fiados"
// (rode o arquivo supabase/adicionar-fiado.sql uma vez).
// ============================================================

export type FiadoTipo = "divida" | "pagamento";

// Lançamento de fiado (tabela "fiados")
export type Fiado = {
  id: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  tipo: FiadoTipo;
  valor: number;
  descricao: string | null;
  data: string; // AAAA-MM-DD
  created_at?: string;
};

// Saldo consolidado de um cliente (agrupado pelo nome)
export type FiadoCliente = {
  chave: string; // nome normalizado (usado para agrupar)
  nome: string; // nome como foi digitado por último
  telefone: string | null;
  saldo: number; // dívidas - pagamentos
  ultimaData: string; // data do lançamento mais recente
  lancamentos: Fiado[];
};

// Chave de agrupamento: sem espaços extras e em minúsculas
export function chaveCliente(nome: string): string {
  return nome.trim().toLowerCase().replace(/\s+/g, " ");
}

// Junta os lançamentos por cliente e calcula o saldo de cada um
export function agruparPorCliente(lancamentos: Fiado[]): FiadoCliente[] {
  const mapa = new Map<string, FiadoCliente>();

  for (const l of lancamentos) {
    const chave = chaveCliente(l.cliente_nome);
    if (!chave) continue;

    let cliente = mapa.get(chave);
    if (!cliente) {
      cliente = {
        chave,
        nome: l.cliente_nome.trim(),
        telefone: null,
        saldo: 0,
        ultimaData: l.data,
        lancamentos: [],
      };
      mapa.set(chave, cliente);
    }

    cliente.saldo += (l.tipo === "divida" ? 1 : -1) * Number(l.valor || 0);
    cliente.lancamentos.push(l);
    if (l.data > cliente.ultimaData) cliente.ultimaData = l.data;
    if (l.cliente_telefone) cliente.telefone = l.cliente_telefone;
  }

  const lista = Array.from(mapa.values());
  for (const cliente of lista) {
    cliente.saldo = Math.round(cliente.saldo * 100) / 100;
    cliente.lancamentos.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  }
  // Quem deve mais aparece primeiro
  lista.sort((a, b) => b.saldo - a.saldo);
  return lista;
}

// Data de hoje no formato AAAA-MM-DD (fuso do navegador)
export function hojeISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// AAAA-MM-DD -> DD/MM/AAAA
export function dataBR(data: string): string {
  const [ano, mes, dia] = (data || "").split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : data;
}

// Texto com vírgula ou ponto -> número (ex: "12,50" -> 12.5)
export function paraValor(texto: string): number {
  const numero = parseFloat((texto || "").replace(",", "."));
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : 0;
}
