"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabase, normalizarTelefone, type Configuracao, type Product } from "@/lib/supabase";
import {
  carregarDeliveryZones,
  configZonasVazia,
  distanciaKm,
  geocodificar,
  zonaParaDistancia,
  type ConfigZonas,
} from "@/lib/zonas";

type LojaPublica = { id: string; nome?: string | null; nome_loja?: string | null; slug?: string | null };
type ItemCarrinho = { produto: Product; quantidade: number; observacao: string };
type StoreSettings = {
  nome_loja: string;
  categoria: string;
  telefone_fixo: string;
  whatsapp: string;
  endereco: string;
  maps_link: string;
  instagram: string;
  facebook: string;
  banner_url: string;
  logo_url: string;
  cor_principal: string;
  status_manual: "aberto" | "fechado";
  abre_as: string;
  fecha_as: string;
  horario_automatico: boolean;
  entrega_min: number;
  entrega_max: number;
  retirada_min: number;
  retirada_max: number;
  permitir_entrega: boolean;
  permitir_retirada: boolean;
  apps: {
    ifood: { ativo: boolean; link: string };
    food99: { ativo: boolean; link: string };
    keeta: { ativo: boolean; link: string };
    rappi: { ativo: boolean; link: string };
    outros: Array<{ id: string; nome: string; link: string; icone: string }>;
  };
  horarios: Record<"segunda" | "terca" | "quarta" | "quinta" | "sexta" | "sabado" | "domingo", { ativo: boolean; abre: string; fecha: string }>;
};

const VERDE_PADRAO = "#2E9E4A";
const CINZA = "#333333";
const SETTINGS_PADRAO: StoreSettings = {
  nome_loja: "Minha Loja",
  categoria: "",
  telefone_fixo: "",
  whatsapp: "",
  endereco: "",
  maps_link: "",
  instagram: "",
  facebook: "",
  banner_url: "",
  logo_url: "",
  cor_principal: VERDE_PADRAO,
  status_manual: "aberto",
  abre_as: "18:00",
  fecha_as: "23:00",
  horario_automatico: false,
  entrega_min: 35,
  entrega_max: 50,
  retirada_min: 20,
  retirada_max: 35,
  permitir_entrega: true,
  permitir_retirada: true,
  apps: {
    ifood: { ativo: false, link: "" },
    food99: { ativo: false, link: "" },
    keeta: { ativo: false, link: "" },
    rappi: { ativo: false, link: "" },
    outros: [],
  },
  horarios: {
    segunda: { ativo: true, abre: "18:00", fecha: "23:00" },
    terca: { ativo: true, abre: "18:00", fecha: "23:00" },
    quarta: { ativo: true, abre: "18:00", fecha: "23:00" },
    quinta: { ativo: true, abre: "18:00", fecha: "23:00" },
    sexta: { ativo: true, abre: "18:00", fecha: "23:00" },
    sabado: { ativo: true, abre: "18:00", fecha: "23:00" },
    domingo: { ativo: false, abre: "18:00", fecha: "23:00" },
  },
};

