"use client";

// ============================================================
// LAYOUT COMPARTILHADO PdvDaGalera (usado por todas as páginas)
// - Sidebar azul com gradiente #2563EB -> #1D4ED8
// - Logo "PdvDaGalera" + box do administrador
// - Menu: Mesa, Balcão, Delivery, KDS, Finalizados,
//   Gerenciamento de loja e Configurações
//   (Cadastrar Produto, Estoque, Caixa e Relatórios ficam dentro de
//   "Gerenciamento de loja"; Layout, Motoboys e Bot Assistente dentro
//   de "Configurações")
// - Botões ABERTO e CARDÁPIO no rodapé da sidebar
// - Área principal clara com o conteúdo da página
// ============================================================
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase, getSessao, limparSessao, Sessao } from "@/lib/supabase";
import { imprimirPedidoAutomatico } from "@/lib/qz";
import { lojaSemAcesso } from "@/lib/acesso-loja";
import { caixaEstaAberto, chaveCaixas, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";
import {
  LayoutConfig,
  MenuGrupo,
  MenuId,
  lerLayout,
  escurecer,
  definicaoMenu,
  menusOrdenados,
  ROTULO_GRUPO,
  TAMANHO_FONTE,
} from "@/lib/layout";

function tocarSomPedidoNovo() {
  try {
    const audio = new window.AudioContext();
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audio.currentTime);
    oscillator.frequency.setValueAtTime(660, audio.currentTime + 0.16);
    volume.gain.setValueAtTime(0.001, audio.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.38);
    oscillator.connect(volume);
    volume.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.4);
    window.setTimeout(() => { void audio.close(); }, 600);
  } catch (error) {
    console.warn("Não foi possível reproduzir o som de pedido novo:", error);
  }
}

// Seções do menu reconhecidas para destacar o item ativo
// (cadastrar/estoque/caixa/relatorios continuam válidos como aba do PDV,
// mas agora são abertos por dentro de "Gerenciamento de loja")
export type ItemAtivo =
  | "mesa"
  | "balcao"
  | "delivery"
  | "kds"
  | "finalizados"
  | "gerenciamento"
  | "configuracoes"
  | "cadastrar"
  | "estoque"
  | "caixa"
  | "relatorios";

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
function IconeGerenciamento() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M4 12v8h16v-8" />
      <path d="M9 20v-5h6v5" />
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

// Classe padrão dos itens do menu (a cor vem da configuração de layout)
const ITEM_MENU =
  "flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg text-sm font-medium opacity-90 bg-white/10 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_3px_rgba(0,0,0,0.25)] hover:bg-white/15 hover:opacity-100 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_3px_5px_rgba(0,0,0,0.3)] transition";
const ITEM_MENU_ATIVO =
  "flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg text-sm font-bold bg-white/25 border border-white/30 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] transition";

const FUNCOES_PEDIDOS: ItemAtivo[] = ["mesa", "balcao", "delivery", "kds", "finalizados"];

// ============================================================
// DADOS DE CADA MENU (ícone e destino)
// A ORDEM e a VISIBILIDADE vêm da tela Layout > Menus
// ============================================================
const ICONES_MENU: Record<MenuId, React.ReactNode> = {
  mesa: <IconeCadeira />,
  balcao: <IconeBalcao />,
  delivery: <IconeDelivery />,
  kds: <IconeKds />,
  finalizados: <IconeFinalizado />,
  gerenciamento: <IconeGerenciamento />,
  configuracoes: <IconeConfig />,
};

const HREF_MENU: Record<MenuId, string> = {
  mesa: "/mesas",
  balcao: "/pdv?aba=balcao",
  delivery: "/pdv?aba=delivery",
  kds: "/pdv?aba=kds",
  finalizados: "/pdv?aba=finalizados",
  gerenciamento: "/pdv?aba=gerenciamento",
  configuracoes: "/pdv?aba=configuracoes",
};

