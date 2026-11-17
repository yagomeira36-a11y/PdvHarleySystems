"use client";

// ============================================================
// TELA CONFIGURAÇÕES
// 1) EMPRESA: dados da empresa (nome, CNPJ, telefone, endereço,
//    taxa de entrega padrão) salvos na tabela "configuracoes"
// 2) CUSTOS: editar o custo de cada produto (para o lucro)
// 3) FORMAS DE PAGAMENTO: adicionar/remover (por loja)
// ============================================================
import { useEffect, useState } from "react";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  Product,
  Configuracao,
} from "@/lib/supabase";
import { lerPagamentos, salvarPagamentos } from "@/lib/pagamentos";
import ConfigImpressora from "./ConfigImpressora";

// Formulário da empresa
type FormEmpresa = {
  nome_empresa: string;
  cnpj: string;
  telefone: string;
  endereco: string;
  taxa_entrega_padrao: string;
};

export default function Configuracoes({ refreshKey }: { refreshKey: number }) {
  const supabase = getSupabase();

  // Estados da tela
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [empresa, setEmpresa] = useState<Configuracao | null>(null);
  const [form, setForm] = useState<FormEmpresa>({
    nome_empresa: "",
    cnpj: "",
    telefone: "",
    endereco: "",
    taxa_entrega_padrao: "",
  });
  // Custo digitado para cada produto (antes de salvar)
  const [custos, setCustos] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<string | null>(null);

  // Formas de pagamento da loja
  const [pagamentos, setPagamentos] = useState<string[]>([]);
  const [novoPagamento, setNovoPagamento] = useState("");
  // ============================================================
  // CARREGAR DADOS
  // ============================================================
  async function carregar() {
    if (!supabase) return;
    const sessao = getSessao();
    if (!sessao) return;
    setCarregando(true);

    // Formas de pagamento salvas no navegador da loja
    setPagamentos(lerPagamentos(sessao.id));

    const [resProdutos, resConfig] = await Promise.all([
      supabase.from("products").select("*").eq("loja_id", sessao.id).order("code"),
      supabase.from("configuracoes").select("*").eq("loja_id", sessao.id).maybeSingle(),
    ]);

    setProdutos((resProdutos.data || []) as Product[]);

    // Preenche o formulário da empresa (ou valores padrão)
    const config = (resConfig.data || null) as Configuracao | null;
    setEmpresa(config);
    setForm({
      nome_empresa: config?.nome_empresa ?? "PDV Hamburgueria",
      cnpj: config?.cnpj ?? "",
      telefone: config?.telefone ?? "",
      endereco: config?.endereco ?? "",
      taxa_entrega_padrao: String(config?.taxa_entrega_padrao ?? ""),
    });

    // Preenche os campos de custo com o valor atual de cada produto
    const mapa: Record<string, string> = {};
    (resProdutos.data || []).forEach((p: Product) => {
      mapa[p.id] = String(p.cost ?? 0);
    });
    setCustos(mapa);

    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // ============================================================
  // SALVAR DADOS DA EMPRESA
  // ============================================================
  async function salvarEmpresa(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const sessao = getSessao();
    if (!sessao) return;
    const { error } = await supabase.from("configuracoes").upsert(
      {
        loja_id: sessao.id, // uma linha de configuração por loja
        nome_empresa: form.nome_empresa.trim(),
        cnpj: form.cnpj.trim() || null,
        telefone: form.telefone.trim() || null,
        endereco: form.endereco.trim() || null,
        taxa_entrega_padrao: parseFloat(form.taxa_entrega_padrao.replace(",", ".")) || 0,
      },
      { onConflict: "loja_id" }
    );
    if (error) {
      setMensagem("Erro ao salvar: " + error.message);
      return;
    }
    setMensagem("Configurações da empresa salvas!");
    carregar();
  }

  // ============================================================
  // SALVAR CUSTO DE UM PRODUTO
  // ============================================================
  async function salvarCusto(produto: Product) {
    if (!supabase) return;
    const custo = parseFloat((custos[produto.id] ?? "0").replace(",", ".")) || 0;
    const { error } = await supabase
      .from("products")
      .update({ cost: custo })
      .eq("id", produto.id);
    if (error) {
      setMensagem("Erro ao salvar custo: " + error.message);
      return;
    }
    setMensagem(`Custo de "${produto.name}" atualizado!`);
    carregar();
  }

  // ============================================================
  // FORMAS DE PAGAMENTO (adicionar/remover — salvas na loja)
  // ============================================================
  function adicionarPagamento() {
    const nome = novoPagamento.trim();
    if (!nome) return;
    if (pagamentos.some((p) => p.toLowerCase() === nome.toLowerCase())) {
      setMensagem("Essa forma de pagamento já existe.");
      return;
    }
    const sessao = getSessao();
    if (!sessao) return;
    const lista = [...pagamentos, nome];
    setPagamentos(lista);
    salvarPagamentos(sessao.id, lista);
    setNovoPagamento("");
    setMensagem(`Forma de pagamento "${nome}" adicionada!`);
  }

  function removerPagamento(nome: string) {
    const sessao = getSessao();
    if (!sessao) return;
    const lista = pagamentos.filter((p) => p !== nome);
    setPagamentos(lista);
    salvarPagamentos(sessao.id, lista);
    setMensagem(`Forma de pagamento "${nome}" removida.`);
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h1 className="text-2xl font-bold mb-1">Configurações</h1>
      <p className="text-sm text-gray-400 mb-4">
        {empresa?.nome_empresa ?? "PDV Hamburgueria"}
      </p>

      {/* Mensagens */}
      {mensagem && (
        <div className="bg-green-50 border border-green-500 text-green-700 rounded-lg p-3 mb-4">
          {mensagem}
        </div>
      )}

      {carregando ? (
        <p className="text-gray-400 text-center py-10">Carregando...</p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* ================= 1) EMPRESA ================= */}
          <section>
            <h2 className="font-bold text-lg mb-3">Configurações da Empresa</h2>
            <form
              onSubmit={salvarEmpresa}
              className="bg-white rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Nome da empresa
                </label>
                <input
                  type="text"
                  value={form.nome_empresa}
                  onChange={(e) => setForm({ ...form, nome_empresa: e.target.value })}
                  className="w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">CNPJ</label>
                <input
                  type="text"
                  value={form.cnpj}
                  onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  placeholder="00.000.000/0000-00"
                  className="w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Telefone</label>
                <input
                  type="text"
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  placeholder="(00) 00000-0000"
                  className="w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Taxa de entrega padrão (R$)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.taxa_entrega_padrao}
                  onChange={(e) =>
                    setForm({ ...form, taxa_entrega_padrao: e.target.value })
                  }
                  placeholder="Ex: 8,00"
                  className="w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-400 mb-1">Endereço</label>
                <input
                  type="text"
                  value={form.endereco}
                  onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                  placeholder="Rua, número, bairro, cidade"
                  className="w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="bg-green-600 hover:bg-green-700 font-bold px-6 py-2 rounded-lg transition"
                >
                  Salvar Configurações
                </button>
              </div>
            </form>
          </section>

          <ConfigImpressora empresa={empresa} />

          {/* ================= 2) CUSTOS DOS PRODUTOS ================= */}
          <section>
            <h2 className="font-bold text-lg mb-1">Custos dos Produtos</h2>
            <p className="text-xs text-gray-400 mb-3">
              O lucro é calculado como (preço - custo) x quantidade vendida.
            </p>
            <div className="bg-white rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-gray-600 text-left">
                  <tr>
                    <th className="px-4 py-2">Produto</th>
                    <th className="px-4 py-2 text-right">Preço</th>
                    <th className="px-4 py-2 text-right w-32">Custo (R$)</th>
                    <th className="px-4 py-2 text-right">Lucro unit.</th>
                    <th className="px-4 py-2 text-center w-28">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {produtos.map((p) => {
                    const custoAtual =
                      parseFloat((custos[p.id] ?? "0").replace(",", ".")) || 0;
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          {p.code} · {p.name}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {formatarMoeda(Number(p.price))}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={custos[p.id] ?? "0"}
                            onChange={(e) =>
                              setCustos({ ...custos, [p.id]: e.target.value })
                            }
                            className="w-24 bg-gray-100 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        </td>
                        <td className="px-4 py-2 text-right text-green-600 font-semibold">
                          {formatarMoeda(Number(p.price) - custoAtual)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => salvarCusto(p)}
                            className="bg-blue-600 hover:bg-blue-700 text-xs font-bold px-3 py-1.5 rounded transition"
                          >
                            Salvar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ================= 3) FORMAS DE PAGAMENTO ================= */}
          <section>
            <h2 className="font-bold text-lg mb-1">Formas de Pagamento</h2>
            <p className="text-xs text-gray-400 mb-3">
              Estas opções aparecem ao finalizar um pedido no Balcão. Você
              pode adicionar novas (ex: Vale-refeição, Fiado) ou remover.
            </p>
            <div className="bg-white rounded-xl p-4">
              <div className="flex flex-wrap gap-2 mb-3">
                {pagamentos.map((p) => (
                  <span
                    key={p}
                    className="bg-gray-100 rounded-full pl-3 pr-1 py-1 flex items-center gap-2 text-sm"
                  >
                    {p}
                    <button
                      onClick={() => removerPagamento(p)}
                      className="text-gray-400 hover:text-red-600 font-bold px-1.5 leading-none"
                      title={`Remover "${p}"`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={novoPagamento}
                  onChange={(e) => setNovoPagamento(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      adicionarPagamento();
                    }
                  }}
                  placeholder="Ex: Vale-refeição, Fiado..."
                  className="flex-1 bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  onClick={adicionarPagamento}
                  disabled={!novoPagamento.trim()}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-40 font-bold px-5 py-2 rounded-lg transition"
                >
                  Adicionar
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
