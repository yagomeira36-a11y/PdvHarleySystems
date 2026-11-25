"use client";

// ============================================================
// TELA CADASTRAR PRODUTO (função da faixa cinza)
// CRUD completo de produtos do cardápio:
// criar, listar, editar e excluir (nome, preço, custo,
// categoria, código e foto)
// ============================================================
import { Fragment, useEffect, useRef, useState } from "react";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  Product,
  Categoria,
} from "@/lib/supabase";
import { CATEGORIAS_PADRAO, lerCategorias, salvarCategorias } from "@/lib/categorias";
import { lerCardapioDaFoto } from "@/lib/cardapio-foto";

// Campos do formulário (texto para facilitar a digitação)
type FormProduto = {
  nome: string;
  preco: string;
  categoria: Categoria;
  codigo: string;
  descricao: string;
  disponivel: boolean;
  foto: string | null;
};

// Item lido da foto, em revisão antes de salvar
type ItemRevisao = {
  nome: string;
  preco: string;
  descricao: string;
  codigo: string;
  categoria: Categoria;
  incluir: boolean;
};

// Formulário vazio (estado inicial)
const FORM_VAZIO: FormProduto = {
  nome: "",
  preco: "",
  categoria: "TODOS",
  codigo: "",
  descricao: "",
  disponivel: true,
  foto: null,
};

function mensagemColunaProdutoAusente(erro: string): string | null {
  const colunaAusente =
    /Could not find the '(available|description)' column of 'products' in the schema cache/i.exec(erro)?.[1] ||
    /column\s+(?:public\.)?products\.(available|description)\s+does not exist/i.exec(erro)?.[1];
  if (!colunaAusente) return null;

  const campo = colunaAusente === "description" ? "descrição" : "disponibilidade";
  return `O banco ainda não tem a coluna de ${campo} dos produtos. No SQL Editor do Supabase, execute supabase/disponibilidade-produtos.sql e tente novamente.`;
}

