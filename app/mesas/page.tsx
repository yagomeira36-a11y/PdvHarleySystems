"use client";

// ============================================================
// PÁGINA /mesas — GERENCIAMENTO DE MESAS (visual Ponto De Vendas Harley Systems)
// Usa o layout compartilhado (sidebar roxa) e mostra:
// - Card "Salão Principal" + grade de mesas clicáveis
// - Lê/grava a tabela "mesas" do Supabase. Loja nova começa
//   zerada: o dono cadastra as mesas pelo botão "+ Adicionar Mesa".
// ============================================================
import { useEffect, useState } from "react";
import LayoutMenu from "@/components/LayoutMenu";
import { getSupabase, getSessao } from "@/lib/supabase";
import { caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";

// Mesa da tela (número + status)
type Mesa = {
  id?: string;
  numero: number;
  status: "disponivel" | "ocupada";
};

// Ícone de cadeira (cabeçalho da página)
function IconeCadeira() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3" />
      <path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z" />
      <path d="M5 18v2" />
      <path d="M19 18v2" />
    </svg>
  );
}

// Ícone de lixeira (botão excluir mesa)
function IconeLixeira() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export default function Mesas() {
  const supabase = getSupabase();

  // Estados da tela
  const [mesas, setMesas] = useState<Mesa[]>([]); // lista de mesas
  const [usandoBanco, setUsandoBanco] = useState(false); // tabela existe no banco?
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<string | null>(null); // erro/aviso
  const [mensagemOk, setMensagemOk] = useState(false); // mensagem é de sucesso?
  const [mesaExcluir, setMesaExcluir] = useState<Mesa | null>(null); // confirmação
  const [excluindo, setExcluindo] = useState(false);

  // Mostra um aviso (erro em vermelho, sucesso em verde)
  function avisar(texto: string | null, ok = false) {
    setMensagem(texto);
    setMensagemOk(ok);
  }

  // ============================================================
  // CARREGAR MESAS (Supabase). Loja nova não tem mesas: fica vazio.
  // ============================================================
  useEffect(() => {
    if (!supabase) {
      setMesas([]);
      setCarregando(false);
      return;
    }
    const sessao = getSessao();
    if (!sessao) {
      setMesas([]);
      setCarregando(false);
      return;
    }
    supabase
      .from("mesas")
      .select("*")
      .eq("loja_id", sessao.id)
      .order("numero")
      .then(({ data, error }) => {
        if (error) {
          setMesas([]);
          setUsandoBanco(false);
        } else {
          setMesas((data as Mesa[]) ?? []);
          setUsandoBanco(true);
        }
        setCarregando(false);
      });
  }, [supabase]);

  // ============================================================
  // ALTERNAR MESA (clique): disponível <-> ocupada
  // ============================================================
  async function alternar(mesa: Mesa) {
    const sessao = getSessao();
    if (!sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      avisar(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    const novoStatus = mesa.status === "disponivel" ? "ocupada" : "disponivel";
    avisar(null);
    setMesas((atual) =>
      atual.map((m) =>
        m.numero === mesa.numero ? { ...m, status: novoStatus } : m
      )
    );
    // Grava no banco se a tabela existir
    if (usandoBanco && mesa.id && supabase) {
      const { error } = await supabase
        .from("mesas")
        .update({ status: novoStatus })
        .eq("id", mesa.id);
      if (error) {
        avisar("Erro ao salvar a mesa: " + error.message);
        // Volta a cor antiga para não enganar
        setMesas((atual) =>
          atual.map((m) =>
            m.numero === mesa.numero ? { ...m, status: mesa.status } : m
          )
        );
      }
    }
  }

  // ============================================================
  // ADICIONAR MESA (próximo número livre)
  // ============================================================
  async function adicionarMesa() {
    const sessao = getSessao();
    if (!sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      avisar(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    const proximo =
      mesas.reduce((maior, m) => Math.max(maior, m.numero), 0) + 1;
    avisar(null);
    if (supabase) {
      const { data, error } = await supabase
        .from("mesas")
        .insert({ numero: proximo, status: "disponivel", loja_id: sessao.id })
        .select()
        .single();
      if (error) {
        avisar("Erro ao adicionar mesa: " + error.message);
        return;
      }
      setUsandoBanco(true);
      setMesas((atual) => [...atual, data as Mesa]);
      return;
    }
    setMesas((atual) => [...atual, { numero: proximo, status: "disponivel" }]);
  }

  // ============================================================
  // EXCLUIR MESA
  // - Bloqueia se a mesa estiver ocupada
  // - Bloqueia se existir pedido em aberto naquela mesa
  // - Caso contrário, pede confirmação antes de apagar
  // ============================================================
  async function pedirExcluir(mesa: Mesa) {
    const sessao = getSessao();
    if (!sessao) return;
    avisar(null);

    // Pedido em aberto (tudo que não está entregue nem cancelado)
    if (supabase) {
      const { data, error } = await supabase
        .from("orders")
        .select("numero_pedido")
        .eq("loja_id", sessao.id)
        .eq("type", "mesa")
        .eq("mesa_numero", mesa.numero)
        .not("status", "in", "(entregue,cancelado)")
        .limit(1);
      if (!error && data && data.length > 0) {
        const numero = (data[0] as { numero_pedido?: number }).numero_pedido;
        avisar(
          `A mesa ${mesa.numero} tem um pedido em aberto${
            numero ? ` (Pedido ${numero})` : ""
          }. Finalize ou cancele o pedido antes de excluir a mesa.`
        );
        return;
      }
    }

    // Mesa marcada como ocupada: libere antes de excluir
    if (mesa.status === "ocupada") {
      avisar(
        `A mesa ${mesa.numero} está ocupada. Libere a mesa antes de excluir.`
      );
      return;
    }

    setMesaExcluir(mesa);
  }

  // Confirma a exclusão da mesa escolhida
  async function confirmarExcluir() {
    if (!mesaExcluir) return;
    const mesa = mesaExcluir;
    setExcluindo(true);
    if (supabase && usandoBanco && mesa.id) {
      const { error } = await supabase.from("mesas").delete().eq("id", mesa.id);
      if (error) {
        setExcluindo(false);
        setMesaExcluir(null);
        avisar("Erro ao excluir a mesa: " + error.message);
        return;
      }
    }
    setMesas((atual) => atual.filter((m) => m.numero !== mesa.numero));
    setExcluindo(false);
    setMesaExcluir(null);
    avisar(`Mesa ${mesa.numero} excluída.`, true);
  }

  return (
    <LayoutMenu ativo="mesa">
      <div className="flex-1 overflow-y-auto p-6">
        {/* Header: título + botão adicionar */}
        <header className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-extrabold flex items-center gap-2.5">
            <span className="text-[#2563EB]">
              <IconeCadeira />
            </span>
            Gerenciamento de Mesas
          </h1>
          <button
            onClick={adicionarMesa}
            className="bg-green-600 hover:bg-green-700 text-white font-bold px-5 py-2.5 rounded-xl shadow-md shadow-green-600/20 transition shrink-0"
          >
            + Adicionar Mesa
          </button>
        </header>

        {/* Card Salão Principal */}
        <div className="bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] rounded-2xl p-5 text-white shadow-lg shadow-blue-500/20 mb-3 flex items-center justify-between">
          <p className="text-lg font-extrabold">Salão Principal</p>
          <span className="bg-white/20 rounded-full px-3.5 py-1 text-sm font-semibold">
            {mesas.length} mesas
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Clique numa mesa para alternar entre{" "}
          <b className="text-green-600">Disponível</b> e{" "}
          <b className="text-red-500">Ocupada</b>. Use a lixeira para excluir.
        </p>

        {mensagem && (
          <div
            className={`rounded-lg p-3 mb-4 border ${
              mensagemOk
                ? "bg-green-50 border-green-400 text-green-700"
                : "bg-red-50 border-red-400 text-red-700"
            }`}
          >
            {mensagem}
          </div>
        )}

        {/* Grade de mesas */}
        {carregando ? (
          <p className="text-gray-500 text-center py-10">Carregando mesas...</p>
        ) : mesas.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-10 text-center">
            <p className="text-lg font-bold text-gray-700 mb-1">
              Nenhuma mesa cadastrada
            </p>
            <p className="text-sm text-gray-500">
              Clique em <b>+ Adicionar Mesa</b> para criar as mesas do seu salão.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
            {mesas.map((m) => {
              const disponivel = m.status === "disponivel";
              return (
                <div key={m.numero} className="relative">
                  <button
                    onClick={() => alternar(m)}
                    className={`w-full rounded-2xl p-6 shadow-md transition hover:shadow-lg hover:-translate-y-0.5 flex flex-col items-center gap-1 border-2 ${
                      disponivel
                        ? "border-[#10B981] bg-green-50 hover:bg-green-100"
                        : "border-[#EF4444] bg-red-50 hover:bg-red-100"
                    }`}
                  >
                    <span
                      className={`text-4xl font-extrabold ${
                        disponivel ? "text-[#10B981]" : "text-[#EF4444]"
                      }`}
                    >
                      {m.numero}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                      Mesa {m.numero}
                    </span>
                    <span
                      className={`text-[11px] font-extrabold uppercase tracking-widest ${
                        disponivel ? "text-[#10B981]" : "text-[#EF4444]"
                      }`}
                    >
                      {disponivel ? "Disponível" : "Ocupada"}
                    </span>
                  </button>
                  <button
                    onClick={() => pedirExcluir(m)}
                    title={`Excluir mesa ${m.numero}`}
                    aria-label={`Excluir mesa ${m.numero}`}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 border border-gray-300 text-gray-500 hover:bg-red-500 hover:border-red-500 hover:text-white flex items-center justify-center shadow transition"
                  >
                    <IconeLixeira />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmação de exclusão */}
      {mesaExcluir && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => !excluindo && setMesaExcluir(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-extrabold mb-2">Excluir mesa</h2>
            <p className="text-sm text-gray-600 mb-5">
              Excluir a <b>Mesa {mesaExcluir.numero}</b>? Essa ação não pode ser
              desfeita.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMesaExcluir(null)}
                disabled={excluindo}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold px-4 py-2 rounded-lg transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarExcluir}
                disabled={excluindo}
                className="bg-red-500 hover:bg-red-600 text-white font-bold px-4 py-2 rounded-lg transition disabled:opacity-50"
              >
                {excluindo ? "Excluindo…" : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </LayoutMenu>
  );
}
