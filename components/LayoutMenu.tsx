"use client";

// ============================================================
// LAYOUT COMPARTILHADO PdvDaGalera (usado por todas as páginas)
// - Sidebar azul com gradiente #2563EB -> #1D4ED8
// - Logo "PdvDaGalera" + box do administrador
// - Menu: Mesa, Balcão, Delivery, KDS, Motoboys,
//   Cadastrar Produto, Caixa, Relatórios, Configurações
// - Botões ABERTO e CARDÁPIO no rodapé da sidebar
// - Área principal clara com o conteúdo da página
// ============================================================
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase, getSessao, limparSessao, Sessao } from "@/lib/supabase";
import { lojaSemAcesso } from "@/lib/acesso-loja";
import { caixaEstaAberto, chaveCaixas, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";
import {
  LayoutConfig,
  lerLayout,
  escurecer,
  TAMANHO_FONTE,
} from "@/lib/layout";

// Seções do menu reconhecidas para destacar o item ativo
export type ItemAtivo =
  | "mesa"
  | "balcao"
  | "delivery"
  | "kds"
  | "finalizados"
  | "motoboys"
  | "cadastrar"
  | "estoque"
  | "bot"
  | "caixa"
  | "relatorios"
  | "configuracoes"
  | "layout";

// ============================================================
// ÍCONES DO MENU (traço fino, cor atual)
// ============================================================
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
function IconeBalcao() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}
function IconeDelivery() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18.5" cy="17.5" r="3.5" />
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="15" cy="5" r="1" />
      <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
    </svg>
  );
}
function IconeKds() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
function IconeFinalizado() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}
function IconeMotoboy() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M5 14 9 7h4l1.5 4" />
      <path d="m12 5 3-2" />
      <circle cx="7.5" cy="7" r="0.6" fill="currentColor" />
    </svg>
  );
}
function IconeProduto() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}
function IconeEstoque() {
  return (
    <svg width="18" height="18" className="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18M21 3v18M3 11h18M3 21h18" />
      <rect x="6" y="3" width="5" height="8" rx="1" />
      <rect x="13" y="14" width="5" height="7" rx="1" />
      <path d="M8 16h2" />
    </svg>
  );
}
function IconeBot() {
  return (
    <svg width="18" height="18" className="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="7" width="16" height="13" rx="3" />
      <path d="M12 7V3M10 3h4M2 11v5M22 11v5M9 16h6" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
    </svg>
  );
}
function IconeConfig() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconeLayout() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}
function IconeCaixa() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}
function IconeRelatorio() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M7 16v-4" />
      <path d="M12 16V8" />
      <path d="M17 16v-6" />
    </svg>
  );
}

// Classe padrão dos itens do menu (a cor vem da configuração de layout)
const ITEM_MENU =
  "flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg text-sm font-medium opacity-90 bg-white/10 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_3px_rgba(0,0,0,0.25)] hover:bg-white/15 hover:opacity-100 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_3px_5px_rgba(0,0,0,0.3)] transition";
const ITEM_MENU_ATIVO =
  "flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg text-sm font-bold bg-white/25 border border-white/30 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] transition";

const FUNCOES_PEDIDOS: ItemAtivo[] = ["mesa", "balcao", "delivery", "kds", "finalizados"];

type Props = {
  ativo: ItemAtivo; // item do menu destacado
  children: React.ReactNode; // conteúdo da área principal
  // Incrementado a cada pedido criado -> atualiza os badges do menu
  refreshKey?: number;
};