export default function CadastrarProduto() {
  const supabase = getSupabase();

  // Estados da tela
  const [produtos, setProdutos] = useState<Product[]>([]); // lista de produtos
  const [form, setForm] = useState<FormProduto>(FORM_VAZIO); // formulário
  const [editandoId, setEditandoId] = useState<string | null>(null); // id em edição
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erroFotoProduto, setErroFotoProduto] = useState<string | null>(null);
  const inputFotoProduto = useRef<HTMLInputElement>(null);
  // Categorias da loja (lista livre)
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_PADRAO);
  const [novaCategoria, setNovaCategoria] = useState("");

  // Importar cardápio por foto (OCR no navegador)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null); // prévia da imagem
  const [lendoFoto, setLendoFoto] = useState(false); // OCR em andamento
  const [progressoFoto, setProgressoFoto] = useState(0); // 0 a 100
  const [itensRevisao, setItensRevisao] = useState<ItemRevisao[]>([]);
  const [textoBrutoFoto, setTextoBrutoFoto] = useState("");
  const [importando, setImportando] = useState(false);

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
      description: form.descricao.trim(),
      available: form.disponivel,
      image_url: form.foto,
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
      const erroColunaProduto = mensagemColunaProdutoAusente(primeira.error.message);
      if (erroColunaProduto) {
        setMensagem(erroColunaProduto);
        return;
      }
      if (bloqueadaPorEnum(primeira.error.message)) return;
      // "Could not find the 'x' column" = schema novo (sem colunas pt-BR)
      if (primeira.error.message.includes("Could not find the")) {
        const segunda = await executar(dados);
        if (segunda.error) {
          const erroColunaProduto = mensagemColunaProdutoAusente(segunda.error.message);
          if (erroColunaProduto) {
            setMensagem(erroColunaProduto);
            return;
          }
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
    setErroFotoProduto(null);
    if (inputFotoProduto.current) inputFotoProduto.current.value = "";

    setForm(FORM_VAZIO);
    carregar();
  }

  // Preenche o formulário para editar (abre inline abaixo do produto na lista)
  function editar(p: Product) {
    setEditandoId(p.id);
    setForm({
      nome: p.name,
      preco: String(p.price),
      categoria: p.category,
      codigo: String(p.code),
      descricao: p.description || "",
      disponivel: p.available !== false,
      foto: p.image_url || null,
    });
    setErroFotoProduto(null);
    if (inputFotoProduto.current) inputFotoProduto.current.value = "";
    setMensagem(null);
  }

  // Cancela a edição
  function cancelar() {
    setEditandoId(null);
    setForm(FORM_VAZIO);
    setErroFotoProduto(null);
    if (inputFotoProduto.current) inputFotoProduto.current.value = "";
  }

  // Escolhe/troca a foto do produto no formulário (salva junto ao cadastrar/editar)
  function escolherFotoProdutoForm(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    setErroFotoProduto(null);
    if (!arquivo) return;
    if (!arquivo.type.startsWith("image/")) {
      setErroFotoProduto("Escolha um arquivo de imagem (JPG, PNG...).");
      return;
    }
    if (arquivo.size > 1.5 * 1024 * 1024) {
      setErroFotoProduto("Imagem muito grande. Use uma de até 1,5 MB.");
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => setForm((atual) => ({ ...atual, foto: String(leitor.result) }));
    leitor.onerror = () => setErroFotoProduto("Não foi possível ler a imagem. Escolha outro arquivo.");
    leitor.readAsDataURL(arquivo);
  }

  // ============================================================
  // CATEGORIAS (adicionar/excluir) — gerenciamento movido do Balcão
  // ============================================================
  function adicionarCategoria() {
    const s = getSessao();
    const nome = novaCategoria.trim().toUpperCase();
    if (!s) return;
    if (!nome) {
      setMensagem("Informe o nome da categoria.");
      return;
    }
    if (categorias.some((c) => c.toUpperCase() === nome)) {
      setMensagem("Essa categoria já existe.");
      return;
    }
    const lista = [...categorias, nome];
    try {
      salvarCategorias(s.id, lista);
    } catch {
      setMensagem("Não foi possível salvar a categoria no navegador.");
      return;
    }
    setCategorias(lista);
    setNovaCategoria("");
    setForm((atual) => ({ ...atual, categoria: nome as Categoria }));
    setMensagem(`Categoria "${nome}" adicionada.`);
  }

  function excluirCategoria(nome: string) {
    const s = getSessao();
    if (!s) return;
    const confirmou = window.confirm(
      `Excluir a categoria "${nome}" da lista? Os produtos serão mantidos e continuarão disponíveis em TODOS.`
    );
    if (!confirmou) return;
    const lista = categorias.filter((c) => c !== nome);
    try {
      salvarCategorias(s.id, lista);
    } catch {
      setMensagem("Não foi possível excluir a categoria no navegador.");
      return;
    }
    setCategorias(lista);
    setForm((atual) =>
      atual.categoria === nome
        ? { ...atual, categoria: (lista[0] || "TODOS") as Categoria }
        : atual
    );
    setMensagem(`Categoria "${nome}" excluída.`);
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

  // ============================================================
  // IMPORTAR CARDÁPIO POR FOTO
  // 1) Lê a foto (OCR) -> 2) revisão/ajuste -> 3) salva no banco
  // ============================================================

  // Escolheu uma foto: mostra a prévia e começa a leitura
  function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite escolher a mesma foto de novo
    if (!arquivo) return;
    if (fotoUrl) URL.revokeObjectURL(fotoUrl);
    setFotoUrl(URL.createObjectURL(arquivo));
    setItensRevisao([]);
    setTextoBrutoFoto("");
    setMensagem(null);
    void lerFoto(arquivo);
  }

  // Roda o OCR e monta a lista para revisão
  async function lerFoto(arquivo: File) {
    setLendoFoto(true);
    setProgressoFoto(0);
    try {
      const resultado = await lerCardapioDaFoto(arquivo, setProgressoFoto);
      const { itens, textoBruto, linhasLidas } = resultado;
      setTextoBrutoFoto(textoBruto);
      if (itens.length === 0) {
        setMensagem(
          `Consegui ler ${linhasLidas} linhas, mas nenhum preço válido. Tente tirar a foto mais perto, reta e com boa luz`
        );
        return;
      }
      // Códigos seguem depois do maior código já cadastrado
      let proximo = Math.max(0, ...produtos.map((p) => Number(p.code) || 0)) + 1;
      setItensRevisao(
        itens.map((it) => ({
          nome: it.nome,
          preco: it.preco.toFixed(2).replace(".", ","),
          descricao: it.descricao,
          codigo: String(proximo++),
          categoria: form.categoria,
          incluir: true,
        }))
      );
      setMensagem(
        `Encontrei ${itens.length} itens. Confira e ajuste antes de importar.`
      );
    } catch (erro) {
      setMensagem(
        "Erro ao ler a foto: " +
          (erro instanceof Error ? erro.message : String(erro))
      );
    } finally {
      setLendoFoto(false);
    }
  }

  // Altera um campo de um item da revisão
  function alterarItem(index: number, dados: Partial<ItemRevisao>) {
    setItensRevisao((lista) =>
      lista.map((it, i) => (i === index ? { ...it, ...dados } : it))
    );
  }

  // Descarta a foto e a lista em revisão
  function limparFoto() {
    if (fotoUrl) URL.revokeObjectURL(fotoUrl);
    setFotoUrl(null);
    setItensRevisao([]);
    setTextoBrutoFoto("");
    setProgressoFoto(0);
  }

  function removerItem(index: number) {
    setItensRevisao((lista) => lista.filter((_, i) => i !== index));
  }

  // Insere vários produtos de uma vez (com o mesmo plano B do cadastro:
  // tabela antiga com colunas em português)
  async function inserirProdutos(
    lista: {
      name: string;
      price: number;
      description: string;
      category: string;
      code: number;
    }[]
  ): Promise<string | null> {
    if (!supabase) return "Sem conexão com o banco.";
    const sessao = getSessao();
    if (!sessao) return "Sessão expirada. Entre novamente.";
    const base = lista.map((d) => ({ ...d, loja_id: sessao.id }));
    const completo = base.map((d) => ({
      ...d,
      nome: d.name,
      preco: d.price,
      codigo: d.code,
      descricao: d.description,
    }));

    const primeira = await supabase.from("products").insert(completo);
    if (!primeira.error) return null;
    if (primeira.error.message.includes("categoria_produto")) {
      return "Uma das categorias não existe no banco. No SQL Editor do Supabase, rode supabase/categorias-livres.sql e tente de novo.";
    }
    if (primeira.error.message.includes("Could not find the")) {
      const segunda = await supabase.from("products").insert(base);
      if (!segunda.error) return null;
      return "Erro ao importar: " + segunda.error.message;
    }
    return "Erro ao importar: " + primeira.error.message;
  }

  // Salva os itens marcados na revisão
  async function importarSelecionados() {
    const marcados = itensRevisao.filter((i) => i.incluir);
    if (marcados.length === 0) {
      setMensagem("Marque pelo menos um item para importar.");
      return;
    }
    const lista = marcados.map((i) => ({
      name: i.nome.trim(),
      price: Number(i.preco.trim().replace(",", ".")),
      description: i.descricao,
      category: i.categoria,
      code: parseInt(i.codigo) || 0,
    }));
    if (lista.some((d) => !d.name)) {
      setMensagem("Todo item precisa de um nome.");
      return;
    }
    if (
      lista.some(
        (d) => !Number.isFinite(d.price) || d.price < 1 || d.price > 999
      )
    ) {
      setMensagem("Informe preços válidos entre R$ 1,00 e R$ 999,00.");
      return;
    }
    if (lista.some((d) => !d.code)) {
      setMensagem("Todo item precisa de um código.");
      return;
    }
    if (new Set(lista.map((d) => d.code)).size !== lista.length) {
      setMensagem("Há códigos repetidos na lista. Ajuste antes de importar.");
      return;
    }

    setImportando(true);
    const erro = await inserirProdutos(lista);
    setImportando(false);
    if (erro) {
      setMensagem(erro);
      return;
    }
    setMensagem(`${lista.length} produto(s) importados!`);
    limparFoto();
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

      {/* ================= FORMULÁRIO NOVO PRODUTO / AVISO DE EDIÇÃO INLINE ================= */}
      <div className="bg-white rounded-xl p-4 mb-6">
        {editandoId ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">Editando produto</h2>
              <p className="text-sm text-gray-500">
                As opções de edição (nome, valor e foto) aparecem abaixo do produto selecionado na lista.
              </p>
            </div>
            <button
              type="button"
              onClick={cancelar}
              className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold px-4 py-2 rounded-lg"
            >
              Cancelar edição
            </button>
          </div>
        ) : (
          <>
            <h2 className="font-bold mb-3">Novo Produto</h2>
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
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-400 mb-1">Descrição do cardápio digital</label>
                <input
                  type="text"
                  placeholder="Ex: Hambúrguer artesanal, queijo e molho da casa"
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                  className={inputClasse}
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold md:self-end pb-2">
                <input
                  type="checkbox"
                  checked={form.disponivel}
                  onChange={(e) => setForm({ ...form, disponivel: e.target.checked })}
                  className="h-4 w-4"
                />
                Disponível no cardápio digital
              </label>
              <div className="md:col-span-3">
                <label className="block text-xs text-gray-400 mb-1">Foto do produto</label>
                <div className="flex items-center gap-3">
                  {form.foto ? (
                    <img
                      src={form.foto}
                      alt="Foto do produto"
                      className="w-16 h-16 rounded-lg object-cover border border-gray-200"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-[10px] text-gray-400 text-center px-1">
                      Sem foto
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => inputFotoProduto.current?.click()}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-3 py-1.5 rounded-lg transition"
                    >
                      {form.foto ? "Trocar foto" : "Escolher foto"}
                    </button>
                    {form.foto && (
                      <button
                        type="button"
                        onClick={() => {
                          setForm((atual) => ({ ...atual, foto: null }));
                          setErroFotoProduto(null);
                          if (inputFotoProduto.current) inputFotoProduto.current.value = "";
                        }}
                        className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold px-3 py-1.5 rounded-lg transition"
                      >
                        Remover foto
                      </button>
                    )}
                  </div>
                </div>
                {erroFotoProduto && (
                  <p className="text-xs text-red-600 mt-2">{erroFotoProduto}</p>
                )}
                <input
                  ref={inputFotoProduto}
                  type="file"
                  accept="image/*"
                  onChange={escolherFotoProdutoForm}
                  className="hidden"
                />
              </div>
              <div className="md:col-span-3 flex gap-2">
                <button
                  type="submit"
                  className="bg-green-600 hover:bg-green-700 font-bold px-6 py-2 rounded-lg transition"
                >
                  Cadastrar
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {/* ================= CATEGORIAS ================= */}
      <div className="bg-white rounded-xl p-4 mb-6">
        <h2 className="font-bold mb-1">Categorias</h2>
        <p className="text-xs text-gray-500 mb-3">
          Adicione ou exclua categorias usadas nos produtos e no balcão.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {categorias.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 rounded-full px-3 py-1 text-sm"
            >
              {c}
              <button
                type="button"
                onClick={() => excluirCategoria(c)}
                title={`Excluir categoria ${c}`}
                aria-label={`Excluir categoria ${c}`}
                className="text-gray-500 hover:text-red-600 font-bold leading-none"
              >
                ×
              </button>
            </span>
          ))}
          {categorias.length === 0 && (
            <span className="text-sm text-gray-400">Nenhuma categoria cadastrada.</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={novaCategoria}
            onChange={(e) => setNovaCategoria(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarCategoria())}
            placeholder="Nova categoria"
            className="bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-48"
          />
          <button
            type="button"
            onClick={adicionarCategoria}
            className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 py-2 rounded-lg transition"
          >
            Adicionar categoria
          </button>
        </div>
      </div>

      {/* ================= IMPORTAR CARDÁPIO POR FOTO ================= */}
      <div className="bg-white rounded-xl p-4 mb-6">
        <h2 className="font-bold mb-1">Importar cardápio por foto</h2>
        <p className="text-xs text-gray-500 mb-3">
          Tire uma foto (ou escolha uma imagem) do seu cardápio. O sistema lê os
          itens com nome e preço no próprio computador e mostra tudo para você
          revisar antes de salvar.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg cursor-pointer transition">
            📷 Escolher foto
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={escolherFoto}
            />
          </label>
          {lendoFoto && (
            <span className="text-sm text-gray-600">
              Lendo a foto… {progressoFoto}%
            </span>
          )}
          {(fotoUrl || itensRevisao.length > 0) && !lendoFoto && (
            <button
              type="button"
              onClick={limparFoto}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Limpar
            </button>
          )}
        </div>

        {lendoFoto && (
          <div className="mt-3 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${progressoFoto}%` }}
            />
          </div>
        )}

        {fotoUrl && (
          <img
            src={fotoUrl}
            alt="Foto do cardápio"
            className="mt-3 max-h-64 rounded-lg border border-gray-200"
          />
        )}

        {itensRevisao.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-semibold mb-2">
              Revise os itens lidos antes de importar:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-gray-600 text-left">
                  <tr>
                    <th className="px-2 py-2 w-10 text-center">OK</th>
                    <th className="px-2 py-2">Nome</th>
                    <th className="px-2 py-2 w-28">Preço (R$)</th>
                    <th className="px-2 py-2 w-24">Código</th>
                    <th className="px-2 py-2 w-40">Categoria</th>
                    <th className="px-2 py-2 w-20">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {itensRevisao.map((it, i) => (
                    <tr key={i} className={it.incluir ? "" : "opacity-50"}>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={it.incluir}
                          onChange={(e) =>
                            alterarItem(i, { incluir: e.target.checked })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={it.nome}
                          onChange={(e) =>
                            alterarItem(i, { nome: e.target.value })
                          }
                          className={inputClasse}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={it.preco}
                          onChange={(e) =>
                            alterarItem(i, { preco: e.target.value })
                          }
                          className={inputClasse}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          value={it.codigo}
                          onChange={(e) =>
                            alterarItem(i, { codigo: e.target.value })
                          }
                          className={inputClasse}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={it.categoria}
                          onChange={(e) =>
                            alterarItem(i, {
                              categoria: e.target.value as Categoria,
                            })
                          }
                          className={inputClasse}
                        >
                          {(categorias.includes(it.categoria)
                            ? categorias
                            : [...categorias, it.categoria]
                          ).map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => removerItem(i)}
                          className="text-red-600 hover:text-red-800 underline"
                          aria-label={`Excluir ${it.nome}`}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={importarSelecionados}
              disabled={importando}
              className="mt-3 bg-green-600 hover:bg-green-700 font-bold px-6 py-2 rounded-lg transition disabled:opacity-50"
            >
              {importando
                ? "Importando…"
                : `Importar ${itensRevisao.filter((i) => i.incluir).length} produto(s)`}
            </button>
          </div>
        )}

        {fotoUrl && !lendoFoto && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">
              Texto bruto lido pelo OCR (para diagnóstico):
            </p>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-700">
              {textoBrutoFoto || "(nenhum texto reconhecido)"}
            </pre>
          </div>
        )}
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
              <Fragment key={p.id}>
                <tr className="hover:bg-gray-50">
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
                      onClick={async () => {
                        if (!supabase) return;
                        const novoDisponivel = p.available === false;
                        const { error } = await supabase
                          .from("products")
                          .update({ available: novoDisponivel })
                          .eq("id", p.id);
                        if (error) {
                          setMensagem(
                            mensagemColunaProdutoAusente(error.message) ||
                              "Erro ao atualizar disponibilidade: " + error.message
                          );
                        } else {
                          setMensagem(
                            novoDisponivel
                              ? "Produto disponível no cardápio!"
                              : "Produto pausado no cardápio!"
                          );
                          carregar();
                        }
                      }}
                      className={`font-semibold px-2 ${p.available === false ? "text-green-600 hover:text-green-700" : "text-orange-600 hover:text-orange-700"}`}
                    >
                      {p.available === false ? "Ativar" : "Pausar"}
                    </button>
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
                {editandoId === p.id && (
                  <tr className="bg-blue-50/40">
                    <td colSpan={5} className="px-4 py-3">
                      <form onSubmit={salvar} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="md:col-span-3 flex items-center justify-between gap-2">
                          <h3 className="font-bold text-sm">Editar produto</h3>
                          <span className="text-xs text-gray-500">Altere nome, valor e foto abaixo</span>
                        </div>
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
                        <div className="md:col-span-2">
                          <label className="block text-xs text-gray-400 mb-1">Descrição do cardápio digital</label>
                          <input
                            type="text"
                            placeholder="Ex: Hambúrguer artesanal, queijo e molho da casa"
                            value={form.descricao}
                            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                            className={inputClasse}
                          />
                        </div>
                        <label className="flex items-center gap-2 text-sm font-semibold md:self-end pb-2">
                          <input
                            type="checkbox"
                            checked={form.disponivel}
                            onChange={(e) => setForm({ ...form, disponivel: e.target.checked })}
                            className="h-4 w-4"
                          />
                          Disponível no cardápio digital
                        </label>
                        <div className="md:col-span-3">
                          <label className="block text-xs text-gray-400 mb-1">Foto do produto</label>
                          <div className="flex items-center gap-3">
                            {form.foto ? (
                              <img
                                src={form.foto}
                                alt="Foto do produto"
                                className="w-16 h-16 rounded-lg object-cover border border-gray-200"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-[10px] text-gray-400 text-center px-1">
                                Sem foto
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => inputFotoProduto.current?.click()}
                                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-3 py-1.5 rounded-lg transition"
                              >
                                {form.foto ? "Trocar foto" : "Escolher foto"}
                              </button>
                              {form.foto && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setForm((atual) => ({ ...atual, foto: null }));
                                    setErroFotoProduto(null);
                                    if (inputFotoProduto.current) inputFotoProduto.current.value = "";
                                  }}
                                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold px-3 py-1.5 rounded-lg transition"
                                >
                                  Remover foto
                                </button>
                              )}
                            </div>
                          </div>
                          {erroFotoProduto && (
                            <p className="text-xs text-red-600 mt-2">{erroFotoProduto}</p>
                          )}
                          <input
                            ref={inputFotoProduto}
                            type="file"
                            accept="image/*"
                            onChange={escolherFotoProdutoForm}
                            className="hidden"
                          />
                        </div>
                        <div className="md:col-span-3 flex gap-2">
                          <button
                            type="submit"
                            className="bg-green-600 hover:bg-green-700 font-bold px-6 py-2 rounded-lg transition"
                          >
                            Salvar Alterações
                          </button>
                          <button
                            type="button"
                            onClick={cancelar}
                            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-2 rounded-lg"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
