"use client";

// ============================================================
// TELA CADASTRAR PRODUTO (função da faixa cinza)
// CRUD completo de produtos do cardápio:
// criar, listar, editar e excluir (nome, preço, custo,
// categoria, código e foto)
// ============================================================
import { useEffect, useState } from "react";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  Product,
  Categoria,
} from "@/lib/supabase";
import { CATEGORIAS_PADRAO, lerCategorias } from "@/lib/categorias";

// Campos do formulário (texto para facilitar a digitação)
type FormProduto = {
  nome: string;
  preco: string;
  categoria: Categoria;
  codigo: string;
};

// Formulário vazio (estado inicial)
const FORM_VAZIO: FormProduto = {
  nome: "",
  preco: "",
  categoria: "HAMBÚRGUER",
  codigo: "",
};

export default function CadastrarProduto() {
  const supabase = getSupabase();

  // Estados da tela
  const [produtos, setProdutos] = useState<Product[]>([]); // lista de produtos
  const [form, setForm] = useState<FormProduto>(FORM_VAZIO); // formulário
  const [editandoId, setEditandoId] = useState<string | null>(null); // id em edição
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  // Categorias da loja (lista livre, criadas no balcão)
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_PADRAO);

  // ============================================================
  // CARREGAR PRODUTOS
  // ============================================================
  async function carregar() {
    if (!supabase) return;
    const sessao = getSessao();
    if (!sessao) return;
    setCategorias(lerCategorias(sessao.id));
    setCarregando(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("loja_id", sessao.id)
      .order("code");
    if (!error) {
      const lista = (data || []) as Product[];
      setProdutos(lista);
      setCategorias(Array.from(new Set([
        ...lerCategorias(sessao.id),
        ...lista.map((p) => p.category).filter((c) => c !== "TODOS"),
      ])));
    }
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // ============================================================
  // SALVAR (criar novo ou atualizar em edição)
  // ============================================================
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const sessao = getSessao();
    if (!sessao) return;

    // Converte textos em números
    const dados = {
      name: form.nome.trim(),
      price: parseFloat(form.preco.replace(",", ".")) || 0,
      category: form.categoria,
      code: parseInt(form.codigo) || 0,
      loja_id: sessao.id,
    };

    // Validação mínima
    if (!dados.name) {
      setMensagem("Informe o nome do produto.");
      return;
    }
    if (!dados.code) {
      setMensagem("Informe o código do produto.");
      return;
    }

    // Tabela antiga do banco tem colunas em português (nome, preco, codigo)
    // obrigatórias; o schema novo usa só as colunas em inglês. Envia as duas
    // versões e, se alguma coluna não existir, tenta de novo só com o padrão.
    const completo = {
      ...dados,
      nome: dados.name,
      preco: dados.price,
      codigo: dados.code,
    };

    const executar = (payload: Record<string, unknown>) =>
      editandoId
        ? supabase.from("products").update(payload).eq("id", editandoId)
        : supabase.from("products").insert(payload);

    // Categoria nova ainda bloqueada pelo enum do banco -> aviso amigável
    const bloqueadaPorEnum = (mensagem: string) => {
      if (!mensagem.includes("categoria_produto")) return false;
      setMensagem(
        "Para usar categorias novas, libere o banco primeiro: no Supabase, abra o SQL Editor e rode o arquivo supabase/categorias-livres.sql (uma única vez). Depois cadastre de novo."
      );
      return true;
    };

    const primeira = await executar(completo);
    if (primeira.error) {
      if (bloqueadaPorEnum(primeira.error.message)) return;
      // "Could not find the 'x' column" = schema novo (sem colunas pt-BR)
      if (primeira.error.message.includes("Could not find the")) {
        const segunda = await executar(dados);
        if (segunda.error) {
          if (bloqueadaPorEnum(segunda.error.message)) return;
          setMensagem(
            (editandoId ? "Erro ao atualizar: " : "Erro ao cadastrar: ") +
              segunda.error.message
          );
          return;
        }
      } else {
        setMensagem(
          (editandoId ? "Erro ao atualizar: " : "Erro ao cadastrar: ") +
            primeira.error.message
        );
        return;
      }
    }

    setMensagem(editandoId ? "Produto atualizado!" : "Produto cadastrado!");
    setEditandoId(null);

    setForm(FORM_VAZIO);
    carregar();
  }

  // Preenche o formulário para editar
  function editar(p: Product) {
    setEditandoId(p.id);
    setForm({
      nome: p.name,
      preco: String(p.price),
      categoria: p.category,
      codigo: String(p.code),
    });
    setMensagem(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Cancela a edição
  function cancelar() {
    setEditandoId(null);
    setForm(FORM_VAZIO);
  }

  // ============================================================
  // EXCLUIR produto (com confirmação)
  // ============================================================
  async function excluir(p: Product) {
    if (!supabase) return;
    const confirmou = window.confirm(
      `Excluir o produto "${p.name}"? Essa ação não pode ser desfeita.`
    );
    if (!confirmou) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) {
      setMensagem("Erro ao excluir: " + error.message);
      return;
    }
    setMensagem("Produto excluído.");
    carregar();
  }

  // Classe comum dos inputs do formulário
  const inputClasse =
    "w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500";

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Cadastrar Produto</h1>

      {/* Mensagens */}
      {mensagem && (
        <div className="bg-green-50 border border-green-500 text-green-700 rounded-lg p-3 mb-4">
          {mensagem}
        </div>
      )}

      {/* ================= FORMULÁRIO ================= */}
      <div className="bg-white rounded-xl p-4 mb-6">
        <h2 className="font-bold mb-3">
          {editandoId ? "Editar Produto" : "Novo Produto"}
        </h2>
        <form onSubmit={salvar} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-3">
            <label className="block text-xs text-gray-400 mb-1">Nome *</label>
            <input
              type="text"
              placeholder="Nome do produto"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              className={inputClasse}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Preço (R$) *</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="Ex: 29,90"
              value={form.preco}
              onChange={(e) => setForm({ ...form, preco: e.target.value })}
              className={inputClasse}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Código *</label>
            <input
              type="number"
              placeholder="Ex: 13"
              value={form.codigo}
              onChange={(e) => setForm({ ...form, codigo: e.target.value })}
              className={inputClasse}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Categoria</label>
            <select
              value={form.categoria}
              onChange={(e) =>
                setForm({ ...form, categoria: e.target.value as Categoria })
              }
              className={inputClasse}
            >
              {(categorias.includes(form.categoria)
                ? categorias
                : [...categorias, form.categoria]
              ).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3 flex gap-2">
            <button
              type="submit"
              className="bg-green-600 hover:bg-green-700 font-bold px-6 py-2 rounded-lg transition"
            >
              {editandoId ? "Salvar Alterações" : "Cadastrar"}
            </button>
            {editandoId && (
              <button
                type="button"
                onClick={cancelar}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-2 rounded-lg"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ================= TABELA DE PRODUTOS ================= */}
      <div className="bg-white rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-600 text-left">
            <tr>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Categoria</th>
              <th className="px-4 py-2 text-right">Preço</th>
              <th className="px-4 py-2 text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {carregando && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Carregando...
                </td>
              </tr>
            )}
            {!carregando && produtos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Nenhum produto cadastrado.
                </td>
              </tr>
            )}
            {produtos.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono">{p.code}</td>
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2">
                  <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                    {p.category}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  {formatarMoeda(Number(p.price))}
                </td>
                <td className="px-4 py-2 text-center whitespace-nowrap">
                  <button
                    onClick={() => editar(p)}
                    className="text-blue-600 hover:text-blue-700 font-semibold px-2"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => excluir(p)}
                    className="text-red-500 hover:text-red-600 font-semibold px-2"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
