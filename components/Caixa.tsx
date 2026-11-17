"use client";

// ============================================================
// TELA CAIXA
// Abrir/fechar o caixa, resumo das vendas da sessão, pedidos
// do expediente (editáveis) e histórico de caixas fechados
// (reabrir restaura as vendas do expediente).
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  rotuloPedido,
  Order,
  OrderItem,
  Product,
  Entrega,
  Motoboy,
  Configuracao,
} from "@/lib/supabase";
import {
  Caixa,
  lerCaixas,
  salvarCaixas,
  caixaAberto,
  caixaReaberto,
  formatarDataHora,
  chaveCaixas,
  caixaEstaAberto,
  MENSAGEM_CAIXA_FECHADO,
  pedidosDoCaixa,
  resumirMovimentoCaixa,
} from "@/lib/caixa";
import EditarPedidoModal, { ItemEdit } from "./EditarPedidoModal";
import ImpressaoPedido from "./ImpressaoPedido";
import { lerImpressora } from "@/lib/impressao";
import type { DadosExtrato } from "@/lib/impressao";
import { imprimirExtratoQz } from "@/lib/qz";

export default function TelaCaixa({ refreshKey }: { refreshKey: number }) {
  const supabase = getSupabase();

  // Dados do banco (pedidos e itens para calcular as vendas)
  const [pedidos, setPedidos] = useState<Order[]>([]);
  const [itens, setItens] = useState<OrderItem[]>([]);
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]);
  const [empresa, setEmpresa] = useState<Pick<Configuracao, "nome_empresa" | "cnpj" | "telefone" | "endereco"> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  // Extrato do caixa (impressão em bobina via QZ Tray)
  const [extratoAberto, setExtratoAberto] = useState(false);
  const [extratoConfirmado, setExtratoConfirmado] = useState(false);
  const [extratoEnviando, setExtratoEnviando] = useState(false);
  const [extratoErro, setExtratoErro] = useState("");
  const [extratoMensagem, setExtratoMensagem] = useState("");
  const dialogoExtrato = useRef<HTMLDialogElement>(null);
  const extratoEmCurso = useRef(false);

  // ============================================================
  // CONTROLE DO CAIXA (abrir / fechar / histórico / editar)
  // ============================================================
  const [caixas, setCaixas] = useState<Caixa[]>([]); // sessões salvas
  const [fundo, setFundo] = useState(""); // troco inicial ao abrir
  const [fechando, setFechando] = useState(false); // mostra o form de fechar
  const [dinheiro, setDinheiro] = useState(""); // valor conferido no fechamento
  const [obsFechamento, setObsFechamento] = useState(""); // obs do fechamento
  const [editandoId, setEditandoId] = useState<string | null>(null); // caixa em edição
  const [editFundo, setEditFundo] = useState(""); // fundo na edição
  const [editVendas, setEditVendas] = useState(""); // vendas na edição
  const [editDinheiro, setEditDinheiro] = useState(""); // dinheiro na edição
  const [editObs, setEditObs] = useState(""); // obs na edição

  // Edição de pedido do expediente (modal compartilhado)
  const [pedidoEditando, setPedidoEditando] = useState<Order | null>(null);
  const [itensEditando, setItensEditando] = useState<ItemEdit[]>([]);

  // ============================================================
  // CARREGAR DADOS
  // ============================================================
  async function carregar() {
    setCarregando(true);
    setErroCarregamento(null);
    try {
      const sessao = getSessao();
      if (!supabase || !sessao) throw new Error("Não foi possível acessar os dados da loja. Entre novamente no sistema.");
      setCaixas(lerCaixas(sessao.id));
      const buscarTodos = async (tabela: string) => {
        const linhas: unknown[] = [];
        for (let inicio = 0; ; inicio += 1000) {
          const { data, error } = await supabase.from(tabela).select("*").eq("loja_id", sessao.id).order("id").range(inicio, inicio + 999);
          if (error) throw new Error(error.message);
          linhas.push(...(data || []));
          if (!data || data.length < 1000) return linhas;
        }
      };
      const [peds, itensPedidos, listaProdutos, listaEntregas, listaMotoboys, resEmpresa] = await Promise.all([
        buscarTodos("orders"),
        buscarTodos("order_items"),
        buscarTodos("products"),
        buscarTodos("entregas"),
        buscarTodos("motoboys"),
        supabase.from("configuracoes").select("*").eq("loja_id", sessao.id).maybeSingle(),
      ]);
      setPedidos(peds as Order[]);
      setItens(itensPedidos as OrderItem[]);
      setProdutos((listaProdutos as Product[]).sort((a, b) => a.code - b.code));
      setEntregas(listaEntregas as Entrega[]);
      setMotoboys(listaMotoboys as Motoboy[]);
      setEmpresa((resEmpresa.data as Configuracao | null) ?? null);
    } catch (erro) {
      setErroCarregamento(erro instanceof Error ? erro.message : "Não foi possível carregar o resumo do caixa.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    function atualizarCaixas() {
      const sessao = getSessao();
      if (!sessao) return;
      const atuais = lerCaixas(sessao.id);
      setCaixas(atuais);
      if (!caixaAberto(atuais)) {
        setPedidoEditando(null);
        setFechando(false);
      }
    }
    function aoStorage(e: StorageEvent) {
      const sessao = getSessao();
      if (sessao && (e.key === null || e.key === chaveCaixas(sessao.id))) {
        atualizarCaixas();
      }
    }
    atualizarCaixas();
    window.addEventListener("pdv-caixa-atualizado", atualizarCaixas);
    window.addEventListener("storage", aoStorage);
    window.addEventListener("focus", atualizarCaixas);
    return () => {
      window.removeEventListener("pdv-caixa-atualizado", atualizarCaixas);
      window.removeEventListener("storage", aoStorage);
      window.removeEventListener("focus", atualizarCaixas);
    };
  }, []);

  // ============================================================
  // CÁLCULOS DO CAIXA E LUCRO
  // ============================================================
  const resumo = useMemo(() => {
    // O caixa conta SÓ os pedidos do caixa ABERTO.
    // Caixa reaberto: restaura o valor de vendas salvo no fechamento
    // e soma os pedidos novos (criados depois da reabertura).
    // Com o caixa fechado, tudo fica zerado.
    const aberto = caixaAberto(caixas);
    const reaberto = aberto && caixaReaberto(aberto) ? aberto : null;
    const inicioNovos = aberto
      ? new Date(reaberto ? (aberto.reabertoEm as string) : aberto.abertoEm).getTime()
      : null;

    const periodo = pedidosDoCaixa(pedidos, aberto);
    const detalhes = resumirMovimentoCaixa(periodo, entregas, motoboys);
    const validos = periodo.filter((o) => o.status !== "cancelado" && inicioNovos !== null && new Date(o.created_at).getTime() >= inicioNovos);
    const expediente = reaberto && aberto
      ? periodo.filter((o) => o.status !== "cancelado" && new Date(o.created_at).getTime() <= new Date(aberto.fechadoEm as string).getTime())
      : [];

    // Soma dos totais (reaberto = soma dos pedidos do expediente,
    // ou o valor salvo se não houver pedidos no período)
    const somaExpediente = expediente.reduce((s, o) => s + Number(o.total), 0);
    const baseVendas = reaberto
      ? periodo.some((o) => new Date(o.created_at).getTime() <= new Date(reaberto.fechadoEm as string).getTime())
        ? somaExpediente
        : (aberto?.vendas ?? 0)
      : 0;
    const caixaHoje =
      baseVendas + validos.reduce((s, o) => s + Number(o.total), 0);
    const caixaGeral = caixaHoje;

    // Lucro = (preço - custo) x quantidade de cada item vendido
    const lucroDe = (ordens: Order[]) => {
      const ids = new Set(ordens.map((o) => o.id));
      return itens
        .filter((i) => ids.has(i.order_id))
        .reduce((s, i) => s + (Number(i.price) - Number(i.cost)) * i.qty, 0);
    };
    const lucroHoje = reaberto
      ? lucroDe(expediente) + lucroDe(validos)
      : lucroDe(validos);
    const lucroGeral = lucroHoje;

    // Resumo por tipo de venda (expediente + pedidos novos)
    const todos = reaberto ? [...expediente, ...validos] : validos;
    const balcao = todos.filter((o) => o.type === "balcao");
    const delivery = todos.filter((o) => o.type === "delivery");
    const mesa = todos.filter((o) => o.type === "mesa");
    const taxasHoje = delivery.reduce((s, o) => s + Number(o.delivery_fee), 0);

    return {
      ...detalhes,
      caixaHoje,
      caixaGeral,
      lucroHoje,
      lucroGeral,
      pedidosHoje: todos.length,
      balcaoQtd: balcao.length,
      deliveryQtd: delivery.length,
      mesaQtd: mesa.length,
      balcaoTotal: balcao.reduce((s, o) => s + Number(o.total), 0),
      deliveryTotal: delivery.reduce((s, o) => s + Number(o.total), 0),
      mesaTotal: mesa.reduce((s, o) => s + Number(o.total), 0),
      taxasHoje,
      margemHoje: caixaHoje > 0 ? (lucroHoje / caixaHoje) * 100 : 0,
      // Pedidos do expediente em ordem de hora (para a lista/edição)
      expediente: [...todos].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
      reaberto: Boolean(reaberto),
    };
  }, [pedidos, itens, caixas, entregas, motoboys]);

  // ============================================================
  // VENDAS DE UM PERÍODO DE CAIXA (pedidos não cancelados)
  // Usado só para caixas ANTIGOS que não têm o valor salvo
  // ============================================================
  function vendasDoPeriodo(c: Caixa): number {
    const inicio = new Date(c.abertoEm).getTime();
    const fim = c.fechadoEm ? new Date(c.fechadoEm).getTime() : Date.now();
    return pedidos
      .filter((o) => {
        if (o.status === "cancelado") return false;
        const t = new Date(o.created_at).getTime();
        return t >= inicio && t <= fim;
      })
      .reduce((s, o) => s + Number(o.total), 0);
  }

  // ============================================================
  // VENDAS DO CAIXA ATUAL (pedidos desde a abertura, não cancelados)
  // Este valor é SALVO no caixa na hora de fechar
  // ============================================================
  function vendasSessao(): number {
    return resumo.caixaHoje;
  }

  // ============================================================
  // ABRIR CAIXA (um por vez — começa com vendas zeradas)
  // ============================================================
  function abrirCaixa() {
    const sessao = getSessao();
    if (!sessao) return;
    const atuais = lerCaixas(sessao.id);
    if (caixaAberto(atuais)) {
      setMensagem("Já existe um caixa aberto. Feche ele primeiro.");
      return;
    }
    const novo: Caixa = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Date.now()),
      abertoEm: new Date().toISOString(),
      fechadoEm: null,
      fundo: parseFloat(fundo.replace(",", ".")) || 0,
      vendas: null,
      dinheiro: null,
      obs: "",
    };
    const lista = [novo, ...atuais];
    setCaixas(lista);
    salvarCaixas(sessao.id, lista);
    setFundo("");
    setFechando(false);
    setMensagem("Caixa aberto!");
  }

  // ============================================================
  // FECHAR CAIXA (salva as vendas da sessão, o dinheiro e a obs)
  // ============================================================
  function fecharCaixa() {
    const sessao = getSessao();
    if (!sessao) return;
    const atuais = lerCaixas(sessao.id);
    const aberto = caixaAberto(atuais);
    if (!aberto) {
      setCaixas(atuais);
      setMensagem("Nenhum caixa aberto.");
      return;
    }
    if (aberto.id !== caixaAberto(caixas)?.id) {
      setCaixas(atuais);
      setFechando(false);
      setMensagem("O caixa foi alterado em outra aba. Confira os valores antes de fechar.");
      return;
    }
    const lista = atuais.map((c) =>
      c.id === aberto.id
        ? {
            ...c,
            fechadoEm: new Date().toISOString(),
            vendas: vendasSessao(), // valor das vendas do caixa fica salvo
            dinheiro: parseFloat(dinheiro.replace(",", ".")) || 0,
            obs: obsFechamento.trim(),
          }
        : c
    );
    setCaixas(lista);
    salvarCaixas(sessao.id, lista);
    setFechando(false);
    setDinheiro("");
    setObsFechamento("");
    setMensagem("Caixa fechado e salvo!");
  }

  // ============================================================
  // SALVAR EDIÇÃO DE UM CAIXA FECHADO
  // ============================================================
  function salvarEdicao(c: Caixa) {
    const sessao = getSessao();
    if (!sessao) return;
    const lista = lerCaixas(sessao.id).map((x) =>
      x.id === c.id
        ? {
            ...x,
            fundo: parseFloat(editFundo.replace(",", ".")) || 0,
            vendas: parseFloat(editVendas.replace(",", ".")) || 0,
            dinheiro: parseFloat(editDinheiro.replace(",", ".")) || 0,
            obs: editObs.trim(),
          }
        : x
    );
    setCaixas(lista);
    salvarCaixas(sessao.id, lista);
    setEditandoId(null);
    setMensagem("Caixa editado e salvo!");
  }

  // ============================================================
  // REABRIR UM CAIXA FECHADO — restaura o valor de vendas do
  // expediente e soma os pedidos novos em cima dele
  // ============================================================
  function reabrirCaixa(c: Caixa) {
    const sessao = getSessao();
    if (!sessao) return;
    const atuais = lerCaixas(sessao.id);
    if (caixaAberto(atuais)) {
      setMensagem("Já existe um caixa aberto. Feche ele primeiro.");
      return;
    }
    const lista = lerCaixas(sessao.id).map((x) =>
      x.id === c.id
        ? {
            ...x,
            reabertoEm: new Date().toISOString(),
            dinheiro: null,
            obs: "",
          }
        : x
    );
    setCaixas(lista);
    salvarCaixas(sessao.id, lista);
    setFechando(false);
    setMensagem(
      `Caixa reaberto! Vendas do expediente restauradas: ${formatarMoeda(
        c.vendas ?? vendasDoPeriodo(c)
      )}. Os pedidos do expediente aparecem abaixo para editar.`
    );
  }

  // ============================================================
  // EDITAR UM PEDIDO DO EXPEDIENTE (abre o modal compartilhado)
  // ============================================================
  async function abrirEdicaoExpediente(p: Order) {
    const sessao = getSessao();
    if (!supabase || !sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    const { data: it } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", p.id);
    const lista = ((it || []) as OrderItem[]).map((i) => ({
      key: i.id,
      product_id: i.product_id,
      nome:
        produtos.find((pr) => pr.id === i.product_id)?.name ??
        "(produto removido)",
      qty: i.qty,
      price: Number(i.price),
      cost: Number(i.cost),
    }));
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    setPedidoEditando(p);
    setItensEditando(lista);
  }

  // Hora curta (hh:mm) para a lista do expediente
  function formatarHoraCurta(iso: string): string {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Caixa aberto agora + caixas fechados (para a tela)
  const abertoCaixa = caixaAberto(caixas);
  const caixasFechados = caixas.filter((c) => c.fechadoEm && !caixaReaberto(c));

  // ============================================================
  // EXTRATO DO CAIXA — monta o resumo e envia à impressora do cliente
  // ============================================================
  useEffect(() => {
    if (extratoAberto) dialogoExtrato.current?.showModal();
  }, [extratoAberto]);

  function dadosDoExtrato(): DadosExtrato {
    const sessao = getSessao();
    return {
      empresa:
        empresa || {
          nome_empresa: sessao?.nome_loja ?? "PdvDG",
          cnpj: null,
          telefone: null,
          endereco: null,
        },
      emitidoEm: new Date().toISOString(),
      abertoEm: abertoCaixa?.abertoEm ?? null,
      fechadoEm: abertoCaixa?.fechadoEm ?? null,
      fundo: abertoCaixa?.fundo ?? 0,
      vendas: resumo.caixaHoje,
      lucro: resumo.lucroHoje,
      taxas: resumo.taxasHoje,
      cancelados: resumo.cancelados,
      balcao: { nome: "Balcão", quantidade: resumo.balcaoQtd, total: resumo.balcaoTotal },
      delivery: { nome: "Delivery (com taxa)", quantidade: resumo.deliveryQtd, total: resumo.deliveryTotal },
      mesa: { nome: "Mesa", quantidade: resumo.mesaQtd, total: resumo.mesaTotal },
      pagamentos: resumo.pagamentos
        .filter((p) => p.pedidos > 0)
        .map((p) => ({ nome: p.nome, quantidade: p.pedidos, total: p.total })),
      motoboys: resumo.motoboys
        .filter((m) => m.entregas > 0)
        .map((m) => ({ nome: m.nome, quantidade: m.entregas, total: m.total })),
      entregas: resumo.entregasQtd,
      ganhosMotoboys: resumo.ganhosMotoboys,
      linhas: resumo.expediente.map((o) => ({
        hora: formatarHoraCurta(o.created_at),
        tipo:
          o.type === "delivery"
            ? "Delivery"
            : o.type === "mesa"
              ? `Mesa ${o.mesa_numero ?? ""}`.trim()
              : "Balcão",
        cliente: o.customer_name || "",
        pagamento: o.forma_pagamento || "",
        total: Number(o.total),
      })),
    };
  }

  async function imprimirExtrato() {
    if (extratoEmCurso.current || !extratoConfirmado || !abertoCaixa) return;
    extratoEmCurso.current = true;
    setExtratoEnviando(true);
    setExtratoErro("");
    setExtratoMensagem("");
    try {
      const sessao = getSessao();
      if (!sessao) throw new Error("Sessão da loja não encontrada.");
      const config = lerImpressora(sessao.id);
      const resultado = await imprimirExtratoQz(dadosDoExtrato(), config);
      setExtratoMensagem(resultado);
    } catch (falha) {
      setExtratoErro(falha instanceof Error ? falha.message : "Não foi possível enviar o extrato ao QZ Tray.");
    } finally {
      extratoEmCurso.current = false;
      setExtratoEnviando(false);
      setExtratoConfirmado(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <header className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">Caixa</h1>
          <p className="text-sm text-gray-500">Abra o caixa, acompanhe as vendas e feche no fim do expediente.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setExtratoAberto(true);
              setExtratoConfirmado(false);
              setExtratoErro("");
              setExtratoMensagem("");
            }}
            disabled={!abertoCaixa}
            title={abertoCaixa ? "Imprimir o extrato do caixa de hoje" : "Abra o caixa para emitir o extrato."}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-100 disabled:opacity-50"
          >
            Extrato
          </button>
          <button type="button" onClick={carregar} disabled={carregando} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-100 disabled:opacity-50">
            Atualizar
          </button>
        </div>
      </header>

      {/* Mensagens */}
      {mensagem && (
        <div className="bg-green-50 border border-green-500 text-green-700 rounded-lg p-3 mb-4">
          {mensagem}
        </div>
      )}

      {erroCarregamento ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">
          <p>Não foi possível carregar o resumo do caixa. {erroCarregamento}</p>
          <button type="button" onClick={carregar} className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800">Tentar novamente</button>
        </div>
      ) : carregando ? (
        <p role="status" className="text-gray-400 text-center py-10">Carregando...</p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* ================= CARDS DO CAIXA ================= */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="bg-white rounded-xl p-4">
              <p className="text-xs text-gray-400">Vendas do caixa</p>
              <p className="text-xl font-bold text-green-600">
                {formatarMoeda(resumo.caixaHoje)}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4">
              <p className="text-xs text-gray-400">Lucro do caixa</p>
              <p className="text-xl font-bold text-green-600">
                {formatarMoeda(resumo.lucroHoje)}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4">
              <p className="text-xs text-gray-400">Margem do caixa</p>
              <p className="text-xl font-bold">{resumo.margemHoje.toFixed(1)}%</p>
            </div>
            <div className="bg-white rounded-xl p-4">
              <p className="text-xs text-gray-400">Pedidos do caixa</p>
              <p className="text-xl font-bold">{resumo.pedidosHoje}</p>
            </div>
            <div className="bg-white rounded-xl p-4">
              <p className="text-xs text-gray-400">Taxas do caixa</p>
              <p className="text-xl font-bold">{formatarMoeda(resumo.taxasHoje)}</p>
            </div>
            <div className="bg-white rounded-xl p-4">
              <p className="text-xs text-gray-400">Total geral (caixa)</p>
              <p className="text-xl font-bold text-green-600">
                {formatarMoeda(resumo.caixaGeral)}
              </p>
            </div>
          </div>

          {/* Detalhamento do caixa */}
          <div className="bg-white rounded-xl p-4">
            <h2 className="font-semibold mb-2">Resumo do caixa</h2>
            <p className="mb-3 text-xs text-gray-500">{abertoCaixa ? "Pedidos criados neste expediente, incluindo o período original quando o caixa está reaberto." : "Abra ou reabra um caixa para consultar o resumo do expediente."}</p>
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-left">
                <tr>
                  <th className="py-1 pr-4">Tipo</th>
                  <th className="py-1 pr-4 text-right">Pedidos</th>
                  <th className="py-1 pr-4 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-gray-200">
                  <td className="py-2">Balcão</td>
                  <td className="py-2 text-right">{resumo.balcaoQtd}</td>
                  <td className="py-2 text-right font-semibold">
                    {formatarMoeda(resumo.balcaoTotal)}
                  </td>
                </tr>
                <tr className="border-t border-gray-200">
                  <td className="py-2">Delivery (inclui taxa)</td>
                  <td className="py-2 text-right">{resumo.deliveryQtd}</td>
                  <td className="py-2 text-right font-semibold">
                    {formatarMoeda(resumo.deliveryTotal)}
                  </td>
                </tr>
                <tr className="border-t border-gray-200">
                  <td className="py-2">Mesa</td>
                  <td className="py-2 text-right">{resumo.mesaQtd}</td>
                  <td className="py-2 text-right font-semibold">
                    {formatarMoeda(resumo.mesaTotal)}
                  </td>
                </tr>
                <tr className="border-t border-gray-200 font-bold">
                  <td className="py-2">Total do caixa</td>
                  <td className="py-2 text-right">{resumo.pedidosHoje}</td>
                  <td className="py-2 text-right text-green-600">
                    {formatarMoeda(resumo.caixaHoje)}
                  </td>
                </tr>
                <tr className="border-t border-gray-200">
                  <td className="py-2 text-gray-400">Lucro do caixa</td>
                  <td className="py-2"></td>
                  <td className="py-2 text-right font-semibold text-green-600">
                    {formatarMoeda(resumo.lucroGeral)}
                  </td>
                </tr>
                <tr className="border-t border-gray-200 text-red-700">
                  <td className="py-2">Pedidos cancelados</td>
                  <td className="py-2 text-right font-semibold">{resumo.cancelados}</td>
                  <td className="py-2 text-right text-xs">Fora das vendas</td>
                </tr>
              </tbody>
            </table>

            <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
              <section aria-labelledby="caixa-pagamentos-titulo" className="min-w-0">
                <h3 id="caixa-pagamentos-titulo" className="font-semibold">Pedidos por forma de pagamento</h3>
                <p className="mt-1 mb-3 text-xs text-gray-500">Cancelados não entram nos totais. Fiado é valor a receber, não dinheiro recebido.</p>
                <div className="overflow-x-auto" role="region" aria-label="Resumo por forma de pagamento" tabIndex={0}>
                  <table className="w-full whitespace-nowrap text-sm">
                    <thead className="text-left text-gray-500">
                      <tr>
                        <th scope="col" className="py-2 pr-4">Pagamento</th>
                        <th scope="col" className="py-2 pr-4 text-right">Pedidos</th>
                        <th scope="col" className="py-2 text-right">Valor dos pedidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumo.pagamentos.map((pagamento) => (
                        <tr key={pagamento.nome} className="border-t border-gray-200">
                          <th scope="row" className="py-2 pr-4 text-left font-medium">{pagamento.nome}</th>
                          <td className="py-2 pr-4 text-right">{pagamento.pedidos}</td>
                          <td className="py-2 text-right font-semibold">{formatarMoeda(pagamento.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-300 font-bold">
                        <th scope="row" className="py-2 pr-4 text-left">Total dos pedidos</th>
                        <td className="py-2 pr-4 text-right">{resumo.pedidosHoje}</td>
                        <td className="py-2 text-right">{formatarMoeda(resumo.pagamentos.reduce((soma, pagamento) => soma + pagamento.total, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              <section aria-labelledby="caixa-motoboys-titulo" className="min-w-0">
                <h3 id="caixa-motoboys-titulo" className="font-semibold">Motoboys — entregas concluídas</h3>
                <p className="mt-1 mb-3 text-xs text-gray-500">Somente pedido e entrega marcados como Entregue. O ganho considera as taxas registradas nas entregas, sem salário ou gorjetas.</p>
                <div className="overflow-x-auto" role="region" aria-label="Resumo por motoboy" tabIndex={0}>
                  <table className="w-full whitespace-nowrap text-sm">
                    <thead className="text-left text-gray-500">
                      <tr>
                        <th scope="col" className="py-2 pr-4">Motoboy</th>
                        <th scope="col" className="py-2 pr-4 text-right">Entregas feitas</th>
                        <th scope="col" className="py-2 text-right">Ganho em taxas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumo.motoboys.map((motoboy) => (
                        <tr key={motoboy.id ?? "sem-motoboy"} className="border-t border-gray-200">
                          <th scope="row" className="py-2 pr-4 text-left font-medium">{motoboy.nome}</th>
                          <td className="py-2 pr-4 text-right">{motoboy.entregas}</td>
                          <td className="py-2 text-right font-semibold">{formatarMoeda(motoboy.total)}</td>
                        </tr>
                      ))}
                      {resumo.motoboys.length === 0 && (
                        <tr className="border-t border-gray-200"><td colSpan={3} className="py-4 text-center text-gray-500">Nenhuma entrega concluída neste expediente.</td></tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-300 font-bold">
                        <th scope="row" className="py-2 pr-4 text-left">Total das entregas</th>
                        <td className="py-2 pr-4 text-right">{resumo.entregasQtd}</td>
                        <td className="py-2 text-right">{formatarMoeda(resumo.ganhosMotoboys)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            </div>
          </div>

          {/* ================= CONTROLE DO CAIXA ================= */}
          <h3 className="font-semibold">Controle do Caixa</h3>
          {abertoCaixa ? (
            <div className="bg-green-50 border-2 border-green-500 rounded-xl p-4 mb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-extrabold text-green-700">CAIXA ABERTO</p>
                <p className="text-xs text-gray-500">
                  Aberto em {formatarDataHora(abertoCaixa.abertoEm)}
                </p>
              </div>
              {caixaReaberto(abertoCaixa) && abertoCaixa.reabertoEm && (
                <p className="mt-2 text-xs font-bold text-amber-700 bg-amber-100 border border-amber-400 rounded-lg px-3 py-1.5">
                  Caixa reaberto em {formatarDataHora(abertoCaixa.reabertoEm)}{" "}
                  — vendas do expediente restauradas
                </p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <div>
                  <p className="text-xs text-gray-500">Troco inicial</p>
                  <p className="font-bold">
                    {formatarMoeda(abertoCaixa.fundo)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Vendas desde a abertura</p>
                  <p className="font-bold text-green-600">
                    {formatarMoeda(resumo.caixaHoje)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total esperado</p>
                  <p className="font-bold">
                    {formatarMoeda(abertoCaixa.fundo + resumo.caixaHoje)}
                  </p>
                </div>
              </div>

              {!fechando ? (
                <button
                  onClick={() => {
                    setFechando(true);
                    setDinheiro("");
                    setObsFechamento("");
                  }}
                  className="mt-3 bg-red-600 hover:bg-red-700 text-white font-bold px-5 py-2.5 rounded-lg transition"
                >
                  Fechar Caixa
                </button>
              ) : (
                <div className="mt-3 bg-white rounded-lg p-3 flex flex-col gap-2">
                  <p className="text-sm font-bold text-gray-700">
                    Fechamento do caixa
                  </p>
                  <p className="text-xs text-gray-500">
                    Vendas que serão salvas:{" "}
                    <b className="text-green-600">
                      {formatarMoeda(vendasSessao())}
                    </b>
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Dinheiro na gaveta (R$)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={dinheiro}
                        onChange={(e) => setDinheiro(e.target.value)}
                        placeholder="Ex: 250,00"
                        className="w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Observação
                      </label>
                      <input
                        type="text"
                        value={obsFechamento}
                        onChange={(e) => setObsFechamento(e.target.value)}
                        placeholder="Ex: sobrou troco, sangria..."
                        className="w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={fecharCaixa}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg transition"
                    >
                      Confirmar Fechamento
                    </button>
                    <button
                      onClick={() => setFechando(false)}
                      className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold px-5 py-2.5 rounded-lg transition"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl p-4 mb-3 flex flex-wrap items-end gap-3">
              <p className="text-sm text-gray-500 w-full">
                Nenhum caixa aberto agora.
              </p>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Troco inicial (R$)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fundo}
                  onChange={(e) => setFundo(e.target.value)}
                  placeholder="Ex: 100,00"
                  className="w-40 bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <button
                onClick={abrirCaixa}
                className="bg-green-600 hover:bg-green-700 text-white font-extrabold px-6 py-2.5 rounded-lg transition"
              >
                Abrir Caixa
              </button>
            </div>
          )}

          {/* ================= PEDIDOS DO EXPEDIENTE (caixa aberto) ================= */}
          {abertoCaixa && (
            <div className="bg-white rounded-xl overflow-hidden">
              <p className="px-4 pt-3 text-sm font-bold text-gray-700">
                Pedidos do expediente ({resumo.expediente.length})
              </p>
              {resumo.expediente.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-gray-400">
                  Nenhum pedido neste caixa ainda.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 text-gray-600 text-left">
                    <tr>
                      <th className="px-4 py-2">Hora</th>
                      <th className="px-4 py-2">Pedido</th>
                      <th className="px-4 py-2">Tipo</th>
                      <th className="px-4 py-2">Cliente</th>
                      <th className="px-4 py-2">Pagamento</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {resumo.expediente.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-500">
                          {formatarHoraCurta(p.created_at)}
                        </td>
                        <td className="px-4 py-2 font-mono">
                          {rotuloPedido(p)}
                        </td>
                        <td className="px-4 py-2">
                          {p.type === "delivery"
                            ? "Delivery"
                            : p.type === "mesa"
                              ? `Mesa ${p.mesa_numero ?? ""}`
                              : "Balcão"}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {p.customer_name || "—"}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {p.forma_pagamento || "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold">
                          {formatarMoeda(Number(p.total))}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <div className="flex flex-wrap items-center justify-center gap-2">
                          <ImpressaoPedido pedido={p} />
                          <button
                            onClick={() => abrirEdicaoExpediente(p)}
                            className="bg-blue-600 hover:bg-blue-700 text-xs font-bold px-3 py-1.5 rounded transition"
                          >
                            Editar
                          </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ================= HISTÓRICO DE CAIXAS FECHADOS ================= */}
          <div className="bg-white rounded-xl overflow-hidden">
            <p className="px-4 pt-3 text-sm font-bold text-gray-700">
              Caixas fechados ({caixasFechados.length})
            </p>
            {caixasFechados.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">
                Nenhum caixa fechado ainda.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-gray-600 text-left">
                  <tr>
                    <th className="px-4 py-2">Abertura</th>
                    <th className="px-4 py-2">Fechamento</th>
                    <th className="px-4 py-2 text-right">Troco</th>
                    <th className="px-4 py-2 text-right">Vendas</th>
                    <th className="px-4 py-2 text-right">Dinheiro</th>
                    <th className="px-4 py-2 text-right">Diferença</th>
                    <th className="px-4 py-2">Obs</th>
                    <th className="px-4 py-2 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {caixasFechados.map((c) => {
                    // Caixas novos têm o valor salvo no fechamento;
                    // caixas antigos (sem o campo) usam o cálculo do período
                    const vendas = c.vendas ?? vendasDoPeriodo(c);
                    const esperado = c.fundo + vendas;
                    const dif =
                      c.dinheiro !== null ? c.dinheiro - esperado : null;
                    const editando = editandoId === c.id;
                    return (
                      <tr key={c.id} className="hover:bg-gray-50 align-top">
                        <td className="px-4 py-2 text-gray-600">
                          {formatarDataHora(c.abertoEm)}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {formatarDataHora(c.fechadoEm!)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {editando ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={editFundo}
                              onChange={(e) => setEditFundo(e.target.value)}
                              className="w-20 bg-gray-100 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                          ) : (
                            formatarMoeda(c.fundo)
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold">
                          {editando ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={editVendas}
                              onChange={(e) => setEditVendas(e.target.value)}
                              className="w-20 bg-gray-100 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                          ) : (
                            formatarMoeda(vendas)
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {editando ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={editDinheiro}
                              onChange={(e) => setEditDinheiro(e.target.value)}
                              className="w-20 bg-gray-100 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                          ) : (
                            formatarMoeda(c.dinheiro ?? 0)
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-bold">
                          {dif === null ? (
                            <span className="text-gray-400">—</span>
                          ) : dif >= 0 ? (
                            <span className="text-green-600">
                              Sobra {formatarMoeda(dif)}
                            </span>
                          ) : (
                            <span className="text-red-600">
                              Falta {formatarMoeda(-dif)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-500 max-w-[160px] truncate">
                          {editando ? (
                            <input
                              type="text"
                              value={editObs}
                              onChange={(e) => setEditObs(e.target.value)}
                              className="w-full bg-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                          ) : (
                            c.obs || "—"
                          )}
                        </td>
                        <td className="px-4 py-2 text-center whitespace-nowrap">
                          {editando ? (
                            <div className="flex gap-1 justify-center">
                              <button
                                onClick={() => salvarEdicao(c)}
                                className="bg-green-600 hover:bg-green-700 text-xs font-bold px-3 py-1.5 rounded transition"
                              >
                                Salvar
                              </button>
                              <button
                                onClick={() => setEditandoId(null)}
                                className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold px-3 py-1.5 rounded transition"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1 justify-center">
                              <button
                                onClick={() => {
                                  setEditandoId(c.id);
                                  setEditFundo(String(c.fundo));
                                  setEditVendas(String(vendas));
                                  setEditDinheiro(String(c.dinheiro ?? 0));
                                  setEditObs(c.obs);
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-xs font-bold px-3 py-1.5 rounded transition"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => reabrirCaixa(c)}
                                className="bg-amber-500 hover:bg-amber-600 text-xs font-bold px-3 py-1.5 rounded transition"
                              >
                                Reabrir
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ================= EXTRATO DO CAIXA ================= */}
      {extratoAberto && (
        <dialog
          ref={dialogoExtrato}
          onCancel={(event) => { event.preventDefault(); if (!extratoEmCurso.current) setExtratoAberto(false); }}
          aria-labelledby="extrato-titulo"
          className="m-auto w-[95vw] max-w-lg rounded-2xl border border-gray-300 bg-white p-5 text-gray-900 shadow-2xl backdrop:bg-black/50"
        >
          <header className="flex items-center justify-between gap-3">
            <h2 id="extrato-titulo" className="text-lg font-bold">Extrato do caixa</h2>
            <button type="button" disabled={extratoEnviando} onClick={() => setExtratoAberto(false)} className="rounded border px-3 py-2 disabled:opacity-50">Fechar</button>
          </header>
          <p className="my-3 text-sm text-gray-600">
            Imprime o resumo do caixa aberto (movimento de hoje) na impressora do cliente, em bobina 80 mm, com corte.
          </p>
          <p className="mb-3 text-xs text-gray-500">
            Vendas: <b>{formatarMoeda(resumo.caixaHoje)}</b> · Pedidos: <b>{resumo.pedidosHoje}</b> · Cancelados: <b>{resumo.cancelados}</b>
          </p>
          <label className="my-4 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={extratoConfirmado} disabled={extratoEnviando} onChange={(event) => setExtratoConfirmado(event.target.checked)} className="mt-1" />
            Conferi o papel e a fila; quero enviar o extrato.
          </label>
          {extratoErro && <p role="alert" className="my-3 whitespace-normal rounded bg-red-50 p-3 text-sm text-red-800">{extratoErro}</p>}
          {extratoMensagem && <p role="status" className="my-3 whitespace-normal rounded bg-green-50 p-3 text-sm text-green-800">{extratoMensagem}</p>}
          <button type="button" disabled={extratoEnviando || !extratoConfirmado} onClick={() => void imprimirExtrato()} className="w-full rounded-lg bg-blue-700 p-3 text-sm font-bold text-white disabled:opacity-50">
            {extratoEnviando ? "Enviando ao QZ Tray..." : "Imprimir extrato agora"}
          </button>
        </dialog>
      )}

      {/* ================= MODAL DE EDIÇÃO DE PEDIDO (expediente) ================= */}
      {pedidoEditando && (
        <EditarPedidoModal
          pedido={pedidoEditando}
          itensIniciais={itensEditando}
          produtos={produtos}
          onClose={() => setPedidoEditando(null)}
          onSaved={(texto) => {
            setPedidoEditando(null);
            setMensagem(texto);
            carregar();
          }}
        />
      )}
    </div>
  );
}
