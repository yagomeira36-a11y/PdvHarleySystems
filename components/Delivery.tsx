"use client";

import { useEffect, useState } from "react";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  rotuloPedido,
  Order,
  Entrega,
  OrderItem,
  Motoboy,
} from "@/lib/supabase";
import { caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";

const STATUS_COR: Record<string, string> = {
  pago: "bg-green-100 text-green-700",
  saiu_entrega: "bg-blue-100 text-blue-700",
};

const STATUS_NOME: Record<string, string> = {
  pago: "Pronto para entrega",
  saiu_entrega: "Saiu para entrega",
};

// Data curta para exibição
function formatarData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Delivery({
  refreshKey,
  aoPedidoCriado,
}: {
  refreshKey: number;
  aoPedidoCriado: (texto: string, tipo?: "ok" | "erro") => void;
}) {
  const supabase = getSupabase();

  // Estados da tela
  const [pedidos, setPedidos] = useState<Order[]>([]); // pedidos delivery
  const [entregas, setEntregas] = useState<Entrega[]>([]); // entregas vinculadas
  const [itens, setItens] = useState<OrderItem[]>([]); // itens de cada pedido
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]); // motoboys cadastrados
  const [carregando, setCarregando] = useState(true);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  // ============================================================
  // CARREGAR DADOS (pedidos delivery + entregas + itens + motoboys)
  // ============================================================
  async function carregar() {
    const sessao = getSessao();
    if (!supabase || !sessao) {
      setCarregando(false);
      return;
    }
    setCarregando(true);

    const { data: peds, error } = await supabase
      .from("orders")
      .select("*")
      .eq("type", "delivery")
      .eq("loja_id", sessao.id)
      .in("status", ["pago", "saiu_entrega"])
      .order("created_at", { ascending: false });
    if (error) {
      setMensagem("Erro ao carregar pedidos: " + error.message);
      setCarregando(false);
      return;
    }
    const listaPedidos = (peds || []) as Order[];
    setPedidos(listaPedidos);

    if (listaPedidos.length > 0) {
      const ids = listaPedidos.map((o) => o.id);
      // Entregas e itens dos pedidos carregados
      const [resEntregas, resItens] = await Promise.all([
        supabase.from("entregas").select("*").in("order_id", ids),
        supabase.from("order_items").select("*").in("order_id", ids),
      ]);
      setEntregas((resEntregas.data || []) as Entrega[]);
      setItens((resItens.data || []) as OrderItem[]);
    } else {
      setEntregas([]);
      setItens([]);
    }

    // Motoboys da loja (para mostrar o nome do responsável)
    const { data: motos } = await supabase
      .from("motoboys")
      .select("*")
      .eq("loja_id", sessao.id);
    setMotoboys((motos || []) as Motoboy[]);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function mudarStatus(
    pedido: Order,
    novoStatus: "pendente" | "saiu_entrega" | "entregue"
  ) {
    const sessao = getSessao();
    if (!supabase || !sessao || salvandoId) return;
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    setSalvandoId(pedido.id);
    setMensagem(null);
    try {
      const { data, error } = await supabase
        .from("orders")
        .update({ status: novoStatus })
        .eq("id", pedido.id)
        .eq("loja_id", sessao.id)
        .eq("type", "delivery")
        .eq("status", pedido.status)
        .select("id")
        .maybeSingle();
      if (error || !data) {
        setMensagem(error
          ? "Erro ao atualizar pedido: " + error.message
          : "Esse pedido foi alterado. Confira a lista atualizada.");
        await carregar();
        return;
      }

      const { error: erroEntrega } = await supabase
        .from("entregas")
        .update({ status: novoStatus })
        .eq("order_id", pedido.id)
        .eq("loja_id", sessao.id);
      if (erroEntrega) {
        const { data: restaurado, error: erroRestaurar } = await supabase
          .from("orders")
          .update({ status: pedido.status })
          .eq("id", pedido.id)
          .eq("loja_id", sessao.id)
          .eq("status", novoStatus)
          .select("id")
          .maybeSingle();
        setMensagem("Erro ao atualizar entrega: " + erroEntrega.message +
          (erroRestaurar || !restaurado
            ? " Não foi possível restaurar o pedido; confira seu status."
            : " O pedido foi mantido na etapa anterior."));
        await carregar();
        return;
      }

      setPedidos((atual) => novoStatus === "saiu_entrega"
        ? atual.map((p) => p.id === pedido.id ? { ...p, status: novoStatus } : p)
        : atual.filter((p) => p.id !== pedido.id));
      setEntregas((atual) => atual.map((e) =>
        e.order_id === pedido.id ? { ...e, status: novoStatus } : e));
      const destino = novoStatus === "pendente"
        ? "voltou para a cozinha!"
        : novoStatus === "entregue"
          ? "entregue e enviado para Pedido Finalizado!"
          : "saiu para entrega!";
      aoPedidoCriado(`${rotuloPedido(pedido)} ${destino}`);
    } finally {
      setSalvandoId(null);
    }
  }

  // Busca a entrega e o motoboy de um pedido
  function entregaDoPedido(orderId: string): Entrega | undefined {
    return entregas.find((e) => e.order_id === orderId);
  }
  function nomeMotoboy(motoboyId: string | null | undefined): string {
    if (!motoboyId) return "—";
    return motoboys.find((m) => m.id === motoboyId)?.nome ?? "—";
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Pedidos Delivery</h1>

      {mensagem && (
        <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-3 mb-4">
          {mensagem}
        </div>
      )}

      {carregando && (
        <p className="text-gray-400 text-center py-10">Carregando...</p>
      )}

      {!carregando && pedidos.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400">
          Nenhum pedido aguardando entrega. Os pedidos preparados na cozinha aparecem aqui.
        </div>
      )}

      {/* Grade de cards de pedidos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {pedidos.map((pedido) => {
          const entrega = entregaDoPedido(pedido.id);
          const itensPedido = itens.filter((i) => i.order_id === pedido.id);
          return (
            <div key={pedido.id} className="bg-white rounded-xl p-4 flex flex-col gap-2">
              {/* Cabeçalho: nº + data + status */}
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-sm">{rotuloPedido(pedido)}</p>
                <span className="text-xs text-gray-400">
                  {formatarData(pedido.created_at)}
                </span>
                <span
                  className={`text-xs font-bold px-2 py-1 rounded ${STATUS_COR[pedido.status] ?? "bg-gray-200 text-gray-600"}`}
                >
                  {STATUS_NOME[pedido.status] ?? pedido.status}
                </span>
              </div>

              {/* Cliente, telefone e endereço */}
              <div>
                <p className="font-semibold">{pedido.customer_name ?? "Sem nome"}</p>
                {pedido.telefone && (
                  <p className="text-xs text-gray-400">
                    Tel: <b className="text-gray-700">{pedido.telefone}</b>
                  </p>
                )}
                <p className="text-xs text-gray-400">{pedido.address}</p>
                {pedido.complemento && (
                  <p className="text-xs text-gray-400">
                    Complemento: {pedido.complemento}
                  </p>
                )}
              </div>

              {/* Itens do pedido */}
              <ul className="text-sm space-y-1">
                {itensPedido.map((item) => (
                  <li key={item.id}>
                    <div className="flex justify-between">
                      <span>
                        {item.qty}x{" "}
                        {item.product_id ? "Item" : "Item removido"}
                      </span>
                      <span className="text-gray-400">
                        {formatarMoeda(Number(item.price) * item.qty)}
                      </span>
                    </div>
                    {item.observacao && (
                      <p className="text-xs text-amber-600 italic ml-3">
                        Obs: {item.observacao}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              {/* Taxa + total */}
              <div className="text-sm border-t border-gray-200 pt-2 flex flex-col gap-1">
                <p className="flex justify-between text-gray-400">
                  <span>Taxa de entrega</span>
                  <span>{formatarMoeda(Number(pedido.delivery_fee))}</span>
                </p>
                <p className="flex justify-between font-bold">
                  <span>Total</span>
                  <span className="text-green-600">
                    {formatarMoeda(Number(pedido.total))}
                  </span>
                </p>
              </div>

              {/* Motoboy responsável */}
              <p className="text-sm bg-gray-100 rounded px-3 py-2">
                Motoboy:{" "}
                <b className="text-green-600">
                  {nomeMotoboy(entrega?.motoboy_id)}
                </b>
              </p>

              <div className="flex flex-wrap gap-2 mt-auto">
                <button
                  onClick={() => mudarStatus(pedido, "pendente")}
                  disabled={salvandoId !== null}
                  title="Voltar para a cozinha"
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold px-3 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Voltar
                </button>
                {pedido.status === "pago" && (
                  <button
                    onClick={() => mudarStatus(pedido, "saiu_entrega")}
                    disabled={salvandoId !== null}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-3 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Saiu pra entrega
                  </button>
                )}
                <button
                  onClick={() => mudarStatus(pedido, "entregue")}
                  disabled={salvandoId !== null}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-3 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Entregue
                </button>
                {salvandoId === pedido.id && (
                  <p role="status" className="w-full text-xs text-gray-500">Salvando...</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
