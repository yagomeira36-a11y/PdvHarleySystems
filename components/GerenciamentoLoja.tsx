"use client";

// ============================================================
// TELA GERENCIAMENTO DE LOJA (hub)
// Primeiro aparece uma "janelinha" com ícone para cada item:
// Cadastrar Produto, Estoque, Caixa, Relatórios e Fiado.
// Clicando no ícone, a tela abre dentro do Gerenciamento de loja.
// ============================================================
import { useState } from "react";
import CadastrarProduto from "./CadastrarProduto";
import Estoque from "./Estoque";
import TelaCaixa from "./Caixa";
import Relatorios from "./Relatorios";
import TelaFiado from "./Fiado";
import LojaOnline from "./LojaOnline";
import Clientes from "./Clientes";

// Seções acessíveis pelo hub
type Secao = "hub" | "loja-online" | "cadastrar" | "estoque" | "caixa" | "relatorios" | "fiado" | "clientes";

// ============================================================
// ÍCONES DO HUB (um para cada "janelinha")
// ============================================================
function IconeCadastrar() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}
function IconeEstoque() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18M21 3v18M3 11h18M3 21h18" />
      <rect x="6" y="3" width="5" height="8" rx="1" />
      <rect x="13" y="14" width="5" height="7" rx="1" />
      <path d="M8 16h2" />
    </svg>
  );
}
function IconeCaixa() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}
function IconeRelatorio() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M7 16v-4" />
      <path d="M12 16V8" />
      <path d="M17 16v-6" />
    </svg>
  );
}
function IconeFiado() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 7h8M8 11h8M8 15h4" />
    </svg>
  );
}

function IconeLojaOnline() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </svg>
  );
}

function IconeClientes() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// ============================================================
// JANELINHAS DO HUB (ícone + título + descrição)
// ============================================================
const CARTOES: {
  id: Secao;
  titulo: string;
  descricao: string;
  icone: React.ReactNode;
}[] = [
  {
    id: "loja-online",
    titulo: "Loja online",
    descricao: "Cardápio digital, link público, WhatsApp e status da loja.",
    icone: <IconeLojaOnline />,
  },
  {
    id: "cadastrar",
    titulo: "Cadastrar Produto",
    descricao: "Cadastre itens do cardápio, preços e categorias.",
    icone: <IconeCadastrar />,
  },
  {
    id: "estoque",
    titulo: "Estoque",
    descricao: "Quantidades disponíveis e avisos de estoque baixo.",
    icone: <IconeEstoque />,
  },
  {
    id: "caixa",
    titulo: "Caixa",
    descricao: "Abertura, fechamento e movimentações do dia.",
    icone: <IconeCaixa />,
  },
  {
    id: "relatorios",
    titulo: "Relatórios",
    descricao: "Vendas, lucro e resumo por período.",
    icone: <IconeRelatorio />,
  },
  {
    id: "clientes",
    titulo: "Clientes",
    descricao: "Cadastros com nome, telefone e endereço.",
    icone: <IconeClientes />,
  },
  {
    id: "fiado",
    titulo: "Fiado",
    descricao: "Contas dos clientes que compram e pagam depois.",
    icone: <IconeFiado />,
  },
];

// Botão de voltar para o hub
function BotaoVoltar({ onVoltar }: { onVoltar: () => void }) {
  return (
    <button
      onClick={onVoltar}
      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-600 transition hover:border-green-300 hover:text-green-700"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 18-6-6 6-6" />
      </svg>
      Gerenciamento de loja
    </button>
  );
}

export default function GerenciamentoLoja({ refreshKey }: { refreshKey: number }) {
  const [secao, setSecao] = useState<Secao>("hub");

  const tituloSecao =
    CARTOES.find((c) => c.id === secao)?.titulo ?? "Gerenciamento de loja";

  // ============================================================
  // SEÇÕES QUE SÃO TELAS INTEIRAS (têm rolagem própria)
  // ============================================================
  if (secao !== "hub") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <BotaoVoltar onVoltar={() => setSecao("hub")} />
          <h1 className="text-xl font-bold">{tituloSecao}</h1>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {secao === "cadastrar" && <CadastrarProduto />}
          {secao === "estoque" && <Estoque />}
          {secao === "caixa" && <TelaCaixa refreshKey={refreshKey} />}
          {secao === "relatorios" && <Relatorios refreshKey={refreshKey} />}
          {secao === "fiado" && <TelaFiado />}
          {secao === "loja-online" && <LojaOnline />}
          {secao === "clientes" && <Clientes />}
        </div>
      </div>
    );
  }

  // ================= HUB: janelinhas com ícone =================
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h1 className="text-2xl font-bold mb-1">Gerenciamento de loja</h1>
      <p className="text-sm text-gray-400 mb-6">
        Produtos, estoque, caixa e relatórios da loja.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {CARTOES.map((c) => (
          <button
            key={c.id}
            onClick={() => setSecao(c.id)}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-green-400 hover:shadow-md"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-700 transition group-hover:bg-green-100">
              {c.icone}
            </span>
            <span className="font-bold text-gray-800">{c.titulo}</span>
            <span className="text-xs text-gray-500">{c.descricao}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
