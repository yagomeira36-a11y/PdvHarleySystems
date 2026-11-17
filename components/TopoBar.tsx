"use client";

// ============================================================
// BARRAS DO TOPO
// 1) Faixa CINZA superior: funções extras (Configurações,
//    Cadastrar Produto, ...)
// 2) Barra principal: abas de venda (Comanda, Mesa, Balcão,
//    Delivery, Integração, Motoboys) + F11/F12
// ============================================================
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Abas principais (fluxo de vendas)
export type Aba =
  | "comanda"
  | "mesa"
  | "balcao"
  | "delivery"
  | "integracao"
  | "motoboys";

// Funções extras (faixa cinza no topo)
export type Funcao = "configuracoes" | "cadastrar_produto";

// Ordem dos botões centrais da barra principal
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "comanda", rotulo: "Comanda" },
  { id: "mesa", rotulo: "Mesa" },
  { id: "balcao", rotulo: "Balcão" },
  { id: "delivery", rotulo: "Delivery" },
  { id: "integracao", rotulo: "Integração" },
  { id: "motoboys", rotulo: "Motoboys" },
];

// Botões da faixa cinza superior
const FUNCOES: { id: Funcao; rotulo: string }[] = [
  { id: "configuracoes", rotulo: "Configurações" },
  { id: "cadastrar_produto", rotulo: "Cadastrar Produto" },
];

type Props = {
  aba: Aba; // aba ativa na barra principal
  funcao: Funcao | null; // função ativa na faixa cinza (null = nenhuma)
  setAba: (aba: Aba) => void;
  setFuncao: (funcao: Funcao | null) => void;
};

export default function TopoBar({ aba, funcao, setAba, setFuncao }: Props) {
  const router = useRouter();

  // Alterna o modo tela cheia (mesma função do F11 do teclado)
  function alternarTelaCheia() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  // Atalhos de teclado: F11 = opções/tela cheia | F12 = fechar caixa
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        alternarTelaCheia();
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
    <>
      {/* ===== FAIXA CINZA SUPERIOR: funções extras ===== */}
      <div className="bg-[#3a3a3a] border-b border-black/50 px-3 py-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mr-1">
          Funções
        </span>
        {FUNCOES.map((f) => (
          <button
            key={f.id}
            onClick={() => setFuncao(funcao === f.id ? null : f.id)}
            className={`px-3 py-1 rounded text-xs font-semibold transition ${
              funcao === f.id
                ? "bg-green-600 text-white"
                : "bg-[#4a4a4a] text-gray-300 hover:bg-[#555]"
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {/* ===== BARRA PRINCIPAL ===== */}
      <header className="bg-topo border-b border-black/50 px-3 py-2 flex items-center justify-between gap-4 flex-wrap">
        {/* ===== Informações do caixa (esquerda) ===== */}
        <div className="flex items-center gap-4 text-sm whitespace-nowrap">
          <span>
            Caixa: <b className="text-green-400">7</b>
          </span>
          <span>
            Abertura: <b>3</b>
          </span>
          <span>
            Usuário: <b className="text-green-400">logado</b>
          </span>
        </div>

        {/* ===== Abas centrais ===== */}
        <nav className="flex gap-2 flex-wrap justify-center">
          {ABAS.map((a) => {
            // A aba só aparece como ATIVO quando nenhuma função extra está aberta
            const ativa = funcao === null && aba === a.id;
            return (
              <button
                key={a.id}
                onClick={() => {
                  if (a.id === "mesa") {
                    // A tela de mesas agora é a página /mesas
                    router.push("/mesas");
                    return;
                  }
                  setFuncao(null); // fecha qualquer função extra
                  setAba(a.id);
                }}
                className={`px-4 py-1.5 rounded font-semibold text-sm transition ${
                  ativa
                    ? "bg-green-600 text-white"
                    : "bg-card text-gray-300 hover:bg-[#4a4a4a]"
                }`}
              >
                {ativa ? `${a.rotulo} ATIVO` : a.rotulo}
              </button>
            );
          })}
        </nav>

        {/* ===== Botões da direita ===== */}
        <div className="flex gap-2">
          <button
            onClick={alternarTelaCheia}
            className="bg-card hover:bg-[#4a4a4a] text-sm px-3 py-1.5 rounded"
            title="Alternar tela cheia"
          >
            F11 Opções
          </button>
          <button
            onClick={() => window.close()}
            className="bg-red-600 hover:bg-red-700 text-sm font-bold px-3 py-1.5 rounded"
            title="Fechar caixa"
          >
            F12 Fechar
          </button>
        </div>
      </header>
    </>
  );
}
