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
import { getSessao, getSupabase } from "@/lib/supabase";
import {
  LayoutConfig as TipoLayout,
  LAYOUT_PADRAO,
  MenuConfig,
  MenuGrupo,
  MenuId,
  ROTULO_GRUPO,
  definicaoMenu,
  lerLayout,
  menusOrdenados,
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
  const [menus, setMenus] = useState<MenuConfig[]>(menusOrdenados(null));
  const [erroImagem, setErroImagem] = useState<string | null>(null);
  const [erroFundo, setErroFundo] = useState<string | null>(null);
  const [erroCardapio, setErroCardapio] = useState<string | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const inputFundo = useRef<HTMLInputElement>(null);
  const inputCardapio = useRef<HTMLInputElement>(null);

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
    setMenus(menusOrdenados(cfg.menus));
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

  // ============================================================
  // MENUS DO LATERAL (mostrar/esconder e reordenar)
  // ============================================================
  function alternarVisivel(id: MenuId) {
    // Gerenciamento de loja e Configurações são sempre visíveis
    // (é por eles que o dono acessa as telas internas)
    if (id === "configuracoes" || id === "gerenciamento") return;
    setMenus((atual) =>
      atual.map((m) => (m.id === id ? { ...m, visivel: !m.visivel } : m))
    );
  }

  // Troca a posição com o vizinho do mesmo grupo
  function moverMenu(id: MenuId, direcao: -1 | 1) {
    setMenus((atual) => {
      const grupo = definicaoMenu(id).grupo;
      const de = atual.findIndex((m) => m.id === id);
      if (de < 0) return atual;
      let para = -1;
      for (let i = de + direcao; i >= 0 && i < atual.length; i += direcao) {
        if (definicaoMenu(atual[i].id).grupo === grupo) {
          para = i;
          break;
        }
      }
      if (para < 0) return atual;
      const copia = [...atual];
      const temp = copia[de];
      copia[de] = copia[para];
      copia[para] = temp;
      return copia;
    });
  }

  // ============================================================
  // SALVAR (aplica na hora em todas as telas)
  // ============================================================
  async function salvar() {
    const s = getSessao();
    if (!s) return;
    salvarLayout(s.id, { cor, corLetras, tamanho, logo, fundo, cardapio, menus });
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from("configuracoes").update({ logo_url: logo }).eq("loja_id", s.id);
    }
    aoPedidoCriado("Layout salvo e aplicado!");
  }

  // ============================================================
  // RESTAURAR O PADRÃO AZUL
  // ============================================================
  async function restaurar() {
    setCor(LAYOUT_PADRAO.cor);
    setCorLetras(LAYOUT_PADRAO.corLetras);
    setTamanho("medio");
    setLogo(null);
    setFundo(null);
    setCardapio(null);
    setMenus(menusOrdenados(null));
    const s = getSessao();
    if (!s) return;
    salvarLayout(s.id, { ...LAYOUT_PADRAO });
    const supabase = getSupabase();
    if (supabase) await supabase.from("configuracoes").update({ logo_url: null }).eq("loja_id", s.id);
    aoPedidoCriado("Layout voltou ao padrão!");
  }

  // Menus visíveis do grupo "Pedidos" (usados na prévia)
  const menusPedidos = menus.filter(
    (m) => m.visivel && definicaoMenu(m.id).grupo === "pedidos"
  );

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
              Ícone da loja
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Aparece no topo do menu, no lugar da caixa “Escolha seu ícone no layout”.
              Também aparece no quadrinho do administrador.
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
            {logo ? (
              <img
                src={logo}
                alt="Ícone da loja"
                className="w-28 h-14 rounded-xl object-cover border border-white/40 shadow-[0_3px_8px_rgba(0,0,0,0.3)] mb-3"
              />
            ) : (
              <div className="relative inline-block mb-3">
                <div className="bg-gradient-to-b from-gray-400 to-gray-600 rounded-xl px-4 py-1.5 shadow-[0_3px_8px_rgba(0,0,0,0.3),inset_0_2px_3px_rgba(255,255,255,0.35)] border border-white/40">
                  <p
                    className="max-w-28 text-center text-xs font-black leading-tight text-white"
                    style={{
                      textShadow:
                        "1px 1px 0 #4b5563, 2px 2px 0 #374151, 3px 3px 0 #1f2937, 4px 4px 8px rgba(0,0,0,0.45)",
                    }}
                  >
                    Escolha seu ícone no layout
                  </p>
                </div>
                <div className="absolute -bottom-1 left-5 w-2.5 h-2.5 bg-gray-600 rotate-45 rounded-sm" />
              </div>
            )}
            <p className="text-[10px] opacity-70 mb-3">
              Ponto De Vendas Harley Systems
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
              {ROTULO_GRUPO.pedidos}
            </p>
            <div className="space-y-1 text-xs font-medium">
              {menusPedidos.map((m, i) => (
                <p
                  key={m.id}
                  className={`px-2 py-1.5 rounded-lg ${
                    i === 0 ? "bg-white/20 font-bold" : "opacity-90"
                  }`}
                >
                  {definicaoMenu(m.id).rotulo}
                </p>
              ))}
              {menusPedidos.length === 0 && (
                <p className="px-2 py-1.5 rounded-lg opacity-60 text-[10px]">
                  (nenhum menu visível)
                </p>
              )}
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

      {/* ============ Menus do sistema (mostrar/esconder e reordenar) ============ */}
      <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-200 p-5 max-w-5xl">
        <p className="text-sm font-bold text-gray-700 mb-1">Menus do sistema</p>
        <p className="text-xs text-gray-500 mb-4">
          Escolha quais menus aparecem na barra lateral e em que ordem. Use as
          setas para mover e o olho para mostrar/esconder. Clique em{" "}
          <b>SALVAR</b> para aplicar.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {(["pedidos", "gerenciamento"] as MenuGrupo[]).map((grupo) => {
            const doGrupo = menus.filter(
              (m) => definicaoMenu(m.id).grupo === grupo
            );
            return (
              <div key={grupo}>
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">
                  {ROTULO_GRUPO[grupo]}
                </p>
                <div className="space-y-1.5">
                  {doGrupo.map((m, i) => {
                    const def = definicaoMenu(m.id);
                    const fixo = m.id === "configuracoes" || m.id === "gerenciamento";
                    return (
                      <div
                        key={m.id}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                          m.visivel
                            ? "bg-white border-gray-200"
                            : "bg-gray-50 border-dashed border-gray-300"
                        }`}
                      >
                        <button
                          onClick={() => alternarVisivel(m.id)}
                          disabled={fixo}
                          title={
                            fixo
                              ? "Este menu não pode ser escondido"
                              : m.visivel
                                ? "Esconder do menu"
                                : "Mostrar no menu"
                          }
                          className={`w-8 h-8 rounded-lg flex items-center justify-center border transition ${
                            fixo
                              ? "bg-gray-100 border-gray-200 text-gray-300 cursor-not-allowed"
                              : m.visivel
                                ? "bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                                : "bg-gray-100 border-gray-300 text-gray-400 hover:bg-gray-200"
                          }`}
                        >
                          {m.visivel ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                              <path d="M6.61 6.61A13.5 13.5 0 0 0 2 11s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                              <path d="m2 2 20 20" />
                            </svg>
                          )}
                        </button>
                        <span
                          className={`flex-1 text-sm ${
                            m.visivel
                              ? "font-medium text-gray-800"
                              : "text-gray-400 line-through"
                          }`}
                        >
                          {def.rotulo}
                        </span>
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => moverMenu(m.id, -1)}
                            disabled={i === 0}
                            title="Mover para cima"
                            className="w-7 h-6 rounded border border-gray-200 bg-gray-50 hover:bg-gray-200 text-gray-600 text-[10px] leading-none disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => moverMenu(m.id, 1)}
                            disabled={i === doGrupo.length - 1}
                            title="Mover para baixo"
                            className="w-7 h-6 rounded border border-gray-200 bg-gray-50 hover:bg-gray-200 text-gray-600 text-[10px] leading-none disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            ▼
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
