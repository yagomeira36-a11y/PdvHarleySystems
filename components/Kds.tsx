"use client";

// ============================================================
// TELA KDS (COZINHA)
// Mostra os pedidos pendentes para a cozinha preparar:
// - tickets com nº, tipo (balcão/delivery), hora e itens
// - observações dos itens em destaque (âmbar)
// - botão "Preparado" para marcar o pedido como pago
// ============================================================
import { useEffect, useState } from "react";
import { getSupabase, getSessao, formatarMoeda, rotuloPedido, Order, OrderItem } from "@/lib/supabase";
import { caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";

export default function Kds({
  refreshKey,
  aoPedidoCriado,
}: {
  refreshKey: number;
  aoPedidoCriado?: (texto: string, tipo?: "ok" | "erro") => void;
}) {
  const supabase = getSupabase();

  const [pedidos, setPedidos] = useState<Order[]>([]);
  const [itens, setItens] = useState<OrderItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<string | null>(null);

  // ============================================================
  // CARREGAR PEDIDOS PENDENTES + ITENS
  // ============================================================
  async function carregar() {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const sessao = getSessao();
    if (!sessao) {
      setCarregando(false);
      return;
    }
    const { data: peds } = await supabase
      .from("orders")
      .select("*")
      .in("status", ["pendente"])
      .eq("loja_id", sessao.id)
      .order("created_at", { ascending: true });
    const lista = (peds || []) as Order[];
    setPedidos(lista);

    if (lista.length > 0) {
      const ids = lista.map((o) => o.id);
      const { data: it } = await supabase
        .from("order_items")
        .select("*")
        .in("order_id", ids);
      setItens((it || []) as OrderItem[]);
    } else {
      setItens([]);
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // ============================================================
  // MARCAR COMO PREPARADO (pendente -> pago)
  // ============================================================
  async function marcarPreparado(pedido: Order) {
    const sessao = getSessao();
    if (!supabase || !sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    const { error } = await supabase
      .from("orders")
      .update({ status: "pago" })
      .eq("id", pedido.id);
    if (error) {
      setMensagem("Erro ao atualizar: " + error.message);
      return;
    }
    setMensagem(`${rotuloPedido(pedido)} pronto!`);
    // Avisa a página para atualizar os badges do menu e as outras telas
    aoPedidoCriado?.(`${rotuloPedido(pedido)} pronto!`);
    carregar();
  }

  // Hora curta para exibição
  function formatarHora(iso: string): string {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const itensDoPedido = (orderId: string) =>
    itens.filter((i) => i.order_id === orderId);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-extrabold">Cozinha</h1>
        <button
          onClick={carregar}
          className="bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold px-4 py-2 rounded-xl shadow-sm transition"
        >
          Atualizar
        </button>
      </div>

      {mensagem && (
        <div className="bg-green-50 border border-green-500 text-green-700 rounded-lg p-3 mb-4">
          {mensagem}
        </div>
      )}

      {carregando && (
        <p className="text-gray-500 text-center py-10">Carregando...</p>
      )}

      {!carregando && pedidos.length === 0 && (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-500 shadow-sm">
          Nenhum pedido pendente na cozinha.
        </div>
      )}

      {/* Grade de tickets da cozinha */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {pedidos.map((pedido) => (
          <div
            key={pedido.id}
            className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex flex-col gap-3"
          >
            {/* Cabeçalho do ticket */}
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-lg">{rotuloPedido(pedido)}</p>
              <span
                className={`text-xs font-bold px-2 py-1 rounded-full ${
                  pedido.type === "delivery"
                    ? "bg-blue-100 text-blue-700"
                    : pedido.type === "mesa"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-green-100 text-green-700"
                }`}
              >
                {pedido.type === "delivery"
                  ? "DELIVERY"
                  : pedido.type === "mesa"
                    ? "MESA"
                    : "BALCÃO"}
              </span>
              <span className="text-sm text-gray-500">
                {formatarHora(pedido.created_at)}
              </span>
            </div>

            {/* Cliente (delivery) */}
            {pedido.type === "delivery" && pedido.customer_name && (
              <p className="text-sm text-gray-600 -mt-1">
                Cliente: <b>{pedido.customer_name}</b>
              </p>
            )}

            {/* Mesa (pedido de mesa) */}
            {pedido.type === "mesa" && pedido.mesa_numero && (
              <p className="text-sm text-amber-700 -mt-1">
                Mesa: <b>{pedido.mesa_numero}</b>
              </p>
            )}

            {/* Itens a preparar */}
            <ul className="space-y-2 flex-1">
              {itensDoPedido(pedido.id).map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-bold">
                      {item.qty}x Item {item.product_id ? "" : "(removido)"}
                    </p>
                    {item.observacao && (
                      <p className="text-xs text-amber-600 italic font-semibold">
                        Obs: {item.observacao}
                      </p>
                    )}
                  </div>
                  <span className="text-sm text-gray-500 shrink-0">
                    {formatarMoeda(Number(item.price) * item.qty)}
                  </span>
                </li>
              ))}
              {itensDoPedido(pedido.id).length === 0 && (
                <li className="text-sm text-gray-400 text-center py-3">
                  Sem itens registrados.
                </li>
              )}
            </ul>

            {/* Ação */}
            <button
              onClick={() => marcarPreparado(pedido)}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl transition"
            >
              Preparado
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
