"use client";

// ============================================================
// TELA /pagamento — mensalidade do Ponto De Vendas Harley Systems
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
    linkBoleto: string | null;
  } | null;
  pix: { imagem: string; copiaECola: string } | null;
  pixErro: string | null;
  boleto: { linhaDigitavel: string; codigoBarras: string } | null;
  boletoErro: string | null;
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
  const [boletoCopiado, setBoletoCopiado] = useState(false);
  const [requerCpf, setRequerCpf] = useState(false);
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    const s = getSessao();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessao(s);
    prepararMensalidade(s.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar(lojaId: string) {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/asaas/cobranca?loja=${encodeURIComponent(lojaId)}`, { cache: "no-store" });
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

  async function copiarCodigo(codigo: string, boleto = false) {
    try {
      await navigator.clipboard.writeText(codigo);
      if (boleto) {
        setBoletoCopiado(true);
        setTimeout(() => setBoletoCopiado(false), 2000);
      } else {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }
    } catch {
      setErro("Não foi possível copiar automaticamente. Selecione e copie o código exibido abaixo.");
    }
  }

  async function prepararMensalidade(lojaId: string, documento = "") {
    setGerando(true);
    setCarregando(true);
    setErro(null);
    setAviso(null);
    setDados(null);
    try {
      const resposta = await fetch("/api/asaas/gerar-cobranca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loja: lojaId, ...(documento ? { cpfCnpj: documento } : {}) }),
      });
      const corpo = (await resposta.json()) as { erro?: string; requerCpf?: boolean };
      if (!resposta.ok) {
        if (corpo.requerCpf) {
          setRequerCpf(true);
        } else {
          setErro(corpo.erro ?? "Não foi possível carregar a mensalidade.");
        }
        return;
      }
      setRequerCpf(false);
      setCpfCnpj("");
      await carregar(lojaId);
    } catch {
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setCarregando(false);
      setGerando(false);
    }
  }

  async function salvarDocumento(e: React.FormEvent) {
    e.preventDefault();
    if (!sessao || gerando) return;
    const documento = cpfCnpj.replace(/\D/g, "");
    if (documento.length !== 11 && documento.length !== 14) {
      setErro("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.");
      return;
    }
    await prepararMensalidade(sessao.id, documento);
  }

  function sair() {
    limparSessao();
    router.replace("/login");
  }

  const bloqueado = dados?.status === "bloqueado";
  const linkFatura = dados?.cobranca?.linkFatura ?? null;
  const linkBoleto = dados?.cobranca?.linkBoleto ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="relative inline-block">
            <div className="bg-gradient-to-b from-gray-400 to-gray-600 rounded-2xl px-6 py-2 shadow-[0_4px_10px_rgba(0,0,0,0.3),inset_0_2px_3px_rgba(255,255,255,0.35)] border border-white/40">
              <p
                className="max-w-56 text-base font-black tracking-wide text-white leading-tight"
                style={{
                  textShadow:
                    "1px 1px 0 #4b5563, 2px 2px 0 #374151, 3px 3px 0 #1f2937, 4px 4px 8px rgba(0,0,0,0.45)",
                }}
              >
                Ponto De Vendas Harley Systems
              </p>
            </div>
            <div className="absolute -bottom-1.5 left-7 w-3 h-3 bg-gray-600 rotate-45 rounded-sm" />
          </div>
          <h1 className="text-xl font-extrabold text-gray-900 mt-4">
            Mensalidade do Ponto De Vendas Harley Systems
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
          <p className="text-center text-gray-400 py-10">Carregando Pix e boleto...</p>
        ) : requerCpf || dados?.semAssinatura ? (
          <form onSubmit={salvarDocumento}>
            <p className="text-sm text-gray-600 mb-4">
              Informe o CPF ou CNPJ do responsável uma única vez para vincular
              sua loja à conta Asaas atual. Depois disso, o QR Code Pix, o código
              copia e cola e o boleto aparecerão automaticamente.
            </p>
            <label htmlFor="cpf-cnpj" className="block text-xs font-semibold text-gray-500 mb-1.5">
              CPF ou CNPJ do dono
            </label>
            <input
              id="cpf-cnpj"
              type="text"
              inputMode="numeric"
              autoComplete="off"
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
              {gerando ? "Preparando pagamento..." : "Salvar documento e continuar"}
            </button>
            <button
              type="button"
              onClick={sair}
              className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-xl transition"
            >
              Sair
            </button>
          </form>
        ) : dados ? (
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
                  <textarea
                    aria-label="Pix copia e cola"
                    readOnly
                    value={dados.pix.copiaECola}
                    onFocus={(e) => e.currentTarget.select()}
                    rows={3}
                    className="w-full resize-none border border-gray-300 rounded-lg p-3 text-xs font-mono text-gray-700 break-all"
                  />
                  <button
                    onClick={() => copiarCodigo(dados.pix!.copiaECola)}
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold py-2.5 rounded-lg transition"
                  >
                    {copiado ? "Código copiado!" : "Copiar código Pix (copia e cola)"}
                  </button>
                </div>
              </div>
            ) : null}
            {dados?.pixErro ? (
              <p className="bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg p-3 text-sm mb-4">
                Não foi possível carregar o QR Code Pix: {dados.pixErro}
              </p>
            ) : null}

            {/* Boleto bancário */}
            {dados?.boleto || linkBoleto ? (
              <div className="border border-gray-200 rounded-xl p-4 mb-4">
                <p className="font-bold text-gray-800 mb-1">Boleto bancário</p>
                <p className="text-xs text-gray-500 mb-3">
                  Pague usando a linha digitável abaixo ou abra o boleto.
                </p>
                {dados?.boleto ? (
                  <>
                    <textarea
                      aria-label="Linha digitável do boleto"
                      readOnly
                      value={dados.boleto.linhaDigitavel}
                      onFocus={(e) => e.currentTarget.select()}
                      rows={2}
                      className="w-full resize-none border border-gray-300 rounded-lg p-3 text-xs font-mono text-gray-700 mb-2"
                    />
                    <button
                      onClick={() => copiarCodigo(dados.boleto!.linhaDigitavel, true)}
                      className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold py-2.5 rounded-lg transition mb-3"
                    >
                      {boletoCopiado ? "Linha digitável copiada!" : "Copiar linha digitável"}
                    </button>
                  </>
                ) : null}
                {linkBoleto ? (
                  <a
                    href={linkBoleto}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-center w-full bg-[#2563EB] hover:bg-[#1E40AF] text-white font-bold py-3 rounded-xl transition"
                  >
                    Abrir boleto
                  </a>
                ) : null}
              </div>
            ) : null}
            {dados?.boletoErro ? (
              <p className="bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg p-3 text-sm mb-4">
                Não foi possível carregar a linha digitável do boleto: {dados.boletoErro}
              </p>
            ) : null}

            {/* Fatura para outras formas de pagamento */}
            {linkFatura ? (
              <div className="border border-gray-200 rounded-xl p-4 mb-4">
                <p className="font-bold text-gray-800 mb-1">
                  Outras formas de pagamento
                </p>
                <p className="text-xs text-gray-500 mb-3">
                  Abra a fatura segura do Asaas para ver as formas disponíveis,
                  como boleto ou cartão.
                </p>
                <a
                  href={linkFatura}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center w-full bg-[#2563EB] hover:bg-[#1E40AF] text-white font-bold py-3 rounded-xl transition"
                >
                  Abrir fatura Asaas
                </a>
              </div>
            ) : null}

            {dados && !dados.cobranca ? (
              <p className="border border-yellow-300 bg-yellow-50 rounded-xl p-4 mb-4 text-sm text-yellow-800">
                Não há mensalidade em aberto no Asaas. Use “Já paguei” para conferir seu acesso.
              </p>
            ) : null}

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
        ) : (
          <>
            <button
              onClick={() => sessao && prepararMensalidade(sessao.id)}
              className="w-full bg-[#2563EB] hover:bg-[#1E40AF] text-white font-bold py-3 rounded-xl transition mb-2"
            >
              Tentar novamente
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
