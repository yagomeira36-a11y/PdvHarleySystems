"use client";

// ============================================================
// TELA /pagamento — mensalidade do PdvDaGalera
// Aparece quando a loja está vencida ou bloqueada: o único
// caminho daqui é pagar (Pix ou cartão) no Asaas.
// O PDV fica travado enquanto não pagar.
// ============================================================
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatarMoeda,
  getSessao,
  limparSessao,
  salvarSessao,
  Sessao,
} from "@/lib/supabase";

// Resposta da rota /api/asaas/cobranca
type Mensalidade = {
  status: string;
  valor: number;
  vencimento: string | null;
  semAssinatura: boolean;
  cobranca: {
    id: string;
    status: string;
    valor: number;
    vencimento: string;
    linkFatura: string | null;
  } | null;
  pix: { imagem: string; copiaECola: string } | null;
  erro?: string;
};

// AAAA-MM-DD -> DD/MM/AAAA
function formatarDataBR(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export default function Pagamento() {
  const router = useRouter();
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [dados, setDados] = useState<Mensalidade | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  // Loja sem assinatura no Asaas: pede o CPF/CNPJ para gerar a cobrança
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    const s = getSessao();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessao(s);
    carregar(s.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar(lojaId: string) {
    setCarregando(true);
    try {
      const resposta = await fetch(`/api/asaas/cobranca?loja=${lojaId}`);
      const corpo = (await resposta.json()) as Mensalidade;
      if (!resposta.ok) {
        setErro(corpo.erro ?? "Não foi possível carregar a mensalidade.");
      } else {
        setDados(corpo);
      }
    } catch {
      setErro("Não foi possível falar com o servidor.");
    }
    setCarregando(false);
  }

  // Confere no Asaas se o pagamento já caiu e libera o acesso
  async function jaPaguei() {
    if (!sessao || sincronizando) return;
    setSincronizando(true);
    setErro(null);
    setAviso(null);
    try {
      const resposta = await fetch("/api/asaas/sincronizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loja: sessao.id }),
      });
      const corpo = (await resposta.json()) as {
        status?: string;
        vencimento?: string | null;
        erro?: string;
      };
      if (!resposta.ok) {
        setErro(corpo.erro ?? "Não foi possível conferir o pagamento.");
      } else if (corpo.status === "ativo") {
        // Libera o acesso: atualiza a sessão e entra no PDV
        salvarSessao({
          ...sessao,
          status_pagamento: "ativo",
          data_vencimento: corpo.vencimento ?? sessao.data_vencimento,
        });
        router.replace("/pdv");
        return;
      } else {
        setAviso(
          "Ainda não identificamos o pagamento. Se você acabou de pagar, aguarde alguns minutos e tente de novo."
        );
        carregar(sessao.id);
      }
    } catch {
      setErro("Não foi possível falar com o servidor.");
    }
    setSincronizando(false);
  }

  async function copiarPix() {
    if (!dados?.pix) return;
    await navigator.clipboard.writeText(dados.pix.copiaECola);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  // Gera a cobrança no Asaas para lojas que ainda não têm assinatura
  // (ex: criadas com a data de vencimento já passada)
  async function gerarCobranca(e: React.FormEvent) {
    e.preventDefault();
    if (!sessao || gerando) return;
    const documento = cpfCnpj.replace(/\D/g, "");
    if (documento.length !== 11 && documento.length !== 14) {
      setErro("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.");
      return;
    }
    setGerando(true);
    setErro(null);
    setAviso(null);
    try {
      const resposta = await fetch("/api/asaas/gerar-cobranca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loja: sessao.id, cpfCnpj: documento }),
      });
      const corpo = (await resposta.json()) as { erro?: string };
      if (!resposta.ok) {
        setErro(corpo.erro ?? "Não foi possível gerar a cobrança.");
        setGerando(false);
        return;
      }
      // Cobrança criada: recarrega e a tela já mostra o Pix e o boleto
      await carregar(sessao.id);
    } catch {
      setErro("Não foi possível falar com o servidor.");
    }
    setGerando(false);
  }

  function sair() {
    limparSessao();
    router.replace("/login");
  }

  const bloqueado = dados?.status === "bloqueado";
  const linkFatura = dados?.cobranca?.linkFatura ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="relative inline-block">
            <div className="bg-gradient-to-b from-gray-400 to-gray-600 rounded-2xl px-6 py-2 shadow-[0_4px_10px_rgba(0,0,0,0.3),inset_0_2px_3px_rgba(255,255,255,0.35)] border border-white/40">
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
            <div className="absolute -bottom-1.5 left-7 w-3 h-3 bg-gray-600 rotate-45 rounded-sm" />
          </div>
          <h1 className="text-xl font-extrabold text-gray-900 mt-4">
            Mensalidade do PdvDaGalera
          </h1>
          <p className="text-sm text-gray-500">{sessao?.nome_loja ?? ""}</p>
        </div>

        {/* Aviso de status */}
        <div
          className={`rounded-xl p-3 mb-4 text-sm font-semibold text-center ${
            bloqueado
              ? "bg-gray-100 border border-gray-300 text-gray-700"
              : "bg-red-50 border border-red-300 text-red-700"
          }`}
        >
          {bloqueado
            ? "Seu acesso está bloqueado. Pague a mensalidade para liberar o PDV."
            : "Sua mensalidade está vencida. Pague para liberar o PDV."}
        </div>

        {erro && (
          <p className="bg-red-50 border border-red-400 text-red-600 rounded-lg p-3 text-sm font-semibold mb-4">
            {erro}
          </p>
        )}
        {aviso && (
          <p className="bg-yellow-50 border border-yellow-400 text-yellow-700 rounded-lg p-3 text-sm font-semibold mb-4">
            {aviso}
          </p>
        )}

        {carregando ? (
          <p className="text-center text-gray-400 py-10">Carregando...</p>
        ) : dados?.semAssinatura ? (
          <form onSubmit={gerarCobranca}>
            <p className="text-sm text-gray-600 mb-4">
              Esta loja ainda não tem cobrança no Asaas. Informe o CPF ou CNPJ
              do dono para gerar a mensalidade de R$ 79,99 e receber o Pix
              (QR Code + copia e cola) e o boleto.
            </p>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">
              CPF ou CNPJ do dono
            </label>
            <input
              type="text"
              value={cpfCnpj}
              onChange={(e) => setCpfCnpj(e.target.value)}
              placeholder="000.000.000-00 ou 00.000.000/0000-00"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
            <button
              type="submit"
              disabled={gerando}
              className="w-full bg-[#2563EB] hover:bg-[#1E40AF] disabled:opacity-50 text-white font-extrabold py-3.5 rounded-xl tracking-wide transition mb-2"
            >
              {gerando ? "Gerando cobrança..." : "Gerar cobrança de R$ 79,99"}
            </button>
            <button
              type="button"
              onClick={sair}
              className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-xl transition"
            >
              Sair
            </button>
          </form>
        ) : (
          <>
            {/* Valor */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Mensalidade
                </p>
                <p className="text-2xl font-extrabold text-gray-900">
                  {formatarMoeda(dados?.cobranca?.valor ?? dados?.valor ?? 0)}
                  <span className="text-sm font-semibold text-gray-500"> /mês</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Vencimento
                </p>
                <p className="text-sm font-bold text-gray-700">
                  {formatarDataBR(
                    dados?.cobranca?.vencimento ?? dados?.vencimento ?? null
                  )}
                </p>
              </div>
            </div>

            {/* Pix */}
            {dados?.pix ? (
              <div className="border border-gray-200 rounded-xl p-4 mb-4">
                <p className="font-bold text-gray-800 mb-1">Pagar com Pix</p>
                <p className="text-xs text-gray-500 mb-3">
                  Abra o app do seu banco e escaneie o código abaixo.
                </p>
                <div className="flex flex-col items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${dados.pix.imagem}`}
                    alt="QR Code do Pix"
                    className="w-48 h-48 border border-gray-200 rounded-lg"
                  />
                  <button
                    onClick={copiarPix}
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold py-2.5 rounded-lg transition"
                  >
                    {copiado ? "Código copiado!" : "Copiar código Pix (copia e cola)"}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Cartão / boleto */}
            {linkFatura ? (
              <div className="border border-gray-200 rounded-xl p-4 mb-4">
                <p className="font-bold text-gray-800 mb-1">Pagar com boleto ou cartão</p>
                <p className="text-xs text-gray-500 mb-3">
                  Abre a fatura segura do Asaas: lá você escolhe boleto ou cartão de crédito.
                </p>
                <a
                  href={linkFatura}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center w-full bg-[#2563EB] hover:bg-[#1E40AF] text-white font-bold py-3 rounded-xl transition"
                >
                  Abrir fatura (boleto ou cartão)
                </a>
              </div>
            ) : null}

            {!dados?.pix && !linkFatura && (
              <p className="text-sm text-gray-500 text-center mb-4">
                Nenhuma fatura em aberto encontrada. Clique em &quot;Já
                paguei&quot; para atualizar.
              </p>
            )}

            {/* Ações */}
            <button
              onClick={jaPaguei}
              disabled={sincronizando}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-extrabold py-3.5 rounded-xl tracking-wide transition mb-2"
            >
              {sincronizando ? "Conferindo..." : "Já paguei — liberar acesso"}
            </button>
            <button
              onClick={sair}
              className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-xl transition"
            >
              Sair
            </button>
          </>
        )}
      </div>
    </div>
  );
}
