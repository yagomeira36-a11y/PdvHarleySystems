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
import { lerPagamentos } from "@/lib/pagamentos";
import type { Order } from "@/lib/supabase";
import { imprimirPedidoAutomatico } from "@/lib/qz";
import ImpressaoPedido from "./ImpressaoPedido";
import { caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";
import {
  CATEGORIAS_PADRAO,
  inicializarCategorias,
  lerCategorias,
  salvarCategorias,
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
  const pedidoGravado = useRef<Order | null>(null);
  const [falhaImpressao, setFalhaImpressao] = useState<{ pedido: Order; mensagem: string } | null>(null);

  async function concluirPedido(pedido: Order, texto: string) {
    const resultado = await imprimirPedidoAutomatico(pedido);
    setFalhaImpressao(resultado.erro ? { pedido, mensagem: resultado.mensagem } : null);
    aoPedidoCriado(resultado.erro ? resultado.mensagem : `${texto} Comprovante e comanda enviados ao QZ Tray.`, resultado.erro ? "erro" : "ok");
    if (!resultado.erro) router.push("/pdv?aba=kds");
  }

  async function finalizarPedido() {
    if (finalizacaoEmCurso.current) return;
    if (!comanda) return;
    if (!comanda.carrinho.length) { aoPedidoCriado("Adicione itens ao carrinho primeiro.", "erro"); return; }
    finalizacaoEmCurso.current = true;
    pedidoGravado.current = null;
    try {
      if (comanda.tipoVenda === "delivery") await confirmarDelivery();
      else if (comanda.tipoVenda === "mesa") await finalizarMesa();
      else await finalizarBalcao();
    } catch (erro) {
      const salvo = pedidoGravado.current as Order | null;
      if (salvo) removerComanda(comanda.id);
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

  // Categorias de produto (lista da loja, com opção de criar novas)
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_PADRAO);
  const [novaCategoria, setNovaCategoria] = useState(""); // texto da categoria nova
  const [adicionandoCategoria, setAdicionandoCategoria] = useState(false); // mostra o campo "+"

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

  // Fecha/descarta uma comanda
  function removerComanda(id: string) {
    const alvo = comandas.find((c) => c.id === id);
    if (alvo && alvo.carrinho.length > 0) {
      const confirmou = window.confirm(
        `Descartar o ${rotuloComanda(alvo)}? Os itens dele serão perdidos.`
      );
      if (!confirmou) return;
    }
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

  // ============================================================
  // CARREGAR CARDÁPIO, MOTOBOYS E CONFIGURAÇÕES DA EMPRESA
  // ============================================================
  useEffect(() => {
    if (!supabase) return;
    const sessao = getSessao();
    if (!sessao) return; // sem loja logada, não carrega nada
    supabase
      .from("products")
      .select("*")
      .eq("loja_id", sessao.id)
      .order("code")
      .then(({ data }) => {
        const lista = (data || []) as Product[];
        setProdutos(lista);
        try {
          setCategorias(inicializarCategorias(
            sessao.id,
            lista.map((produto) => produto.category)
          ));
        } catch {
          aoPedidoCriado("Não foi possível carregar as categorias no navegador.", "erro");
        }
      });
    supabase
      .from("motoboys")
      .select("*")
      .eq("loja_id", sessao.id)
      .then(({ data }) => setMotoboys((data || []) as Motoboy[]));
    // Formas de pagamento da loja
    const listaPagamentos = lerPagamentos(sessao.id);
    setPagamentos(listaPagamentos);
    // Categorias de produto da loja (lista livre, salva no navegador)
    setCategorias(lerCategorias(sessao.id));
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
  // CRIAR CATEGORIA NOVA (ex: "molhos") direto nas pills do balcão
  // ============================================================
  function confirmarNovaCategoria() {
    const s = getSessao();
    const nome = novaCategoria.trim().toUpperCase();
    if (!s) return;
    if (!nome || nome === "TODOS") {
      aoPedidoCriado("Informe uma categoria diferente de TODOS.", "erro");
      return;
    }
    if (categorias.some((c) => c.toUpperCase() === nome)) {
      aoPedidoCriado("Essa categoria já existe.", "erro");
      return;
    }
    const lista = [...categorias, nome];
    try {
      salvarCategorias(s.id, lista);
    } catch {
      aoPedidoCriado("Não foi possível salvar a categoria no navegador.", "erro");
      return;
    }
    setCategorias(lista);
    setCategoria(nome);
    setAdicionandoCategoria(false);
    setNovaCategoria("");
  }

  function excluirCategoria(nome: string) {
    const s = getSessao();
    if (!s) return;
    const confirmou = window.confirm(
      `Excluir a categoria "${nome}" da lista? Os produtos serão mantidos e continuarão disponíveis em TODOS.`
    );
    if (!confirmou) return;

    const lista = categorias.filter((categoriaSalva) => categoriaSalva !== nome);
    try {
      salvarCategorias(s.id, lista);
    } catch {
      aoPedidoCriado("Não foi possível excluir a categoria no navegador.", "erro");
      return;
    }
    setCategorias(lista);
    if (categoria === nome) setCategoria("TODOS");
  }

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

    // 4) Salva o cliente para reconhecer pelo telefone na próxima venda
    if (nomeCliente && telNormalizado.length >= 10) {
      await supabase.from("clientes").upsert(
        {
          nome: nomeCliente,
          telefone: telNormalizado,
          loja_id: sessao.id,
        },
        { onConflict: "loja_id,telefone" }
      );
    }

    // 5) Fecha a comanda, avisa e vai para a cozinha (KDS)
    setErroBalcao(null);
    const rotulo = comanda.rotulo;
    removerComanda(comanda.id);
    await concluirPedido(pedido as Order, `${rotuloPedido(pedido as Order)} de balcão criado! Total: ${formatarMoeda(total)}`);
    void rotulo;
  }

  // ============================================================
  // CONFIRMAR PEDIDO DELIVERY (telefone + endereço + taxa + motoboy)
  // ============================================================
  async function confirmarDelivery() {
    if (!supabase || enviando || !comanda) return;
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
    if (erroZonas) {
      setErroForm(erroZonas);
      return;
    }
    if (!zonasCfg.zonas.some((zona) => zona.ativo)) {
      setErroForm("Cadastre uma zona de entrega ativa em Configurações → Entrega por Zonas.");
      return;
    }
    if (comanda.distanciaKm == null) {
      setErroForm(
        'Calcule a entrega pelo endereço (botão "Calcular entrega") para definir a zona e a taxa.'
      );
      return;
    }
    if (foraDeArea || !zonaAtual) {
      setErroForm(
        `O endereço está fora da área de entrega (${comanda.distanciaKm.toFixed(
          1
        )} km). Não entregamos nesse endereço.`
      );
      return;
    }
    const taxaNum = zonaAtual.taxa;
    const totalComTaxa = total + taxaNum;
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

    // 6) Fecha a comanda
    const motoboy = motoboys.find((m) => m.id === comanda.motoboyId);
    setAvisoCliente(null);
    removerComanda(comanda.id);
    await concluirPedido(pedido as Order, `${rotuloPedido(pedido as Order)} de delivery criado! Motoboy: ${motoboy?.nome ?? "—"}`);
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
    if (erroZonas) {
      setResultadoEntrega({ ok: false, texto: erroZonas });
      return;
    }
    if (!zonasCfg.zonas.some((zona) => zona.ativo)) {
      setResultadoEntrega({
        ok: false,
        texto: "Nenhuma zona ativa cadastrada. Configure em Configurações → Entrega por Zonas.",
      });
      return;
    }
    const enderecoCompleto = [comanda.endereco, comanda.complemento]
      .filter(Boolean)
      .join(", ")
      .trim();
    if (enderecoCompleto.length < 4) {
      setResultadoEntrega({
        ok: false,
        texto: "Informe a rua e o número do cliente para calcular.",
      });
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
        setResultadoEntrega({
          ok: false,
          texto:
            "Não encontramos esse endereço. Confira rua, número, bairro e cidade.",
        });
        return;
      }
      // Distância da loja até o cliente
      const dist = distanciaKm(zonasCfg.lat, zonasCfg.lng, achado.lat, achado.lng);
      const zona = zonaParaDistancia(dist, zonasCfg.zonas);
      if (!zona) {
        atualizar({ distanciaKm: dist, taxa: "" });
        setResultadoEntrega({
          ok: false,
          texto: `Cliente a ${dist.toFixed(1)} km — fora da área de entrega.`,
        });
        return;
      }
      const indice =
        zonasOrdenadas(zonasCfg.zonas).findIndex((z) => z.id === zona.id) + 1;
      // Preenche a taxa da zona automaticamente
      atualizar({ distanciaKm: dist, taxa: String(zona.taxa) });
      setResultadoEntrega({
        ok: true,
        texto: `Cliente a ${dist.toFixed(1)} km — Zona ${indice} (até ${
          zona.raioKm
        } km) — taxa ${formatarMoeda(zona.taxa)}.`,
      });
    } catch (erro) {
      setResultadoEntrega({
        ok: false,
        texto:
          erro instanceof Error ? erro.message : "Falha ao calcular a entrega.",
      });
    } finally {
      setCalculandoEntrega(false);
    }
  }

  // ============================================================
  // PEDIDO NA MESA: carregar mesas livres/ocupadas da loja
  // ============================================================
  function carregarMesas() {
    setLiberando(null);
    setErroMesa(null);
    if (!supabase) return;
    const sessao = getSessao();
    if (!sessao) return;
    setCarregandoMesas(true);
    supabase
      .from("mesas")
      .select("*")
      .eq("loja_id", sessao.id)
      .order("numero")
      .then(({ data }) => {
        setMesas((data || []) as Mesa[]);
        setCarregandoMesas(false);
      });
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
    if (supabase && mesa.id) {
      const { error } = await supabase
        .from("mesas")
        .update({ status: "disponivel" })
        .eq("id", mesa.id);
      if (error) {
        setErroMesa("Erro ao liberar a mesa: " + error.message);
        return;
      }
      carregarMesas();
    } else {
      setMesas((atual) =>
        atual.map((m) =>
          m.numero === mesa.numero ? { ...m, status: "disponivel" } : m
        )
      );
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

    // 5) Fecha a comanda
    const numeroMesa = comanda.mesaEscolhida;
    removerComanda(comanda.id);
    await concluirPedido(pedido as Order, `${rotuloPedido(pedido as Order)} da mesa ${numeroMesa} criado! Total: ${formatarMoeda(total)}`);
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
                    removerComanda(c.id);
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
          {["TODOS", ...categorias].map((c) => (
            <span key={c} className="inline-flex items-center gap-1">
              <button
                onClick={() => setCategoria(c)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${
                  categoria === c
                    ? "bg-green-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                {c}
              </button>
              {c !== "TODOS" && (
                <button
                  type="button"
                  onClick={() => excluirCategoria(c)}
                  title={`Excluir categoria ${c}`}
                  aria-label={`Excluir categoria ${c}`}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-gray-500 hover:bg-red-100 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {adicionandoCategoria ? (
            <span className="flex items-center gap-1.5">
              <input
                type="text"
                value={novaCategoria}
                onChange={(e) => setNovaCategoria(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmarNovaCategoria()}
                placeholder="Nova categoria"
                autoFocus
                className="bg-white border border-green-400 rounded-full px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                onClick={confirmarNovaCategoria}
                title="Salvar categoria"
                className="bg-green-600 hover:bg-green-700 text-white rounded-full w-7 h-7 text-sm font-bold transition"
              >
                ✓
              </button>
              <button
                onClick={() => {
                  setAdicionandoCategoria(false);
                  setNovaCategoria("");
                }}
                title="Cancelar"
                className="bg-gray-200 hover:bg-gray-300 text-gray-600 rounded-full w-7 h-7 text-sm font-bold transition"
              >
                ✕
              </button>
            </span>
          ) : (
            <button
              onClick={() => setAdicionandoCategoria(true)}
              title="Adicionar categoria"
              className="bg-white hover:bg-green-50 text-green-700 border border-dashed border-green-400 rounded-full w-8 h-8 text-lg font-bold transition"
            >
              +
            </button>
          )}
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
