"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSessao, getSupabase, normalizarTelefone } from "@/lib/supabase";
import type { Cliente } from "@/lib/supabase";

const FORM_VAZIO = { nome: "", telefone: "", endereco: "", complemento: "" };

export default function Clientes() {
  const supabase = getSupabase();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState(FORM_VAZIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");

  const carregar = useCallback(async () => {
    const sessao = getSessao();
    if (!supabase || !sessao) {
      setErro("Não foi possível acessar os clientes. Confira a conexão e entre novamente.");
      setCarregando(false);
      return;
    }

    setCarregando(true);
    const { data, error } = await supabase
      .from("clientes")
      .select("id,nome,telefone,endereco,complemento,created_at")
      .eq("loja_id", sessao.id)
      .order("nome", { ascending: true });

    if (error) {
      setErro(`Não foi possível carregar os clientes: ${error.message}`);
      setClientes([]);
    } else {
      setErro("");
      setClientes(((data || []) as Cliente[]).filter((cliente) => Boolean(cliente.endereco?.trim())));
    }
    setCarregando(false);
  }, [supabase]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const clientesFiltrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    if (!termo) return clientes;
    const digitos = normalizarTelefone(termo);
    return clientes.filter((cliente) =>
      cliente.nome.toLocaleLowerCase("pt-BR").includes(termo) ||
      normalizarTelefone(cliente.telefone).includes(digitos)
    );
  }, [busca, clientes]);

  function editar(cliente: Cliente) {
    setEditandoId(cliente.id);
    setForm({
      nome: cliente.nome,
      telefone: cliente.telefone,
      endereco: cliente.endereco || "",
      complemento: cliente.complemento || "",
    });
    setErro("");
    setMensagem("");
  }

  function cancelarEdicao() {
    setEditandoId(null);
    setForm(FORM_VAZIO);
  }

  async function salvar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || salvando) return;
    if (!editandoId) {
      setErro("Selecione um cliente da lista para editar.");
      return;
    }
    const sessao = getSessao();
    if (!sessao) {
      setErro("Sessão da loja não encontrada. Entre novamente no sistema.");
      return;
    }

    const nome = form.nome.trim();
    const telefone = normalizarTelefone(form.telefone);
    if (!nome) {
      setErro("Informe o nome do cliente.");
      return;
    }
    if (telefone.length < 10 || telefone.length > 13) {
      setErro("Informe um telefone válido com DDD.");
      return;
    }

    setSalvando(true);
    setErro("");
    setMensagem("");
    const dados = {
      nome,
      telefone,
      endereco: form.endereco.trim() || null,
      complemento: form.complemento.trim() || null,
    };
    const resultado = await supabase
      .from("clientes")
      .update(dados)
      .eq("id", editandoId)
      .eq("loja_id", sessao.id);
    setSalvando(false);

    if (resultado.error) {
      setErro(resultado.error.code === "23505"
        ? "Já existe um cliente com esse telefone nesta loja."
        : `Não foi possível salvar o cliente: ${resultado.error.message}`);
      return;
    }
    setMensagem("Informações do cliente atualizadas.");
    cancelarEdicao();
    await carregar();
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
      <div className="mx-auto max-w-5xl space-y-5">
        {editandoId && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-wider text-green-700">Cliente de delivery</p>
              <h2 className="mt-1 text-xl font-black text-gray-900">Editar informações</h2>
            </div>
            <form onSubmit={(event) => void salvar(event)} className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold text-gray-700">
              Nome
              <input
                required
                maxLength={120}
                value={form.nome}
                onChange={(event) => setForm({ ...form, nome: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                placeholder="Nome do cliente"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700">
              Telefone
              <input
                required
                type="tel"
                inputMode="tel"
                maxLength={20}
                value={form.telefone}
                onChange={(event) => setForm({ ...form, telefone: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                placeholder="(11) 99999-9999"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700">
              Endereço
              <input
                required
                maxLength={250}
                value={form.endereco}
                onChange={(event) => setForm({ ...form, endereco: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                placeholder="Rua, número e bairro"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700">
              Complemento <span className="font-normal text-gray-400">(opcional)</span>
              <input
                maxLength={120}
                value={form.complemento}
                onChange={(event) => setForm({ ...form, complemento: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
                placeholder="Apto, referência..."
              />
            </label>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button type="submit" disabled={salvando} className="rounded-lg bg-green-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-green-800 disabled:opacity-50">
                  {salvando ? "Salvando..." : "Salvar alterações"}
                </button>
                <button type="button" onClick={cancelarEdicao} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-100">
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        )}

        {erro && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
        {mensagem && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{mensagem}</p>}

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4">
            <div>
              <h2 className="font-black text-gray-900">Clientes salvos</h2>
              <p className="mt-1 text-xs text-gray-500">{clientes.length} clientes de delivery</p>
            </div>
            <input
              type="search"
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-72"
              placeholder="Buscar por nome ou telefone"
              aria-label="Buscar clientes por nome ou telefone"
            />
          </header>
          {carregando ? (
            <p role="status" className="p-8 text-center text-sm text-gray-500">Carregando clientes...</p>
          ) : clientesFiltrados.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">
              {clientes.length ? "Nenhum cliente encontrado para essa busca." : "Os clientes aparecerão aqui após realizarem um pedido delivery."}
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {clientesFiltrados.map((cliente) => (
                <article key={cliente.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <h3 className="truncate font-bold text-gray-900">{cliente.nome}</h3>
                    <p className="mt-1 text-sm text-gray-600">{cliente.telefone}</p>
                    <p className="mt-1 text-sm text-gray-500">
                      {cliente.endereco || "Endereço não informado"}
                      {cliente.complemento ? ` · ${cliente.complemento}` : ""}
                    </p>
                  </div>
                  <button type="button" onClick={() => editar(cliente)} className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100">
                    Editar informações
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
