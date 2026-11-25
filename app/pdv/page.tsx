"use client";

// ============================================================
// PÁGINA PRINCIPAL DO PDV (layout Ponto De Vendas Harley Systems)
// A seção ativa vem da URL (?aba=...) e a navegação fica
// toda na sidebar azul do LayoutMenu. Guarda o carrinho,
// o cliente e as mensagens (toast) de toda a aplicação.
// ============================================================
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import LayoutMenu, { ItemAtivo } from "@/components/LayoutMenu";
import Balcao from "@/components/Balcao";
import Delivery from "@/components/Delivery";
import GerenciamentoLoja from "@/components/GerenciamentoLoja";
import Configuracoes from "@/components/Configuracoes";
import CadastrarProduto from "@/components/CadastrarProduto";
import Estoque from "@/components/Estoque";
import Kds from "@/components/Kds";
import PedidosFinalizados from "@/components/PedidosFinalizados";
import TelaCaixa from "@/components/Caixa";
import Relatorios from "@/components/Relatorios";
import { getSessao, getSupabase } from "@/lib/supabase";
import { contarPendenciasOffline, sincronizarPedidosOffline } from "@/lib/offline-pdv";

// Seções válidas (o padrão é o Balcão)
const ABAS_VALIDAS: ItemAtivo[] = [
  "balcao",
  "delivery",
  "kds",
  "finalizados",
  "gerenciamento",
  "configuracoes",
  "cadastrar",
  "estoque",
  "caixa",
  "relatorios",
];

function ConteudoPDV() {
  const params = useSearchParams();
  const pedida = params.get("aba");
  const [aba, setAba] = useState<ItemAtivo>(
    ABAS_VALIDAS.includes(pedida as ItemAtivo) ? (pedida as ItemAtivo) : "balcao"
  );

  // Mantém a seção sincronizada quando a URL muda (navegação pela sidebar)
  useEffect(() => {
    setAba(
      ABAS_VALIDAS.includes(pedida as ItemAtivo)
        ? (pedida as ItemAtivo)
        : "balcao"
    );
  }, [pedida]);

  // Mensagem flutuante (toast)
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  // Incrementado a cada pedido criado -> recarrega as outras telas
  const [refreshKey, setRefreshKey] = useState(0);

  // Chamado pelos componentes após criar pedido / entrega
  function aoPedidoCriado(texto: string, tipo: "ok" | "erro" = "ok") {
    setAviso({ tipo, texto });
    setRefreshKey((k) => k + 1);
    // Some sozinho depois de 5 segundos
    setTimeout(() => setAviso(null), 5000);
  }

  const callbackPedidoRef = useRef(aoPedidoCriado);
  useEffect(() => {
    callbackPedidoRef.current = aoPedidoCriado;
  }, [aoPedidoCriado]);

  useEffect(() => {
    const supabase = getSupabase();
    const sessao = getSessao();
    if (!supabase || !sessao) return;
    const clienteSupabase = supabase;
    const lojaId = sessao.id;
    let ativo = true;
    let sincronizando = false;

    async function sincronizar() {
      if (!navigator.onLine || sincronizando) return;
      sincronizando = true;
      try {
        const pendenciasAntes = await contarPendenciasOffline(lojaId);
        const resultado = await sincronizarPedidosOffline(clienteSupabase, lojaId);
        if (!ativo) return;
        const pendenciasDepois = await contarPendenciasOffline(lojaId);
        if (resultado.sincronizados.length > 0) {
          setRefreshKey((atual) => atual + 1);
          callbackPedidoRef.current(
            `${resultado.sincronizados.length} pedido(s) offline sincronizado(s) com o servidor.`,
            "ok"
          );
        } else if (pendenciasAntes > 0 && pendenciasDepois === 0) {
          // atualizações/status sincronizados sem novos pedidos criados
          setRefreshKey((atual) => atual + 1);
        }
        if (resultado.falhas.length > 0) {
          callbackPedidoRef.current(
            `${resultado.falhas.length} item(ns) offline continuam pendentes: ${resultado.falhas[0].mensagem}`,
            "erro"
          );
        }
      } catch (error) {
        if (ativo) {
          const msg = error instanceof Error ? error.message : String(error || "");
          const offline = typeof navigator !== "undefined" && !navigator.onLine;
          const rede = offline || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|econn|socket/i.test(msg) || error instanceof TypeError;
          if (!rede) {
            callbackPedidoRef.current(msg || "Não foi possível sincronizar os pedidos offline.", "erro");
          }
          // erro de rede: mantém fila silenciosa, retry automático no próximo ciclo
        }
      } finally {
        sincronizando = false;
      }
    }

    window.addEventListener("online", sincronizar);
    const intervalo = window.setInterval(() => {
      void (async () => {
        try {
          if ((await contarPendenciasOffline(lojaId)) > 0) await sincronizar();
        } catch {
          /* ignora falhas transitórias de leitura da fila */
        }
      })();
    }, 15000);
    void sincronizar();
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
      window.removeEventListener("online", sincronizar);
    };
  }, []);

  // Atalhos de teclado: F11 = tela cheia | F12 = fechar caixa
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
      }
      if (e.key === "F12") {
        e.preventDefault();
        window.close(); // tenta fechar a janela (navegadores podem bloquear)
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  return (
    <LayoutMenu ativo={aba} refreshKey={refreshKey} aoPedidoCriado={aoPedidoCriado}>
      {/* Conteúdo conforme a seção ativa */}
      {aba === "balcao" && <Balcao aoPedidoCriado={aoPedidoCriado} />}
      {aba === "delivery" && (
        <Delivery refreshKey={refreshKey} aoPedidoCriado={aoPedidoCriado} />
      )}
      {aba === "kds" && (
        <Kds refreshKey={refreshKey} aoPedidoCriado={aoPedidoCriado} />
      )}
      {aba === "finalizados" && (
        <PedidosFinalizados
          refreshKey={refreshKey}
          aoPedidoCriado={aoPedidoCriado}
        />
      )}
      {aba === "gerenciamento" && (
        <GerenciamentoLoja refreshKey={refreshKey} />
      )}
      {aba === "cadastrar" && <CadastrarProduto />}
      {aba === "estoque" && <Estoque />}
      {aba === "caixa" && <TelaCaixa refreshKey={refreshKey} />}
      {aba === "relatorios" && <Relatorios refreshKey={refreshKey} />}
      {aba === "configuracoes" && (
        <Configuracoes refreshKey={refreshKey} aoPedidoCriado={aoPedidoCriado} />
      )}

      {/* Toast flutuante (sucesso verde / erro vermelho) */}
      {aviso && (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-lg px-4 py-3 shadow-lg max-w-sm ${
            aviso.tipo === "ok"
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {aviso.texto}
        </div>
      )}
    </LayoutMenu>
  );
}

export default function PDV() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-gray-500">
          Carregando...
        </div>
      }
    >
      <ConteudoPDV />
    </Suspense>
  );
}
