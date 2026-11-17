"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AJUDA_ASSISTENTE, responderAssistente } from "@/lib/assistente-estoque";
import { getSessao } from "@/lib/supabase";

type Mensagem = {
  id: number;
  autor: "usuario" | "assistente";
  texto: string;
};

const ATALHOS = [
  { rotulo: "Ver estoque", comando: "ESTOQUE" },
  { rotulo: "Estoque baixo", comando: "BAIXOS" },
  { rotulo: "Ajuda", comando: "AJUDA" },
];

export default function BotAssistente() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([
    { id: 0, autor: "assistente", texto: AJUDA_ASSISTENTE },
  ]);
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const envioEmCurso = useRef(false);
  const proximoId = useRef(1);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chat = chatRef.current;
    if (chat) chat.scrollTop = chat.scrollHeight;
  }, [mensagens, enviando]);

  function adicionarMensagem(autor: Mensagem["autor"], texto: string) {
    const id = proximoId.current++;
    setMensagens((atuais) => [...atuais, { id, autor, texto }]);
  }

  async function enviar(texto: string, limparCampo = false) {
    const comando = texto.trim();
    if (!comando || envioEmCurso.current) return;

    envioEmCurso.current = true;
    setEnviando(true);
    setErro(null);

    try {
      const loja = getSessao();
      if (!loja?.id) {
        setErro("Sessão da loja não encontrada. Entre novamente no PDV para usar o assistente.");
        return;
      }

      adicionarMensagem("usuario", comando);
      if (limparCampo) setMensagem("");
      const resposta = await responderAssistente(loja.id, comando);
      adicionarMensagem("assistente", resposta);
    } catch (falha) {
      const detalhe = falha instanceof Error && falha.message.trim()
        ? falha.message
        : "Verifique se o navegador permite acessar o armazenamento local.";
      setErro(`Não foi possível concluir o comando. ${detalhe} Consulte o estoque antes de repetir um cadastro ou uma adição de quantidade.`);
    } finally {
      envioEmCurso.current = false;
      setEnviando(false);
    }
  }

  function enviarFormulario(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    void enviar(mensagem, true);
  }

  return (
    <section className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto space-y-5 p-4 text-gray-900 sm:p-6" aria-labelledby="bot-assistente-titulo">
      <header>
        <h1 id="bot-assistente-titulo" className="text-2xl font-bold">Bot Assistente WhatsApp</h1>
        <p className="mt-1 text-sm text-gray-600">Assistente interno para o dono e os funcionários. Não atende clientes.</p>
      </header>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4" role="note" aria-labelledby="bot-whatsapp-status">
        <h2 id="bot-whatsapp-status" className="font-bold text-amber-900">WhatsApp não conectado</h2>
        <p className="mt-1 text-sm text-amber-900">
          O assistente abaixo funciona apenas dentro do sistema nesta etapa. A conexão oficial com o WhatsApp será preparada futuramente; não há envio ou recebimento de mensagens pelo WhatsApp agora.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-labelledby="bot-chat-titulo">
          <div className="border-b border-gray-200 px-4 py-3">
            <h2 id="bot-chat-titulo" className="font-semibold">Conversa interna</h2>
            <p id="bot-chat-memoria" className="mt-1 text-xs text-gray-600">As mensagens ficam só em memória e são apagadas ao sair desta tela ou recarregar a página.</p>
          </div>

          <div
            ref={chatRef}
            role="log"
            aria-label="Mensagens do assistente interno"
            aria-describedby="bot-chat-memoria"
            aria-live="polite"
            aria-relevant="additions"
            aria-atomic="false"
            aria-busy={enviando}
            tabIndex={0}
            className="h-[360px] space-y-4 overflow-y-auto overscroll-contain bg-gray-50 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:h-[420px]"
          >
            {mensagens.map((item) => (
              <div key={item.id} className={`flex ${item.autor === "usuario" ? "justify-end" : "justify-start"}`}>
                <div className={`min-w-0 max-w-[95%] rounded-xl px-4 py-3 sm:max-w-[90%] ${item.autor === "usuario" ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-900"}`}>
                  <p className={`mb-1 text-xs font-semibold ${item.autor === "usuario" ? "text-blue-100" : "text-gray-600"}`}>
                    {item.autor === "usuario" ? "Você" : "Assistente"}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{item.texto}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3 border-t border-gray-200 p-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Consultas rápidas">
              {ATALHOS.map((atalho) => (
                <button
                  key={atalho.comando}
                  type="button"
                  disabled={enviando}
                  onClick={() => void enviar(atalho.comando)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {atalho.rotulo}
                </button>
              ))}
            </div>

            <p role="status" className="min-h-5 text-sm text-gray-600">
              {enviando ? "Processando comando..." : ""}
            </p>

            {erro && (
              <p id="bot-assistente-erro" role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {erro}
              </p>
            )}

            <form onSubmit={enviarFormulario} className="space-y-2">
              <label htmlFor="bot-assistente-mensagem" className="block text-sm font-semibold">Mensagem ou comando</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="bot-assistente-mensagem"
                  type="text"
                  value={mensagem}
                  onChange={(evento) => setMensagem(evento.target.value)}
                  disabled={enviando}
                  autoComplete="off"
                  maxLength={500}
                  placeholder="Ex.: ESTOQUE 12"
                  aria-describedby={`bot-assistente-input-ajuda${erro ? " bot-assistente-erro" : ""}`}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-100"
                />
                <button
                  type="submit"
                  disabled={enviando || !mensagem.trim()}
                  className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {enviando ? "Enviando..." : "Enviar"}
                </button>
              </div>
              <p id="bot-assistente-input-ajuda" className="text-xs text-gray-600">Pressione Enter para enviar. Use os códigos dos itens de estoque.</p>
            </form>
          </div>
        </section>

        <aside className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm" aria-labelledby="bot-comandos-titulo">
          <h2 id="bot-comandos-titulo" className="font-semibold">Comandos de estoque</h2>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="font-semibold">Consultar um item pelo código</dt>
              <dd className="mt-1"><code className="block rounded-lg bg-gray-100 p-2 text-gray-900">ESTOQUE 12</code></dd>
            </div>
            <div>
              <dt className="font-semibold">Adicionar 5 ao item de código 12</dt>
              <dd className="mt-1"><code className="block rounded-lg bg-gray-100 p-2 text-gray-900">ADICIONAR 12 5</code></dd>
            </div>
            <div>
              <dt className="font-semibold">Cadastrar um item de estoque</dt>
              <dd className="mt-1 space-y-2">
                <code className="block whitespace-pre-wrap break-words rounded-lg bg-gray-100 p-2 text-gray-900">CADASTRAR 101; Molho; un; 10; 2</code>
                <p className="text-gray-600">Formato: código; nome; unidade; quantidade inicial; mínimo. Separe os campos com ponto e vírgula.</p>
                <p className="text-gray-600">No exemplo: código 101, nome Molho, unidade un, quantidade inicial 10 e mínimo 2.</p>
              </dd>
            </div>
          </dl>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
            <p className="font-semibold">Alterações em dados reais</p>
            <p className="mt-1">CADASTRAR e ADICIONAR alteram o estoque real da loja neste navegador. Consultas não alteram dados.</p>
          </div>

          <div className="border-t border-gray-200 pt-4 text-sm text-gray-600">
            <h3 className="font-semibold text-gray-900">Apoio ao uso do PDV</h3>
            <p className="mt-1">Use AJUDA para conhecer os comandos ou escreva sua dúvida sobre caixa, relatórios, produtos, delivery, mesas e fotos.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
