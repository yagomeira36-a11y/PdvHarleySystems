"use client";

import { useCallback, useEffect, useState } from "react";

type Settings = {
  instanceName: string;
  aiEnabled: boolean;
  paused: boolean;
  welcomeMessage: string;
  connectionStatus: "disconnected" | "connecting" | "connected";
  phoneNumber: string;
  profilePictureUrl: string;
};

type Status = Pick<Settings, "connectionStatus" | "phoneNumber" | "profilePictureUrl">;

const SETTINGS_INICIAIS: Settings = {
  instanceName: "",
  aiEnabled: false,
  paused: false,
  welcomeMessage: "",
  connectionStatus: "disconnected",
  phoneNumber: "",
  profilePictureUrl: "",
};

async function respostaApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : "Não foi possível concluir a operação."
    );
  }
  return body as T;
}

export default function WhatsAppAtendenteConfig() {
  const [settings, setSettings] = useState<Settings>(SETTINGS_INICIAIS);
  const [status, setStatus] = useState<Status>({
    connectionStatus: "disconnected",
    phoneNumber: "",
    profilePictureUrl: "",
  });
  const [qrCode, setQrCode] = useState("");
  const [welcomeDraft, setWelcomeDraft] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [operacao, setOperacao] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregarStatus = useCallback(async () => {
    const current = await respostaApi<Status>("/api/whatsapp/status");
    setStatus(current);
    if (current.connectionStatus === "connected") setQrCode("");
    return current;
  }, []);

  const carregarConfiguracao = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const current = await respostaApi<Settings>("/api/whatsapp/settings");
      setSettings(current);
      setWelcomeDraft(current.welcomeMessage);
      await carregarStatus();
    } catch (failure) {
      setErro(failure instanceof Error ? failure.message : "Não foi possível carregar o atendente.");
    } finally {
      setCarregando(false);
    }
  }, [carregarStatus]);

  useEffect(() => {
    void carregarConfiguracao();
  }, [carregarConfiguracao]);

  useEffect(() => {
    if (carregando) return;
    const interval = window.setInterval(() => {
      void carregarStatus().catch((failure: unknown) => {
        setErro(failure instanceof Error ? failure.message : "Falha ao consultar o WhatsApp.");
      });
    }, 8000);
    return () => window.clearInterval(interval);
  }, [carregando, carregarStatus]);

  async function conectar() {
    setOperacao("connect");
    setErro("");
    setAviso("");
    try {
      const result = await respostaApi<{ qrCode: string }>("/api/whatsapp/connect", {
        method: "POST",
      });
      setQrCode(result.qrCode);
      setStatus((current) => ({ ...current, connectionStatus: "connecting" }));
      setAviso("QR Code gerado. Escaneie em WhatsApp > Aparelhos conectados.");
    } catch (failure) {
      setErro(failure instanceof Error ? failure.message : "Não foi possível gerar o QR Code.");
    } finally {
      setOperacao("");
    }
  }

  async function desconectar() {
    if (!window.confirm("Desconectar o WhatsApp desta loja? A IA será desligada.")) return;
    setOperacao("disconnect");
    setErro("");
    setAviso("");
    try {
      await respostaApi("/api/whatsapp/disconnect", { method: "POST" });
      setQrCode("");
      setSettings((current) => ({ ...current, aiEnabled: false }));
      await carregarStatus();
      setAviso("WhatsApp desconectado.");
    } catch (failure) {
      setErro(failure instanceof Error ? failure.message : "Não foi possível desconectar.");
    } finally {
      setOperacao("");
    }
  }

  async function alterarConfig(patch: Partial<Pick<Settings, "aiEnabled" | "paused">>) {
    setOperacao("config");
    setErro("");
    setAviso("");
    try {
      const updated = await respostaApi<Settings>("/api/whatsapp/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSettings(updated);
      setAviso(updated.paused ? "IA pausada. O atendimento manual continua ativo." : "Configuração atualizada.");
    } catch (failure) {
      setErro(failure instanceof Error ? failure.message : "Não foi possível salvar a configuração.");
    } finally {
      setOperacao("");
    }
  }

  async function salvarBoasVindas() {
    setOperacao("welcome");
    setErro("");
    setAviso("");
    try {
      const updated = await respostaApi<Settings>("/api/whatsapp/settings", {
        method: "PATCH",
        body: JSON.stringify({ welcomeMessage: welcomeDraft }),
      });
      setSettings(updated);
      setWelcomeDraft(updated.welcomeMessage);
      setAviso("Mensagem de boas-vindas salva.");
    } catch (failure) {
      setErro(failure instanceof Error ? failure.message : "Não foi possível salvar a mensagem.");
    } finally {
      setOperacao("");
    }
  }

  const conectado = status.connectionStatus === "connected";
  const statusTexto = conectado
    ? `Conectado${status.phoneNumber ? ` · +${status.phoneNumber}` : ""}`
    : status.connectionStatus === "connecting"
      ? "Aguardando leitura do QR Code"
      : "Desconectado";

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm" aria-labelledby="whatsapp-config-titulo">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="whatsapp-config-titulo" className="text-lg font-bold text-gray-900">
            Atendente IA / WhatsApp
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Conecte o número que a loja já usa. Cada loja recebe uma instância isolada; a IA só responde depois de 5 minutos sem uma resposta manual do dono.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${conectado ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
          {statusTexto}
        </span>
      </header>

      {carregando ? (
        <p className="py-4 text-sm text-gray-500">Carregando conexão...</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {conectado ? (
              <>
                {status.profilePictureUrl ? (
                  <img
                    src={status.profilePictureUrl}
                    alt="Foto do WhatsApp conectado"
                    className="h-12 w-12 rounded-full border border-gray-200 object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-xl" aria-hidden="true">
                    🏪
                  </div>
                )}
                <p className="text-sm font-semibold text-green-800">{statusTexto}</p>
                <button
                  type="button"
                  disabled={!!operacao}
                  onClick={() => void desconectar()}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {operacao === "disconnect" ? "Desconectando..." : "Desconectar"}
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!!operacao}
                onClick={() => void conectar()}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {operacao === "connect" ? "Gerando QR Code..." : "Conectar meu WhatsApp"}
              </button>
            )}
          </div>

          {qrCode && !conectado && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:flex-row">
              <img src={qrCode} alt="QR Code para conectar o WhatsApp da loja" className="h-56 w-56 bg-white p-2" />
              <div className="max-w-md text-sm text-gray-700">
                <p className="font-bold">No celular do estabelecimento:</p>
                <ol className="mt-2 list-inside list-decimal space-y-1">
                  <li>Abra o WhatsApp.</li>
                  <li>Toque em Aparelhos conectados.</li>
                  <li>Toque em Conectar aparelho e escaneie o QR Code.</li>
                </ol>
                <p className="mt-3 text-xs text-gray-500">A conexão usa a sessão do WhatsApp Web; não é necessário trocar o número.</p>
              </div>
            </div>
          )}

          {conectado && (
            <div className="grid gap-3 rounded-lg border border-gray-200 p-3 sm:grid-cols-2">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={settings.aiEnabled}
                  disabled={!!operacao}
                  onChange={(event) => void alterarConfig({ aiEnabled: event.target.checked })}
                  className="mt-1"
                />
                <span>
                  <b>Ligar atendente IA</b>
                  <span className="mt-1 block text-xs text-gray-600">Responde clientes usando o cardápio e as zonas desta loja.</span>
                </span>
              </label>
              <button
                type="button"
                disabled={!settings.aiEnabled || !!operacao}
                onClick={() => void alterarConfig({ paused: !settings.paused })}
                className={`rounded-lg px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${settings.paused ? "bg-amber-100 text-amber-900" : "border border-gray-300 text-gray-700 hover:bg-gray-50"}`}
              >
                {settings.paused ? "Retomar IA" : "Pausar IA"}
              </button>
            </div>
          )}

          <div>
            <label htmlFor="whatsapp-boas-vindas" className="block text-sm font-semibold text-gray-800">
              Mensagem de boas-vindas
            </label>
            <textarea
              id="whatsapp-boas-vindas"
              value={welcomeDraft}
              onChange={(event) => setWelcomeDraft(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Ex.: Olá! Bem-vindo à nossa hamburgueria. Como posso ajudar?"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500">{welcomeDraft.length}/500</span>
              <button
                type="button"
                disabled={!!operacao || welcomeDraft === settings.welcomeMessage}
                onClick={() => void salvarBoasVindas()}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {operacao === "welcome" ? "Salvando..." : "Salvar mensagem"}
              </button>
            </div>
          </div>
        </>
      )}

      {erro && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      {aviso && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{aviso}</p>}
    </section>
  );
}
