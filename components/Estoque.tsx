"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getSessao } from "@/lib/supabase";
import {
  UNIDADES_ESTOQUE,
  EVENTO_ESTOQUE,
  cadastrarItemEstoque,
  chaveEstoque,
  editarItemEstoque,
  formatarQuantidade,
  lerEstoque,
  movimentarEstoque,
} from "@/lib/estoque";
import type { DadosEstoque, ItemEstoque, UnidadeEstoque } from "@/lib/estoque";

type EstadoEstoque = { lojaId: string; dados: DadosEstoque };
type NovoItem = { codigo: string; nome: string; unidade: UnidadeEstoque; quantidade: string; minimo: string };
type AcaoEstoque = {
  lojaId: string;
  codigo: number;
  tipo: "entrada" | "saida" | "editar";
  nome: string;
  minimo: string;
  quantidade: string;
  observacao: string;
};

const CLASSE_CAMPO = "w-full min-h-[42px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50";
const CLASSE_BOTAO = "min-h-[42px] rounded-lg px-4 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

function novoFormulario(): NovoItem {
  return { codigo: "", nome: "", unidade: "un", quantidade: "0", minimo: "0" };
}

function mensagemErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : "Não foi possível concluir a operação. Tente novamente.";
}

function numeroCampo(valor: string, campo: string): number {
  if (!valor.trim() || !Number.isFinite(Number(valor))) throw new Error(`Informe um valor válido para ${campo}.`);
  return Number(valor);
}

