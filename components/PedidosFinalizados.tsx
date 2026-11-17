"use client";

// ============================================================
// TELA PEDIDO FINALIZADO
// Lista os pedidos do expediente ATUAL (caixa aberto):
// Delivery aparece apenas quando entregue; os demais pedidos
// aparecem após o preparo. Com o caixa fechado,
// a lista fica vazia (o expediente acabou).
// Ações por pedido:
// - Editar: muda nome do cliente, itens e quantidades
// - Voltar p/ Preparo: status volta para "pendente" (cozinha)
// - Excluir: vira "cancelado" (continua salvo, sai da lista)
// ============================================================
import { useEffect, useState } from "react";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  rotuloPedido,
  Order,
  OrderItem,
  Product,
} from "@/lib/supabase";
import { lerCaixas, caixaAberto, caixaReaberto, Caixa, caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";
import EditarPedidoModal, { ItemEdit } from "./EditarPedidoModal";
import ImpressaoPedido from "./ImpressaoPedido";

// Cores do badge de cada status
const STATUS_COR: Record<string, string> = {
  pago: "bg-green-100 text-green-700",
  saiu_entrega: "bg-blue-100 text-blue-700",
  entregue: "bg-green-100 text-green-700",
};

// Nome amigável de cada status
const STATUS_NOME: Record<string, string> = {
  pago: "pago",
  saiu_entrega: "saiu p/ entrega",
  entregue: "entregue",
};

export default function PedidosFinalizados({
  refreshKey,
  aoPedidoCriado,
}: {
  refreshKey: number;
  aoPedidoCriado?: (texto: string, tipo?: "ok" | "erro") => void;
}) {
  const supabase = getSupabase();

  const [pedidos, setPedidos] = useState<Order[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<string | null>(null);

  // Caixa aberto no momento (sem caixa aberto = lista vazia)
  const [caixaAberta, setCaixaAberta] = useState<Caixa | null>(null);

  // Confirmação em 2 cliques (sem janela nativa): pedido + ação
  const [confirmando, setConfirmando] = useState<{
    id: string;
    acao: "voltar" | "excluir";
  } | null>(null);

  // Modal de edição
  const [editandoPedido, setEditandoPedido] = useState<Order | null>(null);
  const [editItensIniciais, setEditItensIniciais] = useState<ItemEdit[]>([]);
  const [produtos, setProdutos] = useState<Product[]>([]);

  // ============================================================
  // CARREGAR PEDIDOS FINALIZADOS DA LOJA + PRODUTOS
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
    const [resPedidos, resProdutos] = await Promise.all([
      supabase
        .from("orders")
        .select("*")
        .eq("loja_id", sessao.id)
        .in("status", ["pago", "saiu_entrega", "entregue"])
        .order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select("*")
        .eq("loja_id", sessao.id)
        .order("code"),
    ]);
    setProdutos((resProdutos.data || []) as Product[]);

    // Só mostra os pedidos do expediente atual (caixa aberto)
    const aberta = caixaAberto(lerCaixas(sessao.id));
    setCaixaAberta(aberta);
    let lista = ((resPedidos.data || []) as Order[]).filter(
      (p) => p.type !== "delivery" || p.status === "entregue"
    );
    if (aberta) {
      const inicio = caixaReaberto(aberta)
        ? new Date(aberta.reabertoEm as string).getTime()
        : new Date(aberta.abertoEm).getTime();
      lista = lista.filter(
        (p) => new Date(p.created_at).getTime() >= inicio
      );
    } else {
      lista = [];
    }
    setPedidos(lista);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // ============================================================
  // VOLTAR PARA O PREPARO (status volta para "pendente")
  // ============================================================
  async function voltarParaPreparo(p: Order) {
    const sessao = getSessao();
    if (!supabase || !sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    setConfirmando(null);
    const { error } = await supabase
      .from("orders")
      .update({ status: "pendente" })
      .eq("id", p.id);
    if (error) {
      setMensagem("Erro ao voltar para o preparo: " + error.message);
      return;
    }
    aoPedidoCriado?.(`${rotuloPedido(p)} voltou para a cozinha!`);
    carregar();
  }

  // ============================================================
  // EXCLUIR (vira "cancelado" — fica salvo, mas fora das listas)
  // ============================================================
  async function excluirPedido(p: Order) {
    const sessao = getSessao();
    if (!supabase || !sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    setConfirmando(null);
    const { error } = await supabase
      .from("orders")
      .update({ status: "cancelado" })
      .eq("id", p.id);
    if (error) {
      setMensagem("Erro ao excluir: " + error.message);
      return;
    }
    aoPedidoCriado?.(`${rotuloPedido(p)} excluído (cancelado)!`);
    carregar();
  }

  // ============================================================
  // ABRIR EDIÇÃO DE UM PEDIDO (carrega os itens atuais)
  // ============================================================
  async function abrirEdicao(p: Order) {
    const sessao = getSessao();
    if (!supabase || !sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    setMensagem(null);
    const { data: it } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", p.id);
    const lista = ((it || []) as OrderItem[]).map((i) => ({
      key: i.id,
      product_id: i.product_id,
      nome:
        produtos.find((pr) => pr.id === i.product_id)?.name ??
        "(produto removido)",
      qty: i.qty,
      price: Number(i.price),
      cost: Number(i.cost),
    }));
    setEditandoPedido(p);
    setEditItensIniciais(lista);
  }

  // Hora curta para exibição
  function formatarHora(iso: string): string {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-extrabold">Pedido Finalizado</h1>
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

      {!carregando && !caixaAberta && (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-500 shadow-sm">
          Nenhum caixa aberto. Abra o caixa para acompanhar os pedidos
          finalizados do expediente.
        </div>
      )}

      {!carregando && caixaAberta && pedidos.length === 0 && (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-500 shadow-sm">
          Nenhum pedido finalizado ainda.
        </div>
      )}

      {!carregando && caixaAberta && pedidos.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-2">Pedido</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Hora</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {pedidos.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 align-middle">
                  <td className="px-4 py-2 font-semibold">{rotuloPedido(p)}</td>
                  <td className="px-4 py-2">
                    {p.type === "delivery"
                      ? "Delivery"
                      : p.type === "mesa"
                        ? `Mesa ${p.mesa_numero ?? ""}`
                        : "Balcão"}
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
                      {STATUS_NOME[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center whitespace-nowrap">
                    <div className="flex gap-1 justify-center flex-wrap">
                      <ImpressaoPedido pedido={p} />
                      <button
                        onClick={() => abrirEdicao(p)}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-2.5 py-1.5 rounded transition"
                      >
                        Editar
                      </button>
                      {confirmando?.id === p.id &&
                      confirmando.acao === "voltar" ? (
                        <button
                          onClick={() => voltarParaPreparo(p)}
                          className="bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold px-2.5 py-1.5 rounded transition"
                        >
                          Confirmar?
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            setConfirmando({ id: p.id, acao: "voltar" })
                          }
                          className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-2.5 py-1.5 rounded transition"
                        >
                          Voltar p/ Preparo
                        </button>
                      )}
                      {confirmando?.id === p.id &&
                      confirmando.acao === "excluir" ? (
                        <button
                          onClick={() => excluirPedido(p)}
                          className="bg-red-700 hover:bg-red-800 text-white text-xs font-bold px-2.5 py-1.5 rounded transition"
                        >
                          Confirmar?
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            setConfirmando({ id: p.id, acao: "excluir" })
                          }
                          className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-2.5 py-1.5 rounded transition"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ================= MODAL DE EDIÇÃO DO PEDIDO ================= */}
      {editandoPedido && (
        <EditarPedidoModal
          pedido={editandoPedido}
          itensIniciais={editItensIniciais}
          produtos={produtos}
          onClose={() => setEditandoPedido(null)}
          onSaved={(texto) => {
            setEditandoPedido(null);
            aoPedidoCriado?.(texto);
            carregar();
          }}
        />
      )}
    </div>
  );
}