function moeda(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function IconeWhatsApp({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9 9 0 0 1-4-.9L3 20l1-4.7A8.4 8.4 0 1 1 21 11.5Z" />
      <path d="M8.5 8.5c.5 2 2 3.5 4 4l1-1.2c.3-.3.7-.3 1-.1l1.5 1c.3.2.4.6.3.9-.3 1-1.2 1.6-2.2 1.5-3.7-.3-6.7-3.3-7-7-.1-1 .5-1.9 1.5-2.2.3-.1.7 0 .9.3l1 1.5c.2.3.2.7-.1 1l-1.9 1.3Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="white" />
    </svg>
  );
}

function ConteudoCardapio() {
  const supabase = getSupabase();
  const searchParams = useSearchParams();
  const lojaId = searchParams?.get("loja")?.trim() || null;
  const [loja, setLoja] = useState<LojaPublica | null>(null);
  const [config, setConfig] = useState<Configuracao | null>(null);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [zonasEntrega, setZonasEntrega] = useState<ConfigZonas>(configZonasVazia());
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState("");
  const [categoria, setCategoria] = useState("TODOS");
  const [pesquisa, setPesquisa] = useState("");
  const [selecionado, setSelecionado] = useState<Product | null>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [observacao, setObservacao] = useState("");
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [checkoutAberto, setCheckoutAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [telefoneCliente, setTelefoneCliente] = useState("");
  const [tipoEntrega, setTipoEntrega] = useState<"Entrega" | "Retirada">("Entrega");
  const [endereco, setEndereco] = useState("");
  const [numeroEndereco, setNumeroEndereco] = useState("");
  const [complementoEndereco, setComplementoEndereco] = useState("");
  const [bairroEndereco, setBairroEndereco] = useState("");
  const [pagamento, setPagamento] = useState("Pix");
  const [observacaoPedido, setObservacaoPedido] = useState("");
  const [taxaCalculada, setTaxaCalculada] = useState<number | null>(null);
  const [foraArea, setForaArea] = useState(false);
  const [calculandoTaxa, setCalculandoTaxa] = useState(false);
  const [finalizandoPedido, setFinalizandoPedido] = useState(false);
  const [erroCheckout, setErroCheckout] = useState("");
  const [pedidoConfirmado, setPedidoConfirmado] = useState<{
    numero: string | number;
    whatsappUrl: string | null;
  } | null>(null);

  useEffect(() => {
    console.log("lojaId da URL:", lojaId);
  }, [lojaId]);

  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setCarregando(true);
      setErroCarregamento("");
      setLoja(null);
      setProdutos([]);
      if (!lojaId) { setCarregando(false); return; }
      if (!supabase) {
        setErroCarregamento("Não foi possível conectar ao cardápio.");
        setCarregando(false);
        return;
      }

      const lojaRes = await supabase
        .from("lojas")
        .select("id,nome,nome_loja,slug")
        .eq("id", lojaId)
        .maybeSingle();
      if (!ativo) return;
      if (lojaRes.error || !lojaRes.data) {
        console.error("Erro ao localizar a loja do cardápio:", lojaRes.error?.message || "Loja não encontrada");
        setErroCarregamento("Loja não encontrada. Confira o ID no link do cardápio.");
        setCarregando(false);
        return;
      }

      const escolhida = lojaRes.data as LojaPublica;
      const [configRes, produtosRes] = await Promise.all([
        supabase.from("configuracoes").select("*").eq("loja_id", escolhida.id).maybeSingle(),
        supabase.from("products").select("*").eq("loja_id", escolhida.id).order("category").order("name"),
      ]);
      let settingsApi: StoreSettings | null = null;
      let zonasApi: ConfigZonas;
      try {
        const [settingsResponse, zonas] = await Promise.all([
          fetch(`/api/store-settings?loja=${encodeURIComponent(escolhida.id)}`, { cache: "no-store" }),
          carregarDeliveryZones(escolhida.id, false),
        ]);
        settingsApi = settingsResponse.ok ? await settingsResponse.json() as StoreSettings : null;
        zonasApi = zonas;
      } catch (error) {
        console.error("Erro ao carregar as zonas de entrega:", error);
        if (ativo) {
          setErroCarregamento("Não foi possível carregar as zonas de entrega desta loja.");
          setCarregando(false);
        }
        return;
      }
      if (!ativo) return;
      if (produtosRes.error) {
        console.error("Erro ao carregar itens do cardápio:", produtosRes.error.message);
        setErroCarregamento("Não foi possível carregar os itens desta loja.");
        setCarregando(false);
        return;
      }
      const itens = (produtosRes.data || []) as Product[];
      console.log("quantidade de itens:", itens.length);
      setLoja(escolhida);
      setConfig((configRes.data as Configuracao | null) || null);
      setSettings(settingsApi);
      setZonasEntrega(zonasApi);
      setProdutos(itens);
      setCarregando(false);
    }
    void carregar();
    return () => { ativo = false; };
  }, [supabase, lojaId]);

  const categorias = useMemo(() => {
    const nomes = Array.from(new Set(produtos.map((produto) => produto.category).filter(Boolean)));
    return ["TODOS", ...nomes];
  }, [produtos]);

  const filtrados = useMemo(() => {
    const texto = pesquisa.trim().toLowerCase();
    return produtos.filter((produto) =>
      (categoria === "TODOS" || produto.category === categoria) &&
      (!texto || `${produto.name} ${produto.description || ""}`.toLowerCase().includes(texto))
    );
  }, [produtos, categoria, pesquisa]);

  const quantidadeTotal = carrinho.reduce((total, item) => total + item.quantidade, 0);
  const subtotal = carrinho.reduce((total, item) => total + item.quantidade * Number(item.produto.price), 0);
  const settingsSafe: StoreSettings = {
    ...SETTINGS_PADRAO,
    ...(settings || {}),
    apps: {
      ...SETTINGS_PADRAO.apps,
      ...(settings?.apps || {}),
      ifood: { ...SETTINGS_PADRAO.apps.ifood, ...(settings?.apps?.ifood || {}) },
      food99: { ...SETTINGS_PADRAO.apps.food99, ...(settings?.apps?.food99 || {}) },
      keeta: { ...SETTINGS_PADRAO.apps.keeta, ...(settings?.apps?.keeta || {}) },
      rappi: { ...SETTINGS_PADRAO.apps.rappi, ...(settings?.apps?.rappi || {}) },
      outros: Array.isArray(settings?.apps?.outros) ? settings?.apps?.outros || [] : [],
    },
    horarios: { ...SETTINGS_PADRAO.horarios, ...(settings?.horarios || {}) },
  };
  const VERDE = settingsSafe.cor_principal || VERDE_PADRAO;
  const taxaEntrega = tipoEntrega === "Entrega" && settingsSafe.permitir_entrega
    ? (taxaCalculada ?? 0)
    : 0;
  const total = subtotal + taxaEntrega;
  const nomeLoja = settingsSafe.nome_loja || config?.nome_empresa || loja?.nome_loja || loja?.nome || "Minha Loja";
  const categoriaLoja = settingsSafe.categoria || "";
  const telefoneFixo = normalizarTelefone(settingsSafe.telefone_fixo || config?.telefone || "");
  const telefone = normalizarTelefone(settingsSafe.whatsapp || (config as (Configuracao & { whatsapp?: string | null }) | null)?.whatsapp || "");
  const enderecoLoja = settingsSafe.endereco || config?.endereco || "";
  const instagramValor = String(settingsSafe.instagram || "").trim();
  const instagramHandle = instagramValor
    .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^@/, "");
  const instagramUrl = instagramValor.startsWith("http")
    ? instagramValor
    : instagramHandle
      ? `https://instagram.com/${instagramHandle}`
      : "";
  const banner = settingsSafe.banner_url || "";
  const logo = settingsSafe.logo_url || (config as (Configuracao & { logo_url?: string | null }) | null)?.logo_url || "";
  const linkMapa = settingsSafe.maps_link || (enderecoLoja ? `https://maps.google.com/?q=${encodeURIComponent(enderecoLoja)}` : "");
  function horarioAbertoAgora() {
    if (settingsSafe.status_manual === "fechado") return false;
    const agora = new Date();
    if (!settingsSafe.horario_automatico) return true;
    const diaPorIndice = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] as const;
    const dia = diaPorIndice[agora.getDay()];
    const horario = settingsSafe.horarios[dia];
    if (!horario?.ativo) return false;
    const atual = agora.getHours() * 60 + agora.getMinutes();
    const [abreHora, abreMinuto] = String(horario.abre || "18:00").split(":").map((parte) => Number(parte) || 0);
    const [fechaHora, fechaMinuto] = String(horario.fecha || "23:00").split(":").map((parte) => Number(parte) || 0);
    const abre = abreHora * 60 + abreMinuto;
    const fecha = fechaHora * 60 + fechaMinuto;
    return abre <= fecha ? atual >= abre && atual <= fecha : atual >= abre || atual <= fecha;
  }
  const aberto = horarioAbertoAgora();
  const diaHojeIndice = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] as const;
  const horarioHoje = settingsSafe.horarios[diaHojeIndice[new Date().getDay()]];

  function adicionarAoCarrinho() {
    if (!selecionado) return;
    setCarrinho((atual) => {
      const existente = atual.find((item) => item.produto.id === selecionado.id && item.observacao.trim() === observacao.trim());
      return existente
        ? atual.map((item) => item === existente ? { ...item, quantidade: item.quantidade + quantidade } : item)
        : [...atual, { produto: selecionado, quantidade, observacao: observacao.trim() }];
    });
    setSelecionado(null);
    setQuantidade(1);
    setObservacao("");
  }

  async function calcularTaxaEntrega() {
    const enderecoCompleto = [endereco, numeroEndereco, bairroEndereco].filter(Boolean).join(", ");
    if (!enderecoCompleto.trim()) {
      setTaxaCalculada(null);
      setForaArea(false);
      return;
    }
    setCalculandoTaxa(true);
    setForaArea(false);
    try {
      const centro = zonasEntrega;
      if (!centro.zonas.some((zona) => zona.ativo)) {
        setTaxaCalculada(null);
        setForaArea(true);
        return;
      }
      const achado = await geocodificar(enderecoCompleto, centro);
      if (!achado) {
        setTaxaCalculada(null);
        setForaArea(true);
        return;
      }
      const distancia = distanciaKm(centro.lat, centro.lng, achado.lat, achado.lng);
      const zona = zonaParaDistancia(distancia, centro.zonas);
      if (!zona) {
        setTaxaCalculada(null);
        setForaArea(true);
      } else {
        setTaxaCalculada(Number(zona.taxa));
        setForaArea(false);
      }
    } catch (error) {
      setTaxaCalculada(null);
      setForaArea(true);
      console.error("Erro ao calcular a taxa de entrega:", error);
    } finally {
      setCalculandoTaxa(false);
    }
  }

  async function finalizarPedido() {
    if (
      finalizandoPedido ||
      !loja?.id ||
      !nome.trim() ||
      !telefoneCliente.trim() ||
      !carrinho.length ||
      (tipoEntrega === "Entrega" && (
        !endereco.trim() ||
        !numeroEndereco.trim() ||
        !bairroEndereco.trim() ||
        taxaCalculada === null ||
        foraArea
      ))
    ) return;

    setFinalizandoPedido(true);
    setErroCheckout("");
    try {
      const response = await fetch("/api/cardapio/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loja_id: loja.id,
          customer_name: nome,
          telefone: telefoneCliente,
          tipo: tipoEntrega,
          endereco,
          numero: numeroEndereco,
          complemento: complementoEndereco,
          bairro: bairroEndereco,
          pagamento,
          taxa_entrega: taxaEntrega,
          observacao: observacaoPedido,
          items: carrinho.map((item) => ({
            product_id: item.produto.id,
            quantity: item.quantidade,
            observation: item.observacao,
          })),
        }),
      });
      const resultado = await response.json();
      if (!response.ok) throw new Error(resultado.error || "Não foi possível registrar o pedido.");

      const pedido = resultado.pedido as { id: string; numero_pedido: number | null };
      const numeroPedido = pedido.numero_pedido || pedido.id.slice(0, 8).toUpperCase();
      const itensMensagem = carrinho.map((item) => [
        `${item.quantidade}x ${item.produto.name} - ${moeda(item.quantidade * Number(item.produto.price))}`,
        item.observacao ? `Obs: ${item.observacao}` : null,
      ].filter(Boolean).join("\n"));
      const enderecoCliente = [endereco, numeroEndereco, complementoEndereco, bairroEndereco].filter(Boolean).join(", ");
      const mensagem = [
        `*PEDIDO #${numeroPedido}*`,
        `Nome: ${nome.trim()}`,
        `Telefone: ${normalizarTelefone(telefoneCliente)}`,
        tipoEntrega,
        tipoEntrega === "Entrega" ? `Endereço: ${enderecoCliente}` : null,
        "---",
        itensMensagem.join("\n"),
        observacaoPedido.trim() ? `Observação do pedido: ${observacaoPedido.trim()}` : null,
        "---",
        `Total: ${moeda(total)}`,
        `Pagamento: ${pagamento}`,
      ].filter(Boolean).join("\n");
      const telefoneComCodigoPais = telefone.startsWith("55") ? telefone : `55${telefone}`;
      const whatsappUrl = telefoneComCodigoPais.length > 4
        ? `https://wa.me/${telefoneComCodigoPais}?text=${encodeURIComponent(mensagem)}`
        : null;

      setPedidoConfirmado({ numero: numeroPedido, whatsappUrl });
      setCheckoutAberto(false);
      setCarrinho([]);
    } catch (error) {
      setErroCheckout(error instanceof Error ? error.message : "Não foi possível registrar o pedido.");
    } finally {
      setFinalizandoPedido(false);
    }
  }

  useEffect(() => {
    if (!pedidoConfirmado?.whatsappUrl) return;
    const timeout = window.setTimeout(() => {
      window.location.href = pedidoConfirmado.whatsappUrl!;
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [pedidoConfirmado]);

  if (!lojaId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white p-8 text-center">
        <h1 className="text-2xl font-black text-red-700 sm:text-4xl">
          LOJA NÃO INFORMADA - Use o link com ?loja=ID
        </h1>
      </main>
    );
  }
  if (carregando) return <main className="min-h-screen bg-white p-8 text-center text-gray-500">Carregando cardápio...</main>;
  if (erroCarregamento) return <main className="flex min-h-screen items-center justify-center bg-white p-8 text-center text-2xl font-black text-red-700">{erroCarregamento}</main>;

  return (
    <main className="min-h-screen bg-[#f5f5f5] pb-24 lg:pb-0">
      <header>
        <div className="h-52 bg-[#ddd] bg-cover bg-center sm:h-64 lg:h-72" style={banner ? { backgroundImage: `url(${banner})` } : undefined} />
        <div className="bg-[#333333] text-white">
          <div className="mx-auto max-w-7xl px-4 pb-5 sm:px-6">
            <div className="-mt-12 flex flex-col items-start gap-4 sm:-mt-14 sm:flex-row sm:items-end">
              {logo ? (
                <img src={logo} alt={nomeLoja} className="h-24 w-24 rounded-full border-4 border-white object-cover shadow-lg sm:h-28 sm:w-28" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-white bg-[#2E9E4A] text-4xl font-black shadow-lg sm:h-28 sm:w-28">
                  {nomeLoja.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="flex-1 pb-1 sm:pb-3">
                <div className="flex flex-col items-start gap-1.5">
                  <h1 className="text-xl font-black sm:text-2xl">{nomeLoja}</h1>
                  {categoriaLoja && <p className="text-sm text-gray-300">{categoriaLoja}</p>}
                  {instagramHandle && instagramUrl && (
                    <a href={instagramUrl} target="_blank" rel="noreferrer" aria-label="Instagram" className="inline-flex items-center gap-2 text-sm text-white">
                      <InstagramIcon />
                      <span>@{instagramHandle}</span>
                    </a>
                  )}
                  {enderecoLoja && (
                    <p className="text-xs text-gray-300 sm:text-sm">
                      {enderecoLoja}
                      {linkMapa && <a href={linkMapa} target="_blank" rel="noreferrer" className="ml-2 font-bold underline" style={{ color: "#63C97C" }}>ver mapa</a>}
                    </p>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                  {telefoneFixo && (
                    <a href={telefone ? `https://wa.me/${telefone}` : `tel:${telefoneFixo}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5">
                      <IconeWhatsApp /> <span>{telefoneFixo}</span>
                    </a>
                  )}
                  {settingsSafe.facebook && (
                    <div className="flex items-center gap-3 text-gray-300">
                      {settingsSafe.facebook && <a href={String(settingsSafe.facebook)} target="_blank" rel="noreferrer" aria-label="Facebook" className="hover:text-white">f</a>}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {(() => {
              const apps = settingsSafe.apps;
              const principais = [
                apps?.ifood?.ativo && apps.ifood.link ? { nome: "iFood", link: apps.ifood.link, tipo: "ifood" } : null,
                apps?.food99?.ativo && apps.food99.link ? { nome: "99Food", link: apps.food99.link, tipo: "99" } : null,
                apps?.keeta?.ativo && apps.keeta.link ? { nome: "Keeta", link: apps.keeta.link, tipo: "keeta" } : null,
                apps?.rappi?.ativo && apps.rappi.link ? { nome: "Rappi", link: apps.rappi.link, tipo: "rappi" } : null,
                ...(apps?.outros || []).filter((app) => app.nome && app.link).map((app) => ({ nome: app.nome, link: app.link, tipo: "custom", icone: app.icone })),
              ].filter((app): app is { nome: string; link: string; tipo: string; icone?: string } => !!app);
              if (principais.length === 0) return null;
              return (
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
                  <span className="mr-1 text-xs font-bold text-gray-300">Peça também por:</span>
                  {principais.map((app) => (
                    <a key={`${app.tipo}-${app.nome}`} href={app.link} target="_blank" rel="noopener noreferrer" title={app.nome} className="flex h-11 items-center gap-2 rounded-full bg-white px-3 text-sm font-bold text-gray-800 shadow">
                      {app.tipo === "custom" && app.icone ? (
                        <img src={app.icone} alt={app.nome} className="h-7 w-7 rounded-full object-cover" />
                      ) : (
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[9px] text-white ${
                          app.tipo === "ifood" ? "bg-[#EA1D2C]" :
                          app.tipo === "99" ? "bg-[#FFCC00] !text-black" :
                          app.tipo === "keeta" ? "bg-[#00A86B]" :
                          "bg-[#FF441F]"
                        }`}>{app.tipo === "ifood" ? "iF" : app.tipo === "99" ? "99" : app.tipo === "keeta" ? "Ke" : "Ra"}</span>
                      )}
                      <span>{app.nome}</span>
                    </a>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 py-5 sm:px-6">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0">
            <h2 className="mb-5 text-3xl font-black text-gray-900">Cardápio</h2>
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select value={categoria} onChange={(event) => setCategoria(event.target.value)} className="h-12 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700">
                {categorias.map((item) => <option key={item} value={item}>{item === "TODOS" ? "Filtrar" : item}</option>)}
              </select>
              <label className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
                <input value={pesquisa} onChange={(event) => setPesquisa(event.target.value)} placeholder="Pesquisar" className="h-12 w-full rounded-md border border-gray-300 bg-white pl-10 pr-4 text-sm" />
              </label>
            </div>

            <div className="mb-4">
              <h3 className="text-xl font-black" style={{ color: VERDE }}>{categoria === "TODOS" ? (categoriaLoja || "Cardápio") : categoria}</h3>
            </div>

            {filtrados.length === 0 ? (
              <p className="rounded-lg bg-white p-8 text-center text-gray-500">Nenhum produto encontrado.</p>
            ) : (
              <div className="space-y-3">
                {filtrados.map((produto) => (
                  <article key={produto.id} className="grid min-h-40 grid-cols-[130px_minmax(0,1fr)] overflow-hidden rounded-md bg-white shadow-[0_1px_5px_rgba(0,0,0,.12)] sm:grid-cols-[170px_minmax(0,1fr)_155px]">
                    <div className="relative overflow-hidden">
                      {produto.image_url ? <img src={produto.image_url} alt={produto.name} className="h-full min-h-40 w-full object-cover" /> : <div className="h-full min-h-40 w-full bg-gray-200" />}
                      <span className="absolute left-[-42px] top-[18px] w-36 -rotate-45 bg-[#2E9E4A] py-1 text-center text-[10px] font-black uppercase text-white">Novidade</span>
                    </div>
                    <div className="flex min-w-0 flex-col justify-center p-3 sm:p-5">
                      <h4 className="font-black" style={{ color: VERDE }}>{produto.name}</h4>
                      <p className="mt-2 line-clamp-3 text-xs leading-5 text-gray-500 sm:text-sm">{produto.description || "Deliciosa opção preparada especialmente para você."}</p>
                    </div>
                    <div className="col-span-2 flex items-center justify-between border-t border-gray-100 bg-[#fafafa] px-3 py-3 sm:col-span-1 sm:flex-col sm:justify-center sm:border-l sm:border-t-0 sm:px-4">
                      <span className="text-xs font-bold text-gray-600">A partir de <b className="block text-base text-gray-900">{moeda(Number(produto.price))}</b></span>
                      <button type="button" disabled={!aberto} onClick={() => { setSelecionado(produto); setQuantidade(1); setObservacao(""); }} className="flex h-10 items-center gap-2 rounded-md px-4 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50" style={{ background: CINZA }}>
                        <span>▰</span> adicionar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="hidden lg:block">
            <div className="sticky top-4 overflow-hidden rounded-md bg-white shadow-[0_2px_12px_rgba(0,0,0,.14)]">
              <div className="px-5 py-4 text-center text-white" style={{ backgroundColor: aberto ? "#2E9E4A" : "#DC2626" }}>
                <b className="block text-xl">{aberto ? "Aberto Agora" : "Fechado Agora"}</b>
                <span className="text-xs text-white/90">{horarioHoje?.ativo ? `Aberto de ${String(horarioHoje.abre || "18:00").replace(":", "h")} às ${String(horarioHoje.fecha || "23:00").replace(":", "h")}` : "Fechado hoje"}</span>
              </div>
              <div className="grid grid-cols-2 border-b border-gray-200 text-center text-xs">
                {settingsSafe.permitir_entrega && <div className="border-r border-gray-200 p-3"><b className="block text-sm text-gray-800">Entrega</b><span className="text-gray-500">{Number(settingsSafe.entrega_min)} a {Number(settingsSafe.entrega_max)} mins</span></div>}
                {settingsSafe.permitir_retirada && <div className="p-3"><b className="block text-sm text-gray-800">Retirada</b><span className="text-gray-500">{Number(settingsSafe.retirada_min)} a {Number(settingsSafe.retirada_max)} mins</span></div>}
              </div>
              <div className="p-4">
                <h3 className="mb-3 text-lg font-black text-gray-900">Meu pedido</h3>
                {carrinho.length === 0 ? (
                  <p className="rounded-md bg-gray-50 py-8 text-center text-sm text-gray-400">Seu carrinho está vazio</p>
                ) : (
                  <div className="max-h-72 space-y-3 overflow-y-auto">
                    {carrinho.map((item, indice) => (
                      <div key={`${item.produto.id}-${item.observacao}`} className="grid grid-cols-[28px_1fr_auto] gap-2 text-sm">
                        <b className="text-gray-400">{String(item.quantidade).padStart(2, "0")}</b>
                        <div><b className="font-bold text-gray-800">{item.produto.name}</b>{item.observacao && <p className="text-xs text-gray-500">{item.observacao}</p>}</div>
                        <b className="text-gray-800">{moeda(item.quantidade * Number(item.produto.price))}</b>
                        <button type="button" onClick={() => setCarrinho((atual) => atual.filter((_, i) => i !== indice))} className="col-start-2 text-left text-xs text-red-500">remover</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 border-t border-gray-200 pt-3">
                  <div className="flex items-center justify-between text-sm"><b>{tipoEntrega === "Entrega" ? "Vou receber em casa" : "Vou retirar o pedido"}</b><button type="button" onClick={() => setTipoEntrega(tipoEntrega === "Entrega" ? "Retirada" : "Entrega")} className="font-bold" style={{ color: VERDE }}>alterar</button></div>
                  <div className="mt-3 flex justify-between text-sm text-gray-500"><span>Taxa de entrega</span><b>{tipoEntrega === "Entrega" ? (foraArea ? "Fora da área" : calculandoTaxa ? "Calculando..." : taxaCalculada !== null ? moeda(taxaEntrega) : "-") : "-"}</b></div>
                  <button type="button" className="mt-3 text-sm font-bold" style={{ color: VERDE }}>Tenho um cupom de desconto</button>
                  <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4"><b className="text-sm text-gray-700">Valor total</b><b className="text-xl text-gray-900">{moeda(total)}</b></div>
                  <button type="button" disabled={carrinho.length === 0 || !aberto} onClick={() => setCheckoutAberto(true)} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-md text-sm font-black text-white disabled:opacity-50" style={{ background: CINZA }}>Fechar pedido <span>›</span></button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {quantidadeTotal > 0 && (
        <button type="button" onClick={() => setCheckoutAberto(true)} className="fixed bottom-4 left-3 right-3 z-40 flex h-14 items-center justify-between rounded-full px-5 font-black text-white shadow-2xl lg:hidden" style={{ background: CINZA }}>
          <span>Ver meu pedido ({quantidadeTotal})</span><span>{moeda(total)}</span>
        </button>
      )}

      {selecionado && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelecionado(null); }}>
          <div className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-xl font-black" style={{ color: VERDE }}>{selecionado.name}</h2><p className="mt-1 text-sm text-gray-500">{selecionado.description}</p></div><button type="button" onClick={() => setSelecionado(null)} className="text-2xl text-gray-400">×</button></div>
            <label className="block text-sm font-bold text-gray-700">Observação<textarea value={observacao} onChange={(event) => setObservacao(event.target.value)} placeholder="Ex: sem cebola" className="mt-2 h-20 w-full resize-none rounded-xl border border-gray-300 p-3" /></label>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex items-center rounded-full border border-gray-300"><button type="button" onClick={() => setQuantidade((valor) => Math.max(1, valor - 1))} className="h-11 w-11 text-xl">−</button><b className="w-8 text-center">{quantidade}</b><button type="button" onClick={() => setQuantidade((valor) => valor + 1)} className="h-11 w-11 text-xl">+</button></div>
              <button type="button" onClick={adicionarAoCarrinho} className="h-11 flex-1 rounded-full font-black text-white" style={{ background: CINZA }}>Adicionar · {moeda(Number(selecionado.price) * quantidade)}</button>
            </div>
          </div>
        </div>
      )}

      {checkoutAberto && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
          <div className="h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:h-auto sm:max-h-[90vh] sm:rounded-3xl">
            <header className="mb-5 flex items-center justify-between"><h2 className="text-xl font-black">Finalizar pedido</h2><button type="button" onClick={() => setCheckoutAberto(false)} className="text-2xl text-gray-400">×</button></header>
            <label className="block text-sm font-bold">Nome do cliente<input value={nome} onChange={(event) => setNome(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 p-3" /></label>
            <label className="mt-4 block text-sm font-bold">Telefone com DDD<input type="tel" inputMode="tel" autoComplete="tel" value={telefoneCliente} onChange={(event) => setTelefoneCliente(event.target.value)} placeholder="(11) 99999-9999" className="mt-2 w-full rounded-lg border border-gray-300 p-3" /></label>
            <div className="mt-4 grid grid-cols-2 gap-2">{(["Entrega", "Retirada"] as const).filter((tipo) => tipo === "Entrega" ? settingsSafe.permitir_entrega : settingsSafe.permitir_retirada).map((tipo) => <button key={tipo} type="button" onClick={() => setTipoEntrega(tipo)} className="rounded-lg border p-3 font-bold" style={tipoEntrega === tipo ? { borderColor: VERDE, background: "#eff8f1", color: VERDE } : undefined}>{tipo}</button>)}</div>
            {tipoEntrega === "Entrega" && (
              <>
                <label className="mt-4 block text-sm font-bold">Endereço<input autoComplete="street-address" value={endereco} onChange={(event) => { setEndereco(event.target.value); setTaxaCalculada(null); setForaArea(false); }} onBlur={() => void calcularTaxaEntrega()} placeholder="Rua / Avenida" className="mt-2 w-full rounded-lg border border-gray-300 p-3" /></label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block text-sm font-bold">Número<input value={numeroEndereco} onChange={(event) => { setNumeroEndereco(event.target.value); setTaxaCalculada(null); setForaArea(false); }} onBlur={() => void calcularTaxaEntrega()} className="mt-2 w-full rounded-lg border border-gray-300 p-3" /></label>
                  <label className="block text-sm font-bold">Bairro<input autoComplete="address-level3" value={bairroEndereco} onChange={(event) => { setBairroEndereco(event.target.value); setTaxaCalculada(null); setForaArea(false); }} onBlur={() => void calcularTaxaEntrega()} className="mt-2 w-full rounded-lg border border-gray-300 p-3" /></label>
                </div>
                <label className="mt-3 block text-sm font-bold">Complemento (opcional)<input value={complementoEndereco} onChange={(event) => setComplementoEndereco(event.target.value)} placeholder="Apartamento, bloco, referência" className="mt-2 w-full rounded-lg border border-gray-300 p-3" /></label>
                {calculandoTaxa && <p className="mt-2 text-xs text-gray-500">Calculando distância da entrega...</p>}
                {foraArea && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">Fora da área de entrega. Selecione Retirada.</p>}
              </>
            )}
            <label className="mt-4 block text-sm font-bold">Forma de pagamento<select value={pagamento} onChange={(event) => setPagamento(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 p-3"><option>Pix</option><option>Dinheiro</option><option>Cartão na entrega</option></select></label>
            <label className="mt-4 block text-sm font-bold">Observação do pedido (opcional)<textarea value={observacaoPedido} onChange={(event) => setObservacaoPedido(event.target.value)} placeholder="Alguma orientação para o pedido?" className="mt-2 h-20 w-full resize-y rounded-lg border border-gray-300 p-3" /></label>
            {erroCheckout && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{erroCheckout}</p>}
            <p className="my-5 text-right text-xl font-black">Total: {moeda(total)}</p>
            <button type="button" disabled={finalizandoPedido || !nome.trim() || normalizarTelefone(telefoneCliente).length < 10 || carrinho.length === 0 || !aberto || foraArea || calculandoTaxa || (tipoEntrega === "Entrega" && (!endereco.trim() || !numeroEndereco.trim() || !bairroEndereco.trim() || taxaCalculada === null))} onClick={() => void finalizarPedido()} className="flex w-full items-center justify-center gap-2 rounded-lg py-4 font-black text-white disabled:opacity-50" style={{ background: VERDE }}>{finalizandoPedido ? "Salvando pedido..." : "Finalizar pedido"}</button>
          </div>
        </div>
      )}

      {pedidoConfirmado && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <section role="status" aria-live="polite" className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl font-black text-green-700">✓</div>
            <h2 className="text-2xl font-black text-gray-900">Pedido #{pedidoConfirmado.numero} recebido!</h2>
            <p className="mt-2 text-sm text-gray-600">Seu pedido foi registrado. {pedidoConfirmado.whatsappUrl ? "Abrindo o WhatsApp para enviar os detalhes à loja..." : "O WhatsApp da loja não está configurado."}</p>
            {pedidoConfirmado.whatsappUrl && <a href={pedidoConfirmado.whatsappUrl} className="mt-5 inline-flex rounded-lg bg-green-600 px-5 py-3 font-bold text-white">Continuar no WhatsApp</a>}
          </section>
        </div>
      )}
    </main>
  );
}

export default function CardapioPublico() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-white p-8 text-center text-gray-500">Carregando cardápio...</main>}>
      <ConteudoCardapio />
    </Suspense>
  );
}
