"use client";

// ============================================================
// TELA CONFIGURAÇÕES (hub)
// Primeiro aparece uma "janelinha" com ícone para cada item:
// Empresa, Impressora do PDV, Entrega por KM, Custos, Formas de
// Pagamento, Motoboys, Bot Assistente e Layout.
// Clicando no ícone, a seção abre dentro das Configurações.
// ============================================================
import { useEffect, useState } from "react";
import {
  getSupabase,
  getSessao,
  salvarSessao,
  formatarMoeda,
  Product,
  Configuracao,
} from "@/lib/supabase";
import { lerPagamentos, salvarPagamentos } from "@/lib/pagamentos";
import DeliveryZonesMap from "./DeliveryZonesMap";
import ConfigImpressora from "./ConfigImpressora";
import Motoboys from "./Motoboys";
import BotAssistente from "./BotAssistente";
import LayoutConfig from "./LayoutConfig";

// Formulário da empresa
type FormEmpresa = {
  nome_empresa: string;
  cnpj: string;
  telefone: string;
  endereco: string;
};

// Seções acessíveis pelo hub
type Secao =
  | "hub"
  | "empresa"
  | "impressora"
  | "zonas"
  | "custos"
  | "pagamentos"
  | "motoboys"
  | "bot"
  | "layout";

// ============================================================
// ÍCONES DO HUB (um para cada "janelinha")
// ============================================================
function IconeLoja() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M4 12v8h16v-8" />
      <path d="M9 20v-5h6v5" />
    </svg>
  );
}
function IconeImpressora() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </svg>
  );
}
function IconeMapa() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function IconeCusto() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8" />
      <path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h4" />
    </svg>
  );
}
function IconePagamento() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}
function IconeMotoboy() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M5 14 9 7h4l1.5 4" />
      <path d="m12 5 3-2" />
      <circle cx="7.5" cy="7" r="0.6" fill="currentColor" />
    </svg>
  );
}
function IconeBot() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="7" width="16" height="13" rx="3" />
      <path d="M12 7V3M10 3h4M2 11v5M22 11v5M9 16h6" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
    </svg>
  );
}
function IconeLayout() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

// ============================================================
// JANELINHAS DO HUB (ícone + título + descrição)
// ============================================================
const CARTOES: {
  id: Secao;
  titulo: string;
  descricao: string;
  icone: React.ReactNode;
}[] = [
  {
    id: "empresa",
    titulo: "Empresa",
    descricao: "Nome, CNPJ, telefone, endereço e taxa de entrega padrão.",
    icone: <IconeLoja />,
  },
  {
    id: "impressora",
    titulo: "Impressora do PDV",
    descricao: "Impressoras do cliente e da cozinha (QZ Tray).",
    icone: <IconeImpressora />,
  },
  {
    id: "zonas",
    titulo: "Entrega por KM",
    descricao: "Zonas de raio (KM) e valor no mapa de entrega.",
    icone: <IconeMapa />,
  },
  {
    id: "custos",
    titulo: "Custos dos Produtos",
    descricao: "Custo de cada produto para o cálculo do lucro.",
    icone: <IconeCusto />,
  },
  {
    id: "pagamentos",
    titulo: "Formas de Pagamento",
    descricao: "Opções exibidas ao finalizar um pedido no Balcão.",
    icone: <IconePagamento />,
  },
  {
    id: "motoboys",
    titulo: "Motoboys",
    descricao: "Cadastro de motoboys e controle das entregas.",
    icone: <IconeMotoboy />,
  },
  {
    id: "bot",
    titulo: "Bot Assistente",
    descricao: "Assistente interno de estoque por conversa.",
    icone: <IconeBot />,
  },
  {
    id: "layout",
    titulo: "Layout",
    descricao: "Cor, letras, logo, fundo, cardápio e menus do sistema.",
    icone: <IconeLayout />,
  },
];

// Botão de voltar para o hub (usado em todas as seções)
function BotaoVoltar({ onVoltar }: { onVoltar: () => void }) {
  return (
    <button
      onClick={onVoltar}
      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-600 transition hover:border-green-300 hover:text-green-700"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 18-6-6 6-6" />
      </svg>
      Configurações
    </button>
  );
}