// Chave onde guardamos se a sidebar está recolhida (por loja)
function chaveSidebar(lojaId: string): string {
  return `pdv_sidebar_mini_${lojaId}`;
}

// ============================================================
// ITEM DO MENU
// - Normal: ícone + texto (+ badge opcional)
// - Sidebar recolhida: só o ícone, com o nome no title (tooltip)
// ============================================================
function ItemMenu({
  href,
  icone,
  rotulo,
  ativo,
  minimizada,
  badge,
  bloqueio,
}: {
  href: string;
  icone: React.ReactNode;
  rotulo: string;
  ativo: boolean;
  minimizada: boolean;
  badge?: number | null;
  bloqueio?: React.AnchorHTMLAttributes<HTMLAnchorElement>;
}) {
  return (
    <Link
      href={href}
      {...bloqueio}
      title={minimizada ? rotulo : undefined}
      className={`${ativo ? ITEM_MENU_ATIVO : ITEM_MENU} ${
        minimizada ? "relative justify-center" : ""
      }`}
    >
      {icone}
      {!minimizada && <span className="flex-1 truncate">{rotulo}</span>}
      {badge != null && badge > 0 && (
        <span
          className={
            minimizada
              ? "absolute top-0.5 right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] px-0.5 flex items-center justify-center"
              : "bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center"
          }
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

type Props = {
  ativo: ItemAtivo; // item do menu destacado
  children: React.ReactNode; // conteúdo da área principal
  // Incrementado a cada pedido criado -> atualiza os badges do menu
  refreshKey?: number;
  aoPedidoCriado?: (texto: string, tipo?: "ok" | "erro") => void;
};

export default function LayoutMenu({ ativo, children, refreshKey = 0, aoPedidoCriado }: Props) {
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
  const pedidosAtivosRef = useRef<Set<string> | null>(null);
  const tentativasImpressaoWhatsApp = useRef(new Map<string, number>());
  const impressoesWhatsAppEmCurso = useRef(new Set<string>());
  const pedidosWhatsAppImpressos = useRef(new Set<string>());
  const aoPedidoCriadoRef = useRef(aoPedidoCriado);
  const [caixaLiberado, setCaixaLiberado] = useState(false);

  // Cardápio aberto (imagem configurada na tela Layout)
  const [cardapioAberto, setCardapioAberto] = useState(false);

  // Sidebar recolhida (vira uma faixa fina só com ícones)
  const [minimizada, setMinimizada] = useState(false);

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
    aoPedidoCriadoRef.current = aoPedidoCriado;
  }, [aoPedidoCriado]);

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

  useEffect(() => {
    function atualizarSessao() {
      setSessao(getSessao());
    }
    window.addEventListener("pdv-sessao-atualizada", atualizarSessao);
    return () =>
      window.removeEventListener("pdv-sessao-atualizada", atualizarSessao);
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

  // Menus do lateral (visibilidade e ordem escolhidas em Layout > Menus)
  const menus = menusOrdenados(layout?.menus);

  // Recolhe/expande a sidebar e guarda a escolha no navegador da loja
  function alternarMiniatura() {
    const novo = !minimizada;
    setMinimizada(novo);
    const s = getSessao();
    if (s) localStorage.setItem(chaveSidebar(s.id), novo ? "1" : "0");
  }

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

    // Restaura se a sidebar estava recolhida na última visita
    if (s) setMinimizada(localStorage.getItem(chaveSidebar(s.id)) === "1");

    const supabase = getSupabase();
    if (!supabase || !s) {
      setOcupadas(4);
      return;
    }
    const db = supabase;
    const lojaId = s.id;

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
      .eq("loja_id", lojaId)
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

    let ativo = true;
    const inicioMonitoramento = Date.now();
    let ultimoErroMonitoramento = "";
    async function atualizarPedidos() {
      const { data, error } = await db
        .from("orders")
        .select("id,origem,numero_pedido,customer_name,created_at")
        .eq("loja_id", lojaId)
        .in("status", ["pendente", "novo"]);
      if (!ativo) return;
      if (error || !data) {
        const mensagemErro = error?.message || "A consulta retornou vazia.";
        if (mensagemErro !== ultimoErroMonitoramento) {
          console.error("[PDV] Falha ao verificar novos pedidos do WhatsApp:", mensagemErro);
          ultimoErroMonitoramento = mensagemErro;
        }
        return;
      }
      ultimoErroMonitoramento = "";
      const idsAtivos = new Set(data.map((pedido) => String(pedido.id)));
      const anteriores = pedidosAtivosRef.current;
      if (anteriores && Array.from(idsAtivos).some((id) => !anteriores.has(id)) && document.visibilityState === "visible") {
        tocarSomPedidoNovo();
      }
      const agora = Date.now();
      const pedidosNovosWhatsApp = data.filter((pedido) => {
        if (pedido.origem !== "IA WhatsApp") return false;
        const criadoEm = new Date(String(pedido.created_at)).getTime();
        return anteriores
          ? !anteriores.has(String(pedido.id))
          : Number.isFinite(criadoEm) && criadoEm >= inicioMonitoramento - 60_000 && criadoEm <= agora;
      });
      for (const pedido of pedidosNovosWhatsApp) {
        const id = String(pedido.id);
        if (
          pedidosWhatsAppImpressos.current.has(id) ||
          impressoesWhatsAppEmCurso.current.has(id) ||
          (tentativasImpressaoWhatsApp.current.get(id) || 0) >= 3
        ) continue;
        tentativasImpressaoWhatsApp.current.set(
          id,
          (tentativasImpressaoWhatsApp.current.get(id) || 0) + 1
        );
        impressoesWhatsAppEmCurso.current.add(id);
        void imprimirPedidoAutomatico({
          id,
          numero_pedido: pedido.numero_pedido,
          customer_name: pedido.customer_name,
        }).then((resultado) => {
          if (!ativo) return;
          impressoesWhatsAppEmCurso.current.delete(id);
          if (!resultado.erro) {
            pedidosWhatsAppImpressos.current.add(id);
            aoPedidoCriadoRef.current?.(resultado.mensagem, "ok");
          } else if ((tentativasImpressaoWhatsApp.current.get(id) || 0) >= 3) {
            aoPedidoCriadoRef.current?.(resultado.mensagem, "erro");
          }
        });
      }
      pedidosAtivosRef.current = idsAtivos;
      setPendentes(idsAtivos.size);
    }
    void atualizarPedidos();
    const intervaloPedidos = window.setInterval(() => {
      if (document.visibilityState === "visible") void atualizarPedidos();
    }, 3000);
    return () => {
      ativo = false;
      window.clearInterval(intervaloPedidos);
    };
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
        className={`${
          minimizada ? "w-[68px]" : "w-64"
        } shrink-0 h-full flex flex-col transition-[width] duration-200 overflow-hidden`}
        style={{
          background: `linear-gradient(to bottom, rgba(255,255,255,0.22), rgba(255,255,255,0) 22%), linear-gradient(to bottom, ${
            layout?.cor ?? "#2563EB"
          }, ${escurecer(layout?.cor ?? "#2563EB", 0.25)})`,
          color: layout?.corLetras ?? "#ffffff",
          boxShadow:
            "inset 0 2px 0 rgba(255,255,255,0.35), 8px 0 24px rgba(0,0,0,0.25)",
        }}
      >
        {/* Ícone padrão até o dono escolher uma imagem no Layout */}
        <div className={minimizada ? "px-2 py-3" : "p-5 pb-4"}>
          <div
            className={`flex items-center ${
              minimizada ? "justify-center" : "justify-between"
            }`}
          >
            {layout?.logo ? (
              // Ícone que o dono escolheu no Layout
              <img
                src={layout.logo}
                alt={sessao?.nome_loja ?? "Ícone da loja"}
                title={minimizada ? sessao?.nome_loja ?? "Loja" : undefined}
                className={`object-cover border border-white/40 shadow-[0_4px_10px_rgba(0,0,0,0.3)] shrink-0 ${
                  minimizada ? "h-10 w-10 rounded-xl" : "h-16 w-32 rounded-xl"
                }`}
              />
            ) : (
              !minimizada && (
                <div className="relative inline-block">
                  <div className="bg-gradient-to-b from-gray-400 to-gray-600 rounded-2xl px-5 py-2 shadow-[0_4px_10px_rgba(0,0,0,0.3),inset_0_2px_3px_rgba(255,255,255,0.35)] border border-white/40">
                    <p
                      className="max-w-40 text-center text-sm font-black leading-tight text-white"
                      style={{
                        textShadow:
                          "1px 1px 0 #4b5563, 2px 2px 0 #374151, 3px 3px 0 #1f2937, 4px 4px 8px rgba(0,0,0,0.45)",
                      }}
                    >
                      Escolha seu ícone no layout
                    </p>
                  </div>
                  <div className="absolute -bottom-1.5 left-8 w-3 h-3 bg-gray-600 rotate-45 rounded-sm" />
                </div>
              )
            )}
            <button
              onClick={alternarMiniatura}
              title={minimizada ? "Expandir menu" : "Recolher menu"}
              className="w-7 h-7 shrink-0 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 flex items-center justify-center transition"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={minimizada ? "m9 18 6-6-6-6" : "m15 18-6-6 6-6"} />
              </svg>
            </button>
          </div>
          {!minimizada && (
            <p className="text-xs opacity-70 mt-3">Ponto de Venda Da Galera</p>
          )}
        </div>

        {/* Box do administrador (amarelo) */}
        {!minimizada && (
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
        )}

        {/* Menu */}
        <nav
          className={`flex-1 overflow-y-auto py-4 space-y-5 ${
            minimizada ? "px-2" : "px-3"
          }`}
        >
          {/* Seções do menu — ordem e itens vêm de Layout > Menus */}
          {(["pedidos", "gerenciamento"] as MenuGrupo[]).map((grupo) => {
            const itens = menus
              .filter((m) => m.visivel && definicaoMenu(m.id).grupo === grupo)
              .map((m) => definicaoMenu(m.id));
            if (itens.length === 0) return null;
            return (
              <div key={grupo}>
                {!minimizada && (
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-80 px-2 mb-1.5 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
                    {ROTULO_GRUPO[grupo]}
                  </p>
                )}
                <div className="space-y-1">
                  {itens.map((def) => (
                    <ItemMenu
                      key={def.id}
                      href={HREF_MENU[def.id]}
                      ativo={ativo === def.id}
                      minimizada={minimizada}
                      icone={ICONES_MENU[def.id]}
                      rotulo={def.rotulo}
                      badge={
                        def.id === "mesa"
                          ? ocupadas
                          : def.id === "kds"
                            ? pendentes
                            : undefined
                      }
                      bloqueio={def.bloqueiaCaixa ? bloqueioMenu : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Botões de baixo da sidebar */}
        <div className={minimizada ? "p-2" : "p-4"}>
          <button
            onClick={() => setCardapioAberto(true)}
            title="Cardápio"
            className={`w-full bg-green-700 hover:bg-green-800 text-white font-extrabold rounded-xl tracking-wide transition shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_0_#14532d,0_6px_10px_rgba(0,0,0,0.35)] active:translate-y-0.5 active:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_0_#14532d,0_3px_6px_rgba(0,0,0,0.35)] ${
              minimizada ? "py-2.5 text-lg" : "py-2.5"
            }`}
          >
            {minimizada ? "📋" : "CARDÁPIO"}
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
                <b>Configurações → Layout → Imagem do cardápio</b> para escolher a foto.
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
