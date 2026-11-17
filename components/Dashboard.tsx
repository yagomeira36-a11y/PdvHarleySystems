"use client";

// ============================================================
// TELA DASHBOARD (visão geral do dia)
// - Cards com pedidos, receita, lucro e pendências
// - Últimos pedidos com status
// - Se as tabelas ainda não existirem no banco, mostra zeros
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { getSupabase, getSessao, formatarMoeda, rotuloPedido, Order, OrderItem } from "@/lib/supabase";

// Cores do badge de cada status
const STATUS_COR: Record<string, string> = {
  pendente: "bg-amber-100 text-amber-700",
  pago: "bg-green-100 text-green-700",
  saiu_entrega: "bg-blue-100 text-blue-700",
  entregue: "bg-green-100 text-green-700",
  cancelado: "bg-red-100 text-red-700",
};

export default function Dashboard({ refreshKey }: { refreshKey: number }) {
  const supabase = getSupabase();

  const [pedidos, setPedidos] = useState<Order[]>([]);
  const [itens, setItens] = useState<OrderItem[]>([]);
  const [carregando, setCarregando] = useState(true);

  // ============================================================
  // CARREGAR PEDIDOS + ITENS
  // ============================================================
  useEffect(() => {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    const sessao = getSessao();
    if (!sessao) {
      setCarregando(false);
      return;
    }
    Promise.all([
      supabase
        .from("orders")
        .select("*")
        .eq("loja_id", sessao.id)
        .order("created_at", { ascending: false }),
      supabase.from("order_items").select("*").eq("loja_id", sessao.id),
    ]).then(([resPedidos, resItens]) => {
      setPedidos((resPedidos.data || []) as Order[]);
      setItens((resItens.data || []) as OrderItem[]);
      setCarregando(false);
    });
  }, [supabase, refreshKey]);

  // ============================================================
  // CÁLCULOS DO DIA
  // ============================================================
  const resumo = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const validos = pedidos.filter((o) => o.status !== "cancelado");
    const deHoje = validos.filter((o) => new Date(o.created_at) >= hoje);

    const receitaHoje = deHoje.reduce((s, o) => s + Number(o.total), 0);
    const receitaGeral = validos.reduce((s, o) => s + Number(o.total), 0);

    const idsValidos = new Set(validos.map((o) => o.id));
    const itensValidos = itens.filter((i) => idsValidos.has(i.order_id));
    const lucroHoje = itensValidos
      .filter((i) => {
        const pedido = deHoje.find((o) => o.id === i.order_id);
        return !!pedido;
      })
      .reduce((s, i) => s + (Number(i.price) - Number(i.cost)) * i.qty, 0);

    const deliveryPendentes = pedidos.filter(
      (o) => o.type === "delivery" && (o.status === "pendente" || o.status === "saiu_entrega")
    ).length;

    const balcaoHoje = deHoje.filter((o) => o.type === "balcao").length;
    const deliveryHoje = deHoje.filter((o) => o.type === "delivery").length;
    const mesaHoje = deHoje.filter((o) => o.type === "mesa").length;

    return {
      pedidosHoje: deHoje.length,
      receitaHoje,
      receitaGeral,
      lucroHoje,
      deliveryPendentes,
      balcaoHoje,
      deliveryHoje,
      mesaHoje,
    };
  }, [pedidos, itens]);

  // Hora curta para exibição
  function formatarHora(iso: string): string {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Cards de estatística
  const CARDS = [
    { rotulo: "Pedidos hoje", valor: String(resumo.pedidosHoje) },
    { rotulo: "Receita hoje", valor: formatarMoeda(resumo.receitaHoje), verde: true },
    { rotulo: "Lucro hoje", valor: formatarMoeda(resumo.lucroHoje), verde: true },
    { rotulo: "Delivery pendente", valor: String(resumo.deliveryPendentes), destaque: resumo.deliveryPendentes > 0 },
    { rotulo: "Balcão hoje", valor: String(resumo.balcaoHoje) },
    { rotulo: "Delivery hoje", valor: String(resumo.deliveryHoje) },
    { rotulo: "Mesa hoje", valor: String(resumo.mesaHoje) },
    { rotulo: "Receita geral", valor: formatarMoeda(resumo.receitaGeral), verde: true },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h1 className="text-2xl font-extrabold mb-4">Dashboard</h1>

      {carregando && (
        <p className="text-gray-500 text-center py-10">Carregando...</p>
      )}

      {!carregando && (
        <>
          {/* Cards de estatísticas */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-6">
            {CARDS.map((c) => (
              <div
                key={c.rotulo}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4"
              >
                <p className="text-xs text-gray-500 mb-1">{c.rotulo}</p>
                <p
                  className={`text-xl font-extrabold ${
                    c.verde
                      ? "text-green-600"
                      : c.destaque
                        ? "text-red-600"
                        : "text-gray-900"
                  }`}
                >
                  {c.valor}
                </p>
              </div>
            ))}
          </div>

          {/* Últimos pedidos */}
          <h2 className="font-bold text-lg mb-3">Últimos pedidos</h2>
          {pedidos.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center text-gray-500 shadow-sm">
              Nenhum pedido ainda. Crie o primeiro no Balcão.
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-gray-600 text-left">
                  <tr>
                    <th className="px-4 py-2">Pedido</th>
                    <th className="px-4 py-2">Tipo</th>
                    <th className="px-4 py-2">Hora</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pedidos.slice(0, 8).map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-semibold">{rotuloPedido(p)}</td>
                      <td className="px-4 py-2">
                        {p.type === "delivery" ? "Delivery" : p.type === "mesa" ? `Mesa ${p.mesa_numero ?? ""}` : "Balcão"}
                      </td>
                      <td className="px-4 py-2 text-gray-500">
                        {formatarHora(p.created_at)}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold">
                        {formatarMoeda(Number(p.total))}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`text-xs font-bold px-2 py-1 rounded-full ${
                            STATUS_COR[p.status] ?? "bg-gray-200 text-gray-600"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
