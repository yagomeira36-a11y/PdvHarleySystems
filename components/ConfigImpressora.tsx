"use client";

import { useEffect, useRef, useState } from "react";
import { getSessao } from "@/lib/supabase";
import type { Configuracao } from "@/lib/supabase";
import { IMPRESSORA_PADRAO, dadosTesteImpressao, lerImpressora, salvarImpressora } from "@/lib/impressao";
import type { ConfigImpressora as PreferenciasImpressora } from "@/lib/impressao";
import { conectarQz, estadoQz, imprimirDadosQz, observarQz, problemaImpressora, verificarImpressoras } from "@/lib/qz";

type Operacao = "conectar" | "status" | "teste";
const destinos: { campo: "impressoraCliente" | "impressoraCozinha"; id: string; titulo: string }[] = [
  { campo: "impressoraCliente", id: "printerClient", titulo: "Cliente — comprovante não fiscal" },
  { campo: "impressoraCozinha", id: "printerKitchen", titulo: "Cozinha — comanda" },
];

function Spinner() {
  return <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export default function ConfigImpressora({ empresa }: { empresa: Configuracao | null }) {
  const [config, setConfig] = useState<PreferenciasImpressora>({ ...IMPRESSORA_PADRAO });
  const [qz, setQz] = useState(estadoQz);
  const [operacao, setOperacao] = useState<Operacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState("");
  const trava = useRef(false);
  const montado = useRef(false);
  const lojaId = useRef<string | null>(null);
  const ocupado = operacao !== null || qz.conectando;
  const selecionadas = !!config.impressoraCliente && !!config.impressoraCozinha;

  useEffect(() => {
    montado.current = true;
    const pararObservacao = observarQz(() => setQz(estadoQz()));
    setQz(estadoQz());
    try {
      const sessao = getSessao();
      if (!sessao) throw new Error("Sessão da loja não encontrada. Entre novamente no sistema.");
      lojaId.current = sessao.id;
      setConfig(lerImpressora(sessao.id));
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível ler as impressoras desta loja.");
    }
    return () => {
      montado.current = false;
      pararObservacao();
    };
  }, []);

  function conferirLoja() {
    const sessao = getSessao();
    if (!sessao || sessao.id !== lojaId.current) {
      throw new Error("A sessão da loja mudou ou não está disponível. Reabra as Configurações antes de continuar.");
    }
    return sessao.id;
  }

  function alterarConfig(novo: Partial<PreferenciasImpressora>) {
    setConfig((anterior) => ({ ...anterior, ...novo }));
    setErro(null);
    setMensagem("");
  }

  function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    if (trava.current || estadoQz().conectando) return;
    setErro(null);
    setMensagem("");
    try {
      salvarImpressora(conferirLoja(), config);
      setMensagem("Impressoras salvas para esta loja neste navegador. Salvar não confirma conexão nem saída física do papel.");
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível salvar as impressoras.");
    }
  }

  async function executar(acao: Operacao) {
    if (trava.current || estadoQz().conectando) return;
    trava.current = true;
    setOperacao(acao);
    setErro(null);
    setMensagem("");
    try {
      conferirLoja();
      let resultado: string;
      if (acao === "teste") {
        resultado = await imprimirDadosQz(dadosTesteImpressao(empresa), config);
      } else {
        await conectarQz();
        conferirLoja();
        if (selecionadas) {
          await verificarImpressoras(config);
          resultado = "QZ conectado. Lista de filas atualizada e consulta ao driver solicitada. Confira os estados abaixo; isso não confirma a saída física do papel.";
        } else {
          resultado = "QZ conectado. Selecione as filas do cliente e da cozinha e clique em Atualizar status. É permitido usar a mesma fila nas duas opções.";
        }
      }
      if (montado.current) setMensagem(resultado);
    } catch (falha) {
      if (montado.current) {
        setErro(falha instanceof Error ? falha.message : "Falha na comunicação com o QZ Tray. Confira se ele está aberto e autorize a operação quando solicitado.");
      }
    } finally {
      trava.current = false;
      if (montado.current) setOperacao(null);
    }
  }

  return (
    <section aria-labelledby="config-impressora-titulo" className="rounded-xl bg-white p-4">
      <h2 id="config-impressora-titulo" className="text-lg font-bold">Impressora do PDV</h2>
      <p className="mt-1 text-sm text-gray-600">Impressão direta pelo QZ Tray. Preferências salvas por loja neste navegador.</p>
      <div className="my-3 flex flex-wrap gap-2 text-xs font-semibold text-gray-600">
        <span className="rounded-lg bg-gray-100 px-3 py-2">Bobina fixa: 80 mm</span>
        <span className="rounded-lg bg-gray-100 px-3 py-2">1 comprovante + 1 comanda</span>
        <span className="rounded-lg bg-gray-100 px-3 py-2">Corte após cada via</span>
      </div>

      <ol className="my-3 list-inside list-decimal space-y-1 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
        <li>Instale e mantenha o <a href="https://qz.io/download/" target="_blank" rel="noopener noreferrer" className="font-semibold underline">QZ Tray aberto neste computador</a>.</li>
        <li>Instale o driver da impressora no Windows: fila compatível com RAW ESC/POS, bobina de 80 mm e equipamento com guilhotina para o corte.</li>
        <li>Clique em Conectar impressora, autorize no QZ quando solicitado e selecione as filas reais abaixo. Cliente e cozinha podem usar a mesma impressora.</li>
      </ol>
      <p className="mb-2 text-xs text-gray-600">Em impressoras térmicas, o envio é direto, sem janela de impressão do navegador. O teste envia duas vias reais; confira papel e guilhotina antes de iniciá-lo.</p>
      <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Para testar em arquivo, use a fila “Termica Texto” com driver Generic / Text Only e porta FILE:. O Windows solicitará o nome do arquivo .prn. Microsoft Print to PDF e XPS não aceitam este cupom ESC/POS e podem gerar arquivos vazios.</p>

      <div className="mb-4 rounded-lg border border-gray-200 p-3">
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-semibold">
          {qz.conectando && <Spinner />}
          {qz.conectando ? "Conectando ao QZ Tray…" : qz.conectado ? "QZ conectado" : "Desconectado do QZ Tray"}
        </p>
        <p className="mt-1 text-xs text-gray-600">A conexão é com o QZ, não uma confirmação de que a impressora está ligada ou com papel.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={ocupado} onClick={() => executar("conectar")} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40">
            {operacao === "conectar" && <Spinner />}
            {operacao === "conectar" ? "Conectando…" : "Conectar impressora"}
          </button>
          <button type="button" disabled={ocupado} onClick={() => executar("status")} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-100 disabled:opacity-40">
            {operacao === "status" && <Spinner />}
            {operacao === "status" ? "Atualizando…" : "Atualizar status"}
          </button>
        </div>
        {qz.conectado && (
          <div role={qz.assinatura ? "status" : "alert"} className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            <p className="font-semibold">{qz.assinatura ? "Assinatura configurada no servidor" : "Sem assinatura configurada"}</p>
            <p>{qz.mensagemAssinatura}</p>
            <p className="mt-1">{qz.assinatura ? "Operação silenciosa depende de o certificado ser confiável no QZ deste computador. A configuração não comprova essa autorização." : "O QZ pode solicitar autorização a cada operação, inclusive ao listar filas, consultar status e imprimir. Essas solicitações são do QZ, não do Windows."}</p>
          </div>
        )}
      </div>

      {erro && <p role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      {mensagem && <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{mensagem}</p>}
      {operacao === "teste" && <p role="status" className="mb-3 flex items-center gap-2 text-sm"><Spinner />Enviando comprovante e comanda de teste. Não inicie outro teste enquanto aguarda.</p>}
      {qz.conectado && qz.impressoras.length === 0 && <p role="status" className="mb-3 text-sm text-gray-600">Nenhuma fila foi listada pelo QZ. Confira o driver no Windows e clique em Atualizar status.</p>}

      <form onSubmit={salvar}>
        <fieldset disabled={ocupado} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="sr-only">Preferências de impressão ESC/POS</legend>
          {destinos.map((destino) => {
            const nome = config[destino.campo];
            const indisponivel = !!nome && qz.impressoras.indexOf(nome) === -1;
            return (
              <label key={destino.campo} htmlFor={destino.id} className="min-w-0 text-sm font-semibold">{destino.titulo}
                <select id={destino.id} name={destino.id} value={nome} onChange={(evento) => alterarConfig({ [destino.campo]: evento.target.value })} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 disabled:opacity-50" required>
                  <option value="">{qz.conectado ? "Selecione uma impressora" : "Conecte para listar impressoras"}</option>
                  {indisponivel && <option value={nome} disabled>{nome} — indisponível na lista atual</option>}
                  {qz.impressoras.map((impressora) => <option key={impressora} value={impressora}>{impressora}</option>)}
                </select>
              </label>
            );
          })}
          <p className="text-xs text-gray-600 sm:col-span-2">Os nomes são os retornados pelo QZ. Uma seleção salva ausente da lista é preservada, mas precisa ser verificada antes de imprimir.</p>
          <label htmlFor="impressora-colunas" className="text-sm font-semibold">Colunas em 80 mm
            <select id="impressora-colunas" value={config.colunas} onChange={(evento) => alterarConfig({ colunas: Number(evento.target.value) as 42 | 48 })} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
              <option value={42}>42 colunas</option>
              <option value={48}>48 colunas</option>
            </select>
          </label>
          <label htmlFor="impressora-codigo" className="text-sm font-semibold">Página de código ESC/POS
            <select id="impressora-codigo" value={config.paginaCodigo} onChange={(evento) => alterarConfig({ paginaCodigo: Number(evento.target.value) as 2 | 3 | 19 })} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
              <option value={2}>2 — CP850</option>
              <option value={3}>3 — CP860</option>
              <option value={19}>19 — CP858</option>
            </select>
          </label>
          <label htmlFor="impressora-rodape" className="text-sm font-semibold sm:col-span-2">Rodapé do comprovante
            <textarea id="impressora-rodape" maxLength={200} rows={2} value={config.rodape} onChange={(evento) => alterarConfig({ rodape: evento.target.value })} aria-describedby="impressora-rodape-limite" className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2" />
            <span id="impressora-rodape-limite" className="mt-1 block text-xs font-normal text-gray-600">{config.rodape.length}/200 caracteres. Confira a acentuação no teste conforme o manual da impressora.</span>
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" className="rounded-lg bg-green-700 px-5 py-2 text-sm font-bold text-white hover:bg-green-800 disabled:opacity-40">Salvar impressoras</button>
            <button type="button" disabled={!selecionadas || ocupado} onClick={() => executar("teste")} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40">
              {operacao === "teste" && <Spinner />}
              {operacao === "teste" ? "Imprimindo teste…" : "Testar impressão"}
            </button>
          </div>
        </fieldset>
      </form>
      <p className="mt-3 text-xs text-gray-600">Selecione as duas filas para testar. O teste usa as opções acima, mesmo antes de salvar: 1 comprovante e 1 comanda, com corte em cada via. Não cria venda nem grava dados no Supabase. Salve as preferências para os pedidos reais.</p>

      <div className="mt-4 space-y-2 rounded-lg bg-gray-100 p-3">
        <h3 className="text-sm font-semibold">Estado informado pelo driver</h3>
        {destinos.map((destino) => {
          const nome = config[destino.campo];
          const evento = qz.conectado && qz.impressoras.indexOf(nome) !== -1 ? qz.eventos[nome] : undefined;
          const detalhe = qz.detalhes.find((impressora) => impressora.name === nome);
          const problema = qz.conectado ? problemaImpressora(nome) : null;
          return (
            <div key={destino.campo} role={problema ? "alert" : "status"} className="break-words text-sm">
              <p className="font-semibold">{destino.titulo}{nome ? `: ${nome}` : ""}</p>
              {detalhe && <p>Driver: {detalhe.driver || "não informado pelo QZ"}{detalhe.connection ? ` · Conexão: ${detalhe.connection}` : ""}</p>}
              {problema && <p className="font-semibold text-red-800">{problema}</p>}
              <p>{!nome ? "Nenhuma fila selecionada." : !qz.conectado ? "Conecte ao QZ para consultar esta fila." : qz.impressoras.indexOf(nome) === -1 ? "Fila indisponível na lista do QZ. Confira o driver e a seleção." : evento ? `Driver: ${evento.statusText || evento.message || "Evento sem descrição"}${evento.severity ? ` (${evento.severity})` : ""}.` : "Fila listada; sem evento de estado do driver. Clique em Atualizar status."}</p>
              {evento && evento.statusText && evento.message && evento.message !== evento.statusText && <p>{evento.message}</p>}
            </div>
          );
        })}
        {qz.conectado && qz.avisoStatus && <p role="alert" className="text-sm">{qz.avisoStatus}</p>}
        <p className="text-xs text-gray-600">Eventos do driver podem ser incompletos ou atrasados. Fila listada e envio aceito não garantem saída física: confira as duas vias e os cortes no equipamento.</p>
      </div>

      <details className="mt-4 rounded-lg border border-gray-200 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Instalação silenciosa</summary>
        <div className="mt-3 space-y-2 break-words text-gray-600">
          <p>Para impressão sem solicitações de autorização, é necessário assinar as operações e ter um certificado QZ_TRAY confiável no QZ Tray deste computador. Um certificado de demonstração gerado pelo Site Manager serve somente para o PC em que foi gerado; para produção, use um certificado QZ adequado.</p>
          <ol className="list-inside list-decimal space-y-2">
            <li>Consulte a <a href="https://qz.io/docs/signing" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 underline">documentação oficial de assinatura QZ</a> e providencie o certificado e a chave correspondente.</li>
            <li>Configure exclusivamente no SERVER do PDV as variáveis <code>QZ_CERTIFICATE_PATH</code> (caminho do certificado), <code>QZ_PRIVATE_KEY_PATH</code> (caminho da chave privada) e <code>QZ_ALLOWED_PRINTERS</code> (array JSON com os nomes exatos das filas selecionadas, respeitando espaços e maiúsculas). Se ambas as vias usam a mesma fila, basta um nome no array.</li>
            <li>Reinicie o servidor do PDV e conecte novamente para consultar a configuração de assinatura.</li>
          </ol>
          {selecionadas && (
            <div>
              <p>Array JSON das seleções atuais para QZ_ALLOWED_PRINTERS (confira os nomes na lista do QZ):</p>
              <code className="mt-1 block whitespace-pre-wrap break-all rounded bg-gray-100 p-2">{JSON.stringify(config.impressoraCliente === config.impressoraCozinha ? [config.impressoraCliente] : [config.impressoraCliente, config.impressoraCozinha])}</code>
            </div>
          )}
          <p>Nunca coloque a chave privada no navegador, na pasta public ou em variáveis NEXT_PUBLIC_. Sem assinatura confiável, a autorização do QZ pode aparecer por operação.</p>
          <p>Esta tela não instala programas, não altera a confiança de certificados nem autorizações e não afirma que o computador já está instalado ou autorizado.</p>
        </div>
      </details>
    </section>
  );
}
