"use client";

// ============================================================
// PÁGINA PRINCIPAL DO PDV (layout PdvDaGalera)
// A seção ativa vem da URL (?aba=...) e a navegação fica
// toda na sidebar azul do LayoutMenu. Guarda o carrinho,
// o cliente e as mensagens (toast) de toda a aplicação.
// ============================================================
import { Suspense, useEffect, useState } from "react";
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
