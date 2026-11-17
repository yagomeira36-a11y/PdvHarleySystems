"use client";

// ============================================================
// TELA LAYOUT — personalização da loja pelo dono:
// - Cor do layout (sidebar)
// - Cor das letras do menu
// - Tamanho das letras do app (Pequeno/Médio/Grande)
// - Imagem (logo) da loja
// Tudo é salvo no navegador da loja e aplica na hora.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { getSessao, getSupabase, Product } from "@/lib/supabase";
import {
  LayoutConfig as TipoLayout,
  LAYOUT_PADRAO,
  lerLayout,
  salvarLayout,
  escurecer,
} from "@/lib/layout";

export default function LayoutConfig({
  aoPedidoCriado,
}: {
  aoPedidoCriado: (texto: string, tipo?: "ok" | "erro") => void;
}) {
  const [cor, setCor] = useState(LAYOUT_PADRAO.cor);
  const [corLetras, setCorLetras] = useState(LAYOUT_PADRAO.corLetras);
  const [tamanho, setTamanho] = useState<TipoLayout["tamanho"]>("medio");
  const [logo, setLogo] = useState<string | null>(null);
  const [fundo, setFundo] = useState<string | null>(null);
  const [cardapio, setCardapio] = useState<string | null>(null);
  const [erroImagem, setErroImagem] = useState<string | null>(null);
  const [erroFundo, setErroFundo] = useState<string | null>(null);
  const [erroCardapio, setErroCardapio] = useState<string | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const inputFundo = useRef<HTMLInputElement>(null);
  const inputCardapio = useRef<HTMLInputElement>(null);

  const [produtos, setProdutos] = useState<Product[]>([]);
  const fotoPara = useRef<string | null>(null);
  const [salvandoFoto, setSalvandoFoto] = useState<string | null>(null);
  const [carregandoProdutos, setCarregandoProdutos] = useState(true);
  const [erroProdutoFoto, setErroProdutoFoto] = useState<string | null>(null);
  const inputProdutoFoto = useRef<HTMLInputElement>(null);

  // Carrega a configuração atual da loja
  useEffect(() => {
    const s = getSessao();
    if (!s) return;
    const cfg = lerLayout(s.id);
    setCor(cfg.cor);
    setCorLetras(cfg.corLetras);
    setTamanho(cfg.tamanho);
    setLogo(cfg.logo);
    setFundo(cfg.fundo);
    setCardapio(cfg.cardapio);
  }, []);

  // Carrega os produtos da loja (para colocar foto em cada um)
  useEffect(() => {
    const s = getSessao();
    const supabase = getSupabase();
    if (!s || !supabase) {
      setCarregandoProdutos(false);
      return;
    }
    supabase
      .from("products")
      .select("*")
      .eq("loja_id", s.id)
      .order("code")
      .then(({ data, error }) => {
        if (error) setErroProdutoFoto("Erro ao carregar produtos: " + error.message);
        else setProdutos((data || []) as Product[]);
        setCarregandoProdutos(false);
      });
  }, []);

  // ============================================================
  // ESCOLHER IMAGEM DA LOJA (logo)
  // ============================================================
  function escolherImagem(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    setErroImagem(null);
    if (!arquivo) return;
    if (!arquivo.type.startsWith("image/")) {
      setErroImagem("Escolha um arquivo de imagem (JPG, PNG...).");
      return;
    }
    if (arquivo.size > 1.5 * 1024 * 1024) {
      setErroImagem("Imagem muito grande. Use uma de até 1,5 MB.");
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => setLogo(String(leitor.result));
    leitor.readAsDataURL(arquivo);
  }

  // ============================================================
  // ESCOLHER IMAGEM DE FUNDO (banner da área principal)
  // ============================================================
  function escolherFundo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    setErroFundo(null);
    if (!arquivo) return;
    if (!arquivo.type.startsWith("image/")) {
      setErroFundo("Escolha um arquivo de imagem (JPG, PNG...).");
      return;
    }
    if (arquivo.size > 2 * 1024 * 1024) {
      setErroFundo("Imagem muito grande. Use uma de até 2 MB.");
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => setFundo(String(leitor.result));
    leitor.readAsDataURL(arquivo);
  }

  // ============================================================
  // ESCOLHER IMAGEM DO CARDÁPIO (aberta pelo botão CARDÁPIO)
  // ============================================================
  function escolherCardapio(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    setErroCardapio(null);
    if (!arquivo) return;
    if (!arquivo.type.startsWith("image/")) {
      setErroCardapio("Escolha um arquivo de imagem (JPG, PNG...).");
      return;
    }
    if (arquivo.size > 2 * 1024 * 1024) {
      setErroCardapio("Imagem muito grande. Use uma de até 2 MB.");
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => setCardapio(String(leitor.result));
    leitor.readAsDataURL(arquivo);
  }

  function escolherFotoProduto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    const produtoId = fotoPara.current;
    e.target.value = "";
    setErroProdutoFoto(null);
    if (!arquivo || !produtoId || salvandoFoto) return;
    if (!arquivo.type.startsWith("image/")) {
      setErroProdutoFoto("Escolha um arquivo de imagem (JPG, PNG...).");
      return;
    }
    if (arquivo.size > 1.5 * 1024 * 1024) {
      setErroProdutoFoto("Imagem muito grande. Use uma de até 1,5 MB.");
      return;
    }
    setSalvandoFoto(produtoId);
    const leitor = new FileReader();
    leitor.onload = () => atualizarFoto(produtoId, String(leitor.result));
    leitor.onerror = () => {
      setSalvandoFoto(null);
      setErroProdutoFoto("Não foi possível ler a imagem. Escolha outro arquivo.");
    };
    leitor.readAsDataURL(arquivo);
  }

  async function atualizarFoto(produtoId: string, url: string | null) {
    const supabase = getSupabase();
    const s = getSessao();
    if (!supabase || !s) {
      setSalvandoFoto(null);
      return;
    }
    setSalvandoFoto(produtoId);
    setErroProdutoFoto(null);
    const { data, error } = await supabase
      .from("products")
      .update({ image_url: url })
      .eq("id", produtoId)
      .eq("loja_id", s.id)
      .select("id,image_url")
      .maybeSingle();
    setSalvandoFoto(null);
    if (error || !data) {
      setErroProdutoFoto("Erro ao salvar a foto: " + (error?.message || "produto não encontrado."));
      return;
    }
    setProdutos((atual) =>
      atual.map((p) => (p.id === produtoId ? { ...p, image_url: data.image_url } : p))
    );
    aoPedidoCriado(url ? "Foto do produto salva!" : "Foto do produto removida.");
  }

  // ============================================================
  // SALVAR (aplica na hora em todas as telas)
  // ============================================================
  function salvar() {
    const s = getSessao();
    if (!s) return;
    salvarLayout(s.id, { cor, corLetras, tamanho, logo, fundo, cardapio });
    aoPedidoCriado("Layout salvo e aplicado!");
  }

  // ============================================================
  // RESTAURAR O PADRÃO AZUL
  // ============================================================
  function restaurar() {
    setCor(LAYOUT_PADRAO.cor);
    setCorLetras(LAYOUT_PADRAO.corLetras);
    setTamanho("medio");
    setLogo(null);
    setFundo(null);
    setCardapio(null);
    const s = getSessao();
    if (!s) return;
    salvarLayout(s.id, { ...LAYOUT_PADRAO });
    aoPedidoCriado("Layout voltou ao padrão!");
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h1 className="text-2xl font-extrabold mb-4">Layout da Loja</h1>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 max-w-5xl">
        {/* ============ Coluna de configurações ============ */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 space-y-5">
          {/* Cor do layout */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              Cor do layout
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Cor da barra lateral (menu azul).
            </p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={cor}
                onChange={(e) => setCor(e.target.value)}
                className="w-14 h-10 rounded-lg border border-gray-200 cursor-pointer bg-white p-1"
              />
              <input
                type="text"
                value={cor}
                onChange={(e) => setCor(e.target.value)}
                className="w-28 bg-white border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Cor das letras */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              Cor das letras
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Cor das letras do menu lateral.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={corLetras}
                onChange={(e) => setCorLetras(e.target.value)}
                className="w-14 h-10 rounded-lg border border-gray-200 cursor-pointer bg-white p-1"
              />
              <input
                type="text"
                value={corLetras}
                onChange={(e) => setCorLetras(e.target.value)}
                className="w-28 bg-white border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Tamanho das letras */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              Tamanho das letras
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Tamanho das letras de todo o sistema.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["pequeno", "Pequeno"],
                  ["medio", "Médio"],
                  ["grande", "Grande"],
                ] as const
              ).map(([valor, rotulo]) => (
                <button
                  key={valor}
                  onClick={() => setTamanho(valor)}
                  className={`py-2.5 rounded-lg font-bold transition ${
                    tamanho === valor
                      ? "bg-green-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>

          {/* Imagem da loja */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              Imagem da loja
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Aparece no quadrinho amarelo do menu (foto ou logo da loja).
            </p>
            <div className="flex items-center gap-3">
              {logo ? (
                <img
                  src={logo}
                  alt="Logo da loja"
                  className="w-14 h-14 rounded-full object-cover border-2 border-gray-200"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center text-[10px] font-bold">
                  SEM FOTO
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => inputArquivo.current?.click()}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition"
                >
                  Escolher imagem
                </button>
                {logo && (
                  <button
                    onClick={() => setLogo(null)}
                    className="text-xs text-red-500 hover:text-red-700 font-bold"
                  >
                    Remover imagem
                  </button>
                )}
                <input
                  ref={inputArquivo}
                  type="file"
                  accept="image/*"
                  onChange={escolherImagem}
                  className="hidden"
                />
              </div>
            </div>
            {erroImagem && (
              <p className="text-xs text-red-600 mt-2 bg-red-50 border border-red-300 rounded p-2">
                {erroImagem}
              </p>
            )}
          </div>

          {/* Imagem de fundo da área principal (banner) */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              Imagem de fundo (banner)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Papel de parede da área branca do sistema — aparece atrás de
              todas as telas, como o fundo do computador.
            </p>
            <div className="flex items-center gap-3">
              {fundo ? (
                <img
                  src={fundo}
                  alt="Fundo da loja"
                  className="w-24 h-14 rounded-lg object-cover border-2 border-gray-200"
                />
              ) : (
                <div className="w-24 h-14 rounded-lg bg-gray-200 text-gray-400 flex items-center justify-center text-[10px] font-bold">
                  SEM FUNDO
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => inputFundo.current?.click()}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition"
                >
                  Escolher imagem
                </button>
                {fundo && (
                  <button
                    onClick={() => setFundo(null)}
                    className="text-xs text-red-500 hover:text-red-700 font-bold"
                  >
                    Remover imagem
                  </button>
                )}
                <input
                  ref={inputFundo}
                  type="file"
                  accept="image/*"
                  onChange={escolherFundo}
                  className="hidden"
                />
              </div>
            </div>
            {erroFundo && (
              <p className="text-xs text-red-600 mt-2 bg-red-50 border border-red-300 rounded p-2">
                {erroFundo}
              </p>
            )}
          </div>

          {/* Imagem do cardápio (aberta pelo botão CARDÁPIO) */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              Imagem do cardápio
            </label>
            <p className="text-xs text-gray-500 mb-2">
              É o que abre quando o cliente clica no botão CARDÁPIO, no rodapé
              do menu.
            </p>
            <div className="flex items-center gap-3">
              {cardapio ? (
                <img
                  src={cardapio}
                  alt="Cardápio"
                  className="w-24 h-14 rounded-lg object-cover border-2 border-gray-200"
                />
              ) : (
                <div className="w-24 h-14 rounded-lg bg-gray-200 text-gray-400 flex items-center justify-center text-[10px] font-bold">
                  SEM IMAGEM
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => inputCardapio.current?.click()}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition"
                >
                  Escolher imagem
                </button>
                {cardapio && (
                  <button
                    onClick={() => setCardapio(null)}
                    className="text-xs text-red-500 hover:text-red-700 font-bold"
                  >
                    Remover imagem
                  </button>
                )}
                <input
                  ref={inputCardapio}
                  type="file"
                  accept="image/*"
                  onChange={escolherCardapio}
                  className="hidden"
                />
              </div>
            </div>
            {erroCardapio && (
              <p className="text-xs text-red-600 mt-2 bg-red-50 border border-red-300 rounded p-2">
                {erroCardapio}
              </p>
            )}
          </div>

          {/* Botões salvar / restaurar */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={salvar}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-extrabold py-3 rounded-xl transition"
            >
              SALVAR
            </button>
            <button
              onClick={restaurar}
              className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold px-5 py-3 rounded-xl transition"
            >
              Padrão
            </button>
          </div>
        </div>

        {/* ============ Prévia ao vivo ============ */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm font-bold text-gray-700 mb-3">Prévia</p>
          <div
            className="rounded-2xl p-4 w-full max-w-[280px] mx-auto"
            style={{
              background: `linear-gradient(to bottom, ${cor}, ${escurecer(
                cor,
                0.25
              )})`,
              color: corLetras,
            }}
          >
            <div className="relative inline-block mb-3">
              <div className="bg-gradient-to-b from-gray-400 to-gray-600 rounded-xl px-4 py-1.5 shadow-[0_3px_8px_rgba(0,0,0,0.3),inset_0_2px_3px_rgba(255,255,255,0.35)] border border-white/40">
                <p
                  className="text-lg font-black italic tracking-wider text-white leading-none"
                  style={{
                    textShadow:
                      "1px 1px 0 #4b5563, 2px 2px 0 #374151, 3px 3px 0 #1f2937, 4px 4px 8px rgba(0,0,0,0.45)",
                  }}
                >
                  PdvDG
                </p>
              </div>
              <div className="absolute -bottom-1 left-5 w-2.5 h-2.5 bg-gray-600 rotate-45 rounded-sm" />
            </div>
            <p className="text-[10px] opacity-70 mb-3">
              Ponto de Venda Da Galera
            </p>
            <div className="bg-gradient-to-b from-gray-400 to-gray-600 rounded-xl p-2.5 flex items-center gap-2 mb-3 shadow-[0_3px_8px_rgba(0,0,0,0.3),inset_0_2px_3px_rgba(255,255,255,0.35)] border border-white/40">
              {logo ? (
                <img
                  src={logo}
                  alt="Logo"
                  className="w-8 h-8 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-700 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  AD
                </div>
              )}
              <div className="min-w-0">
                <p
                  className="text-xs font-extrabold text-white truncate"
                  style={{
                    textShadow:
                      "1px 1px 0 #4b5563, 2px 2px 0 #374151, 2px 2px 4px rgba(0,0,0,0.4)",
                  }}
                >
                  Administrador
                </p>
                <p className="text-[9px] text-gray-200 truncate">
                  email@loja.com
                </p>
              </div>
            </div>
            <p className="text-[9px] font-bold uppercase tracking-widest opacity-60 mb-1">
              Painel de Pedidos
            </p>
            <div className="space-y-1 text-xs font-medium">
              <p className="px-2 py-1.5 rounded-lg bg-white/20 font-bold">
                Cozinha
              </p>
              <p className="px-2 py-1.5 rounded-lg opacity-90">
                Pedido Finalizado
              </p>
              <p className="px-2 py-1.5 rounded-lg opacity-90">Balcão</p>
            </div>
          </div>

          {/* Prévia da área principal com o fundo */}
          <div
            className="mt-4 h-24 rounded-xl border border-gray-200 overflow-hidden bg-cover bg-center"
            style={
              fundo
                ? { backgroundImage: `url(${fundo})` }
                : { backgroundColor: "#F3F4F6" }
            }
          >
            {!fundo && (
              <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                área branca (sem imagem de fundo)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============ Fotos dos produtos do balcão ============ */}
      <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-200 p-5 max-w-5xl">
        <p className="text-sm font-bold text-gray-700 mb-1">
          Fotos dos produtos (Balcão)
        </p>
        <p className="text-xs text-gray-500 mb-4">
          Coloque uma foto em cada produto — ela aparece na grade do balcão na
          hora. As fotos ficam salvas no seu cadastro, não precisam do botão
          SALVAR acima.
        </p>
        {erroProdutoFoto && (
          <p className="text-xs text-red-600 mb-3 bg-red-50 border border-red-300 rounded p-2">
            {erroProdutoFoto}
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {produtos.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 bg-gray-50 rounded-xl p-2"
            >
              <img
                src={p.image_url || "/placeholder.svg"}
                alt={p.name}
                className="w-12 h-12 rounded-lg object-cover border border-gray-200 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{p.name}</p>
                <p className="text-xs text-gray-400 truncate">{p.category}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => {
                    fotoPara.current = p.id;
                    inputProdutoFoto.current?.click();
                  }}
                  disabled={salvandoFoto !== null}
                  aria-label={`Escolher foto de ${p.name}`}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {salvandoFoto === p.id
                    ? "Salvando..."
                    : p.image_url && p.image_url !== "/placeholder.svg"
                      ? "Trocar"
                      : "Escolher"}
                </button>
                {p.image_url && p.image_url !== "/placeholder.svg" && (
                  <button
                    onClick={() => atualizarFoto(p.id, null)}
                    disabled={salvandoFoto !== null}
                    aria-label={`Remover foto de ${p.name}`}
                    className="text-xs text-red-500 hover:text-red-700 font-bold px-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>
          ))}
          {carregandoProdutos && (
            <p className="text-xs text-gray-400 py-2">Carregando produtos...</p>
          )}
          {!carregandoProdutos && !erroProdutoFoto && produtos.length === 0 && (
            <p className="text-xs text-gray-400 py-2">
              Nenhum produto cadastrado ainda.
            </p>
          )}
        </div>
        <input
          ref={inputProdutoFoto}
          type="file"
          accept="image/*"
          onChange={escolherFotoProduto}
          className="hidden"
        />
      </div>
    </div>
  );
}
