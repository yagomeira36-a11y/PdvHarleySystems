"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase, getSessao, formatarMoeda, rotuloPedido, linkWhatsApp, Order, OrderItem, Entrega, Motoboy } from "@/lib/supabase";
import { caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";
import {
  atualizarPedidoOffline,
  enfileirarUpdateOffline,
  guardarCacheOffline,
  lerCacheOffline,
  listarPedidosOffline,
  type OfflineOrderRecord,
} from "@/lib/offline-pdv";
import ImpressaoPedido from "./ImpressaoPedido";

type PedidoCozinha = Order & { _offline?: boolean; _sincronizado?: boolean; _record?: OfflineOrderRecord };

const STATUS_ATIVOS_COZINHA = new Set(["pendente", "novo", "em_preparo", "saiu_entrega"]);
const CACHE_KEY = (lojaId: string) => `pdv-kds-remote-cache-${lojaId}`;

type KdsRemoteCache = { pedidos: Order[]; itens: OrderItem[]; entregas: Entrega[]; ts: number };

function lerCacheKds(lojaId: string): KdsRemoteCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY(lojaId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KdsRemoteCache;
    if (!parsed || !Array.isArray(parsed.pedidos)) return null;
    return { pedidos: parsed.pedidos || [], itens: parsed.itens || [], entregas: parsed.entregas || [], ts: parsed.ts || 0 };
  } catch { return null; }
}
function salvarCacheKds(lojaId: string, cache: KdsRemoteCache) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CACHE_KEY(lojaId), JSON.stringify(cache)); } catch { /* ignore */ }
}
function chavePedido(p: { id?: string; numero_exibicao?: string | null }) {
  return p.numero_exibicao || p.id || "";
}
function ehErroRede(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = error instanceof Error ? error.message : String(error || "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|offline/i.test(msg) || error instanceof TypeError;
}

export default function Kds({ refreshKey, aoPedidoCriado }: { refreshKey: number; aoPedidoCriado?: (texto: string, tipo?: "ok" | "erro") => void }) {
  const supabase = getSupabase();
  const [pedidos, setPedidos] = useState<PedidoCozinha[]>([]);
  const [itens, setItens] = useState<OrderItem[]>([]);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]);
  const [salvandoMotoboyId, setSalvandoMotoboyId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const carregamentoInicial = useRef(true);

  async function carregar() {
    if (carregamentoInicial.current) setCarregando(true);
    const sessao = getSessao();
    if (!sessao) { setCarregando(false); carregamentoInicial.current = false; return; }
    const lojaId = sessao.id;
    let registrosOffline: OfflineOrderRecord[] = [];
    try { registrosOffline = await listarPedidosOffline(lojaId); } catch (error) { console.error("Não foi possível ler pedidos offline:", error); }

    const mapaLocal = new Map(registrosOffline.map((r) => [r.id, r]));
    const ativosLocais = registrosOffline.filter((r) => STATUS_ATIVOS_COZINHA.has(r.statusLocal || r.pedido.status || "em_preparo"));
    const pedidosLocais: PedidoCozinha[] = ativosLocais.map((registro) => ({
      ...registro.pedido,
      numero_exibicao: registro.numeroExibicao,
      status: registro.statusLocal || registro.pedido.status || "em_preparo",
      _offline: !registro.sincronizado,
      _sincronizado: Boolean(registro.sincronizado),
      _record: registro,
    }));
    const itensLocais = ativosLocais.flatMap((registro) => registro.itens) as OrderItem[];
    const entregasLocais = ativosLocais.flatMap((registro) => registro.entrega ? [{ ...registro.entrega, created_at: registro.criadoEm } as Entrega] : []);

    function montarLista(remotos: Order[], itensRemotos: OrderItem[], entregasRemotas: Entrega[]) {
      const remotosAjustados: PedidoCozinha[] = remotos
        .filter((pedido) => {
          const registro = mapaLocal.get(pedido.id);
          return !(registro && ["pago", "entregue", "cancelado"].includes(registro.statusLocal || ""));
        })
        .map((pedido) => {
          const registro = mapaLocal.get(pedido.id);
          return registro
            ? { ...pedido, numero_exibicao: registro.numeroExibicao || pedido.numero_exibicao, status: registro.statusLocal || pedido.status, _offline: !registro.sincronizado, _sincronizado: Boolean(registro.sincronizado), _record: registro }
            : { ...pedido, _offline: false, _sincronizado: true };
        }) as PedidoCozinha[];
      const idsRemotos = new Set(remotosAjustados.map((p) => p.id));
      const chavesRemotas = new Set(remotosAjustados.map((p) => chavePedido(p)).filter(Boolean));
      const locaisExtras = pedidosLocais.filter((p) => !idsRemotos.has(p.id) && !chavesRemotas.has(chavePedido(p)));
      const lista = [...remotosAjustados, ...locaisExtras].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const idsLocaisComItens = new Set(ativosLocais.map((r) => r.id));
      const itens = [...itensRemotos.filter((i) => !idsLocaisComItens.has(i.order_id)), ...itensLocais];
      const idsEntregaLocal = new Set(entregasLocais.map((e) => e.order_id));
      const ents = [...entregasRemotas.filter((e) => !idsEntregaLocal.has(e.order_id)), ...entregasLocais];
      return { lista, itens, entregas: ents };
    }

    async function aplicarComCache(motivo?: string) {
      const cache = lerCacheKds(lojaId);
      const { lista, itens, entregas } = montarLista(cache?.pedidos || [], cache?.itens || [], cache?.entregas || []);
      setPedidos(lista);
      setItens(itens);
      setEntregas(entregas);
      try { const motoboysSalvos = await lerCacheOffline<Motoboy[]>(lojaId, "motoboys"); setMotoboys(motoboysSalvos || []); } catch { /* mantém estado atual */ }
      const pendentes = registrosOffline.filter((r) => !r.sincronizado).length;
      if (motivo) setMensagem(`Sem conexão/erro ao atualizar. Exibindo último cache${cache ? "" : " local"} + pedidos locais.${pendentes > 0 ? ` ${pendentes} aguardando sincronização.` : ""} (${motivo})`);
      else if (pendentes > 0) setMensagem(`${pendentes} pedido(s) salvo(s) neste dispositivo, aguardando sincronização.`);
      else setMensagem(null);
      setCarregando(false);
      carregamentoInicial.current = false;
    }

    if (!supabase || !navigator.onLine) { await aplicarComCache(); return; }

    try {
      const { data: peds, error } = await supabase.from("orders").select("*").in("status", ["pendente", "novo"]).eq("loja_id", sessao.id).order("created_at", { ascending: true });
      if (error) { await aplicarComCache(error.message); return; }
      const remotos = (peds || []) as Order[];
      let itensRemotos: OrderItem[] = []; let entregasRemotas: Entrega[] = [];
      if (remotos.length > 0) {
        const ids = remotos.map((o) => o.id);
        const entregasIds = remotos.filter((o) => o.type === "delivery").map((o) => o.id);
        const [resItens, resEntregas] = await Promise.all([
          supabase.from("order_items").select("*").in("order_id", ids),
          entregasIds.length > 0 ? supabase.from("entregas").select("*").in("order_id", entregasIds) : Promise.resolve({ data: [] as Entrega[], error: null }),
        ]);
        if (resItens.error || resEntregas.error) { await aplicarComCache(resItens.error?.message || resEntregas.error?.message); return; }
        itensRemotos = (resItens.data || []) as OrderItem[];
        entregasRemotas = (resEntregas.data || []) as Entrega[];
      }
      salvarCacheKds(lojaId, { pedidos: remotos, itens: itensRemotos, entregas: entregasRemotas, ts: Date.now() });
      const { lista, itens, entregas } = montarLista(remotos, itensRemotos, entregasRemotas);
      setPedidos(lista); setItens(itens); setEntregas(entregas);
      const pendentes = registrosOffline.filter((r) => !r.sincronizado).length;
      setMensagem(pendentes > 0 ? `${pendentes} pedido(s) aguardando sincronização.` : null);
      if (lista.some((o) => o.type === "delivery")) {
        try {
          const { data: motos, error: erroMotos } = await supabase.from("motoboys").select("*").eq("loja_id", sessao.id).eq("ativo", true).order("nome");
          if (erroMotos) throw erroMotos;
          setMotoboys((motos || []) as Motoboy[]);
          if (motos) { try { await guardarCacheOffline(sessao.id, "motoboys", motos as Motoboy[]); } catch { /* cache opcional */ } }
        } catch {
          try { const motoboysSalvos = await lerCacheOffline<Motoboy[]>(sessao.id, "motoboys"); setMotoboys(motoboysSalvos || []); } catch { /* mantém */ }
        }
      } else { setMotoboys([]); }
      setCarregando(false); carregamentoInicial.current = false;
    } catch (error) { await aplicarComCache(ehErroRede(error) ? "falha de conexão" : (error instanceof Error ? error.message : "erro")); }
  }

  useEffect(() => {
    void carregar();
    const intervalo = window.setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, 3000);
    const aoFila = () => { void carregar(); };
    window.addEventListener("pdv-offline-orders-changed", aoFila);
    window.addEventListener("online", aoFila);
    return () => { window.clearInterval(intervalo); window.removeEventListener("pdv-offline-orders-changed", aoFila); window.removeEventListener("online", aoFila); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function finalizarPedido(pedido: PedidoCozinha) {
    const sessao = getSessao();
    if (!sessao) return;
    if (!caixaEstaAberto(sessao.id)) { setMensagem(MENSAGEM_CAIXA_FECHADO); return; }
    try {
      const registro = pedido._record;
      if (registro || navigator.onLine === false || !supabase) {
        if (!registro) { setMensagem("Sem conexão para finalizar este pedido no servidor."); return; }
        await atualizarPedidoOffline(registro.id, (atual) => ({ ...atual, statusLocal: "pago", pedido: { ...atual.pedido, status: "pago", numero_exibicao: atual.numeroExibicao } }));
        if (registro.sincronizado) {
          await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: registro.id, tipo: "order_status", payload: { status: "pago" }, criadoEm: new Date().toISOString() });
          if (navigator.onLine && supabase) {
            try { await supabase.from("orders").update({ status: "pago" }).eq("id", pedido.id); } catch { /* ficará na fila */ }
          }
        }
        setMensagem(`${rotuloPedido(pedido)} finalizado!`);
        aoPedidoCriado?.(`${rotuloPedido(pedido)} finalizado!`);
        await carregar();
        return;
      }
      const { error } = await supabase.from("orders").update({ status: "pago" }).eq("id", pedido.id);
      if (error) throw error;
      setMensagem(`${rotuloPedido(pedido)} finalizado!`);
      aoPedidoCriado?.(`${rotuloPedido(pedido)} finalizado!`);
      await carregar();
    } catch (error) {
      if (ehErroRede(error)) setMensagem("Sem conexão. Não foi possível finalizar agora; tente novamente quando voltar a internet.");
      else setMensagem("Erro ao atualizar: " + (error instanceof Error ? error.message : String(error)));
      await carregar();
    }
  }

  async function atribuirMotoboy(pedido: PedidoCozinha, motoboyId: string) {
    const sessao = getSessao();
    if (!sessao) return;
    if (!caixaEstaAberto(sessao.id)) { setMensagem(MENSAGEM_CAIXA_FECHADO); await carregar(); return; }
    setSalvandoMotoboyId(pedido.id);
    setMensagem(null);
    try {
      const registro = pedido._record;
      const entregaAtual = entregas.find((e) => e.order_id === pedido.id) || (registro?.entrega ? { ...registro.entrega, created_at: registro.criadoEm } as Entrega : undefined);
      const entregaId = entregaAtual?.id || registro?.entrega?.id || crypto.randomUUID();
      const taxa = Number(registro?.entrega?.taxa ?? registro?.pedido.delivery_fee ?? pedido.delivery_fee ?? 0);
      const nome = motoboys.find((m) => m.id === motoboyId)?.nome;

      // Pedido local/offline (não sincronizado) ou sem conexão: atualiza só local + enfileira se base já sincronizada
      if (registro && (!registro.sincronizado || navigator.onLine === false || !supabase)) {
        await atualizarPedidoOffline(registro.id, (atual) => ({
          ...atual,
          entrega: motoboyId || atual.entrega
            ? { id: entregaId, order_id: atual.id, motoboy_id: motoboyId || null, status: (atual.entrega?.status as "pendente" | "saiu_entrega" | "entregue") || "pendente", taxa, loja_id: sessao.id }
            : atual.entrega,
        }));
        if (registro.sincronizado) {
          await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: registro.id, tipo: "entrega_motoboy", payload: { motoboy_id: motoboyId || null, entrega_id: entregaId, status: "pendente", taxa }, criadoEm: new Date().toISOString() });
        }
        setMensagem(nome ? `${rotuloPedido(pedido)} com motoboy ${nome}!` : `Motoboy removido do ${rotuloPedido(pedido)}.`);
        await carregar();
        return;
      }

      // Registro local já sincronizado e online: tenta remoto, em erro de rede enfileira
      if (registro && registro.sincronizado) {
        await atualizarPedidoOffline(registro.id, (atual) => ({
          ...atual,
          entrega: motoboyId || atual.entrega
            ? { id: entregaId, order_id: atual.id, motoboy_id: motoboyId || null, status: (atual.entrega?.status as "pendente" | "saiu_entrega" | "entregue") || "pendente", taxa, loja_id: sessao.id }
            : atual.entrega,
        }));
        if (supabase && navigator.onLine) {
          try {
            let erroRemoto: { message: string } | null = null;
            if (motoboyId) {
              if (entregaAtual?.id) ({ error: erroRemoto } = await supabase.from("entregas").update({ motoboy_id: motoboyId }).eq("id", entregaAtual.id).eq("loja_id", sessao.id));
              else ({ error: erroRemoto } = await supabase.from("entregas").insert({ id: entregaId, order_id: pedido.id, motoboy_id: motoboyId, status: "pendente", taxa, loja_id: sessao.id }));
            } else if (entregaAtual?.id) {
              ({ error: erroRemoto } = await supabase.from("entregas").update({ motoboy_id: null }).eq("id", entregaAtual.id).eq("loja_id", sessao.id));
            }
            if (erroRemoto) {
              await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: registro.id, tipo: "entrega_motoboy", payload: { motoboy_id: motoboyId || null, entrega_id: entregaId, status: "pendente", taxa }, criadoEm: new Date().toISOString() });
            }
          } catch (err) {
            await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: registro.id, tipo: "entrega_motoboy", payload: { motoboy_id: motoboyId || null, entrega_id: entregaId, status: "pendente", taxa }, criadoEm: new Date().toISOString() });
            if (!ehErroRede(err)) console.warn("Falha ao vincular motoboy remoto, enfileirado:", err);
          }
        } else {
          await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: registro.id, tipo: "entrega_motoboy", payload: { motoboy_id: motoboyId || null, entrega_id: entregaId, status: "pendente", taxa }, criadoEm: new Date().toISOString() });
        }
        setMensagem(nome ? `${rotuloPedido(pedido)} com motoboy ${nome}!` : `Motoboy removido do ${rotuloPedido(pedido)}.`);
        await carregar();
        return;
      }

      // Pedido remoto sem registro local
      if (!supabase || navigator.onLine === false) {
        await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: pedido.id, tipo: "entrega_motoboy", payload: { motoboy_id: motoboyId || null, entrega_id: entregaId, status: "pendente", taxa }, criadoEm: new Date().toISOString() });
        setEntregas((prev) => {
          const existe = prev.find((e) => e.order_id === pedido.id);
          const atualizada = { id: entregaId, order_id: pedido.id, motoboy_id: motoboyId || null, status: "pendente" as const, taxa, loja_id: sessao.id, created_at: new Date().toISOString() };
          return existe ? prev.map((e) => e.order_id === pedido.id ? { ...e, motoboy_id: motoboyId || null } : e) : [...prev, atualizada];
        });
        setMensagem(`Motoboy do ${rotuloPedido(pedido)} atualizado localmente (aguardando sincronização).`);
        return;
      }
      try {
        let error: { message: string } | null = null;
        if (entregaAtual?.id) ({ error } = await supabase.from("entregas").update({ motoboy_id: motoboyId || null }).eq("id", entregaAtual.id).eq("loja_id", sessao.id));
        else if (motoboyId) ({ error } = await supabase.from("entregas").insert({ id: entregaId, order_id: pedido.id, motoboy_id: motoboyId, status: "pendente", taxa, loja_id: sessao.id }));
        if (error) throw error;
        setMensagem(nome ? `${rotuloPedido(pedido)} com motoboy ${nome}!` : `Motoboy removido do ${rotuloPedido(pedido)}.`);
        await carregar();
      } catch (err) {
        await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: pedido.id, tipo: "entrega_motoboy", payload: { motoboy_id: motoboyId || null, entrega_id: entregaId, status: "pendente", taxa }, criadoEm: new Date().toISOString() });
        setEntregas((prev) => prev.some((e) => e.order_id === pedido.id) ? prev.map((e) => e.order_id === pedido.id ? { ...e, motoboy_id: motoboyId || null } : e) : [...prev, { id: entregaId, order_id: pedido.id, motoboy_id: motoboyId || null, status: "pendente", taxa, loja_id: sessao.id, created_at: new Date().toISOString() } as Entrega]);
        setMensagem(`Motoboy do ${rotuloPedido(pedido)} salvo localmente; será sincronizado.`);
        if (!ehErroRede(err)) console.warn(err);
      }
    } catch (error) {
      console.error("Erro ao vincular motoboy:", error);
      setMensagem(ehErroRede(error) ? "Sem conexão. Alteração salva localmente quando possível; tente atualizar." : "Não foi possível vincular o motoboy agora.");
    } finally {
      setSalvandoMotoboyId(null);
    }
  }

  function formatarHora(iso: string): string { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  const itensDoPedido = (orderId: string) => itens.filter((i) => i.order_id === orderId);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-extrabold">Cozinha</h1>
        <button onClick={() => void carregar()} className="bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold px-4 py-2 rounded-xl shadow-sm transition">Atualizar</button>
      </div>
      {mensagem && <div className="bg-green-50 border border-green-500 text-green-700 rounded-lg p-3 mb-4">{mensagem}</div>}
      {carregando && <p className="text-gray-500 text-center py-10">Carregando...</p>}
      {!carregando && pedidos.length === 0 && <div className="bg-white rounded-2xl p-10 text-center text-gray-500 shadow-sm">Nenhum pedido pendente na cozinha.</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {pedidos.map((pedido) => {
          const registro = pedido._record;
          const pendenteSync = Boolean(registro && !registro.sincronizado);
          const itensPedido = (pedido.items?.length
            ? pedido.items.map((item, index) => ({ id: `${pedido.id}-item-${index}`, product_id: item.product_id, qty: item.qty, price: item.price, cost: 0, observacao: item.observacao, product_name: item.name }))
            : itensDoPedido(pedido.id)) as Array<{ id: string; product_id?: string | null; qty: number; price: number; observacao?: string | null; product_name?: string }>;
          const itensReimpressao = registro
            ? registro.itens.map((item) => ({ nome: (item as { product_name?: string }).product_name || (pedido.items?.find((i) => i.product_id === item.product_id)?.name) || "Item", quantidade: item.qty, preco: Number(item.price), observacao: item.observacao ?? null }))
            : itensPedido.map((item) => ({ nome: item.product_name || "Item", quantidade: item.qty, preco: Number(item.price), observacao: item.observacao ?? null }));
          return (
            <div key={pedido.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-lg">{rotuloPedido(pedido)}</p>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${pedido.type === "delivery" ? "bg-blue-100 text-blue-700" : pedido.type === "mesa" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>{pedido.type === "delivery" ? "DELIVERY" : pedido.type === "mesa" ? "MESA" : "BALCÃO"}</span>
                <span className="text-sm text-gray-500">{formatarHora(pedido.created_at)}</span>
                <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-black text-sky-800">EM PREPARO</span>
                {pedido.status === "novo" && <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-black text-red-700">NOVO</span>}
                {registro && <span className={`rounded-full px-2 py-1 text-[10px] font-black ${pendenteSync ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-700"}`}>{pendenteSync ? "AGUARDANDO SINCRONIZAÇÃO" : "SINCRONIZADO"}</span>}
              </div>
              {pedido.customer_name && <p className="text-sm text-gray-600 -mt-1">Cliente: <b>{pedido.customer_name}</b></p>}
              {pedido.type === "delivery" && pedido.address && <p className="text-sm text-gray-600 -mt-1">Endereço: <b>{pedido.address}</b>{pedido.complemento ? ` · ${pedido.complemento}` : ""}</p>}
              {pedido.type === "delivery" && pedido.telefone && (
                <div className="flex items-center justify-between gap-2 -mt-1">
                  <p className="text-sm text-gray-600">Telefone: <b>{pedido.telefone}</b></p>
                  {linkWhatsApp(pedido.telefone) && <a href={linkWhatsApp(pedido.telefone)!} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg bg-green-600 px-3 py-1 text-xs font-bold text-white hover:bg-green-700">WhatsApp</a>}
                </div>
              )}
              {pedido.type === "delivery" && (
                <div className="flex items-center gap-2 -mt-1">
                  <label htmlFor={`motoboy-${pedido.id}`} className="shrink-0 text-sm font-semibold text-gray-600">Motoboy:</label>
                  {motoboys.length === 0 ? <p className="text-xs text-amber-700">Nenhum motoboy ativo cadastrado.</p> : (
                    <select id={`motoboy-${pedido.id}`} value={entregas.find((e) => e.order_id === pedido.id)?.motoboy_id ?? pedido._record?.entrega?.motoboy_id ?? ""} disabled={salvandoMotoboyId === pedido.id} onChange={(ev) => void atribuirMotoboy(pedido, ev.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-semibold disabled:opacity-50">
                      <option value="">— escolher —</option>
                      {motoboys.map((m) => (<option key={m.id} value={m.id}>{m.nome}</option>))}
                    </select>
                  )}
                  {salvandoMotoboyId === pedido.id && <span className="shrink-0 text-xs text-gray-400">salvando...</span>}
                </div>
              )}
              {pedido.forma_pagamento && <p className="text-xs text-gray-500 -mt-1">Pagamento: {pedido.forma_pagamento}</p>}
              {pedido.observacao && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Observação: {pedido.observacao}</p>}
              {pedido.type === "mesa" && pedido.mesa_numero && <p className="text-sm text-amber-700 -mt-1">Mesa: <b>{pedido.mesa_numero}</b></p>}
              <ul className="space-y-2 flex-1">
                {itensPedido.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm font-bold">{item.qty}x {item.product_name || "Item"}{!item.product_id ? " (removido)" : ""}</p>
                      {item.observacao && <p className="text-xs text-amber-600 italic font-semibold">Obs: {item.observacao}</p>}
                    </div>
                    <span className="text-sm text-gray-500 shrink-0">{formatarMoeda(Number(item.price) * item.qty)}</span>
                  </li>
                ))}
                {itensPedido.length === 0 && <li className="text-sm text-gray-400 text-center py-3">Sem itens registrados.</li>}
              </ul>
              <div className="flex flex-col gap-2">
                {(registro || itensReimpressao.length > 0) && <ImpressaoPedido pedido={pedido} itensLocais={itensReimpressao} rotuloBotao={registro?.falhaImpressao ? "Reimprimir" : "Imprimir"} classNameBotao={`w-full rounded-xl px-3 py-2 text-sm font-bold ${registro?.falhaImpressao ? "bg-amber-500 hover:bg-amber-600 text-white" : "border border-gray-300 bg-white hover:bg-gray-100 text-gray-800"}`} />}
                <button onClick={() => void finalizarPedido(pedido)} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl transition">FINALIZAR PEDIDO</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
