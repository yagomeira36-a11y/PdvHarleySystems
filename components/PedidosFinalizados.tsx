"use client";

// ============================================================
// TELA PEDIDO FINALIZADO
// Lista os pedidos do expediente ATUAL (caixa aberto):
// Os pedidos aparecem após o preparo. Com o caixa fechado,
// a lista fica vazia (o expediente acabou).
// Ações por pedido:
// - Editar: muda nome do cliente, itens e quantidades
// - Voltar p/ Preparo: status volta para "pendente" (cozinha)
// - Cancelar: mantém o pedido e registra motivo/data do cancelamento
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

const MOTIVOS_CANCELAMENTO = [
  "Cliente desistiu",
  "Endereço errado / não encontrado",
  "Falta de ingrediente",
  "Erro no pedido",
  "Outro",
];

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
    acao: "voltar";
  } | null>(null);

  const [pedidoCancelando, setPedidoCancelando] = useState<Order | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [outroMotivo, setOutroMotivo] = useState("");
  const [salvandoCancelamento, setSalvandoCancelamento] = useState(false);
  const [erroCancelamento, setErroCancelamento] = useState("");

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
    let lista = (resPedidos.data || []) as Order[];
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
  // CANCELAR (mantém o pedido no banco e registra o motivo/data)
  // ============================================================
  async function cancelarPedido(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const p = pedidoCancelando;
    const sessao = getSessao();
    if (!supabase || !sessao) {
      setErroCancelamento("Não foi possível identificar a loja para cancelar o pedido.");
      return;
    }
    const motivo = motivoCancelamento === "Outro"
      ? outroMotivo.trim()
      : motivoCancelamento;
    if (!motivo) {
      setErroCancelamento("Informe o motivo do cancelamento.");
      return;
    }
    if (!p) return;

    setSalvandoCancelamento(true);
    setErroCancelamento("");
    try {
      const { error } = await supabase
        .from("orders")
        .update({
          status: "cancelado",
          motivo_cancelamento: motivo,
          cancelado_em: new Date().toISOString(),
        })
        .eq("id", p.id)
        .eq("loja_id", sessao.id);
      if (error) {
        setErroCancelamento("Erro ao cancelar o pedido: " + error.message);
        return;
      }
      setPedidoCancelando(null);
      setMotivoCancelamento("");
      setOutroMotivo("");
      setMensagem(`${rotuloPedido(p)} cancelado e mantido no histórico.`);
      aoPedidoCriado?.(`${rotuloPedido(p)} cancelado!`);
      carregar();
    } catch (error) {
      setErroCancelamento(
        "Erro ao cancelar o pedido: " +
          (error instanceof Error ? error.message : "Falha de comunicação.")
      );
    } finally {
      setSalvandoCancelamento(false);
    }
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
                      <button
                        type="button"
                        onClick={() => {
                          setPedidoCancelando(p);
                          setConfirmando(null);
                          setMotivoCancelamento("");
                          setOutroMotivo("");
                          setErroCancelamento("");
                          setMensagem(null);
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-2.5 py-1.5 rounded transition"
                      >
                        CANCELAR PEDIDO
                      </button>
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

      {pedidoCancelando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="motivo-cancelamento-titulo"
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 id="motivo-cancelamento-titulo" className="text-lg font-extrabold">
              Qual o motivo do cancelamento?
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {rotuloPedido(pedidoCancelando)} · {formatarMoeda(Number(pedidoCancelando.total))}
            </p>
            <form onSubmit={cancelarPedido} className="mt-4 space-y-3">
              <fieldset className="space-y-2">
                <legend className="sr-only">Motivo do cancelamento</legend>
                {MOTIVOS_CANCELAMENTO.map((motivo) => (
                  <label key={motivo} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="motivo-cancelamento"
                      value={motivo}
                      required
                      checked={motivoCancelamento === motivo}
                      onChange={() => setMotivoCancelamento(motivo)}
                    />
                    {motivo}
                  </label>
                ))}
              </fieldset>
              {motivoCancelamento === "Outro" && (
                <label className="block text-sm font-semibold" htmlFor="outro-motivo-cancelamento">
                  Descreva o motivo
                  <input
                    id="outro-motivo-cancelamento"
                    type="text"
                    required
                    autoFocus
                    maxLength={250}
                    value={outroMotivo}
                    onChange={(event) => setOutroMotivo(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                  />
                </label>
              )}
              {erroCancelamento && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {erroCancelamento}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={salvandoCancelamento}
                  onClick={() => setPedidoCancelando(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={salvandoCancelamento}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {salvandoCancelamento ? "Cancelando..." : "Confirmar cancelamento"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
