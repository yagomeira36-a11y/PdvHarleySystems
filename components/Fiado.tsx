"use client";

// ============================================================
// TELA FIADO (crédito da loja)
// - Lança dívidas (o que o cliente levou fiado)
// - Registra pagamentos (quando o cliente paga)
// - Mostra o saldo em aberto de cada cliente
// Os dados ficam no Supabase, na tabela "fiados".
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { formatarMoeda, getSessao, getSupabase } from "@/lib/supabase";
import type { Fiado, FiadoCliente } from "@/lib/fiado";
import { agruparPorCliente, dataBR, hojeISO, paraValor } from "@/lib/fiado";

const FORM_DIVIDA = { nome: "", telefone: "", valor: "", descricao: "", data: "" };
const FORM_PAGAMENTO = { valor: "", descricao: "", data: "" };

// Traduz o erro do banco (ex: tabela ainda não criada)
function descreverErro(erro: { message?: string; code?: string } | null): string {
  const texto = erro?.message || "";
  if (
    erro?.code === "42P01" ||
    /schema cache/i.test(texto) ||
    /does not exist/i.test(texto)
  ) {
    return 'A tabela "fiados" ainda não existe no seu Supabase. Rode o arquivo supabase/adicionar-fiado.sql no SQL Editor do Supabase e recarregue esta tela.';
  }
  return texto || "Não foi possível concluir a operação.";
}