export default function LayoutMenu({ ativo, children, refreshKey = 0 }: Props) {
  const router = useRouter();

  // Loja logada (cookie) — nome no box do administrador e filtro dos dados
  const [sessao, setSessao] = useState<Sessao | null>(null);

  // Configuração visual da loja (cor do layout, letras, tamanho e logo)
  const [layout, setLayout] = useState<LayoutConfig | null>(null);

  // Quantidade de mesas ocupadas (badge do menu "Mesa")
  // Busca no Supabase; se a tabela ainda não existir, usa o padrão (4)
  const [ocupadas, setOcupadas] = useState<number | null>(null);

  // Pedidos pendentes na cozinha (badge do item "KDS (Cozinha)")
  const [pendentes, setPendentes] = useState<number>(0);
  const [caixaLiberado, setCaixaLiberado] = useState(false);

  // Cardápio aberto (imagem configurada na tela Layout)
  const [cardapioAberto, setCardapioAberto] = useState(false);

  // Fecha o cardápio com a tecla ESC
  useEffect(() => {
    if (!cardapioAberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCardapioAberto(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [cardapioAberto]);

  useEffect(() => {
    function atualizarCaixa() {
      const s = getSessao();
      setCaixaLiberado(s !== null && caixaEstaAberto(s.id));
    }
    function aoStorage(e: StorageEvent) {
      const s = getSessao();
      if (s && (e.key === null || e.key === chaveCaixas(s.id))) atualizarCaixa();
    }
    atualizarCaixa();
    window.addEventListener("pdv-caixa-atualizado", atualizarCaixa);
    window.addEventListener("storage", aoStorage);
    window.addEventListener("focus", atualizarCaixa);
    return () => {
      window.removeEventListener("pdv-caixa-atualizado", atualizarCaixa);
      window.removeEventListener("storage", aoStorage);
      window.removeEventListener("focus", atualizarCaixa);
    };
  }, []);

  const bloqueioMenu = {
    "aria-disabled": !caixaLiberado,
    tabIndex: caixaLiberado ? 0 : -1,
    onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
      const s = getSessao();
      if (!s || !caixaEstaAberto(s.id)) {
        e.preventDefault();
        setCaixaLiberado(false);
      }
    },
    style: caixaLiberado ? undefined : { opacity: 0.45, cursor: "not-allowed" },
  };

  // ============================================================
  // APLICAR O LAYOUT CONFIGURADO PELO DONO (cor, letras, tamanho)
  // ============================================================
  useEffect(() => {
    function aplicar() {
      const s = getSessao();
      if (!s) return;
      const cfg = lerLayout(s.id);
      setLayout(cfg);
      // Tamanho das letras: muda a fonte base do app inteiro
      document.documentElement.style.fontSize = `${TAMANHO_FONTE[cfg.tamanho]}px`;
    }
    aplicar();
    // Reaplica quando a tela de Layout salvar uma nova configuração
    window.addEventListener("pdv-layout-atualizado", aplicar);
    return () => window.removeEventListener("pdv-layout-atualizado", aplicar);
  }, []);

  useEffect(() => {
    const s = getSessao();
    setSessao(s);

    const supabase = getSupabase();
    if (!supabase || !s) {
      setOcupadas(4);
      return;
    }

    // Revalida o status da loja: se venceu, ficou vencida ou bloqueada,
    // manda para a tela de pagamento do Asaas (mantém a sessão para cobrar)
    supabase
      .from("lojas")
      .select("status_pagamento,data_vencimento,plano")
      .eq("id", s.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data && lojaSemAcesso(data)) {
          router.replace("/pagamento");
        }
      });

    // Mesas ocupadas da loja (badge do item "Mesa")
    supabase
      .from("mesas")
      .select("status")
      .eq("loja_id", s.id)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setOcupadas(4); // tabela ainda não existe -> padrão do layout
        } else {
          setOcupadas(
            (data as { status: string }[]).filter((m) => m.status === "ocupada")
              .length
          );
        }
      });

    // Pedidos pendentes da cozinha (badge do item "KDS")
    supabase
      .from("orders")
      .select("id")
      .eq("loja_id", s.id)
      .eq("status", "pendente")
      .then(({ data, error }) => {
        if (error || !data) {
          setPendentes(0);
        } else {
          setPendentes(data.length);
        }
      });
  }, [router, refreshKey]);

  return (
    <div
      className="h-screen flex overflow-hidden bg-gray-100 text-gray-900"
      style={
        layout?.fundo
          ? {
              backgroundImage: `url(${layout.fundo})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundAttachment: "fixed",
            }
          : undefined
      }
    >
      {/* ================= SIDEBAR (cor configurada pelo dono) ================= */}
      <aside
        className="w-64 shrink-0 h-full flex flex-col"
        style={{
          background: `linear-gradient(to bottom, rgba(255,255,255,0.22), rgba(255,255,255,0) 22%), linear-gradient(to bottom, ${
            layout?.cor ?? "#2563EB"
          }, ${escurecer(layout?.cor ?? "#2563EB", 0.25)})`,
          color: layout?.corLetras ?? "#ffffff",
          boxShadow:
            "inset 0 2px 0 rgba(255,255,255,0.35), 8px 0 24px rgba(0,0,0,0.25)",
        }}
      >
        {/* Logo (balão cinza com PdvDG em 3D) */}
        <div className="p-5 pb-4">
          <div className="relative inline-block">
            <div className="bg-gradient-to-b from-gray-400 to-gray-600 rounded-2xl px-5 py-2 shadow-[0_4px_10px_rgba(0,0,0,0.3),inset_0_2px_3px_rgba(255,255,255,0.35)] border border-white/40">
              <p
                className="text-2xl font-black italic tracking-wider text-white leading-none"
                style={{
                  textShadow:
                    "1px 1px 0 #4b5563, 2px 2px 0 #374151, 3px 3px 0 #1f2937, 4px 4px 8px rgba(0,0,0,0.45)",
                }}
              >
                PdvDG
              </p>
            </div>
            <div className="absolute -bottom-1.5 left-8 w-3 h-3 bg-gray-600 rotate-45 rounded-sm" />
          </div>
          <p className="text-xs opacity-70 mt-3">Ponto de Venda Da Galera</p>
        </div>

        {/* Box do administrador (amarelo) */}
        <div className="mx-4 bg-gradient-to-b from-gray-400 to-gray-600 rounded-xl p-3 flex items-center gap-2 shadow-[0_4px_10px_rgba(0,0,0,0.3),inset_0_2px_3px_rgba(255,255,255,0.35)] border border-white/40">
          {layout?.logo ? (
            <img
              src={layout.logo}
              alt="Logo da loja"
              className="w-9 h-9 rounded-full object-cover border border-white/60 shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-blue-700 text-white flex items-center justify-center font-bold text-sm shrink-0">
              {(sessao?.nome_loja ?? "AD").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-extrabold text-white truncate"
              style={{
                textShadow:
                  "1px 1px 0 #4b5563, 2px 2px 0 #374151, 3px 3px 5px rgba(0,0,0,0.4)",
              }}
            >
              {sessao?.nome_loja ?? "Administrador"}
            </p>
            <p className="text-[10px] text-gray-200 truncate">
              {sessao?.email_dono ?? "admin@menuau.com"}
            </p>
          </div>
          <button
            onClick={() => {
              limparSessao();
              router.replace("/login");
            }}
            className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shrink-0 shadow-[0_3px_0_#b91c1c]"
          >
            SAIR
          </button>
        </div>

        {/* Menu */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {/* Seção Painel de Pedidos */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-80 px-2 mb-1.5 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
              Painel de Pedidos
            </p>
            <div className="space-y-1">
              <Link
                href="/mesas"
                {...bloqueioMenu}
                className={ativo === "mesa" ? ITEM_MENU_ATIVO : ITEM_MENU}
              >
                <IconeCadeira />
                <span className="flex-1">Mesa</span>
                {ocupadas !== null && ocupadas > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                    {ocupadas}
                  </span>
                )}
              </Link>
              <Link
                href="/pdv?aba=balcao"
                {...bloqueioMenu}
                className={ativo === "balcao" ? ITEM_MENU_ATIVO : ITEM_MENU}
              >
                <IconeBalcao />
                Balcão
              </Link>
              <Link
                href="/pdv?aba=delivery"
                {...bloqueioMenu}
                className={ativo === "delivery" ? ITEM_MENU_ATIVO : ITEM_MENU}
              >
                <IconeDelivery />
                Delivery
              </Link>
              <Link
                href="/pdv?aba=kds"
                {...bloqueioMenu}
                className={ativo === "kds" ? ITEM_MENU_ATIVO : ITEM_MENU}
              >
                <IconeKds />
                <span className="flex-1">Cozinha</span>
                {pendentes > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                    {pendentes}
                  </span>
                )}
              </Link>
              <Link
                href="/pdv?aba=finalizados"
                {...bloqueioMenu}
                className={
                  ativo === "finalizados" ? ITEM_MENU_ATIVO : ITEM_MENU
                }
              >
                <IconeFinalizado />
                Pedido Finalizado
              </Link>
            </div>
          </div>

          {/* Seção Gerenciamento */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-80 px-2 mb-1.5 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
              Gerenciamento
            </p>
            <div className="space-y-1">
              <Link
                href="/pdv?aba=motoboys"
                className={ativo === "motoboys" ? ITEM_MENU_ATIVO : ITEM_MENU}
              >
                <IconeMotoboy />
                Motoboys
              </Link>
              <Link
                href="/pdv?aba=cadastrar"
                className={ativo === "cadastrar" ? ITEM_MENU_ATIVO : ITEM_MENU}
              >
                <IconeProduto />
                Cadastrar Produto
              </Link>
              <Link
                href="/pdv?aba=estoque"
                className={ativo === "estoque" ? ITEM_MENU_ATIVO : ITEM_MENU}
              >
                <IconeEstoque />
                Estoque
              </Link>
              <Link
                href="/pdv?aba=bot"
                className={ativo === "bot" ? ITEM_MENU_ATIVO : ITEM_MENU}
              >
                <IconeBot />
                Bot Assistente WhatsApp
              </Link>
              <Link
                href="/pdv?aba=caixa"
                className={ativo === "caixa" ? ITEM_MENU_ATIVO : ITEM_MENU}
              >
                <IconeCaixa />
                Caixa
              </Link>
              <Link
                href="/pdv?aba=relatorios"
                className={
                  ativo === "relatorios" ? ITEM_MENU_ATIVO : ITEM_MENU
                }
              >
                <IconeRelatorio />
                Relatórios
              </Link>
              <Link
                href="/pdv?aba=configuracoes"
                className={
                  ativo === "configuracoes" ? ITEM_MENU_ATIVO : ITEM_MENU
                }
              >
                <IconeConfig />
                Configurações
              </Link>
              <Link
                href="/pdv?aba=layout"
                className={ativo === "layout" ? ITEM_MENU_ATIVO : ITEM_MENU}
              >
                <IconeLayout />
                Layout
              </Link>
            </div>
          </div>
        </nav>

        {/* Botões de baixo da sidebar */}
        <div className="p-4">
          <button
            onClick={() => setCardapioAberto(true)}
            className="w-full bg-green-700 hover:bg-green-800 text-white font-extrabold rounded-xl py-2.5 tracking-wide transition shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_0_#14532d,0_6px_10px_rgba(0,0,0,0.35)] active:translate-y-0.5 active:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_0_#14532d,0_3px_6px_rgba(0,0,0,0.35)]"
          >
            CARDÁPIO
          </button>
        </div>
      </aside>

      {/* ================= CARDÁPIO (abre sobre a tela) ================= */}
      {cardapioAberto && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setCardapioAberto(false)}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-md max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Botão de voltar em cima da foto */}
            <button
              onClick={() => setCardapioAberto(false)}
              className="absolute top-3 left-3 z-10 bg-black/70 hover:bg-black/90 text-white text-sm font-bold px-3 py-1.5 rounded-lg backdrop-blur flex items-center gap-1"
            >
              ← Voltar
            </button>

            {layout?.cardapio ? (
              <div className="overflow-y-auto max-h-[85vh] bg-white">
                <img
                  src={layout.cardapio}
                  alt="Cardápio"
                  className="w-full h-auto block"
                />
              </div>
            ) : (
              <p className="p-12 text-center text-sm text-gray-500">
                Nenhuma imagem de cardápio cadastrada. Vá em{" "}
                <b>Layout → Imagem do cardápio</b> para escolher a foto.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ================= ÁREA PRINCIPAL ================= */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {FUNCOES_PEDIDOS.includes(ativo) && !caixaLiberado ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-lg">
              <h1 className="text-2xl font-extrabold mb-3">Caixa fechado</h1>
              <p className="text-gray-600 mb-5">{MENSAGEM_CAIXA_FECHADO}</p>
              <Link
                href="/pdv?aba=caixa"
                className="inline-block bg-green-600 hover:bg-green-700 text-white font-bold px-5 py-3 rounded-xl transition"
              >
                Ir para o Caixa
              </Link>
            </div>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