function normalizar(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function statusItem(item: ItemEstoque) {
  if (item.saldo <= 0) return { texto: "Sem estoque", classe: "bg-red-50 text-red-700" };
  if (item.saldo <= item.minimo) return { texto: "Estoque baixo", classe: "bg-amber-50 text-amber-800" };
  return { texto: "Disponível", classe: "bg-green-50 text-green-700" };
}

export default function Estoque() {
  const [estado, setEstado] = useState<EstadoEstoque | null>(null);
  const [lojaId, setLojaId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [erroOperacao, setErroOperacao] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState<NovoItem>(novoFormulario);
  const [acao, setAcao] = useState<AcaoEstoque | null>(null);
  const lojaAtual = useRef<string | null>(null);
  const envioEmCurso = useRef(false);
  const montado = useRef(false);
  const campoAcao = useRef<HTMLInputElement>(null);
  const acionadorAcao = useRef<HTMLButtonElement | null>(null);

  const carregar = useCallback((): EstadoEstoque | null => {
    if (!montado.current) return null;
    try {
      const id = getSessao()?.id || null;
      if (lojaAtual.current !== id) {
        lojaAtual.current = id;
        setLojaId(id);
        setAcao(null);
        setNovo(novoFormulario());
        setBusca("");
        setSucesso(null);
        setErroOperacao(null);
      }
      if (!id) throw new Error("Não foi possível identificar a loja. Entre novamente para acessar o estoque.");
      const atualizado = { lojaId: id, dados: lerEstoque(id) };
      setEstado(atualizado);
      setErroLeitura(null);
      return atualizado;
    } catch (erro) {
      setErroLeitura(mensagemErro(erro));
      return null;
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    montado.current = true;
    carregar();
    function aoAtualizar(evento: Event) {
      const id = getSessao()?.id;
      if (id && (evento as CustomEvent<{ lojaId?: string }>).detail?.lojaId === id) carregar();
    }
    function aoStorage(evento: StorageEvent) {
      const id = getSessao()?.id;
      if (id && (evento.key === null || evento.key === chaveEstoque(id))) carregar();
    }
    function aoFocus() {
      carregar();
    }
    window.addEventListener(EVENTO_ESTOQUE, aoAtualizar);
    window.addEventListener("storage", aoStorage);
    window.addEventListener("focus", aoFocus);
    return () => {
      montado.current = false;
      window.removeEventListener(EVENTO_ESTOQUE, aoAtualizar);
      window.removeEventListener("storage", aoStorage);
      window.removeEventListener("focus", aoFocus);
    };
  }, [carregar]);

  useEffect(() => {
    campoAcao.current?.focus();
  }, [acao?.lojaId, acao?.codigo, acao?.tipo]);

  const dados = estado?.lojaId === lojaId ? estado.dados : null;
  const podeAlterar = !!dados && !!lojaId && !carregando && !erroLeitura && !enviando;
  const itemAcao = acao ? dados?.itens.find((item) => item.codigo === acao.codigo) : undefined;
  const resumo = useMemo(() => dados ? {
    cadastrados: dados.itens.length,
    baixos: dados.itens.filter((item) => item.saldo <= item.minimo).length,
    zerados: dados.itens.filter((item) => item.saldo <= 0).length,
  } : null, [dados]);

  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    const unidades = new Map(dados?.itens.map((item) => [item.codigo, item.unidade]));
    const nomes = new Map(dados?.itens.map((item) => [item.codigo, item.nome]));
    const corresponde = (codigo: number, nome: string) => String(codigo).includes(termo) || normalizar(nome).includes(termo);
    return {
      itens: (dados?.itens || []).filter((item) => corresponde(item.codigo, item.nome)).sort((a, b) => a.codigo - b.codigo),
      movimentos: (dados?.movimentos || [])
        .filter((movimento) => corresponde(movimento.codigo, movimento.nome) || corresponde(movimento.codigo, nomes.get(movimento.codigo) || ""))
        .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime()),
      unidades,
    };
  }, [dados, busca]);

  async function executar(
    lojaEsperada: string | null,
    operacao: (id: string) => Promise<string>,
    aoSalvar: () => void
  ) {
    if (envioEmCurso.current) return;
    envioEmCurso.current = true;
    setEnviando(true);
    setErroOperacao(null);
    setSucesso(null);
    try {
      const atual = carregar();
      if (!atual) return;
      if (atual.lojaId !== lojaEsperada) throw new Error("A loja da sessão mudou. Confira os dados e tente novamente.");
      const mensagem = await operacao(atual.lojaId);
      if (!montado.current) return;
      carregar();
      if (lojaAtual.current === atual.lojaId) {
        aoSalvar();
        setSucesso(mensagem);
      }
    } catch (erro) {
      if (montado.current) {
        carregar();
        setErroOperacao(mensagemErro(erro));
      }
    } finally {
      envioEmCurso.current = false;
      if (montado.current) setEnviando(false);
    }
  }

  function cadastrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = { ...novo };
    void executar(lojaId, async (id) => {
      const item = await cadastrarItemEstoque(id, {
        codigo: numeroCampo(formulario.codigo, "o código"),
        nome: formulario.nome,
        unidade: formulario.unidade,
        quantidade: numeroCampo(formulario.quantidade, "o saldo inicial"),
        minimo: numeroCampo(formulario.minimo, "o estoque mínimo"),
      });
      return `Item ${item.nome} (código ${item.codigo}) cadastrado com sucesso.`;
    }, () => setNovo(novoFormulario()));
  }

  function abrirAcao(item: ItemEstoque, tipo: AcaoEstoque["tipo"], botao: HTMLButtonElement) {
    if (envioEmCurso.current) return;
    const atual = carregar();
    if (!atual || atual.lojaId !== lojaId) return;
    const fresco = atual.dados.itens.find((registro) => registro.codigo === item.codigo);
    if (!fresco) {
      setErroOperacao("Este item não está disponível. Confira a lista atualizada.");
      return;
    }
    acionadorAcao.current = botao;
    setErroOperacao(null);
    setSucesso(null);
    setAcao({
      lojaId: atual.lojaId,
      codigo: fresco.codigo,
      tipo,
      nome: fresco.nome,
      minimo: String(fresco.minimo),
      quantidade: "",
      observacao: "",
    });
  }

  function fecharAcao() {
    setAcao(null);
    if (acionadorAcao.current?.isConnected) acionadorAcao.current.focus();
  }

  function salvarAcao(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!acao) return;
    const formulario = { ...acao };
    void executar(formulario.lojaId, async (id) => {
      if (formulario.tipo === "editar") {
        const item = await editarItemEstoque(id, {
          codigo: formulario.codigo,
          nome: formulario.nome,
          minimo: numeroCampo(formulario.minimo, "o estoque mínimo"),
        });
        return `Item ${item.nome} (código ${item.codigo}) atualizado com sucesso.`;
      }
      const item = await movimentarEstoque(id, {
        codigo: formulario.codigo,
        tipo: formulario.tipo,
        quantidade: numeroCampo(formulario.quantidade, "a quantidade"),
        observacao: formulario.observacao,
      });
      return `${formulario.tipo === "entrada" ? "Entrada" : "Saída"} registrada para ${item.nome}. Saldo atual: ${formatarQuantidade(item.saldo)} ${item.unidade}.`;
    }, fecharAcao);
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-gray-50 text-gray-900 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold">Estoque</h1>
          <p className="text-sm text-gray-500 mt-1">Cadastre itens, acompanhe os saldos e registre entradas e saídas.</p>
        </div>
        <button type="button" onClick={carregar} disabled={carregando || enviando} className={`${CLASSE_BOTAO} bg-white border border-gray-200 hover:bg-gray-100`}>
          Atualizar
        </button>
      </header>

      <p className="bg-blue-50 text-blue-800 border border-blue-200 rounded-xl p-4 text-sm mb-4">
        O estoque é salvo localmente por loja, somente neste navegador, como o caixa. Não é sincronizado com outros navegadores ou dispositivos. Não há baixa automática por vendas: registre as saídas manualmente. Disponível no Gerenciamento mesmo com o caixa fechado.
      </p>

      {erroLeitura && (
        <div role="alert" className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 mb-4">
          <p>{erroLeitura}</p>
          <p className="text-sm mt-1">As alterações estão bloqueadas. Nenhum dado foi apagado ou reiniciado. {dados ? "Os dados abaixo são da última leitura bem-sucedida e podem estar desatualizados. " : ""}Use Atualizar para tentar ler novamente.</p>
        </div>
      )}
      {erroOperacao && <p role="alert" className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 mb-4">{erroOperacao}</p>}
      <div role="status" aria-live="polite" aria-atomic="true">
        {sucesso && <p className="bg-green-50 text-green-800 border border-green-200 rounded-xl p-4 mb-4">{sucesso}</p>}
      </div>
      {carregando && <p role="status" className="text-center text-gray-500 py-6">Carregando estoque...</p>}

      <section aria-label="Resumo do estoque" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {[
          { titulo: "Itens cadastrados", valor: resumo?.cadastrados, classe: "text-blue-700", detalhe: "Total de itens diferentes" },
          { titulo: "No mínimo ou abaixo", valor: resumo?.baixos, classe: "text-amber-800", detalhe: "Inclui os itens sem estoque" },
          { titulo: "Sem estoque", valor: resumo?.zerados, classe: "text-red-700", detalhe: "Itens com saldo zerado" },
        ].map((card) => (
          <div key={card.titulo} className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-sm font-bold text-gray-700">{card.titulo}</p>
            <p className={`text-2xl font-extrabold mt-3 ${card.classe}`}>{card.valor ?? "—"}</p>
            <p className="text-xs text-gray-500 mt-2">{card.detalhe}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="estoque-novo-titulo" className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 mb-5">
        <h2 id="estoque-novo-titulo" className="text-lg font-extrabold mb-1">Novo item</h2>
        <p id="estoque-unidade-ajuda" className="text-xs text-gray-500 mb-4">Use quantidades inteiras para un e até três casas decimais nas demais unidades. O saldo inicial maior que zero gera uma entrada no histórico.</p>
        <form onSubmit={cadastrar} aria-labelledby="estoque-novo-titulo" aria-busy={enviando}>
          <fieldset disabled={!podeAlterar} className="min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <legend className="sr-only">Dados do novo item</legend>
            <label className="flex flex-col gap-2 text-xs font-bold text-gray-600">
              Código
              <input type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" inputMode="numeric" required value={novo.codigo} onChange={(e) => setNovo({ ...novo, codigo: e.target.value })} className={CLASSE_CAMPO} />
            </label>
            <label className="flex flex-col gap-2 text-xs font-bold text-gray-600">
              Nome
              <input type="text" required maxLength={120} value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} className={CLASSE_CAMPO} />
            </label>
            <label className="flex flex-col gap-2 text-xs font-bold text-gray-600">
              Unidade
              <select value={novo.unidade} onChange={(e) => setNovo({ ...novo, unidade: e.target.value as UnidadeEstoque })} className={CLASSE_CAMPO}>
                {UNIDADES_ESTOQUE.map((unidade) => <option key={unidade} value={unidade}>{unidade}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-xs font-bold text-gray-600">
              Saldo inicial ({novo.unidade})
              <input type="number" min="0" step={novo.unidade === "un" ? "1" : "0.001"} inputMode={novo.unidade === "un" ? "numeric" : "decimal"} required aria-describedby="estoque-unidade-ajuda" value={novo.quantidade} onChange={(e) => setNovo({ ...novo, quantidade: e.target.value })} className={CLASSE_CAMPO} />
            </label>
            <label className="flex flex-col gap-2 text-xs font-bold text-gray-600">
              Estoque mínimo ({novo.unidade})
              <input type="number" min="0" step={novo.unidade === "un" ? "1" : "0.001"} inputMode={novo.unidade === "un" ? "numeric" : "decimal"} required aria-describedby="estoque-unidade-ajuda" value={novo.minimo} onChange={(e) => setNovo({ ...novo, minimo: e.target.value })} className={CLASSE_CAMPO} />
            </label>
            <div className="flex items-end">
              <button type="submit" className={`${CLASSE_BOTAO} w-full bg-blue-600 text-white hover:bg-blue-700`}>{enviando ? "Salvando..." : "Cadastrar item"}</button>
            </div>
          </fieldset>
        </form>
      </section>

      <section aria-labelledby="estoque-itens-titulo" className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 id="estoque-itens-titulo" className="text-lg font-extrabold">Itens em estoque</h2>
            <p className="text-sm text-gray-500">{dados ? `${filtrados.itens.length} de ${dados.itens.length} itens` : "Aguardando leitura do estoque"}</p>
          </div>
          <label className="flex flex-col gap-2 text-xs font-bold text-gray-600 w-full sm:w-80">
            Buscar por código ou nome
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código ou nome do item" aria-describedby="estoque-busca-ajuda" className={CLASSE_CAMPO} />
            <span id="estoque-busca-ajuda" className="font-normal text-gray-500">Filtra os itens e o histórico de movimentações.</span>
          </label>
        </div>

        {acao && (
          <section aria-labelledby="estoque-acao-titulo" className="bg-white rounded-2xl border border-blue-200 p-4 sm:p-5 mb-4">
            <h3 id="estoque-acao-titulo" className="text-lg font-extrabold">{acao.tipo === "editar" ? "Editar item" : acao.tipo === "entrada" ? "Entrada de estoque" : "Saída de estoque"}</h3>
            <p id="estoque-acao-ajuda" className="text-sm text-gray-600 mt-1 mb-4">
              Código {acao.codigo} · {itemAcao?.nome || acao.nome}{itemAcao ? ` · Saldo atual: ${formatarQuantidade(itemAcao.saldo)} ${itemAcao.unidade} · Mínimo: ${formatarQuantidade(itemAcao.minimo)} ${itemAcao.unidade}` : " · Item indisponível"}
              {acao.tipo === "editar" ? ". Código, unidade e saldo são preservados." : ". Use quantidades inteiras para un e até três casas decimais nas demais unidades."}
            </p>
            <form onSubmit={salvarAcao} aria-labelledby="estoque-acao-titulo" aria-busy={enviando}>
              <fieldset disabled={!podeAlterar || !itemAcao} className="min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <legend className="sr-only">{acao.tipo === "editar" ? "Alterar nome e mínimo" : "Registrar movimentação"}</legend>
                {acao.tipo === "editar" ? (
                  <>
                    <label className="flex flex-col gap-2 text-xs font-bold text-gray-600">
                      Nome
                      <input ref={campoAcao} type="text" required maxLength={120} value={acao.nome} onChange={(e) => setAcao({ ...acao, nome: e.target.value })} className={CLASSE_CAMPO} />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-bold text-gray-600">
                      Estoque mínimo ({itemAcao?.unidade})
                      <input type="number" min="0" step={itemAcao?.unidade === "un" ? "1" : "0.001"} inputMode={itemAcao?.unidade === "un" ? "numeric" : "decimal"} required aria-describedby="estoque-acao-ajuda" value={acao.minimo} onChange={(e) => setAcao({ ...acao, minimo: e.target.value })} className={CLASSE_CAMPO} />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="flex flex-col gap-2 text-xs font-bold text-gray-600">
                      Quantidade ({itemAcao?.unidade})
                      <input ref={campoAcao} type="number" min={itemAcao?.unidade === "un" ? "1" : "0.001"} max={acao.tipo === "saida" ? itemAcao?.saldo : undefined} step={itemAcao?.unidade === "un" ? "1" : "0.001"} inputMode={itemAcao?.unidade === "un" ? "numeric" : "decimal"} required aria-describedby="estoque-acao-ajuda" value={acao.quantidade} onChange={(e) => setAcao({ ...acao, quantidade: e.target.value })} className={CLASSE_CAMPO} />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-bold text-gray-600">
                      Observação (opcional)
                      <textarea rows={2} maxLength={200} value={acao.observacao} onChange={(e) => setAcao({ ...acao, observacao: e.target.value })} className={CLASSE_CAMPO} />
                    </label>
                  </>
                )}
                <button type="submit" className={`${CLASSE_BOTAO} bg-blue-600 text-white hover:bg-blue-700 sm:col-span-2 sm:justify-self-start`}>
                  {enviando ? "Salvando..." : acao.tipo === "editar" ? "Salvar alterações" : acao.tipo === "entrada" ? "Registrar entrada" : "Registrar saída"}
                </button>
              </fieldset>
            </form>
            <button type="button" onClick={fecharAcao} disabled={enviando} className={`${CLASSE_BOTAO} mt-3 border border-gray-200 bg-white hover:bg-gray-50`}>Cancelar</button>
          </section>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto" role="region" aria-label="Tabela de itens em estoque" tabIndex={0}>
          {!dados ? <p className="px-4 py-8 text-center text-sm text-gray-500">{carregando ? "Carregando itens..." : "Estoque indisponível. Resolva o erro de leitura e tente atualizar."}</p> : filtrados.itens.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">{dados.itens.length === 0 ? "Nenhum item cadastrado. Use o formulário Novo item para começar." : "Nenhum item encontrado para esta busca."}</p>
          ) : (
            <table className="w-full text-sm whitespace-nowrap">
              <caption className="sr-only">Itens, unidades, saldos, mínimos e ações de estoque</caption>
              <thead className="bg-gray-50 text-gray-600 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3">Código</th>
                  <th scope="col" className="px-4 py-3">Nome</th>
                  <th scope="col" className="px-4 py-3">Unidade</th>
                  <th scope="col" className="px-4 py-3 text-right">Saldo</th>
                  <th scope="col" className="px-4 py-3 text-right">Mínimo</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtrados.itens.map((item) => {
                  const status = statusItem(item);
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono">{item.codigo}</td>
                      <th scope="row" className="px-4 py-3 text-left font-semibold whitespace-normal min-w-[160px]">{item.nome}</th>
                      <td className="px-4 py-3 text-gray-600">{item.unidade}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatarQuantidade(item.saldo)} {item.unidade}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatarQuantidade(item.minimo)} {item.unidade}</td>
                      <td className="px-4 py-3"><span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${status.classe}`}>{status.texto}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {([{ tipo: "entrada", texto: "Entrada", classe: "text-green-700 hover:bg-green-50" }, { tipo: "saida", texto: "Saída", classe: "text-red-700 hover:bg-red-50" }, { tipo: "editar", texto: "Editar", classe: "text-blue-700 hover:bg-blue-50" }] as const).map((botao) => (
                            <button key={botao.tipo} type="button" disabled={!podeAlterar || (botao.tipo === "saida" && item.saldo <= 0)} aria-label={`${botao.texto} para ${item.nome}, código ${item.codigo}`} onClick={(e) => abrirAcao(item, botao.tipo, e.currentTarget)} className={`${CLASSE_BOTAO} border border-gray-200 ${botao.classe}`}>{botao.texto}</button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section aria-labelledby="estoque-historico-titulo">
        <h2 id="estoque-historico-titulo" className="text-lg font-extrabold">Histórico de movimentações</h2>
        <p className="text-sm text-gray-500 mt-1 mb-3">{dados ? `${filtrados.movimentos.length} de ${dados.movimentos.length} movimentações · Mais recentes primeiro · Horário local` : "Aguardando leitura do histórico"}</p>
        <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto" role="region" aria-label="Tabela do histórico de movimentações" tabIndex={0}>
          {!dados ? <p className="px-4 py-8 text-center text-sm text-gray-500">{carregando ? "Carregando histórico..." : "Histórico indisponível. Tente atualizar após resolver o erro de leitura."}</p> : filtrados.movimentos.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">{dados.movimentos.length === 0 ? "Nenhuma movimentação registrada. As entradas e saídas aparecerão aqui." : "Nenhuma movimentação encontrada para esta busca."}</p>
          ) : (
            <table className="w-full text-sm whitespace-nowrap">
              <caption className="sr-only">Histórico completo de entradas e saídas filtrado pela busca</caption>
              <thead className="bg-gray-50 text-gray-600 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3">Data e hora</th>
                  <th scope="col" className="px-4 py-3">Código</th>
                  <th scope="col" className="px-4 py-3">Item</th>
                  <th scope="col" className="px-4 py-3">Tipo</th>
                  <th scope="col" className="px-4 py-3 text-right">Quantidade</th>
                  <th scope="col" className="px-4 py-3 text-right">Saldo anterior</th>
                  <th scope="col" className="px-4 py-3 text-right">Saldo atual</th>
                  <th scope="col" className="px-4 py-3">Origem</th>
                  <th scope="col" className="px-4 py-3">Observação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtrados.movimentos.map((movimento) => {
                  const unidade = filtrados.unidades.get(movimento.codigo) || "";
                  return (
                    <tr key={movimento.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500"><time dateTime={movimento.criadoEm}>{new Date(movimento.criadoEm).toLocaleString("pt-BR")}</time></td>
                      <td className="px-4 py-3 font-mono">{movimento.codigo}</td>
                      <td className="px-4 py-3 whitespace-normal min-w-[160px]">{movimento.nome}</td>
                      <td className="px-4 py-3"><span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${movimento.tipo === "entrada" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{movimento.tipo === "entrada" ? "Entrada" : "Saída"}</span></td>
                      <td className="px-4 py-3 text-right font-semibold">{formatarQuantidade(movimento.quantidade)} {unidade}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatarQuantidade(movimento.saldoAnterior)} {unidade}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatarQuantidade(movimento.saldoAtual)} {unidade}</td>
                      <td className="px-4 py-3 text-gray-600">{movimento.origem}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-normal min-w-[180px]">{movimento.observacao || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