export default function Configuracoes({
  refreshKey,
  aoPedidoCriado,
}: {
  refreshKey: number;
  aoPedidoCriado: (texto: string, tipo?: "ok" | "erro") => void;
}) {
  const supabase = getSupabase();

  // Seção aberta dentro das Configurações ("hub" = grade de janelinhas)
  const [secao, setSecao] = useState<Secao>("hub");

  // Estados da tela
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [empresa, setEmpresa] = useState<Configuracao | null>(null);
  const [form, setForm] = useState<FormEmpresa>({
    nome_empresa: "",
    cnpj: "",
    telefone: "",
    endereco: "",
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
    const nomeEmpresa = form.nome_empresa.trim();
    const { error } = await supabase.from("configuracoes").upsert(
      {
        loja_id: sessao.id, // uma linha de configuração por loja
        nome_empresa: nomeEmpresa,
        cnpj: form.cnpj.trim() || null,
        telefone: form.telefone.trim() || null,
        endereco: form.endereco.trim() || null,
      },
      { onConflict: "loja_id" }
    );
    if (error) {
      setMensagem("Erro ao salvar: " + error.message);
      return;
    }

    let resposta: Response;
    try {
      const leitura = await fetch("/api/store-settings", { cache: "no-store" });
      if (!leitura.ok) {
        setMensagem(
          "Nome salvo nas configurações, mas não foi possível carregar as configurações do site."
        );
        return;
      }
      const settingsAtuais = (await leitura.json()) as Record<string, unknown>;
      resposta = await fetch("/api/store-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settingsAtuais, nome_loja: nomeEmpresa }),
      });
    } catch (erro) {
      setMensagem(
        "Nome salvo nas configurações, mas não foi possível atualizar o site: " +
          (erro instanceof Error ? erro.message : String(erro))
      );
      return;
    }
    if (!resposta.ok) {
      const resultado = (await resposta.json().catch(() => null)) as
        | { error?: string }
        | null;
      setMensagem(
        "Nome salvo nas configurações, mas não foi possível atualizar o site: " +
          (resultado?.error || "erro ao sincronizar o nome da loja.")
      );
      return;
    }

    const { error: erroLoja } = await supabase
      .from("lojas")
      .update({ nome_loja: nomeEmpresa })
      .eq("id", sessao.id);
    salvarSessao({ ...sessao, nome_loja: nomeEmpresa });
    window.dispatchEvent(new Event("pdv-sessao-atualizada"));

    if (erroLoja) {
      setMensagem(
        "Nome atualizado no site, mas não foi possível atualizar o cadastro da loja: " +
          erroLoja.message
      );
      carregar();
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

  // Abre uma seção a partir do hub
  function abrir(nova: Secao) {
    setMensagem(null);
    setSecao(nova);
  }

  const tituloSecao = CARTOES.find((c) => c.id === secao)?.titulo ?? "Configurações";

  // ============================================================
  // SEÇÕES QUE SÃO TELAS INTEIRAS (têm rolagem própria):
  // Motoboys, Bot Assistente e Layout
  // ============================================================
  if (secao === "motoboys" || secao === "bot" || secao === "layout") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <BotaoVoltar onVoltar={() => setSecao("hub")} />
          <h1 className="text-xl font-bold">{tituloSecao}</h1>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {secao === "motoboys" && <Motoboys refreshKey={refreshKey} />}
          {secao === "bot" && <BotAssistente />}
          {secao === "layout" && <LayoutConfig aoPedidoCriado={aoPedidoCriado} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {secao === "hub" ? (
        // ================= HUB: janelinhas com ícone =================
        <>
          <h1 className="text-2xl font-bold mb-1">Configurações</h1>
          <p className="text-sm text-gray-400 mb-6">
            {empresa?.nome_empresa ?? "PDV Hamburgueria"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {CARTOES.map((c) => (
              <button
                key={c.id}
                onClick={() => abrir(c.id)}
                className="group flex flex-col items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-green-400 hover:shadow-md"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-700 transition group-hover:bg-green-100">
                  {c.icone}
                </span>
                <span className="font-bold text-gray-800">{c.titulo}</span>
                <span className="text-xs text-gray-500">{c.descricao}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        // ================= SEÇÕES INTERNAS =================
        <>
          <div className="flex items-center gap-3 mb-4">
            <BotaoVoltar onVoltar={() => setSecao("hub")} />
            <h1 className="text-2xl font-bold">{tituloSecao}</h1>
          </div>

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
              {/* ================= EMPRESA ================= */}
              {secao === "empresa" && (
                <section>
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
              )}

              {/* ================= IMPRESSORA DO PDV ================= */}
              {secao === "impressora" && <ConfigImpressora empresa={empresa} />}

              {/* ================= ENTREGA (ZONAS NO MAPA) ================= */}
              {secao === "zonas" && (
                <section>
                  <p className="text-xs text-gray-400 mb-3">
                    Defina o centro e as zonas de entrega. O PDV e o cardápio online
                    usam o mesmo mapa, raios e valores.
                  </p>
                  <DeliveryZonesMap
                    lojaId={getSessao()?.id ?? ""}
                    enderecoLoja={form.endereco}
                  />
                </section>
              )}

              {/* ================= CUSTOS DOS PRODUTOS ================= */}
              {secao === "custos" && (
                <section>
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
              )}

              {/* ================= FORMAS DE PAGAMENTO ================= */}
              {secao === "pagamentos" && (
                <section>
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
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
