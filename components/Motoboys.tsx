"use client";

// ============================================================
// TELA MOTOBOYS
// - CRUD completo de motoboys (nome, telefone, placa, ativo)
// - Lista de entregas de cada motoboy
// - Total de taxas do dia por motoboy
// ============================================================
import { useEffect, useState } from "react";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  rotuloPedido,
  Motoboy,
  Entrega,
  Order,
} from "@/lib/supabase";

// Formulário vazio (usado para criar novo motoboy)
const FORM_VAZIO = { nome: "", telefone: "", placa: "", ativo: true };

export default function Motoboys({ refreshKey }: { refreshKey: number }) {
  const supabase = getSupabase();

  // Estados da tela
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]); // lista de motoboys
  const [entregas, setEntregas] = useState<Entrega[]>([]); // todas as entregas
  const [pedidos, setPedidos] = useState<Order[]>([]); // pedidos (para nº)
  const [form, setForm] = useState(FORM_VAZIO); // formulário
  const [editandoId, setEditandoId] = useState<string | null>(null); // id em edição
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<string | null>(null);

  // ============================================================
  // CARREGAR MOTOBOYS + ENTREGAS + PEDIDOS
  // ============================================================
  async function carregar() {
    if (!supabase) return;
    const sessao = getSessao();
    if (!sessao) return;
    setCarregando(true);

    const [resMotos, resEntregas, resPedidos] = await Promise.all([
      supabase.from("motoboys").select("*").eq("loja_id", sessao.id).order("nome"),
      supabase.from("entregas").select("*").eq("loja_id", sessao.id).order("created_at", { ascending: false }),
      supabase.from("orders").select("id,total,created_at,numero_pedido").eq("loja_id", sessao.id).order("created_at", { ascending: false }),
    ]);

    setMotoboys((resMotos.data || []) as Motoboy[]);
    setEntregas((resEntregas.data || []) as Entrega[]);
    setPedidos((resPedidos.data || []) as Order[]);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // ============================================================
  // SALVAR (criar ou atualizar)
  // ============================================================
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const sessao = getSessao();
    if (!sessao) return;
    if (!form.nome.trim()) {
      setMensagem("Informe o nome do motoboy.");
      return;
    }
    const dados = {
      nome: form.nome.trim(),
      telefone: form.telefone.trim() || null,
      placa: form.placa.trim() || null,
      ativo: form.ativo,
    };

    if (editandoId) {
      const { error } = await supabase
        .from("motoboys")
        .update(dados)
        .eq("id", editandoId);
      if (error) {
        setMensagem("Erro ao atualizar: " + error.message);
        return;
      }
      setMensagem("Motoboy atualizado!");
      setEditandoId(null);
    } else {
      const { error } = await supabase
        .from("motoboys")
        .insert({ ...dados, loja_id: sessao.id });
      if (error) {
        setMensagem("Erro ao cadastrar: " + error.message);
        return;
      }
      setMensagem("Motoboy cadastrado!");
    }
    setForm(FORM_VAZIO);
    carregar();
  }

  // Preenche o formulário para editar
  function editar(m: Motoboy) {
    setEditandoId(m.id);
    setForm({
      nome: m.nome,
      telefone: m.telefone ?? "",
      placa: m.placa ?? "",
      ativo: m.ativo,
    });
    setMensagem(null);
  }

  // Cancela a edição
  function cancelar() {
    setEditandoId(null);
    setForm(FORM_VAZIO);
  }

  // ============================================================
  // EXCLUIR motoboy (as entregas dele ficam sem motoboy)
  // ============================================================
  async function excluir(m: Motoboy) {
    if (!supabase) return;
    const confirmou = window.confirm(
      `Excluir o motoboy "${m.nome}"? As entregas dele ficarão sem responsável.`
    );
    if (!confirmou) return;
    const { error } = await supabase.from("motoboys").delete().eq("id", m.id);
    if (error) {
      setMensagem("Erro ao excluir: " + error.message);
      return;
    }
    setMensagem("Motoboy excluído.");
    carregar();
  }

  // ============================================================
  // RESUMO POR MOTOBOY
  // ============================================================
  function entregasDoMotoboy(motoboyId: string): Entrega[] {
    return entregas.filter((e) => e.motoboy_id === motoboyId);
  }

  // Soma das taxas do dia (entregas de hoje)
  function taxasDoDia(motoboyId: string): number {
    const inicioDoDia = new Date();
    inicioDoDia.setHours(0, 0, 0, 0);
    return entregasDoMotoboy(motoboyId)
      .filter((e) => new Date(e.created_at) >= inicioDoDia)
      .reduce((soma, e) => soma + Number(e.taxa), 0);
  }

  // Nº do pedido para exibição
  function numeroPedido(orderId: string): string {
    const pedido = pedidos.find((p) => p.id === orderId);
    return pedido ? rotuloPedido(pedido) : "—";
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Motoboys</h1>

      {/* Mensagens */}
      {mensagem && (
        <div className="bg-green-50 border border-green-500 text-green-700 rounded-lg p-3 mb-4">
          {mensagem}
        </div>
      )}

      {/* ================= FORMULÁRIO ================= */}
      <div className="bg-white rounded-xl p-4 mb-6">
        <h2 className="font-bold mb-3">
          {editandoId ? "Editar Motoboy" : "Cadastrar Motoboy"}
        </h2>
        <form onSubmit={salvar} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            placeholder="Nome"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            className="bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            required
          />
          <input
            type="text"
            placeholder="Telefone"
            value={form.telefone}
            onChange={(e) => setForm({ ...form, telefone: e.target.value })}
            className="bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="text"
            placeholder="Placa"
            value={form.placa}
            onChange={(e) => setForm({ ...form, placa: e.target.value })}
            className="bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          {/* Ativo */}
          <label className="flex items-center gap-2 text-sm bg-gray-100 rounded px-3 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
              className="accent-green-500 w-4 h-4"
            />
            Ativo
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 bg-green-600 hover:bg-green-700 font-bold px-4 py-2 rounded-lg transition"
            >
              {editandoId ? "Salvar" : "Cadastrar"}
            </button>
            {editandoId && (
              <button
                type="button"
                onClick={cancelar}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 rounded-lg"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ================= LISTA DE MOTOBOYS ================= */}
      {carregando && (
        <p className="text-gray-400 text-center py-10">Carregando...</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {motoboys.map((m) => (
          <div key={m.id} className="bg-white rounded-xl p-4 flex flex-col gap-3">
            {/* Cabeçalho do card */}
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-bold">{m.nome}</p>
                <p className="text-xs text-gray-400">
                  {m.telefone ?? "sem telefone"} · {m.placa ?? "sem placa"}
                </p>
              </div>
              <span
                className={`text-xs font-bold px-2 py-1 rounded ${
                  m.ativo
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {m.ativo ? "ATIVO" : "INATIVO"}
              </span>
            </div>

            {/* Resumo do dia */}
            <div className="bg-gray-100 rounded p-3 flex justify-between items-center">
              <span className="text-sm text-gray-400">
                Taxas hoje ({entregasDoMotoboy(m.id).filter((e) => {
                  const hoje = new Date();
                  hoje.setHours(0, 0, 0, 0);
                  return new Date(e.created_at) >= hoje;
                }).length}{" "}
                entregas)
              </span>
              <span className="font-bold text-green-600">
                {formatarMoeda(taxasDoDia(m.id))}
              </span>
            </div>

            {/* Entregas do motoboy */}
            <div className="text-sm space-y-1 max-h-40 overflow-y-auto">
              {entregasDoMotoboy(m.id).length === 0 && (
                <p className="text-gray-500 text-xs">
                  Nenhuma entrega ainda.
                </p>
              )}
              {entregasDoMotoboy(m.id).map((e) => (
                <div
                  key={e.id}
                  className="flex justify-between items-center bg-gray-100 rounded px-2 py-1"
                >
                  <span className="font-mono text-xs">
                    {numeroPedido(e.order_id)}
                  </span>
                  <span className="text-xs text-gray-400">{e.status}</span>
                  <span className="text-xs font-semibold">
                    {formatarMoeda(Number(e.taxa))}
                  </span>
                </div>
              ))}
            </div>

            {/* Ações */}
            <div className="flex gap-2 mt-auto">
              <button
                onClick={() => editar(m)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-sm font-bold py-2 rounded-lg transition"
              >
                Editar
              </button>
              <button
                onClick={() => excluir(m)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-sm font-bold py-2 rounded-lg transition"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>

      {!carregando && motoboys.length === 0 && (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400">
          Nenhum motoboy cadastrado.
        </div>
      )}
    </div>
  );
}