export default function TelaFiado() {
  const supabase = getSupabase();

  const [lancamentos, setLancamentos] = useState<Fiado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Lançar uma nova dívida
  const [form, setForm] = useState({ ...FORM_DIVIDA, data: hojeISO() });

  // Cliente aberto no detalhe (chave do agrupamento)
  const [selecionado, setSelecionado] = useState<string | null>(null);

  // Registrar pagamento do cliente aberto
  const [pago, setPago] = useState({ ...FORM_PAGAMENTO, data: hojeISO() });

  // ============================================================
  // CÁLCULOS DA TELA
  // ============================================================
  const clientes = agruparPorCliente(lancamentos);
  const totalAberto = clientes.reduce(
    (soma, c) => soma + (c.saldo > 0 ? c.saldo : 0),
    0
  );
  const detalhe = selecionado
    ? clientes.find((c) => c.chave === selecionado) || null
    : null;

  // ============================================================
  // CARREGAR LANÇAMENTOS DA LOJA
  // ============================================================
  const carregar = useCallback(async () => {
    if (!supabase) {
      setErro("Conexão com o banco não configurada.");
      setCarregando(false);
      return;
    }
    const sessao = getSessao();
    if (!sessao) {
      setErro("Sessão da loja não encontrada. Entre novamente no sistema.");
      setCarregando(false);
      return;
    }

    setCarregando(true);
    const { data, error } = await supabase
      .from("fiados")
      .select("*")
      .eq("loja_id", sessao.id)
      .order("data", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setErro(descreverErro(error));
      setLancamentos([]);
    } else {
      setErro(null);
      setLancamentos((data || []) as Fiado[]);
    }
    setCarregando(false);
  }, [supabase]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // ============================================================
  // LANÇAR DÍVIDA
  // ============================================================
  async function lancarDivida(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || salvando) return;
    const sessao = getSessao();
    if (!sessao) {
      setErro("Sessão da loja não encontrada. Entre novamente no sistema.");
      return;
    }

    const nome = form.nome.trim();
    const valor = paraValor(form.valor);
    if (!nome) {
      setErro("Informe o nome do cliente.");
      return;
    }
    if (valor <= 0) {
      setErro("Informe um valor maior que zero.");
      return;
    }

    setSalvando(true);
    setMensagem(null);
    const { error } = await supabase.from("fiados").insert({
      loja_id: sessao.id,
      cliente_nome: nome,
      cliente_telefone: form.telefone.trim() || null,
      tipo: "divida",
      valor,
      descricao: form.descricao.trim() || null,
      data: form.data || hojeISO(),
    });
    setSalvando(false);

    if (error) {
      setErro(descreverErro(error));
      return;
    }
    setErro(null);
    setMensagem(`Fiado de ${formatarMoeda(valor)} lançado para ${nome}.`);
    setForm({ ...FORM_DIVIDA, data: hojeISO() });
    await carregar();
  }

  // ============================================================
  // REGISTRAR PAGAMENTO (do cliente aberto)
  // ============================================================
  async function registrarPagamento(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || salvando || !detalhe) return;
    const sessao = getSessao();
    if (!sessao) return;

    const valor = paraValor(pago.valor);
    if (valor <= 0) {
      setErro("Informe um valor maior que zero para o pagamento.");
      return;
    }

    setSalvando(true);
    setMensagem(null);
    const { error } = await supabase.from("fiados").insert({
      loja_id: sessao.id,
      cliente_nome: detalhe.nome,
      cliente_telefone: detalhe.telefone,
      tipo: "pagamento",
      valor,
      descricao: pago.descricao.trim() || null,
      data: pago.data || hojeISO(),
    });
    setSalvando(false);

    if (error) {
      setErro(descreverErro(error));
      return;
    }
    setErro(null);
    setMensagem(`Pagamento de ${formatarMoeda(valor)} registrado para ${detalhe.nome}.`);
    setPago({ ...FORM_PAGAMENTO, data: hojeISO() });
    await carregar();
  }

  // ============================================================
  // EXCLUIR UM LANÇAMENTO
  // ============================================================
  async function excluirLancamento(id: string) {
    if (!supabase) return;
    setMensagem(null);
    const { error } = await supabase.from("fiados").delete().eq("id", id);
    if (error) {
      setErro(descreverErro(error));
      return;
    }
    setErro(null);
    await carregar();
  }

  // ============================================================
  // EXCLUIR O CLIENTE (todos os lançamentos dele)
  // ============================================================
  async function excluirCliente(cliente: FiadoCliente) {
    if (!supabase) return;
    const confirmar = window.confirm(
      `Excluir TODOS os ${cliente.lancamentos.length} lançamentos de ${cliente.nome}?`
    );
    if (!confirmar) return;

    setMensagem(null);
    const ids = cliente.lancamentos.map((l) => l.id);
    const { error } = await supabase.from("fiados").delete().in("id", ids);
    if (error) {
      setErro(descreverErro(error));
      return;
    }
    setErro(null);
    setSelecionado(null);
    setMensagem(`Todos os lançamentos de ${cliente.nome} foram excluídos.`);
    await carregar();
  }

  // ============================================================
  // TELA
  // ============================================================
  return (
    <div className="flex-1 overflow-y-auto p-4 text-gray-900">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Fiado</h1>
        <p className="mt-1 text-sm text-gray-500">
          Controle o que cada cliente levou fiado e registre os pagamentos.
        </p>
      </header>

      {erro && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {erro}
        </div>
      )}
      {mensagem && (
        <div className="mb-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">
          {mensagem}
        </div>
      )}

      {/* Resumo */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Total a receber</p>
          <p className="text-2xl font-bold text-red-600">{formatarMoeda(totalAberto)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Clientes com fiado</p>
          <p className="text-2xl font-bold">
            {clientes.filter((c) => c.saldo > 0).length}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Lançamentos</p>
          <p className="text-2xl font-bold">{lancamentos.length}</p>
        </div>
      </div>

      {/* Lançar fiado (nova dívida) */}
      <form onSubmit={lancarDivida} className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">Lançar fiado (nova dívida)</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-gray-400">Cliente</label>
            <input
              type="text"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Nome do cliente"
              className="w-full rounded bg-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Telefone</label>
            <input
              type="text"
              value={form.telefone}
              onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              placeholder="(00) 00000-0000"
              className="w-full rounded bg-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Valor (R$)</label>
            <input
              type="text"
              inputMode="decimal"
              value={form.valor}
              onChange={(e) => setForm({ ...form, valor: e.target.value })}
              placeholder="Ex: 25,00"
              className="w-full rounded bg-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-gray-400">Descrição</label>
            <input
              type="text"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex: 2 x-burguer e 1 coca"
              className="w-full rounded bg-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">Data</label>
            <input
              type="date"
              value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
              className="w-full rounded bg-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={salvando}
          className="mt-4 rounded-lg bg-green-600 px-6 py-2 font-bold transition hover:bg-green-700 disabled:opacity-40"
        >
          {salvando ? "Salvando..." : "Lançar fiado"}
        </button>
      </form>

      {/* Lista de clientes */}
      {carregando ? (
        <p className="py-10 text-center text-gray-400">Carregando...</p>
      ) : clientes.length === 0 ? (
        <p className="py-10 text-center text-gray-400">
          Nenhum fiado lançado ainda.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left text-gray-600">
              <tr>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Telefone</th>
                <th className="px-4 py-2">Último lançamento</th>
                <th className="px-4 py-2 text-right">Saldo</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {clientes.map((c) => (
                <tr key={c.chave} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-semibold">{c.nome}</td>
                  <td className="px-4 py-2 text-gray-500">{c.telefone ?? "—"}</td>
                  <td className="px-4 py-2 text-gray-500">{dataBR(c.ultimaData)}</td>
                  <td
                    className={`px-4 py-2 text-right font-bold ${
                      c.saldo > 0 ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    {c.saldo > 0 ? formatarMoeda(c.saldo) : "Quitado"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setSelecionado(c.chave)}
                      className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold transition hover:bg-blue-700"
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detalhe do cliente */}
      {detalhe && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelecionado(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{detalhe.nome}</h2>
                <p className="text-sm text-gray-500">
                  {detalhe.telefone ?? "Sem telefone cadastrado"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Saldo em aberto</p>
                <p
                  className={`text-2xl font-bold ${
                    detalhe.saldo > 0 ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {detalhe.saldo > 0 ? formatarMoeda(detalhe.saldo) : "Quitado"}
                </p>
              </div>
            </div>

            {/* Registrar pagamento */}
            <form
              onSubmit={registrarPagamento}
              className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3"
            >
              <h3 className="mb-2 font-semibold">Registrar pagamento</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_1fr_auto]">
                <input
                  type="text"
                  inputMode="decimal"
                  value={pago.valor}
                  onChange={(e) => setPago({ ...pago, valor: e.target.value })}
                  placeholder="Valor R$"
                  className="rounded bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <input
                  type="text"
                  value={pago.descricao}
                  onChange={(e) => setPago({ ...pago, descricao: e.target.value })}
                  placeholder="Descrição (opcional)"
                  className="rounded bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <input
                  type="date"
                  value={pago.data}
                  onChange={(e) => setPago({ ...pago, data: e.target.value })}
                  className="rounded bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  type="submit"
                  disabled={salvando}
                  className="rounded-lg bg-green-600 px-5 py-2 font-bold transition hover:bg-green-700 disabled:opacity-40"
                >
                  Pagar
                </button>
              </div>
            </form>

            {/* Lançamentos do cliente */}
            <h3 className="mb-2 font-semibold">Lançamentos</h3>
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2 text-center w-20">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {detalhe.lancamentos.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-500">{dataBR(l.data)}</td>
                      <td className="px-3 py-2">{l.descricao ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-bold ${
                            l.tipo === "divida"
                              ? "bg-red-100 text-red-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {l.tipo === "divida" ? "Fiado" : "Pagamento"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {formatarMoeda(Number(l.valor))}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => void excluirLancamento(l.id)}
                          className="text-xs font-bold text-red-600 hover:text-red-700"
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                onClick={() => void excluirCliente(detalhe)}
                className="text-sm font-semibold text-red-600 hover:text-red-700"
              >
                Excluir cliente
              </button>
              <button
                onClick={() => setSelecionado(null)}
                className="rounded-lg border border-gray-200 px-5 py-2 font-semibold text-gray-600 transition hover:bg-gray-100"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
