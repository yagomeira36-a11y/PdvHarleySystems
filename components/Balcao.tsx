"use client";

// ============================================================
// TELA BALCÃO (PDV principal)
// - Grade de produtos em 6 colunas com foto, nome, código e preço
// - Pills de categoria: TODOS, HAMBÚRGUER, BEBIDAS, PORÇÕES
// - Busca por nome/código
// - Carrinho lateral (30%) com itens e cliente
// - Seletor do tipo da venda: Balcão | Delivery | Mesa
// - Balcão/Mesa: nome e telefone são OPCIONAIS
// - Delivery: exige telefone, nome, rua+complemento, taxa e motoboy
//   (cria pedido + entrega e salva o cliente p/ reconhecer depois)
// - Forma de pagamento no carrinho (lista da loja em Configurações)
// - VÁRIOS PEDIDOS AO MESMO TEMPO: abas de comandas no topo.
//   Dá para começar um pedido, deixar em rascunho e abrir outro
//   com "+ Novo Pedido", sem perder o anterior.
// ============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  normalizarTelefone,
  rotuloPedido,
  Product,
  Categoria,
  Motoboy,
  Cliente,
} from "@/lib/supabase";
import { hojeISO } from "@/lib/fiado";
import { lerPagamentos } from "@/lib/pagamentos";
import type { Order } from "@/lib/supabase";
import { imprimirPedidoAutomatico } from "@/lib/qz";
import { montarDadosImpressaoLocal } from "@/lib/impressao";
import ImpressaoPedido from "./ImpressaoPedido";
import { caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";
import {
  CATEGORIAS_PADRAO,
  inicializarCategorias,
  lerCategorias,
} from "@/lib/categorias";
import {
  Comanda,
  ItemCarrinho,
  TipoVenda,
  lerComandas,
  salvarComandas,
  novaComanda,
  proximoRotulo,
} from "@/lib/comandas";
import {
  ConfigZonas,
  Zona,
  configZonasVazia,
  distanciaKm,
  geocodificar,
  carregarDeliveryZones,
  zonaParaDistancia,
  zonasOrdenadas,
} from "@/lib/zonas";
import {
  atualizarPedidoOffline,
  contarPedidosOffline,
  guardarCacheOffline,
  guardarPedidoOffline,
  lerCacheOffline,
  proximoNumeroExibicaoOffline,
  type OfflineOrderRecord,
} from "@/lib/offline-pdv";

type ResultadoFiado = { mensagem: string; erro: boolean };
type DadosPedidoOffline = {
  type: Order["type"];
  total: number;
  customer_name: string | null;
  address: string | null;
  complemento?: string | null;
  telefone?: string | null;
  delivery_fee: number;
  mesa_numero?: number | null;
  motoboyId?: string;
};

// ItemCarrinho continua exportado daqui (compatibilidade com a página PDV)
export type { ItemCarrinho };

// Filtro de categoria (TODOS = sem filtro)
type FiltroCategoria = "TODOS" | Categoria;

// Mesa do salão (número + status)
type Mesa = {
  id?: string;
  numero: number;
  status: "disponivel" | "ocupada";
};

// Opções do seletor de tipo da venda
const TIPOS_VENDA: { valor: TipoVenda; rotulo: string }[] = [
  { valor: "balcao", rotulo: "Balcão" },
  { valor: "delivery", rotulo: "Delivery" },
  { valor: "mesa", rotulo: "Mesa" },
];

function mensagemErroCriacao(erro: { code?: string; message: string }): string {
  if (["PGRST204", "42703"].includes(erro.code || "") && /\bforma_pagamento\b/i.test(erro.message)) {
    return "O banco precisa da coluna forma_pagamento. Execute supabase/adicionar-pagamento.sql no SQL Editor do Supabase e tente novamente. Nenhum pedido foi criado nesta tentativa; o carrinho foi preservado.";
  }
  return "Erro ao criar pedido: " + erro.message;
}

// Rótulo da comanda: "Pedido 1" e, se o cliente já foi digitado, "Pedido 1 - caroline"
function rotuloComanda(c: { rotulo: string; cliente: string }): string {
  const nome = (c.cliente || "").trim();
  return nome ? `${c.rotulo} - ${nome}` : c.rotulo;
}

type Props = {
  // Chamado após criar um pedido (exibe toast e atualiza as outras telas)
  aoPedidoCriado: (texto: string, tipo?: "ok" | "erro") => void;
};

export default function Balcao({ aoPedidoCriado }: Props) {
  const supabase = getSupabase();
  const router = useRouter(); // muda de seção (ex: ir para a cozinha ao finalizar)

  // ============================================================
  // COMANDAS (pedidos em andamento — várias ao mesmo tempo)
  // ============================================================
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [ativaId, setAtivaId] = useState("");
  const [carregado, setCarregado] = useState(false);
  const [conectado, setConectado] = useState(true);
  const [pedidosOffline, setPedidosOffline] = useState(0);

  // Estados da tela
  const [produtos, setProdutos] = useState<Product[]>([]); // cardápio completo
  const [busca, setBusca] = useState(""); // texto da busca
  const [categoria, setCategoria] = useState<FiltroCategoria>("TODOS"); // filtro ativo
  const [erroBalcao, setErroBalcao] = useState<string | null>(null); // erro dos campos do cliente
  const [mesas, setMesas] = useState<Mesa[]>([]); // mesas do salão (livres/ocupadas)
  const [carregandoMesas, setCarregandoMesas] = useState(false); // carregando mesas
  const [erroMesa, setErroMesa] = useState<string | null>(null); // erro do modal de mesa
  const [liberando, setLiberando] = useState<number | null>(null); // mesa aguardando 2º clique p/ liberar
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]); // motoboys p/ seleção
  const [erroForm, setErroForm] = useState<string | null>(null); // erro do modal
  const [enviando, setEnviando] = useState(false); // trava durante gravação
  const finalizacaoEmCurso = useRef(false);
  const callbackPedidoRef = useRef(aoPedidoCriado);
  const pedidoGravado = useRef<Order | null>(null);
  const [falhaImpressao, setFalhaImpressao] = useState<{ pedido: Order; mensagem: string } | null>(null);

  async function concluirPedido(
    pedido: Order,
    texto: string,
    avisoFiado: ResultadoFiado = { mensagem: "", erro: false }
  ) {
    const resultado = await imprimirPedidoAutomatico(pedido);
    setFalhaImpressao(resultado.erro ? { pedido, mensagem: resultado.mensagem } : null);
    const mensagem = resultado.erro
      ? `${resultado.mensagem}${avisoFiado.mensagem ? ` ${avisoFiado.mensagem}` : ""}`
      : `${texto} Comprovante e comanda enviados ao QZ Tray.${avisoFiado.mensagem ? ` ${avisoFiado.mensagem}` : ""}`;
    aoPedidoCriado(mensagem, resultado.erro || avisoFiado.erro ? "erro" : "ok");
    if (!resultado.erro) router.push("/pdv?aba=kds");
  }

  useEffect(() => {
    callbackPedidoRef.current = aoPedidoCriado;
  }, [aoPedidoCriado]);

  function pagamentoEhFiado(forma: string): boolean {
    return forma.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().includes("fiado");
  }

  async function registrarFiadoDoPedido(pedido: Order, comandaPedido: Comanda, lojaId: string): Promise<ResultadoFiado> {
    if (!pagamentoEhFiado(comandaPedido.formaPagamento)) return { mensagem: "", erro: false };
    if (!supabase) throw new Error("Conexão com o banco indisponível para registrar o fiado.");

    const descricaoItens = comandaPedido.carrinho
      .map((item) => `${item.qty}x ${item.product.name}`)
      .join(", ");
    const { error } = await supabase.from("fiados").insert({
      loja_id: lojaId,
      cliente_nome: comandaPedido.cliente.trim(),
      cliente_telefone: normalizarTelefone(comandaPedido.telefone) || null,
      tipo: "divida",
      valor: Number(pedido.total),
      descricao: `${rotuloPedido(pedido)}: ${descricaoItens}`,
      data: hojeISO(),
    });

    if (error) {
      console.error("Pedido fiado criado, mas não foi possível registrar a dívida:", error.message);
      return {
        mensagem: "Atenção: o pedido foi criado, mas não foi possível registrar o débito na tela Fiado.",
        erro: true,
      };
    }
    return { mensagem: "Débito registrado em Fiado.", erro: false };
  }

  async function finalizarPedido() {
    if (finalizacaoEmCurso.current) return;
    if (!comanda) return;
    if (!comanda.carrinho.length) { aoPedidoCriado("Adicione itens ao carrinho primeiro.", "erro"); return; }
    if (pagamentoEhFiado(comanda.formaPagamento) && !comanda.cliente.trim()) {
      aoPedidoCriado("Informe o nome do cliente para registrar o pedido no Fiado.", "erro");
      return;
    }
    finalizacaoEmCurso.current = true;
    pedidoGravado.current = null;
    try {
      if (comanda.tipoVenda === "delivery") await confirmarDelivery();
      else if (comanda.tipoVenda === "mesa") await finalizarMesa();
      else await finalizarBalcao();
    } catch (erro) {
      const salvo = pedidoGravado.current as Order | null;
      if (salvo) retirarComanda(comanda.id);
      const mensagem = `${salvo ? `${rotuloPedido(salvo)} já registrado, mas a finalização ficou incompleta.` : "Não foi possível confirmar a gravação do pedido."} ${erro instanceof Error ? erro.message : "Falha de comunicação."} Confira o Caixa antes de tentar novamente. Nenhum documento foi enviado automaticamente.`;
      setErroBalcao(mensagem);
      setErroForm(mensagem);
      setErroMesa(mensagem);
      aoPedidoCriado(mensagem, "erro");
    } finally {
      setEnviando(false);
      finalizacaoEmCurso.current = false;
    }
  }
  const [zonasCfg, setZonasCfg] = useState<ConfigZonas>(configZonasVazia()); // zonas de entrega (mapa)
  const [erroZonas, setErroZonas] = useState("");
  const [calculandoEntrega, setCalculandoEntrega] = useState(false); // buscando endereço no mapa
  const [resultadoEntrega, setResultadoEntrega] = useState<
    { ok: boolean; texto: string } | null
  >(null); // resultado do cálculo da entrega
  const [avisoCliente, setAvisoCliente] = useState<string | null>(null); // cliente reconhecido?
  const [produtoAdicionando, setProdutoAdicionando] = useState<Product | null>(null); // produto no modal de observação
  const [observacao, setObservacao] = useState(""); // observação do item sendo adicionado

  // Formas de pagamento (lista da loja + escolhida na venda)
  const [pagamentos, setPagamentos] = useState<string[]>([]);

  // Categorias de produto (lista da loja)
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_PADRAO);

  // ============================================================
  // CARREGAR AS COMANDAS SALVAS (rascunhos) DO NAVEGADOR
  // ============================================================
  useEffect(() => {
    const sessao = getSessao();
    if (!sessao) {
      setCarregado(true);
      return;
    }
    const salvas = lerComandas(sessao.id);
    const inicial = salvas.length > 0 ? salvas : [novaComanda("Pedido 1", "Dinheiro")];
    setComandas(inicial);
    setAtivaId(inicial[0].id);
    setCarregado(true);
  }, []);

  // Salva os rascunhos sempre que algo muda (por loja)
  useEffect(() => {
    if (!carregado) return;
    const sessao = getSessao();
    if (!sessao) return;
    salvarComandas(sessao.id, comandas);
  }, [comandas, carregado]);

  // Comanda em edição (aba ativa)
  const comanda = comandas.find((c) => c.id === ativaId) ?? comandas[0];

  // Atualiza campos da comanda ativa
  function atualizar(patch: Partial<Comanda>) {
    setComandas((atual) =>
      atual.map((c) => (c.id === ativaId ? { ...c, ...patch } : c))
    );
  }

  // Troca de aba (comanda)
  function trocarComanda(id: string) {
    if (id === ativaId) return;
    setAtivaId(id);
    setErroBalcao(null);
    setErroForm(null);
    setErroMesa(null);
    setLiberando(null);
    setAvisoCliente(null);
    setResultadoEntrega(null);
  }

  // Abre um novo pedido (sem apagar o atual)
  function novoPedido() {
    const forma = comanda?.formaPagamento ?? pagamentos[0] ?? "Dinheiro";
    const nova = novaComanda(proximoRotulo(comandas), forma);
    setComandas((atual) => [...atual, nova]);
    setAtivaId(nova.id);
    setErroBalcao(null);
    setErroForm(null);
    setErroMesa(null);
    setAvisoCliente(null);
    setResultadoEntrega(null);
  }

  function retirarComanda(id: string) {
    const restante = comandas.filter((c) => c.id !== id);
    if (restante.length === 0) {
      const nova = novaComanda("Pedido 1", pagamentos[0] ?? "Dinheiro");
      setComandas([nova]);
      setAtivaId(nova.id);
      return;
    }
    setComandas(restante);
    if (ativaId === id) setAtivaId(restante[0].id);
  }

  function descartarPedido(id: string) {
    const alvo = comandas.find((c) => c.id === id);
    if (alvo && alvo.carrinho.length > 0) {
      const confirmou = window.confirm(
        `Descartar o ${rotuloComanda(alvo)}? Os itens dele serão perdidos.`
      );
      if (!confirmou) return;
    }
    retirarComanda(id);
  }

  // ============================================================
  // CARREGAR CARDÁPIO, MOTOBOYS E CONFIGURAÇÕES DA EMPRESA
  // ============================================================
  useEffect(() => {
    const sessao = getSessao();
    if (!sessao) return;
    const lojaId = sessao.id;
    let ativo = true;

    async function carregarDadosPDV() {
      try {
        const [produtosSalvos, motoboysSalvos, mesasSalvas] = await Promise.all([
          lerCacheOffline<Product[]>(lojaId, "products"),
          lerCacheOffline<Motoboy[]>(lojaId, "motoboys"),
          lerCacheOffline<Mesa[]>(lojaId, "mesas"),
        ]);
        if (!ativo) return;
        if (produtosSalvos) setProdutos(produtosSalvos);
        if (motoboysSalvos) setMotoboys(motoboysSalvos);
        if (mesasSalvas) setMesas(mesasSalvas);
      } catch (error) {
        console.error("Não foi possível ler o cache offline do PDV:", error);
        if (!navigator.onLine) {
          callbackPedidoRef.current("Não foi possível carregar os dados locais do PDV.", "erro");
        }
      }

      if (!supabase || !navigator.onLine) return;
      const [produtosResult, motoboysResult] = await Promise.all([
        supabase
          .from("products")
          .select("*")
          .eq("loja_id", lojaId)
          .order("code"),
        supabase
          .from("motoboys")
          .select("*")
          .eq("loja_id", lojaId),
      ]);
      if (!ativo) return;

      if (produtosResult.error) {
        if (navigator.onLine) {
          callbackPedidoRef.current("Não foi possível atualizar o cardápio: " + produtosResult.error.message, "erro");
        }
      } else {
        const lista = (produtosResult.data || []) as Product[];
        setProdutos(lista);
        try {
          await guardarCacheOffline(lojaId, "products", lista);
        } catch (error) {
          console.error("Não foi possível atualizar o cache local do cardápio:", error);
        }
        try {
          setCategorias(inicializarCategorias(
            lojaId,
            lista.map((produto) => produto.category)
          ));
        } catch {
          callbackPedidoRef.current("Não foi possível carregar as categorias no navegador.", "erro");
        }
      }

      if (motoboysResult.error) {
        if (navigator.onLine) {
          callbackPedidoRef.current("Não foi possível atualizar os motoboys: " + motoboysResult.error.message, "erro");
        }
      } else {
        const lista = (motoboysResult.data || []) as Motoboy[];
        setMotoboys(lista);
        try {
          await guardarCacheOffline(lojaId, "motoboys", lista);
        } catch (error) {
          console.error("Não foi possível atualizar o cache local dos motoboys:", error);
        }
      }
    }

    void carregarDadosPDV();
    // Formas de pagamento da loja
    const listaPagamentos = lerPagamentos(lojaId);
    setPagamentos(listaPagamentos);
    // Categorias de produto da loja (lista livre, salva no navegador)
    setCategorias(lerCategorias(lojaId));
    return () => { ativo = false; };
  }, [supabase]);

  useEffect(() => {
    const sessao = getSessao();
    if (!sessao) return;
    const lojaId = sessao.id;
    let ativo = true;

    async function atualizarFila() {
      try {
        setConectado(navigator.onLine);
        const quantidade = await contarPedidosOffline(lojaId);
        if (ativo) setPedidosOffline(quantidade);
      } catch (error) {
        console.error("Falha ao atualizar a fila offline:", error);
        if (ativo) {
          callbackPedidoRef.current(
            error instanceof Error ? error.message : "Não foi possível atualizar a fila offline.",
            "erro"
          );
        }
      }
    }

    const aoConectar = () => { void atualizarFila(); };
    const aoDesconectar = () => setConectado(false);
    const filaAlterada = () => { void atualizarFila(); };
    window.addEventListener("online", aoConectar);
    window.addEventListener("offline", aoDesconectar);
    window.addEventListener("pdv-offline-orders-changed", filaAlterada);
    void atualizarFila();
    return () => {
      ativo = false;
      window.removeEventListener("online", aoConectar);
      window.removeEventListener("offline", aoDesconectar);
      window.removeEventListener("pdv-offline-orders-changed", filaAlterada);
    };
  }, [supabase]);

  useEffect(() => {
    const lojaId = getSessao()?.id ?? "";
    if (!lojaId) return;
    let ativo = true;

    async function carregarZonas() {
      try {
        const config = await carregarDeliveryZones(lojaId);
        if (ativo) {
          setZonasCfg(config);
          setErroZonas("");
        }
      } catch (erro) {
        if (ativo) {
          setErroZonas(
            erro instanceof Error
              ? erro.message
              : "Não foi possível carregar as zonas de entrega."
          );
        }
      }
    }

    const receberZonas = (evento: Event) => {
      const detalhe = (evento as CustomEvent<{
        lojaId: string;
        config: ConfigZonas;
      }>).detail;
      if (detalhe?.lojaId === lojaId) {
        setZonasCfg(detalhe.config);
        setErroZonas("");
      }
    };

    void carregarZonas();
    window.addEventListener("pdv-delivery-zones-atualizado", receberZonas);
    return () => {
      ativo = false;
      window.removeEventListener("pdv-delivery-zones-atualizado", receberZonas);
    };
  }, []);

  // Garante que a comanda ativa use uma forma de pagamento que existe na loja
  useEffect(() => {
    if (!pagamentos.length || !comanda) return;
    if (!pagamentos.includes(comanda.formaPagamento)) {
      setComandas((atual) =>
        atual.map((c) =>
          c.id === ativaId ? { ...c, formaPagamento: pagamentos[0] } : c
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagamentos, ativaId, carregado]);


  // ============================================================
  // FILTRO: categoria + busca (por nome ou código)
  // ============================================================
  const produtosFiltrados = useMemo(() => {
    return produtos.filter((p) => {
      if (categoria !== "TODOS" && p.category !== categoria) return false;
      const termo = busca.trim().toLowerCase();
      if (!termo) return true;
      return (
        p.name.toLowerCase().includes(termo) ||
        String(p.code).includes(termo)
      );
    });
  }, [produtos, categoria, busca]);

  // ============================================================
  // CARRINHO da comanda ativa: adicionar, alterar quantidade e remover
  // ============================================================
  function adicionar(produto: Product, obs: string) {
    if (!comanda) return;
    const existente = comanda.carrinho.find(
      (i) => i.product.id === produto.id && i.observacao === obs
    );
    const novo = existente
      ? comanda.carrinho.map((i) =>
          i.key === existente.key ? { ...i, qty: i.qty + 1 } : i
        )
      : [
          ...comanda.carrinho,
          {
            key: `${produto.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            product: produto,
            qty: 1,
            observacao: obs,
          },
        ];
    atualizar({ carrinho: novo });
  }

  function alterarQtd(key: string, delta: number) {
    if (!comanda) return;
    atualizar({
      carrinho: comanda.carrinho
        .map((i) => (i.key === key ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0),
    });
  }

  function remover(key: string) {
    if (!comanda) return;
    atualizar({ carrinho: comanda.carrinho.filter((i) => i.key !== key) });
  }

  // Total do carrinho (sem taxa de entrega)
  const carrinho = comanda?.carrinho ?? [];
  const total = carrinho.reduce((soma, i) => soma + Number(i.product.price) * i.qty, 0);

  function chaveTaxaEntregaCache(lojaId: string) {
    return `pdv_taxa_entrega_${lojaId}`;
  }
  function lerTaxaEntregaCache(lojaId: string): number | null {
    if (typeof window === "undefined") return null;
    try {
      const bruto = window.localStorage.getItem(chaveTaxaEntregaCache(lojaId));
      if (bruto == null) return null;
      const n = Number(bruto);
      return Number.isFinite(n) && n >= 0 ? n : null;
    } catch { return null; }
  }
  function salvarTaxaEntregaCache(lojaId: string, taxa: number) {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(chaveTaxaEntregaCache(lojaId), String(taxa)); } catch { /* ignore */ }
  }
  function parseTaxaEntrega(valor: string | null | undefined): number | null {
    const n = Number(String(valor ?? "").replace(",", ".").trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function ehErroDeRede(error: unknown): boolean {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    const msg =
      typeof error === "string"
        ? error
        : error && typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message: string }).message)
          : "";
    const texto = msg.toLowerCase();
    if (
      texto.includes("failed to fetch") ||
      texto.includes("networkerror") ||
      texto.includes("network request failed") ||
      texto.includes("load failed") ||
      texto.includes("fetch failed") ||
      texto.includes("err_internet_disconnected") ||
      texto.includes("offline")
    ) return true;
    return error instanceof TypeError;
  }

  async function guardarComandaOffline(dados: DadosPedidoOffline): Promise<Order> {
    if (!comanda) throw new Error("Nenhuma comanda ativa para salvar offline.");
    const sessao = getSessao();
    if (!sessao) throw new Error("Sessão da loja não encontrada.");

    const id = crypto.randomUUID();
    const criadoEm = new Date().toISOString();
    const numeroExibicao = proximoNumeroExibicaoOffline(sessao.id);
    const itens = comanda.carrinho.map((item) => ({
      id: crypto.randomUUID(),
      order_id: id,
      product_id: item.product.id,
      qty: item.qty,
      price: Number(item.product.price),
      cost: Number(item.product.cost ?? 0),
      observacao: item.observacao || null,
      loja_id: sessao.id,
    }));
    const pedido: Order = {
      id,
      total: dados.total,
      type: dados.type,
      status: "em_preparo",
      customer_name: dados.customer_name,
      address: dados.address,
      complemento: dados.complemento ?? null,
      telefone: dados.telefone ?? null,
      delivery_fee: dados.delivery_fee,
      mesa_numero: dados.mesa_numero ?? null,
      forma_pagamento: comanda.formaPagamento,
      numero_pedido: null,
      numero_exibicao: numeroExibicao,
      created_at: criadoEm,
      items: comanda.carrinho.map((item) => ({
        product_id: item.product.id,
        name: item.product.name,
        qty: item.qty,
        price: Number(item.product.price),
        observacao: item.observacao || null,
      })),
    };
    const record: OfflineOrderRecord = {
      id,
      lojaId: sessao.id,
      numeroExibicao,
      pedido,
      itens,
      criadoEm,
      statusLocal: "em_preparo",
      sincronizado: false,
    };

    if (dados.type === "delivery") {
      record.entrega = {
        id: crypto.randomUUID(),
        order_id: id,
        motoboy_id: dados.motoboyId || null,
        status: "pendente",
        taxa: dados.delivery_fee,
        loja_id: sessao.id,
      };
      record.cliente = {
        nome: comanda.cliente.trim(),
        telefone: normalizarTelefone(comanda.telefone),
        endereco: comanda.endereco.trim(),
        complemento: comanda.complemento.trim() || null,
        loja_id: sessao.id,
      };
    }

    if (pagamentoEhFiado(comanda.formaPagamento)) {
      const descricaoItens = comanda.carrinho
        .map((item) => `${item.qty}x ${item.product.name}`)
        .join(", ");
      record.fiado = {
        id: crypto.randomUUID(),
        cliente_nome: comanda.cliente.trim(),
        cliente_telefone: normalizarTelefone(comanda.telefone) || null,
        tipo: "divida",
        valor: dados.total,
        descricao: `${rotuloPedido(pedido)}: ${descricaoItens}`,
        data: hojeISO(),
        loja_id: sessao.id,
      };
    }

    if (dados.mesa_numero) record.mesaNumero = dados.mesa_numero;
    await guardarPedidoOffline(record);
    setPedidosOffline(await contarPedidosOffline(sessao.id));
    return pedido;
  }

  async function salvarPedidoOfflineAgora(
    dados: DadosPedidoOffline,
    mostrarErro: (mensagem: string) => void
  ): Promise<boolean> {
    if (!comanda) {
      const mensagem = "Nenhuma comanda ativa para salvar offline.";
      mostrarErro(mensagem);
      aoPedidoCriado(mensagem, "erro");
      return true;
    }
    const comandaAtual = comanda;
    const itensImpressao = comandaAtual.carrinho.map((item) => ({
      nome: item.product.name,
      quantidade: item.qty,
      preco: Number(item.product.price),
      observacao: item.observacao || null,
    }));
    setEnviando(true);
    try {
      const pedido = await guardarComandaOffline(dados);
      retirarComanda(comandaAtual.id);
      mostrarErro("");
      const resultado = await imprimirPedidoAutomatico(
        pedido,
        await montarDadosImpressaoLocal({ pedido, itens: itensImpressao })
      );
      await atualizarPedidoOffline(pedido.id, (record) => ({ ...record, falhaImpressao: resultado.erro }));
      setFalhaImpressao(resultado.erro ? { pedido, mensagem: resultado.mensagem } : null);
      const texto = resultado.erro
        ? `${rotuloPedido(pedido)} salvo offline - será sincronizado. Impressão pendente: ${resultado.mensagem}`
        : `${rotuloPedido(pedido)} salvo offline - será sincronizado`;
      aoPedidoCriado(texto, resultado.erro ? "erro" : "ok");
      router.push("/pdv?aba=kds");
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Não foi possível salvar o pedido offline.";
      mostrarErro(mensagem);
      aoPedidoCriado(mensagem, "erro");
    } finally {
      setEnviando(false);
    }
    return true;
  }

  async function salvarOfflineSeDesconectado(
    dados: DadosPedidoOffline,
    mostrarErro: (mensagem: string) => void
  ): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return salvarPedidoOfflineAgora(dados, mostrarErro);
    }
    return false;
  }

  // ============================================================
  // FINALIZAR PEDIDO NO BALCÃO (nome e telefone são OPCIONAIS)
  // ============================================================
  async function finalizarBalcao() {
    if (!supabase || enviando || !comanda) return;
    const sessao = getSessao();
    if (!sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setErroBalcao(MENSAGEM_CAIXA_FECHADO);
      return;
    }

    // Nome e telefone opcionais no balcão (obrigatórios só no delivery)
    const nomeCliente = comanda.cliente.trim() || null;
    const telNormalizado = normalizarTelefone(comanda.telefone);

    if (await salvarOfflineSeDesconectado({
      type: "balcao",
      total,
      customer_name: nomeCliente,
      address: null,
      telefone: telNormalizado || null,
      delivery_fee: 0,
    }, setErroBalcao)) return;

    setEnviando(true);
    setErroBalcao(null);

    // 1) Grava o pedido (pendente = aparece na cozinha até ficar pronto)
    const { data: pedido, error } = await supabase
      .from("orders")
      .insert({
        total,
        type: "balcao",
        status: "pendente",
        forma_pagamento: comanda.formaPagamento,
        customer_name: nomeCliente,
        telefone: telNormalizado || null,
        address: null,
        delivery_fee: 0,
        loja_id: sessao.id,
      })
      .select()
      .single();

    if (error) {
      setErroBalcao(mensagemErroCriacao(error));
      setEnviando(false);
      return;
    }

    // 2) Grava os itens do pedido (congela o custo no momento da venda)
    pedidoGravado.current = pedido as Order;
    const { error: erroItens } = await supabase.from("order_items").insert(
      comanda.carrinho.map((i) => ({
        order_id: pedido.id,
        product_id: i.product.id,
        qty: i.qty,
        price: i.product.price,
        cost: Number(i.product.cost ?? 0),
        observacao: i.observacao || null,
        loja_id: sessao.id,
      }))
    );
    if (erroItens) throw new Error("Não foi possível salvar os itens: " + erroItens.message);

    const avisoFiado = await registrarFiadoDoPedido(pedido as Order, comanda, sessao.id);

    // 4) Fecha a comanda, avisa e vai para a cozinha (KDS)
    setErroBalcao(null);
    const rotulo = comanda.rotulo;
    retirarComanda(comanda.id);
    await concluirPedido(pedido as Order, `${rotuloPedido(pedido as Order)} de balcão criado! Total: ${formatarMoeda(total)}`, avisoFiado);
    void rotulo;
  }

  // ============================================================
  // CONFIRMAR PEDIDO DELIVERY (telefone + endereço + taxa + motoboy)
  // ============================================================
  async function confirmarDelivery() {
    if (enviando || !comanda) return;
    const sessao = getSessao();
    if (!sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setErroForm(MENSAGEM_CAIXA_FECHADO);
      return;
    }

    // Validações obrigatórias (campos sempre visíveis ao escolher Delivery)
    const telNormalizado = normalizarTelefone(comanda.telefone);
    if (telNormalizado.length < 10) {
      setErroForm("Informe um telefone válido (com DDD).");
      return;
    }
    if (!comanda.cliente.trim()) {
      setErroForm("Informe o nome do cliente.");
      return;
    }
    if (!comanda.endereco.trim()) {
      setErroForm("Informe a rua e o número do cliente.");
      return;
    }
    if (!comanda.motoboyId) {
      setErroForm("Selecione um motoboy para a entrega.");
      return;
    }
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const taxaManual = parseTaxaEntrega(comanda.taxa);
    const taxaCache = lerTaxaEntregaCache(sessao.id);
    const taxaNum = zonaAtual?.taxa ?? taxaManual ?? taxaCache ?? (Number.isFinite(Number(comanda.taxa)) ? Number(comanda.taxa) : null);
    if (taxaNum == null || !Number.isFinite(taxaNum) || taxaNum < 0) {
      if (offline) {
        setErroForm("Informe a taxa de entrega manualmente para continuar.");
      } else if (erroZonas) {
        setErroForm(erroZonas);
      } else if (!zonasCfg.zonas.some((zona) => zona.ativo) && taxaNum == null) {
        setErroForm("Informe a taxa de entrega para continuar.");
      } else if (comanda.distanciaKm == null) {
        setErroForm('Calcule a entrega pelo endereço (botão "Calcular entrega") ou informe a taxa manualmente para continuar.');
      } else {
        setErroForm("Informe a taxa de entrega para continuar.");
      }
      return;
    }
    const totalComTaxa = total + taxaNum;
    salvarTaxaEntregaCache(sessao.id, taxaNum);

    if (await salvarOfflineSeDesconectado({
      type: "delivery",
      total: totalComTaxa,
      customer_name: comanda.cliente.trim(),
      address: comanda.endereco.trim(),
      complemento: comanda.complemento.trim() || null,
      telefone: telNormalizado,
      delivery_fee: taxaNum,
      motoboyId: comanda.motoboyId,
    }, setErroForm)) return;

    if (!supabase) {
      // Sem conexão com o servidor: salvar offline
      await salvarPedidoOfflineAgora({
        type: "delivery",
        total: totalComTaxa,
        customer_name: comanda.cliente.trim(),
        address: comanda.endereco.trim(),
        complemento: comanda.complemento.trim() || null,
        telefone: telNormalizado,
        delivery_fee: taxaNum,
        motoboyId: comanda.motoboyId,
      }, setErroForm);
      return;
    }

    setEnviando(true);
    setErroForm(null);

    // 1) Grava o pedido delivery (total já inclui a taxa)
    const { data: pedido, error } = await supabase
      .from("orders")
      .insert({
        total: totalComTaxa,
        type: "delivery",
        status: "pendente",
        forma_pagamento: comanda.formaPagamento,
        customer_name: comanda.cliente.trim(),
        address: comanda.endereco.trim(),
        complemento: comanda.complemento.trim() || null,
        telefone: telNormalizado,
        delivery_fee: taxaNum,
        loja_id: sessao.id,
      })
      .select()
      .single();

    if (error) {
      setErroForm(mensagemErroCriacao(error));
      setEnviando(false);
      return;
    }

    // 2) Grava os itens (congela o custo no momento da venda)
    pedidoGravado.current = pedido as Order;
    const { error: erroItens } = await supabase.from("order_items").insert(
      comanda.carrinho.map((i) => ({
        order_id: pedido.id,
        product_id: i.product.id,
        qty: i.qty,
        price: i.product.price,
        cost: Number(i.product.cost ?? 0),
        observacao: i.observacao || null,
        loja_id: sessao.id,
      }))
    );
    if (erroItens) throw new Error("Não foi possível salvar os itens: " + erroItens.message);

    // 3) Salva/atualiza o cliente para reconhecer pelo telefone na próxima venda
    await supabase.from("clientes").upsert(
      {
        nome: comanda.cliente.trim(),
        telefone: telNormalizado,
        endereco: comanda.endereco.trim(),
        complemento: comanda.complemento.trim() || null,
        loja_id: sessao.id,
      },
      { onConflict: "loja_id,telefone" }
    );

    // 4) Cria a entrega linkada ao motoboy escolhido
    const { error: erroEntrega } = await supabase.from("entregas").insert({
      order_id: pedido.id,
      motoboy_id: comanda.motoboyId,
      status: "pendente",
      taxa: taxaNum,
      loja_id: sessao.id,
    });

    if (erroEntrega) throw new Error("Não foi possível criar a entrega: " + erroEntrega.message);

    const avisoFiado = await registrarFiadoDoPedido(pedido as Order, comanda, sessao.id);

    // 6) Fecha a comanda
    const motoboy = motoboys.find((m) => m.id === comanda.motoboyId);
    setAvisoCliente(null);
    retirarComanda(comanda.id);
    await concluirPedido(pedido as Order, `${rotuloPedido(pedido as Order)} de delivery criado! Motoboy: ${motoboy?.nome ?? "—"}`, avisoFiado);
  }

  // ============================================================
  // ESCOLHER O TIPO DA VENDA (mostra os campos certos no carrinho)
  // Delivery -> dados de entrega | Mesa -> seleção de mesa
  // ============================================================
  function escolherTipo(t: TipoVenda) {
    setErroBalcao(null);
    setErroForm(null);
    setErroMesa(null);
    if (t === "mesa") {
      atualizar({ tipoVenda: t });
      carregarMesas();
    } else if (t === "delivery") {
      atualizar({
        tipoVenda: t,
      });
    } else {
      atualizar({ tipoVenda: t });
    }
  }

  // ============================================================
  // CALCULAR A ENTREGA PELO ENDEREÇO (descobre a zona e a taxa)
  // ============================================================
  async function calcularEntrega() {
    if (!comanda) return;
    const sessao = getSessao();
    const lojaId = sessao?.id || "";
    const taxaManual = parseTaxaEntrega(comanda.taxa);
    const taxaCache = lojaId ? lerTaxaEntregaCache(lojaId) : null;
    const taxaFallback = taxaManual ?? taxaCache;

    // Offline ou pedido local: não fazer fetch; usar taxa em cache ou manual
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (taxaFallback != null) {
        atualizar({ taxa: String(taxaFallback) });
        setResultadoEntrega({
          ok: true,
          texto: `Taxa manual - offline: ${formatarMoeda(taxaFallback)}.`,
        });
      } else {
        setResultadoEntrega({
          ok: false,
          texto: "Sem internet. Informe a taxa de entrega manualmente para continuar.",
        });
      }
      return;
    }

    if (erroZonas) {
      if (taxaFallback != null) {
        atualizar({ taxa: String(taxaFallback) });
        setResultadoEntrega({ ok: true, texto: `Usando taxa manual/cache: ${formatarMoeda(taxaFallback)}.` });
      } else {
        setResultadoEntrega({ ok: false, texto: erroZonas });
      }
      return;
    }
    if (!zonasCfg.zonas.some((zona) => zona.ativo)) {
      if (taxaFallback != null) {
        atualizar({ taxa: String(taxaFallback) });
        setResultadoEntrega({ ok: true, texto: `Usando taxa manual/cache: ${formatarMoeda(taxaFallback)}.` });
      } else {
        setResultadoEntrega({
          ok: false,
          texto: "Nenhuma zona ativa cadastrada. Configure em Configurações → Entrega por Zonas ou informe a taxa manualmente.",
        });
      }
      return;
    }
    const enderecoCompleto = [comanda.endereco, comanda.complemento]
      .filter(Boolean)
      .join(", ")
      .trim();
    if (enderecoCompleto.length < 4) {
      if (taxaFallback != null) {
        atualizar({ taxa: String(taxaFallback) });
        setResultadoEntrega({ ok: true, texto: `Usando taxa manual/cache: ${formatarMoeda(taxaFallback)}.` });
      } else {
        setResultadoEntrega({
          ok: false,
          texto: "Informe a rua e o número do cliente para calcular.",
        });
      }
      return;
    }
    setErroForm(null);
    setCalculandoEntrega(true);
    setResultadoEntrega(null);
    try {
      // Converte o endereço em coordenadas (perto da loja)
      const achado = await geocodificar(enderecoCompleto, {
        lat: zonasCfg.lat,
        lng: zonasCfg.lng,
      });
      if (!achado) {
        if (taxaFallback != null) {
          atualizar({ taxa: String(taxaFallback) });
          setResultadoEntrega({ ok: true, texto: `Endereço não localizado. Usando taxa manual/cache: ${formatarMoeda(taxaFallback)}.` });
        } else {
          setResultadoEntrega({
            ok: false,
            texto:
              "Não encontramos esse endereço. Confira rua, número, bairro e cidade ou informe a taxa manualmente.",
          });
        }
        return;
      }
      // Distância da loja até o cliente
      const dist = distanciaKm(zonasCfg.lat, zonasCfg.lng, achado.lat, achado.lng);
      const zona = zonaParaDistancia(dist, zonasCfg.zonas);
      if (!zona) {
        atualizar({ distanciaKm: dist, taxa: taxaFallback != null ? String(taxaFallback) : "" });
        if (taxaFallback != null) {
          setResultadoEntrega({ ok: true, texto: `Fora da área de entrega. Usando taxa manual/cache: ${formatarMoeda(taxaFallback)}.` });
        } else {
          setResultadoEntrega({
            ok: false,
            texto: `Cliente a ${dist.toFixed(1)} km — fora da área de entrega. Informe a taxa manualmente para continuar.`,
          });
        }
        return;
      }
      const indice =
        zonasOrdenadas(zonasCfg.zonas).findIndex((z) => z.id === zona.id) + 1;
      // Preenche a taxa da zona automaticamente
      atualizar({ distanciaKm: dist, taxa: String(zona.taxa) });
      if (lojaId) salvarTaxaEntregaCache(lojaId, zona.taxa);
      setResultadoEntrega({
        ok: true,
        texto: `Cliente a ${dist.toFixed(1)} km — Zona ${indice} (até ${
          zona.raioKm
        } km) — taxa ${formatarMoeda(zona.taxa)}.`,
      });
    } catch (erro) {
      if (taxaFallback != null) {
        atualizar({ taxa: String(taxaFallback) });
        setResultadoEntrega({ ok: true, texto: `Falha de conexão. Usando taxa manual/cache: ${formatarMoeda(taxaFallback)}.` });
      } else {
        setResultadoEntrega({
          ok: false,
          texto:
            (erro instanceof Error ? erro.message : "Falha ao calcular a entrega.") + " Informe a taxa manualmente para continuar.",
        });
      }
    } finally {
      setCalculandoEntrega(false);
    }
  }

  // ============================================================
  // PEDIDO NA MESA: carregar mesas livres/ocupadas da loja
  // ============================================================
  async function carregarMesas() {
    setLiberando(null);
    setErroMesa(null);
    const sessao = getSessao();
    if (!sessao) return;
    setCarregandoMesas(true);
    try {
      const salvas = await lerCacheOffline<Mesa[]>(sessao.id, "mesas");
      if (salvas) setMesas(salvas);
      if (!supabase || !navigator.onLine) return;

      const { data, error } = await supabase
        .from("mesas")
        .select("*")
        .eq("loja_id", sessao.id)
        .order("numero");
      if (error) throw new Error(error.message);
      const lista = (data || []) as Mesa[];
      setMesas(lista);
      await guardarCacheOffline(sessao.id, "mesas", lista);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Não foi possível carregar as mesas.";
      setErroMesa(`Não foi possível atualizar as mesas: ${mensagem}`);
    } finally {
      setCarregandoMesas(false);
    }
  }

  // ============================================================
  // LIBERAR MESA OCUPADA (volta a ficar verde/livre)
  // Primeiro clique pergunta, segundo clique confirma (sem janela).
  // ============================================================
  async function liberarMesa(mesa: Mesa) {
    const sessao = getSessao();
    if (!sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setErroMesa(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    setErroMesa(null);
    if (liberando !== mesa.numero) {
      setLiberando(mesa.numero);
      return;
    }
    setLiberando(null);
    if (supabase && navigator.onLine && mesa.id) {
      const { error } = await supabase
        .from("mesas")
        .update({ status: "disponivel" })
        .eq("id", mesa.id);
      if (error) {
        setErroMesa("Erro ao liberar a mesa: " + error.message);
        return;
      }
      void carregarMesas();
    } else {
      const atualizadas: Mesa[] = mesas.map((m) =>
        m.numero === mesa.numero ? { ...m, status: "disponivel" } : m
      );
      setMesas(atualizadas);
      try {
        await guardarCacheOffline(sessao.id, "mesas", atualizadas);
      } catch (error) {
        setErroMesa(error instanceof Error ? error.message : "Não foi possível salvar as mesas no dispositivo.");
      }
    }
  }

  async function finalizarMesa() {
    if (!supabase || enviando || !comanda) return;
    if (!comanda.mesaEscolhida) {
      setErroMesa("Selecione uma mesa livre.");
      return;
    }
    const sessao = getSessao();
    if (!sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setErroMesa(MENSAGEM_CAIXA_FECHADO);
      return;
    }

    if (await salvarOfflineSeDesconectado({
      type: "mesa",
      total,
      customer_name: comanda.cliente.trim() || null,
      address: null,
      telefone: normalizarTelefone(comanda.telefone) || null,
      delivery_fee: 0,
      mesa_numero: comanda.mesaEscolhida,
    }, setErroMesa)) return;

    setEnviando(true);
    setErroMesa(null);

    // 1) Grava o pedido do tipo mesa (pendente = aparece na cozinha)
    const { data: pedido, error } = await supabase
      .from("orders")
      .insert({
        total,
        type: "mesa",
        status: "pendente",
        forma_pagamento: comanda.formaPagamento,
        customer_name: comanda.cliente.trim() || null,
        address: null,
        telefone: normalizarTelefone(comanda.telefone) || null,
        delivery_fee: 0,
        mesa_numero: comanda.mesaEscolhida,
        loja_id: sessao.id,
      })
      .select()
      .single();

    if (error) {
      // Sem a coluna/regra de mesa no banco -> orienta a rodar o SQL
      const msg = error.message.toLowerCase();
      if (msg.includes("mesa_numero") || msg.includes("orders_type_check")) {
        setErroMesa(
          "Banco ainda sem suporte a pedidos de mesa: rode o arquivo supabase/corrigir-mesa.sql no SQL Editor do Supabase."
        );
      } else {
        setErroMesa(mensagemErroCriacao(error));
      }
      setEnviando(false);
      return;
    }

    // 2) Grava os itens do pedido (congela o custo no momento da venda)
    pedidoGravado.current = pedido as Order;
    const { error: erroItens } = await supabase.from("order_items").insert(
      comanda.carrinho.map((i) => ({
        order_id: pedido.id,
        product_id: i.product.id,
        qty: i.qty,
        price: i.product.price,
        cost: Number(i.product.cost ?? 0),
        observacao: i.observacao || null,
        loja_id: sessao.id,
      }))
    );
    if (erroItens) throw new Error("Não foi possível salvar os itens: " + erroItens.message);

    // 3) Marca a mesa como ocupada no salão
    const { error: erroOcuparMesa } = await supabase
      .from("mesas")
      .update({ status: "ocupada" })
      .eq("loja_id", sessao.id)
      .eq("numero", comanda.mesaEscolhida);
    if (erroOcuparMesa) throw new Error("Não foi possível ocupar a mesa: " + erroOcuparMesa.message);

    const avisoFiado = await registrarFiadoDoPedido(pedido as Order, comanda, sessao.id);

    // 5) Fecha a comanda
    const numeroMesa = comanda.mesaEscolhida;
    retirarComanda(comanda.id);
    await concluirPedido(pedido as Order, `${rotuloPedido(pedido as Order)} da mesa ${numeroMesa} criado! Total: ${formatarMoeda(total)}`, avisoFiado);
  }

  // ============================================================
  // RECONHECER CLIENTE PELO TELEFONE (campo do carrinho)
  // Ao digitar um telefone completo, preenche nome/endereço
  // automaticamente (se o cliente já estiver salvo).
  // ============================================================
  async function reconhecerCliente(telefoneDigitado: string) {
    atualizar({ telefone: telefoneDigitado });
    const telNormalizado = normalizarTelefone(telefoneDigitado);

    // Só busca quando o telefone parece completo (10 ou 11 dígitos)
    if (telNormalizado.length < 10 || !supabase) {
      setAvisoCliente(null);
      return;
    }

    const sessao = getSessao();
    if (!sessao) return;

    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("loja_id", sessao.id)
      .eq("telefone", telNormalizado)
      .maybeSingle();

    // Se a tabela não existe, deu erro ou o cliente não existe, segue manual
    if (error || !data) {
      setAvisoCliente("Novo cliente — os dados serão salvos automaticamente.");
      return;
    }

    const c = data as Cliente;
    atualizar({
      cliente: c.nome,
      endereco: c.endereco ?? "",
      complemento: c.complemento ?? "",
    });
    setAvisoCliente(`Cliente reconhecido: ${c.nome}. Dados preenchidos!`);
  }

  // Zona de entrega que cobre a distância calculada até o cliente
  const zonaAtual: Zona | null =
    comanda?.distanciaKm != null
      ? zonaParaDistancia(comanda.distanciaKm, zonasCfg.zonas)
      : null;
  const temZonas = zonasCfg.zonas.some((zona) => zona.ativo);
  const foraDeArea =
    comanda?.distanciaKm != null && temZonas && zonaAtual === null;
  const taxaNum = zonaAtual?.taxa ?? 0;
  const zonaIndice = zonaAtual
    ? zonasOrdenadas(zonasCfg.zonas).findIndex((z) => z.id === zonaAtual.id) + 1
    : 0;

  if (!carregado || !comanda) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        Carregando...
      </div>
    );
  }

  return (
    <fieldset disabled={enviando} aria-label="Pedido no balcão" className="flex flex-1 min-h-0 min-w-0">
      {/* ================= LADO ESQUERDO: cardápio ================= */}
      <div className="flex-1 p-4 flex flex-col gap-3 min-w-0">
        <div
          role="status"
          className={`rounded-lg px-3 py-2 text-xs font-semibold ${
            conectado ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"
          }`}
        >
          {conectado
            ? "Conectado ao servidor."
            : "Sem internet. Os novos pedidos serão salvos neste dispositivo."}
          {pedidosOffline > 0 &&
            ` ${pedidosOffline} pedido(s) aguardando sincronização.`}
        </div>

        {/* Abas de comandas (vários pedidos ao mesmo tempo) */}
        <div className="flex items-center gap-2 flex-wrap">
          {comandas.map((c) => {
            const ativa = c.id === comanda.id;
            const itens = c.carrinho.reduce((s, i) => s + i.qty, 0);
            return (
              <span
                key={c.id}
                className={`flex items-center gap-1.5 rounded-lg pl-3 pr-1 py-1.5 text-sm font-bold transition cursor-pointer ${
                  ativa
                    ? "bg-green-600 text-white shadow"
                    : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                }`}
                onClick={() => trocarComanda(c.id)}
                title={`Abrir ${rotuloComanda(c)}`}
              >
                <span>
                  {rotuloComanda(c)}
                  {itens > 0 && (
                    <span
                      className={`ml-1.5 text-xs font-bold ${
                        ativa ? "text-green-100" : "text-green-600"
                      }`}
                    >
                      {itens} {itens === 1 ? "item" : "itens"}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    descartarPedido(c.id);
                  }}
                  title={`Fechar ${rotuloComanda(c)}`}
                  className={`w-5 h-5 rounded-full text-xs font-bold leading-none ${
                    ativa
                      ? "hover:bg-white/25 text-white"
                      : "hover:bg-gray-200 text-gray-400"
                  }`}
                >
                  ✕
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={novoPedido}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-3.5 py-1.5 rounded-lg transition shadow"
          >
            + Novo Pedido
          </button>
        </div>

        {/* Linha: busca com lupa */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-lg">
            {/* Ícone de lupa */}
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquise aqui..."
              className="w-full bg-white rounded px-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>

        {/* Pills de categoria */}
        <div className="flex gap-2 flex-wrap items-center">
          {Array.from(new Set(["TODOS", ...categorias])).map((c) => (
            <button
              key={c}
              onClick={() => setCategoria(c)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${
                categoria === c
                  ? "bg-green-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Grade de produtos (6 colunas em telas grandes) */}
        <div className="flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {produtosFiltrados.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  // Abre o modal para informar observação antes de adicionar
                  setProdutoAdicionando(p);
                  setObservacao("");
                }}
                className="bg-white rounded-lg overflow-hidden text-left hover:ring-2 hover:ring-green-500 transition group"
              >
                {/* Foto quadrada do produto */}
                <img
                  src={p.image_url || "/placeholder.svg"}
                  alt={p.name}
                  className="w-full aspect-square object-cover"
                />
                <div className="p-2">
                  {/* Nome em até 2 linhas */}
                  <p className="text-sm leading-tight line-clamp-2 min-h-[2.25rem]">
                    {p.name}
                  </p>
                  {/* Código + preço */}
                  <p className="text-xs text-gray-400 mt-1">
                    {p.code}{" "}
                    <span className="text-green-600 font-bold text-sm">
                      {formatarMoeda(Number(p.price))}
                    </span>
                  </p>
                </div>
              </button>
            ))}
            {/* Estado vazio da busca */}
            {produtosFiltrados.length === 0 && (
              <p className="col-span-full text-center text-gray-400 py-10">
                Nenhum produto encontrado.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ================= LADO DIREITO: carrinho (30%) ================= */}
      <aside className="w-[30%] min-w-[340px] bg-white border-l border-gray-200 p-4 flex flex-col gap-3">
        {/* Qual comanda está aberta */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {rotuloComanda(comanda)}
          </p>
          <p className="text-xs text-gray-400">
            {comandas.length} {comandas.length === 1 ? "pedido aberto" : "pedidos abertos"}
          </p>
        </div>

        {/* Dados do cliente (sempre visíveis; obrigatórios só no delivery) */}
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={comanda.cliente}
            onChange={(e) => atualizar({ cliente: e.target.value })}
            placeholder={
              comanda.tipoVenda === "delivery"
                ? "Nome do cliente *"
                : "Nome do cliente (opcional)"
            }
            className="w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="tel"
            value={comanda.telefone}
            onChange={(e) => reconhecerCliente(e.target.value)}
            placeholder={
              comanda.tipoVenda === "delivery"
                ? "Telefone do cliente *"
                : "Telefone do cliente (opcional)"
            }
            className="w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          {erroBalcao && (
            <p className="text-xs text-red-600 font-semibold">{erroBalcao}</p>
          )}
          {avisoCliente && !erroBalcao && (
            <p className="text-xs text-green-600 font-semibold">{avisoCliente}</p>
          )}
        </div>

        {/* Lista de itens do carrinho */}
        <div className="flex-1 overflow-y-auto bg-white rounded p-3">
          {carrinho.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-8">
              Carrinho vazio. Clique em um produto.
            </p>
          )}
          <ul className="space-y-2">
            {carrinho.map((i) => (
              <li
                key={i.key}
                className="flex items-center gap-2 text-sm bg-gray-100 rounded p-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium">{i.product.name}</p>
                  {i.observacao && (
                    <p className="text-xs text-amber-600 italic truncate">
                      Obs: {i.observacao}
                    </p>
                  )}
                  <p className="text-xs text-gray-400">
                    {formatarMoeda(Number(i.product.price))} cada
                  </p>
                </div>
                {/* Controles de quantidade */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => alterarQtd(i.key, -1)}
                    className="w-7 h-7 rounded bg-gray-200 hover:bg-gray-300 font-bold"
                  >
                    -
                  </button>
                  <span className="w-6 text-center font-bold">{i.qty}</span>
                  <button
                    onClick={() => alterarQtd(i.key, 1)}
                    className="w-7 h-7 rounded bg-gray-200 hover:bg-gray-300 font-bold"
                  >
                    +
                  </button>
                </div>
                {/* Subtotal + remover */}
                <div className="text-right">
                  <p className="font-semibold text-green-600">
                    {formatarMoeda(Number(i.product.price) * i.qty)}
                  </p>
                  <button
                    onClick={() => remover(i.key)}
                    className="text-xs text-red-500 hover:text-red-600"
                  >
                    remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Tipo da venda: Balcão, Delivery ou Mesa */}
        <div className="grid grid-cols-3 gap-2">
          {TIPOS_VENDA.map((t) => (
            <button
              key={t.valor}
              onClick={() => escolherTipo(t.valor)}
              className={`py-2 rounded-lg text-sm font-bold transition ${
                comanda.tipoVenda === t.valor
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t.rotulo}
            </button>
          ))}
        </div>

        {/* ================= DELIVERY: dados da entrega (sempre visíveis) ================= */}
        {comanda.tipoVenda === "delivery" && (
          <div className="bg-gray-50 rounded-lg p-3 flex flex-col gap-2 max-h-[45vh] overflow-y-auto">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Dados da Entrega
            </p>

            {/* Erro de validação */}
            {erroForm && (
              <p className="bg-red-50 border border-red-400 text-red-600 rounded p-2 text-xs">
                {erroForm}
              </p>
            )}

            {/* Rua e número (obrigatório) */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Rua e número *
              </label>
              <input
                type="text"
                value={comanda.endereco}
                onChange={(e) => {
                  atualizar({ endereco: e.target.value, distanciaKm: null });
                  setResultadoEntrega(null);
                }}
                placeholder="Rua, número, bairro..."
                className="w-full bg-white border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            {/* Complemento (opcional) */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Complemento
              </label>
              <input
                type="text"
                value={comanda.complemento}
                onChange={(e) => atualizar({ complemento: e.target.value })}
                placeholder="Apto, bloco, ponto de referência..."
                className="w-full bg-white border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {/* Calcular a entrega pela distância (zona no mapa) */}
            <button
              type="button"
              onClick={() => void calcularEntrega()}
              disabled={calculandoEntrega || !!erroZonas || !zonasCfg.zonas.some((zona) => zona.ativo)}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold px-4 py-2 rounded-lg transition"
            >
              {calculandoEntrega
                ? "Calculando..."
                : "📍 Calcular entrega pelo endereço"}
            </button>

            {/* Resultado do cálculo da entrega */}
            {resultadoEntrega && (
              <p
                className={`rounded p-2 text-xs ${
                  resultadoEntrega.ok
                    ? "bg-green-50 border border-green-400 text-green-700"
                    : "bg-red-50 border border-red-400 text-red-600"
                }`}
              >
                {resultadoEntrega.ok ? "✓ " : "⚠ "}
                {resultadoEntrega.texto}
              </p>
            )}

            {!temZonas && (
              <p className="text-xs text-amber-600">
                Nenhuma zona de entrega cadastrada. Configure em Configurações →
                Entrega por Zonas.
              </p>
            )}
            {erroZonas && (
              <p role="alert" className="text-xs text-red-600">
                {erroZonas}
              </p>
            )}

            {/* Taxa + motoboy lado a lado */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Taxa de entrega (R$)
                </label>
                <input
                  type="text"
                  value={zonaAtual ? String(zonaAtual.taxa).replace(".", ",") : ""}
                  readOnly
                  placeholder="Calcule pelo endereço"
                  className="w-full bg-gray-100 border border-gray-200 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Motoboy *
                </label>
                <select
                  value={comanda.motoboyId}
                  onChange={(e) => atualizar({ motoboyId: e.target.value })}
                  className="w-full bg-white border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Selecione...</option>
                  {motoboys
                    .filter((m) => m.ativo)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome} {m.placa ? `(${m.placa})` : ""}
                      </option>
                    ))}
                </select>
                {motoboys.filter((m) => m.ativo).length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">
                    Nenhum motoboy ativo. Cadastre na aba Motoboys.
                  </p>
                )}
              </div>
            </div>

            {/* Prévia do total com taxa */}
            <p className="text-sm text-gray-700 bg-white border border-gray-200 rounded p-2">
              Produtos: {formatarMoeda(total)} + Taxa:{" "}
              {formatarMoeda(taxaNum)} ={" "}
              <b className="text-green-600">
                {formatarMoeda(total + taxaNum)}
              </b>
            </p>
          </div>
        )}

        {/* ================= MESA: seleção inline (livres/ocupadas) ================= */}
        {comanda.tipoVenda === "mesa" && (
          <div className="bg-gray-50 rounded-lg p-3 flex flex-col gap-2 max-h-[45vh] overflow-y-auto">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Selecionar Mesa
            </p>

            {/* Erro de validação */}
            {erroMesa && (
              <p className="bg-red-50 border border-red-400 text-red-600 rounded p-2 text-xs">
                {erroMesa}
              </p>
            )}

            {carregandoMesas ? (
              <p className="text-gray-400 text-center py-4 text-sm">
                Carregando mesas...
              </p>
            ) : mesas.length === 0 ? (
              <p className="text-gray-400 text-center py-4 text-sm">
                Nenhuma mesa cadastrada. Cadastre na aba Mesa do menu.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {mesas.map((m) => {
                  const livre = m.status === "disponivel";
                  const escolhida = comanda.mesaEscolhida === m.numero;
                  const confirmando = liberando === m.numero;
                  return (
                    <button
                      key={m.numero}
                      onClick={() =>
                        livre ? atualizar({ mesaEscolhida: m.numero }) : liberarMesa(m)
                      }
                      title={
                        livre
                          ? `Usar a mesa ${m.numero}`
                          : confirmando
                            ? `Confirma liberar a mesa ${m.numero}?`
                            : `Clique para liberar a mesa ${m.numero}`
                      }
                      className={`rounded-lg p-2 border-2 text-center transition ${
                        !livre
                          ? confirmando
                            ? "border-amber-500 bg-amber-100"
                            : "border-red-300 bg-red-50 hover:border-green-400 hover:bg-green-50"
                          : escolhida
                            ? "border-green-600 bg-green-50"
                            : "border-gray-200 bg-white hover:border-green-400"
                      }`}
                    >
                      <p
                        className={`text-xl font-extrabold ${
                          livre ? "text-green-600" : "text-red-500"
                        }`}
                      >
                        {m.numero}
                      </p>
                      <p
                        className={`text-[10px] font-bold uppercase tracking-wider ${
                          livre ? "text-green-600" : "text-red-500"
                        }`}
                      >
                        {livre
                          ? "Livre"
                          : confirmando
                            ? "Liberar?"
                            : "Ocupada (liberar)"}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Forma de pagamento */}
        <div className="bg-gray-50 rounded-lg p-3">
          <label className="block text-xs text-gray-400 mb-1">
            Forma de pagamento
          </label>
          <select
            value={comanda.formaPagamento}
            onChange={(e) => atualizar({ formaPagamento: e.target.value })}
            className="w-full bg-white border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {pagamentos.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-gray-400 mt-1">
            Adicione novas formas em Configurações.
          </p>
        </div>

        {falhaImpressao && <div role="alert" className="mb-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="mb-2">{falhaImpressao.mensagem}</p>
          <ImpressaoPedido pedido={falhaImpressao.pedido} />
          <button type="button" onClick={() => setFalhaImpressao(null)} className="ml-2 underline">Dispensar aviso</button>
        </div>}

        {/* Botão verde grande com o total */}
        <button
          onClick={() => void finalizarPedido()}
          disabled={enviando || carrinho.length === 0}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg py-3 transition"
        >
          <span className="block text-2xl font-bold">{formatarMoeda(total)}</span>
          <span className="block text-xs opacity-90">
            {enviando ? "Salvando e enviando à impressora..." : comanda.tipoVenda === "delivery"
              ? "Finalizar Delivery"
              : comanda.tipoVenda === "mesa"
                ? "Finalizar na Mesa"
                : "Finalizar no Balcão"}
          </span>
        </button>
      </aside>

      {/* ================= MODAL: ADICIONAR ITEM COM OBSERVAÇÃO ================= */}
      {produtoAdicionando && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-96 max-w-full">
            <h3 className="text-lg font-bold mb-1">{produtoAdicionando.name}</h3>
            <p className="text-sm text-gray-400 mb-4">
              {produtoAdicionando.code} — {formatarMoeda(Number(produtoAdicionando.price))}
            </p>
            <label className="block text-xs text-gray-400 mb-1">
              Observação (opcional)
            </label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex: sem cebola, sem gelo, bem passado..."
              rows={3}
              autoFocus
              className="w-full bg-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  adicionar(produtoAdicionando, observacao.trim());
                  setProdutoAdicionando(null);
                  setObservacao("");
                }}
                className="flex-1 bg-green-600 hover:bg-green-700 font-bold py-3 rounded-lg transition"
              >
                Adicionar ao carrinho
              </button>
              <button
                onClick={() => {
                  setProdutoAdicionando(null);
                  setObservacao("");
                }}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 rounded-lg text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

    </fieldset>
  );
}
