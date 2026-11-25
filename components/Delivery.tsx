"use client";

import { useEffect, useState } from "react";
import { getSupabase, getSessao, formatarMoeda, rotuloPedido, Order, Entrega, OrderItem, Motoboy } from "@/lib/supabase";
import { caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";
import { atualizarPedidoOffline, enfileirarUpdateOffline, listarPedidosOffline, type OfflineOrderRecord } from "@/lib/offline-pdv";

type PedidoDelivery = Order & { _offline?: boolean; _sincronizado?: boolean; _record?: OfflineOrderRecord };

const STATUS_COR: Record<string, string> = {
  pago: "bg-green-100 text-green-700",
  saiu_entrega: "bg-blue-100 text-blue-700",
  pendente: "bg-amber-100 text-amber-700",
  em_preparo: "bg-sky-100 text-sky-800",
  entregue: "bg-gray-100 text-gray-700",
};
const STATUS_NOME: Record<string, string> = { pago: "Pronto para entrega", saiu_entrega: "Saiu para entrega", pendente: "Aguardando preparo", em_preparo: "Em preparo", entregue: "Entregue" };
const CACHE_KEY = (lojaId: string) => `pdv-delivery-remote-cache-${lojaId}`;

type DeliveryRemoteCache = { pedidos: Order[]; itens: OrderItem[]; entregas: Entrega[]; motoboys: Motoboy[]; ts: number };
function lerCacheDelivery(lojaId: string): DeliveryRemoteCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY(lojaId));
    if (!raw) return null;
    const p = JSON.parse(raw) as DeliveryRemoteCache;
    if (!p || !Array.isArray(p.pedidos)) return null;
    return { pedidos: p.pedidos || [], itens: p.itens || [], entregas: p.entregas || [], motoboys: p.motoboys || [], ts: p.ts || 0 };
  } catch { return null; }
}
function salvarCacheDelivery(lojaId: string, cache: DeliveryRemoteCache) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CACHE_KEY(lojaId), JSON.stringify(cache)); } catch { /* ignore */ }
}
function chavePedido(p: { id?: string; numero_exibicao?: string | null }) { return p.numero_exibicao || p.id || ""; }
function ehErroRede(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = error instanceof Error ? error.message : String(error || "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|offline/i.test(msg) || error instanceof TypeError;
}
function formatarData(iso: string): string { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }

export default function Delivery({ refreshKey, aoPedidoCriado }: { refreshKey: number; aoPedidoCriado: (texto: string, tipo?: "ok" | "erro") => void }) {
  const supabase = getSupabase();
  const [pedidos, setPedidos] = useState<PedidoDelivery[]>([]);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [itens, setItens] = useState<OrderItem[]>([]);
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function carregar() {
    const sessao = getSessao();
    if (!sessao) { setCarregando(false); return; }
    setCarregando(true);
    setMensagem(null);
    const lojaId = sessao.id;
    let registrosOffline: OfflineOrderRecord[] = [];
    try { registrosOffline = await listarPedidosOffline(lojaId); } catch (e) { console.error(e); }
    const mapaLocal = new Map(registrosOffline.map((r) => [r.id, r]));
    const locaisDelivery = registrosOffline.filter((r) => r.pedido.type === "delivery" && ["pago", "saiu_entrega"].includes(r.statusLocal || r.pedido.status));
    const pedidosLocais: PedidoDelivery[] = locaisDelivery.map((registro) => ({
      ...registro.pedido, numero_exibicao: registro.numeroExibicao, status: registro.statusLocal || registro.pedido.status, _offline: !registro.sincronizado, _sincronizado: Boolean(registro.sincronizado), _record: registro,
    }));
    const itensLocais = locaisDelivery.flatMap((r) => r.itens) as OrderItem[];
    const entregasLocais = locaisDelivery.flatMap((r) => r.entrega ? [{ ...r.entrega, created_at: r.criadoEm } as Entrega] : []);

    function montar(remotos: Order[], itensRemotos: OrderItem[], entregasRemotas: Entrega[]) {
      const remotosAjustados: PedidoDelivery[] = remotos
        .filter((pedido) => { const registro = mapaLocal.get(pedido.id); return !(registro && !["pago", "saiu_entrega"].includes(registro.statusLocal || "")); })
        .map((pedido) => { const registro = mapaLocal.get(pedido.id); return registro ? { ...pedido, numero_exibicao: registro.numeroExibicao || pedido.numero_exibicao, status: registro.statusLocal || pedido.status, _offline: !registro.sincronizado, _sincronizado: Boolean(registro.sincronizado), _record: registro } : { ...pedido, _offline: false, _sincronizado: true }; }) as PedidoDelivery[];
      const idsRemotos = new Set(remotosAjustados.map((p) => p.id));
      const chavesRemotas = new Set(remotosAjustados.map((p) => chavePedido(p)).filter(Boolean));
      const locaisExtras = pedidosLocais.filter((p) => !idsRemotos.has(p.id) && !chavesRemotas.has(chavePedido(p)));
      const lista = [...remotosAjustados, ...locaisExtras].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const idsLocaisComItens = new Set(locaisDelivery.map((r) => r.id));
      const itens = [...itensRemotos.filter((i) => !idsLocaisComItens.has(i.order_id)), ...itensLocais];
      const idsEntregaLocal = new Set(entregasLocais.map((e) => e.order_id));
      const ents = [...entregasRemotas.filter((e) => !idsEntregaLocal.has(e.order_id)), ...entregasLocais];
      return { lista, itens, entregas: ents };
    }

    async function aplicarComCache(motivo?: string) {
      const cache = lerCacheDelivery(lojaId);
      const { lista, itens, entregas } = montar(cache?.pedidos || [], cache?.itens || [], cache?.entregas || []);
      setPedidos(lista); setItens(itens); setEntregas(entregas); setMotoboys(cache?.motoboys || []);
      if (motivo) setMensagem(`Sem conexão/erro ao atualizar. Exibindo último cache${cache ? " disponível" : " local"} + pedidos locais. (${motivo})`);
      setCarregando(false);
    }

    if (!supabase || !navigator.onLine) { await aplicarComCache(); return; }
    try {
      const { data: peds, error } = await supabase.from("orders").select("*").eq("type", "delivery").eq("loja_id", sessao.id).in("status", ["pago", "saiu_entrega"]).order("created_at", { ascending: false });
      if (error) { await aplicarComCache(error.message); return; }
      const remotos = (peds || []) as Order[];
      let itensRemotos: OrderItem[] = []; let entregasRemotas: Entrega[] = []; let motoboysRemotos: Motoboy[] = [];
      if (remotos.length > 0) {
        const ids = remotos.map((o) => o.id);
        const [resEntregas, resItens] = await Promise.all([
          supabase.from("entregas").select("*").in("order_id", ids),
          supabase.from("order_items").select("*").in("order_id", ids),
        ]);
        if (resEntregas.error || resItens.error) { await aplicarComCache(resEntregas.error?.message || resItens.error?.message); return; }
        entregasRemotas = (resEntregas.data || []) as Entrega[];
        itensRemotos = (resItens.data || []) as OrderItem[];
      }
      try { const { data: motos } = await supabase.from("motoboys").select("*").eq("loja_id", sessao.id); motoboysRemotos = (motos || []) as Motoboy[]; } catch { motoboysRemotos = lerCacheDelivery(lojaId)?.motoboys || []; }
      salvarCacheDelivery(lojaId, { pedidos: remotos, itens: itensRemotos, entregas: entregasRemotas, motoboys: motoboysRemotos, ts: Date.now() });
      const { lista, itens, entregas } = montar(remotos, itensRemotos, entregasRemotas);
      setPedidos(lista); setItens(itens); setEntregas(entregas); setMotoboys(motoboysRemotos);
    } catch (error) { await aplicarComCache(ehErroRede(error) ? "falha de conexão" : (error instanceof Error ? error.message : "erro")); } finally { setCarregando(false); }
  }

  useEffect(() => {
    void carregar();
    const aoFila = () => { void carregar(); };
    window.addEventListener("pdv-offline-orders-changed", aoFila);
    window.addEventListener("online", aoFila);
    return () => { window.removeEventListener("pdv-offline-orders-changed", aoFila); window.removeEventListener("online", aoFila); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function mudarStatus(pedido: PedidoDelivery, novoStatus: "pendente" | "saiu_entrega" | "entregue") {
    const sessao = getSessao();
    if (!sessao || salvandoId) return;
    if (!caixaEstaAberto(sessao.id)) { setMensagem(MENSAGEM_CAIXA_FECHADO); return; }
    setSalvandoId(pedido.id); setMensagem(null);
    try {
      const registro = pedido._record;
      const entregaId = registro?.entrega?.id || entregas.find((e) => e.order_id === pedido.id)?.id || crypto.randomUUID();
      const taxa = Number(registro?.entrega?.taxa ?? registro?.pedido.delivery_fee ?? pedido.delivery_fee ?? 0);
      const tipoUpdate = novoStatus === "pendente" ? "order_status" : "entrega_status";

      if (registro || navigator.onLine === false || !supabase) {
        if (!registro) {
          await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: pedido.id, tipo: tipoUpdate, payload: { status: novoStatus }, criadoEm: new Date().toISOString() });
          setPedidos((atual) => novoStatus === "saiu_entrega" ? atual.map((p) => p.id === pedido.id ? { ...p, status: novoStatus } : p) : novoStatus === "pendente" ? atual.filter((p) => p.id !== pedido.id) : atual.filter((p) => p.id !== pedido.id));
          setEntregas((atual) => atual.some((e) => e.order_id === pedido.id) ? atual.map((e) => e.order_id === pedido.id ? { ...e, status: novoStatus } : e) : [...atual, { id: entregaId, order_id: pedido.id, motoboy_id: null, status: novoStatus, taxa, loja_id: sessao.id, created_at: new Date().toISOString() } as Entrega]);
        } else {
          await atualizarPedidoOffline(registro.id, (atual) => ({
            ...atual,
            statusLocal: novoStatus,
            pedido: { ...atual.pedido, status: novoStatus, numero_exibicao: atual.numeroExibicao },
            entrega: atual.entrega || novoStatus !== "pendente"
              ? { ...(atual.entrega || { id: entregaId, order_id: atual.id, motoboy_id: null, taxa, loja_id: sessao.id }), status: novoStatus === "pendente" ? "pendente" : novoStatus }
              : atual.entrega,
          }));
          if (registro.sincronizado) {
            if (supabase && navigator.onLine) {
              try {
                if (novoStatus === "pendente") {
                  const { error } = await supabase.from("orders").update({ status: "pendente" }).eq("id", pedido.id).eq("loja_id", sessao.id);
                  if (error) throw error;
                } else {
                  const { error: e1 } = await supabase.from("orders").update({ status: novoStatus }).eq("id", pedido.id).eq("loja_id", sessao.id).eq("type", "delivery");
                  const { error: e2 } = await supabase.from("entregas").update({ status: novoStatus }).eq("order_id", pedido.id).eq("loja_id", sessao.id);
                  if (e1 || e2) throw e1 || e2;
                }
              } catch (err) {
                await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: registro.id, tipo: tipoUpdate, payload: { status: novoStatus }, criadoEm: new Date().toISOString() });
                if (!ehErroRede(err)) console.warn(err);
              }
            } else {
              await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: registro.id, tipo: tipoUpdate, payload: { status: novoStatus }, criadoEm: new Date().toISOString() });
            }
          }
          await carregar();
        }
        const destino = novoStatus === "pendente" ? "voltou para a cozinha!" : novoStatus === "entregue" ? "entregue e enviado para Pedido Finalizado!" : "saiu para entrega!";
        aoPedidoCriado(`${rotuloPedido(pedido)} ${destino}`);
        if (!registro) return; // já atualizamos UI localmente
        return;
      }

      // Pedido remoto, online
      try {
        const { data, error } = await supabase.from("orders").update({ status: novoStatus }).eq("id", pedido.id).eq("loja_id", sessao.id).eq("type", "delivery").eq("status", pedido.status).select("id").maybeSingle();
        if (error || !data) { setMensagem(error ? "Erro ao atualizar pedido: " + error.message : "Esse pedido foi alterado. Confira a lista atualizada."); await carregar(); return; }
        const { error: erroEntrega } = await supabase.from("entregas").update({ status: novoStatus }).eq("order_id", pedido.id).eq("loja_id", sessao.id);
        if (erroEntrega) {
          try { await supabase.from("orders").update({ status: pedido.status }).eq("id", pedido.id).eq("loja_id", sessao.id).eq("status", novoStatus); } catch { /* best effort */ }
          setMensagem("Erro ao atualizar entrega: " + erroEntrega.message);
          await carregar();
          return;
        }
        const destino = novoStatus === "pendente" ? "voltou para a cozinha!" : novoStatus === "entregue" ? "entregue e enviado para Pedido Finalizado!" : "saiu para entrega!";
        aoPedidoCriado(`${rotuloPedido(pedido)} ${destino}`);
        await carregar();
      } catch (err) {
        await enfileirarUpdateOffline({ id: crypto.randomUUID(), lojaId: sessao.id, orderId: pedido.id, tipo: tipoUpdate, payload: { status: novoStatus }, criadoEm: new Date().toISOString() });
        setMensagem(`Sem conexão. ${rotuloPedido(pedido)} atualizado localmente e será sincronizado.`);
        setPedidos((atual) => novoStatus === "saiu_entrega" ? atual.map((p) => p.id === pedido.id ? { ...p, status: novoStatus } : p) : atual.filter((p) => p.id !== pedido.id));
        if (!ehErroRede(err)) console.warn(err);
      }
    } catch (error) {
      console.error(error);
      setMensagem(ehErroRede(error) ? "Sem conexão. Não foi possível concluir agora." : "Erro ao atualizar pedido.");
    } finally { setSalvandoId(null); }
  }

  function entregaDoPedido(orderId: string): Entrega | undefined { return entregas.find((e) => e.order_id === orderId); }
  function nomeMotoboy(motoboyId: string | null | undefined): string { if (!motoboyId) return "—"; return motoboys.find((m) => m.id === motoboyId)?.nome ?? "—"; }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Pedidos Delivery</h1>
      {mensagem && <div role="alert" className="bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-3 mb-4">{mensagem}</div>}
      {carregando && <p className="text-gray-400 text-center py-10">Carregando...</p>}
      {!carregando && pedidos.length === 0 && <div className="bg-white rounded-xl p-10 text-center text-gray-400">Nenhum pedido aguardando entrega. Os pedidos preparados na cozinha aparecem aqui.</div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {pedidos.map((pedido) => {
          const entrega = entregaDoPedido(pedido.id) || (pedido._record?.entrega ? { ...pedido._record.entrega, created_at: pedido.created_at } as Entrega : undefined);
          const itensPedido = pedido.items?.length ? pedido.items.map((item, idx) => ({ id: `${pedido.id}-${idx}`, qty: item.qty, price: item.price, observacao: item.observacao, product_id: item.product_id })) : itens.filter((i) => i.order_id === pedido.id);
          const pendenteSync = Boolean(pedido._record && !pedido._record.sincronizado);
          return (
            <div key={pedido.id} className="bg-white rounded-xl p-4 flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-sm">{rotuloPedido(pedido)}</p>
                <span className="text-xs text-gray-400">{formatarData(pedido.created_at)}</span>
                <span className={`text-xs font-bold px-2 py-1 rounded ${STATUS_COR[pedido.status] ?? "bg-gray-200 text-gray-600"}`}>{STATUS_NOME[pedido.status] ?? pedido.status}</span>
                {pedido._record && <span className={`text-[10px] font-black px-2 py-1 rounded-full ${pendenteSync ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-700"}`}>{pendenteSync ? "AGUARDANDO SINCRONIZAÇÃO" : "SINCRONIZADO"}</span>}
              </div>
              <div>
                <p className="font-semibold">{pedido.customer_name ?? "Sem nome"}</p>
                {pedido.telefone && <p className="text-xs text-gray-400">Tel: <b className="text-gray-700">{pedido.telefone}</b></p>}
                <p className="text-xs text-gray-400">{pedido.address}</p>
                {pedido.complemento && <p className="text-xs text-gray-400">Complemento: {pedido.complemento}</p>}
              </div>
              <ul className="text-sm space-y-1">
                {itensPedido.map((item) => (
                  <li key={item.id}>
                    <div className="flex justify-between"><span>{item.qty}x {item.product_id ? "Item" : "Item removido"}</span><span className="text-gray-400">{formatarMoeda(Number(item.price) * item.qty)}</span></div>
                    {item.observacao && <p className="text-xs text-amber-600 italic ml-3">Obs: {item.observacao}</p>}
                  </li>
                ))}
              </ul>
              <div className="text-sm border-t border-gray-200 pt-2 flex flex-col gap-1">
                <p className="flex justify-between text-gray-400"><span>Taxa de entrega</span><span>{formatarMoeda(Number(pedido.delivery_fee))}</span></p>
                <p className="flex justify-between font-bold"><span>Total</span><span className="text-green-600">{formatarMoeda(Number(pedido.total))}</span></p>
              </div>
              <p className="text-sm bg-gray-100 rounded px-3 py-2">Motoboy: <b className="text-green-600">{nomeMotoboy(entrega?.motoboy_id || pedido._record?.entrega?.motoboy_id)}</b></p>
              <div className="flex flex-wrap gap-2 mt-auto">
                <button onClick={() => void mudarStatus(pedido, "pendente")} disabled={salvandoId !== null} title="Voltar para a cozinha" className="flex-1 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold px-3 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed">Voltar</button>
                {pedido.status === "pago" && <button onClick={() => void mudarStatus(pedido, "saiu_entrega")} disabled={salvandoId !== null} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-3 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed">Saiu pra entrega</button>}
                <button onClick={() => void mudarStatus(pedido, "entregue")} disabled={salvandoId !== null} className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-3 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed">Entregue</button>
                {salvandoId === pedido.id && <p role="status" className="w-full text-xs text-gray-500">Salvando...</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
