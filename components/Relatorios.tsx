"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  rotuloPedido,
  Order,
  OrderItem,
} from "@/lib/supabase";
import { filtrarPedidosCancelados } from "@/lib/pedidos";

type Periodo = "dia" | "mes" | "ano" | "tudo";
type PontoGrafico = { rotulo: string; descricao: string; total: number; pedidos: number };

const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: "dia", rotulo: "Dia" },
  { valor: "mes", rotulo: "Mês" },
  { valor: "ano", rotulo: "Ano" },
  { valor: "tudo", rotulo: "Tudo" },
];

function dataLocal(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function formatarHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function limites(data: Date, periodo: Exclude<Periodo, "tudo">): [number, number] {
  const ano = data.getFullYear();
  const mes = data.getMonth();
  const dia = data.getDate();
  if (periodo === "dia") {
    return [new Date(ano, mes, dia).getTime(), new Date(ano, mes, dia + 1).getTime()];
  }
  if (periodo === "mes") {
    return [new Date(ano, mes, 1).getTime(), new Date(ano, mes + 1, 1).getTime()];
  }
  return [new Date(ano, 0, 1).getTime(), new Date(ano + 1, 0, 1).getTime()];
}

function nestePeriodo(pedido: Order, intervalo: [number, number]): boolean {
  const instante = new Date(pedido.created_at).getTime();
  return instante >= intervalo[0] && instante < intervalo[1];
}

function GraficoVendas({ pontos }: { pontos: PontoGrafico[] }) {
  const [detalhe, setDetalhe] = useState<number | null>(null);
  const maximo = Math.max(1, ...pontos.map((p) => p.total));
  const teto = Math.ceil(maximo / Math.pow(10, Math.floor(Math.log10(maximo)))) * Math.pow(10, Math.floor(Math.log10(maximo)));
  const largura = Math.max(660, pontos.length * 32 + 100);
  const passo = (largura - 100) / Math.max(1, pontos.length);
  const selecionado = detalhe === null ? null : pontos[detalhe];

  return (
    <>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${largura} 275`}
          className="w-full h-64 min-w-[660px]"
          role="group"
          aria-label="Gráfico de vendas por data. Use Tab para consultar cada barra."
        >
          {[0, 1, 2, 3, 4].map((nivel) => {
            const y = 225 - nivel * 50;
            return (
              <g key={nivel} aria-hidden="true">
                <line x1="80" x2={largura - 20} y1={y} y2={y} stroke="#e5e7eb" strokeDasharray={nivel ? "4 4" : undefined} />
                <text x="70" y={y + 4} textAnchor="end" fontSize="11" fill="#6b7280">
                  {formatarMoeda((teto * nivel) / 4)}
                </text>
              </g>
            );
          })}
          {pontos.map((p, indice) => {
            const altura = (p.total / teto) * 200;
            const x = 80 + indice * passo;
            return (
              <g
                key={p.descricao}
                tabIndex={0}
                role="img"
                aria-label={`${p.descricao}: ${formatarMoeda(p.total)}, ${p.pedidos} pedidos`}
                onMouseEnter={() => setDetalhe(indice)}
                onMouseLeave={() => setDetalhe(null)}
                onFocus={() => setDetalhe(indice)}
                onBlur={() => setDetalhe(null)}
                onClick={() => setDetalhe(indice)}
                className="outline-none"
              >
                <title>{`${p.descricao}: ${formatarMoeda(p.total)} · ${p.pedidos} pedidos`}</title>
                <rect x={x + 2} y="20" width={passo - 4} height="210" fill="transparent" />
                <rect
                  x={x + passo * 0.18}
                  y={225 - altura}
                  width={passo * 0.64}
                  height={p.total > 0 ? Math.max(altura, 1) : 0}
                  rx="4"
                  fill={detalhe === indice ? "#1d4ed8" : "#3b82f6"}
                />
                <text x={x + passo / 2} y="247" textAnchor="middle" fontSize="11" fill="#6b7280" aria-hidden="true">
                  {p.rotulo}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-xs text-gray-500 min-h-[20px] mt-2" aria-live="polite">
        {selecionado
          ? `${selecionado.descricao} · ${formatarMoeda(selecionado.total)} · ${selecionado.pedidos} pedidos`
          : "Passe sobre uma barra ou toque nela para ver o valor e a data."}
      </p>
    </>
  );
}

export default function Relatorios({ refreshKey }: { refreshKey: number }) {
  const supabase = getSupabase();
  const [pedidos, setPedidos] = useState<Order[]>([]);
  const [itens, setItens] = useState<OrderItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>("dia");
  const [dataSelecionada, setDataSelecionada] = useState(() => dataLocal(new Date()));

  async function carregar() {
    const sessao = getSessao();
    if (!supabase || !sessao) {
      setErro("Não foi possível conectar aos relatórios. Confira a conexão e entre novamente.");
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const buscarTodos = async (tabela: "orders" | "order_items") => {
        const registros: (Order | OrderItem)[] = [];
        for (let inicio = 0; ; inicio += 1000) {
          const { data, error } = await supabase!
            .from(tabela)
            .select("*")
            .eq("loja_id", sessao!.id)
            .order("id")
            .range(inicio, inicio + 999);
          if (error) throw new Error(error.message);
          registros.push(...(data || []));
          if (!data || data.length < 1000) return registros;
        }
      };
      const [ordens, linhas] = await Promise.all([buscarTodos("orders"), buscarTodos("order_items")]);
      setPedidos((ordens as Order[]).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      setItens(linhas as OrderItem[]);
    } catch (e) {
      setErro("Erro ao carregar relatórios: " + (e instanceof Error ? e.message : "Confira sua conexão."));
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const resumo = useMemo(() => {
    const [ano, mes, dia] = dataSelecionada.split("-").map(Number);
    const referencia = new Date(ano, mes - 1, dia);
    const validos = pedidos.filter((p) => p.status !== "cancelado");
    const lucroPorPedido = new Map<string, number>();
    itens.forEach((i) => {
      lucroPorPedido.set(i.order_id, (lucroPorPedido.get(i.order_id) || 0) + (Number(i.price) - Number(i.cost)) * i.qty);
    });
    const estatistica = (ordens: Order[]) => {
      const total = ordens.reduce((s, p) => s + Number(p.total), 0);
      const lucro = ordens.reduce((s, p) => s + (lucroPorPedido.get(p.id) || 0), 0);
      return { total, lucro, pedidos: ordens.length, margem: total > 0 ? (lucro / total) * 100 : 0 };
    };
    const doDia = validos.filter((p) => nestePeriodo(p, limites(referencia, "dia")));
    const doMes = validos.filter((p) => nestePeriodo(p, limites(referencia, "mes")));
    const doAno = validos.filter((p) => nestePeriodo(p, limites(referencia, "ano")));
    const extrato = periodo === "dia" ? doDia : periodo === "mes" ? doMes : periodo === "ano" ? doAno : validos;
    const cancelados = filtrarPedidosCancelados(
      pedidos,
      periodo === "tudo" ? undefined : limites(referencia, periodo)
    );
    const selecionado = estatistica(extrato);
    const titulo = periodo === "dia"
      ? referencia.toLocaleDateString("pt-BR")
      : periodo === "mes"
        ? referencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
        : periodo === "ano" ? String(ano) : "Todo o histórico";
    let pontos: PontoGrafico[];
    if (periodo === "dia") {
      pontos = Array.from({ length: 24 }, (_, hora) => ({
        rotulo: `${String(hora).padStart(2, "0")}h`,
        descricao: `${titulo} às ${String(hora).padStart(2, "0")}h`,
        total: 0, pedidos: 0,
      }));
    } else if (periodo === "mes") {
      pontos = Array.from({ length: new Date(ano, mes, 0).getDate() }, (_, indice) => ({
        rotulo: String(indice + 1),
        descricao: new Date(ano, mes - 1, indice + 1).toLocaleDateString("pt-BR"),
        total: 0, pedidos: 0,
      }));
    } else if (periodo === "ano") {
      pontos = Array.from({ length: 12 }, (_, indice) => ({
        rotulo: new Date(ano, indice, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        descricao: new Date(ano, indice, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
        total: 0, pedidos: 0,
      }));
    } else {
      const anos = Array.from(new Set(extrato.map((p) => new Date(p.created_at).getFullYear()))).sort((a, b) => a - b);
      pontos = anos.map((valor) => ({ rotulo: String(valor), descricao: String(valor), total: 0, pedidos: 0 }));
    }
    extrato.forEach((p) => {
      const data = new Date(p.created_at);
      const indice = periodo === "dia" ? data.getHours()
        : periodo === "mes" ? data.getDate() - 1
          : periodo === "ano" ? data.getMonth()
            : pontos.findIndex((ponto) => ponto.rotulo === String(data.getFullYear()));
      pontos[indice].total += Number(p.total);
      pontos[indice].pedidos += 1;
    });
    const canais = (["balcao", "delivery", "mesa"] as const).map((tipo) => ({
      tipo,
      nome: tipo === "balcao" ? "Balcão" : tipo === "delivery" ? "Delivery" : "Mesa",
      ...estatistica(extrato.filter((p) => p.type === tipo)),
    }));
    return {
      dia: estatistica(doDia), mes: estatistica(doMes), ano: estatistica(doAno),
      extrato, cancelados, selecionado, titulo, pontos, canais,
      rotuloDia: referencia.toLocaleDateString("pt-BR"),
      rotuloMes: referencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
      rotuloAno: String(ano),
    };
  }, [pedidos, itens, periodo, dataSelecionada]);

  function escolherData(valor: string, tipo: "dia" | "mes" | "ano") {
    if (!valor) return;
    if (tipo === "ano") {
      if (!/^\d{4}$/.test(valor) || Number(valor) < 1000 || Number(valor) > 9999) return;
      setDataSelecionada(`${valor}-01-01`);
    } else if (tipo === "mes") {
      if (/^\d{4}-\d{2}$/.test(valor)) setDataSelecionada(`${valor}-01`);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      setDataSelecionada(valor);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold">Relatórios de vendas</h1>
          <p className="text-sm text-gray-500 mt-1">Escolha a data para comparar vendas, consultar gráficos e conferir o extrato.</p>
        </div>
        <button onClick={carregar} disabled={carregando} className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm font-bold hover:bg-gray-50 disabled:opacity-50">
          {carregando ? "Atualizando..." : "Atualizar"}
        </button>
      </header>

      <section aria-label="Filtros dos relatórios" className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-4">
        <div>
          <p className="text-xs font-bold text-gray-500 mb-2">Período</p>
          <div className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1">
            {PERIODOS.map((p) => (
              <button key={p.valor} onClick={() => setPeriodo(p.valor)} aria-pressed={periodo === p.valor} className={`px-4 py-2 text-sm font-bold rounded-md transition ${periodo === p.valor ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-200"}`}>
                {p.rotulo}
              </button>
            ))}
          </div>
        </div>
        {periodo !== "tudo" && (
          <label className="flex flex-col gap-2 text-xs font-bold text-gray-500">
            {periodo === "dia" ? "Escolher dia" : periodo === "mes" ? "Escolher mês" : "Escolher ano"}
            {periodo === "ano" ? (
              <select aria-label="Escolher ano" value={dataSelecionada.slice(0, 4)} onChange={(e) => escolherData(e.target.value, "ano")} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 min-h-[42px]">
                {Array.from(new Set([Number(dataSelecionada.slice(0, 4)), ...Array.from({ length: 11 }, (_, indice) => new Date().getFullYear() - indice), ...pedidos.map((p) => new Date(p.created_at).getFullYear())])).sort((a, b) => b - a).map((ano) => <option key={ano} value={ano}>{ano}</option>)}
              </select>
            ) : (
              <input key={periodo} aria-label={periodo === "dia" ? "Escolher dia" : "Escolher mês"} type={periodo === "dia" ? "date" : "month"} value={periodo === "dia" ? dataSelecionada : dataSelecionada.slice(0, 7)} onChange={(e) => escolherData(e.target.value, periodo)} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 min-h-[42px]" />
            )}
          </label>
        )}
        <button onClick={() => { setDataSelecionada(dataLocal(new Date())); setPeriodo("dia"); }} className="text-blue-600 hover:bg-blue-50 rounded-lg px-3 py-2 text-sm font-bold min-h-[42px]">Hoje</button>
        <p className="text-xs text-gray-500 basis-full">Datas pela criação do pedido, no horário local. Pedidos cancelados não entram nos totais.</p>
      </section>

      {erro && <p role="alert" className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 mb-4">{erro}</p>}
      {carregando ? <p className="text-gray-500 text-center py-10">Carregando relatórios...</p> : !erro && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {([
              { valor: "dia", titulo: "Vendas do dia", data: resumo.rotuloDia, dados: resumo.dia },
              { valor: "mes", titulo: "Vendas do mês", data: resumo.rotuloMes, dados: resumo.mes },
              { valor: "ano", titulo: "Vendas do ano", data: resumo.rotuloAno, dados: resumo.ano },
            ] as const).map((card) => (
              <button key={card.valor} onClick={() => setPeriodo(card.valor)} aria-pressed={periodo === card.valor} aria-label={`${card.titulo}: ${card.data}`} className={`text-left rounded-2xl border p-4 transition ${periodo === card.valor ? "bg-blue-50 border-blue-400 shadow-sm" : "bg-white border-gray-200 hover:border-blue-300"}`}>
                <p className="text-sm font-bold text-gray-700">{card.titulo}</p>
                <p className="text-xs text-gray-500 mt-1 capitalize">{card.data}</p>
                <p className="text-2xl font-extrabold text-blue-700 mt-3">{formatarMoeda(card.dados.total)}</p>
                <div className="text-xs text-gray-600 flex flex-wrap justify-between gap-2 mt-3">
                  <span>{card.dados.pedidos} pedidos</span>
                  <span>Lucro: <b className="text-green-700">{formatarMoeda(card.dados.lucro)}</b></span>
                </div>
                <p className="text-xs text-gray-500 mt-2">Margem {card.dados.margem.toFixed(1)}%</p>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)] gap-4">
            <section className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 min-w-0" aria-label="Evolução das vendas">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-extrabold">Evolução das vendas</h2>
                  <p className="text-sm text-gray-500 capitalize">{resumo.titulo} · {periodo === "dia" ? "por hora" : periodo === "mes" ? "por dia" : periodo === "ano" ? "por mês" : "por ano"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Vendas do período</p>
                  <p className="font-extrabold text-xl text-blue-700">{formatarMoeda(resumo.selecionado.total)}</p>
                </div>
              </div>
              {resumo.extrato.length === 0 && <p className="text-sm text-gray-500 mb-3">Nenhuma venda neste período.</p>}
              <GraficoVendas key={`${periodo}-${dataSelecionada}`} pontos={resumo.pontos} />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-t border-gray-100 pt-4 mt-3 text-sm">
                <div><p className="text-gray-500 text-xs">Pedidos</p><p className="font-bold">{resumo.selecionado.pedidos}</p></div>
                <div><p className="text-gray-500 text-xs">Ticket médio</p><p className="font-bold">{formatarMoeda(resumo.selecionado.pedidos ? resumo.selecionado.total / resumo.selecionado.pedidos : 0)}</p></div>
                <div><p className="text-gray-500 text-xs">Lucro do período</p><p className="font-bold text-green-700">{formatarMoeda(resumo.selecionado.lucro)}</p></div>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-gray-200 p-5" aria-label="Vendas por tipo">
              <h2 className="text-lg font-extrabold">Vendas por tipo</h2>
              <p className="text-xs text-gray-500 mt-1 mb-6 capitalize">{resumo.titulo}</p>
              <div className="space-y-6">
                {resumo.canais.map((canal) => {
                  const porcentagem = resumo.selecionado.total > 0 ? (canal.total / resumo.selecionado.total) * 100 : 0;
                  return (
                    <div key={canal.tipo}>
                      <div className="flex justify-between gap-2 text-sm mb-2"><span className="font-bold">{canal.nome}</span><span className="font-bold">{formatarMoeda(canal.total)}</span></div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden" role="img" aria-label={`${canal.nome}: ${porcentagem.toFixed(1)}% das vendas`}>
                        <div className={`h-full rounded-full ${canal.tipo === "balcao" ? "bg-blue-500" : canal.tipo === "delivery" ? "bg-violet-500" : "bg-emerald-500"}`} style={{ width: `${porcentagem}%` }} />
                      </div>
                      <p className="text-xs text-gray-500 mt-2">{canal.pedidos} pedidos · {porcentagem.toFixed(1)}%</p>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <section aria-label="Extrato de vendas">
            <div className="flex flex-wrap justify-between items-end gap-3 mb-3">
              <div><h2 className="font-extrabold text-lg">Extrato de vendas</h2><p className="text-sm text-gray-500 capitalize">{resumo.titulo} · {resumo.extrato.length} pedidos</p></div>
              <p className="text-sm font-bold text-blue-700">Total: {formatarMoeda(resumo.selecionado.total)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
              {resumo.extrato.length === 0 ? <p className="px-4 py-8 text-center text-sm text-gray-500">Nenhuma venda neste período.</p> : (
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="bg-gray-50 text-gray-600 text-left"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Hora</th><th className="px-4 py-3">Pedido</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Pagamento</th><th className="px-4 py-3 text-right">Total</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {resumo.extrato.map((p) => <tr key={p.id} className="hover:bg-gray-50"><td className="px-4 py-3 text-gray-500">{formatarData(p.created_at)}</td><td className="px-4 py-3 text-gray-500">{formatarHora(p.created_at)}</td><td className="px-4 py-3 font-semibold">{rotuloPedido(p)}</td><td className="px-4 py-3">{p.type === "delivery" ? "Delivery" : p.type === "mesa" ? `Mesa ${p.mesa_numero ?? ""}` : "Balcão"}</td><td className="px-4 py-3 text-gray-600">{p.customer_name || "—"}</td><td className="px-4 py-3 text-gray-600">{p.forma_pagamento || "—"}</td><td className="px-4 py-3 text-right font-semibold">{formatarMoeda(Number(p.total))}</td></tr>)}
                  </tbody>
                  <tfoot><tr className="bg-blue-50 font-bold"><td className="px-4 py-3" colSpan={6}>Total do período ({resumo.extrato.length} pedidos)</td><td className="px-4 py-3 text-right text-blue-700">{formatarMoeda(resumo.selecionado.total)}</td></tr></tfoot>
                </table>
              )}
            </div>
          </section>

          <section aria-label="Pedidos cancelados">
            <div className="mb-3">
              <h2 className="font-extrabold text-lg">CANCELADOS</h2>
              <p className="text-sm text-gray-500 capitalize">
                {resumo.titulo} · {resumo.cancelados.length} pedidos cancelados · fora do faturamento
              </p>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
              {resumo.cancelados.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-500">
                  Nenhum pedido cancelado neste período.
                </p>
              ) : (
                <table className="w-full whitespace-nowrap text-sm">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th className="px-4 py-3">Pedido</th>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Motivo do cancelamento</th>
                      <th className="px-4 py-3 text-right">Valor</th>
                      <th className="px-4 py-3">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {resumo.cancelados.map((pedido) => {
                      const dataCancelamento = pedido.cancelado_em || pedido.created_at;
                      return (
                        <tr key={pedido.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-semibold">{pedido.numero_pedido ?? "—"}</td>
                          <td className="px-4 py-3 text-gray-600">{pedido.customer_name || "—"}</td>
                          <td className="px-4 py-3 text-gray-600">{pedido.motivo_cancelamento || "Não informado"}</td>
                          <td className="px-4 py-3 text-right font-semibold">{formatarMoeda(Number(pedido.total))}</td>
                          <td className="px-4 py-3 text-gray-500">
                            {formatarData(dataCancelamento)} · {formatarHora(dataCancelamento)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
