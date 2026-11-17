"use client";

// ============================================================
// MODAL DE EDIÇÃO DE PEDIDO (compartilhado)
// Usado em "Pedido Finalizado" e na lista de pedidos do
// expediente (caixa). Permite mudar o nome do cliente, alterar
// quantidades, remover e adicionar itens. Ao salvar, atualiza
// o total e os itens no banco.
// ============================================================
import { useState } from "react";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  rotuloPedido,
  Order,
  Product,
} from "@/lib/supabase";
import { caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";

// Item do pedido dentro do modal de edição
export type ItemEdit = {
  key: string;
  product_id: string | null;
  nome: string;
  qty: number;
  price: number;
  cost: number;
};

type Props = {
  pedido: Order;
  itensIniciais: ItemEdit[];
  produtos: Product[];
  onClose: () => void;
  // Chamado após salvar com sucesso (texto para o toast)
  onSaved: (texto: string) => void;
};

export default function EditarPedidoModal({
  pedido,
  itensIniciais,
  produtos,
  onClose,
  onSaved,
}: Props) {
  const supabase = getSupabase();

  const [editNome, setEditNome] = useState(pedido.customer_name ?? "");
  const [editItens, setEditItens] = useState<ItemEdit[]>(itensIniciais);
  const [produtoNovo, setProdutoNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  function mudarQty(key: string, delta: number) {
    setEditItens((lista) =>
      lista
        .map((i) =>
          i.key === key ? { ...i, qty: Math.max(0, i.qty + delta) } : i
        )
        .filter((i) => i.qty > 0)
    );
  }

  function removerItem(key: string) {
    setEditItens((lista) => lista.filter((i) => i.key !== key));
  }

  function adicionarItem() {
    if (!produtoNovo) return;
    const pr = produtos.find((x) => x.id === produtoNovo);
    if (!pr) return;
    const existente = editItens.find((i) => i.product_id === pr.id);
    if (existente) {
      setEditItens((lista) =>
        lista.map((i) =>
          i.key === existente.key ? { ...i, qty: i.qty + 1 } : i
        )
      );
    } else {
      setEditItens((lista) => [
        ...lista,
        {
          key: `novo-${Date.now()}`,
          product_id: pr.id,
          nome: pr.name,
          qty: 1,
          price: Number(pr.price),
          cost: Number(pr.cost ?? 0),
        },
      ]);
    }
    setProdutoNovo("");
  }

  // Total da edição (delivery soma a taxa de entrega)
  const totalEdicao =
    editItens.reduce((s, i) => s + i.qty * i.price, 0) +
    (pedido.type === "delivery" ? Number(pedido.delivery_fee || 0) : 0);

  // ============================================================
  // SALVAR EDIÇÃO DO PEDIDO (atualiza total e itens no banco)
  // ============================================================
  async function salvarEdicaoPedido() {
    const sessao = getSessao();
    if (!supabase || !sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    setSalvando(true);
    setMensagem(null);
    const { error: e1 } = await supabase
      .from("orders")
      .update({
        total: totalEdicao,
        customer_name: editNome.trim() || null,
      })
      .eq("id", pedido.id);
    if (e1) {
      setMensagem("Erro ao salvar pedido: " + e1.message);
      setSalvando(false);
      return;
    }
    const { error: e2 } = await supabase
      .from("order_items")
      .delete()
      .eq("order_id", pedido.id);
    if (e2) {
      setMensagem("Erro ao atualizar itens: " + e2.message);
      setSalvando(false);
      return;
    }
    if (editItens.length > 0) {
      const { error: e3 } = await supabase.from("order_items").insert(
        editItens.map((i) => ({
          order_id: pedido.id,
          product_id: i.product_id,
          qty: i.qty,
          price: i.price,
          cost: i.cost,
          loja_id: sessao.id,
        }))
      );
      if (e3) {
        setMensagem("Erro ao salvar itens: " + e3.message);
        setSalvando(false);
        return;
      }
    }
    setSalvando(false);
    onSaved(`${rotuloPedido(pedido)} editado!`);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-extrabold">
            Editar {rotuloPedido(pedido)}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 font-bold text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <label className="block text-xs text-gray-400 mb-1">
          Nome do cliente
        </label>
        <input
          type="text"
          value={editNome}
          onChange={(e) => setEditNome(e.target.value)}
          placeholder="Nome do cliente"
          className="w-full bg-gray-100 rounded px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <p className="text-xs text-gray-400 mb-2">Itens do pedido</p>
        <div className="space-y-2 mb-4">
          {editItens.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4 bg-gray-50 rounded-lg">
              Nenhum item. Adicione um produto abaixo.
            </p>
          )}
          {editItens.map((i) => (
            <div
              key={i.key}
              className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{i.nome}</p>
                <p className="text-xs text-gray-500">
                  {formatarMoeda(i.price)} cada
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => mudarQty(i.key, -1)}
                  className="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 font-bold"
                >
                  −
                </button>
                <span className="w-8 text-center font-bold">{i.qty}</span>
                <button
                  onClick={() => mudarQty(i.key, 1)}
                  className="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 font-bold"
                >
                  +
                </button>
              </div>
              <p className="w-20 text-right text-sm font-bold">
                {formatarMoeda(i.price * i.qty)}
              </p>
              <button
                onClick={() => removerItem(i.key)}
                className="text-red-500 hover:text-red-700 text-xs font-bold"
              >
                Remover
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-4">
          <select
            value={produtoNovo}
            onChange={(e) => setProdutoNovo(e.target.value)}
            className="flex-1 bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Adicionar produto...</option>
            {produtos.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.code} · {pr.name} — {formatarMoeda(Number(pr.price))}
              </option>
            ))}
          </select>
          <button
            onClick={adicionarItem}
            disabled={!produtoNovo}
            className="bg-gray-800 hover:bg-gray-900 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg transition"
          >
            Adicionar
          </button>
        </div>

        <div className="flex items-center justify-between bg-blue-50 rounded-lg px-4 py-3 mb-4">
          <p className="font-bold text-blue-900">Total do pedido</p>
          <p className="text-lg font-extrabold text-blue-700">
            {formatarMoeda(totalEdicao)}
          </p>
        </div>

        {mensagem && (
          <div className="bg-red-50 border border-red-400 text-red-600 rounded-lg p-2 mb-3 text-sm">
            {mensagem}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={salvarEdicaoPedido}
            disabled={salvando}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition"
          >
            {salvando ? "Salvando..." : "Salvar Alterações"}
          </button>
          <button
            onClick={onClose}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold px-5 py-2.5 rounded-lg transition"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
