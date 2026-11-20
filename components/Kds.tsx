"use client";

// ============================================================
// TELA KDS (COZINHA)
// Mostra os pedidos pendentes para a cozinha preparar:
// - tickets com nº, tipo (balcão/delivery), hora e itens
// - observações dos itens em destaque (âmbar)
// - botão "Finalizar pedido" para mover o pedido para finalizados
// - pedidos delivery (inclusive da loja online) permitem escolher
//   o motoboy, criando ou atualizando a entrega
// ============================================================
import { useEffect, useRef, useState } from "react";
import { getSupabase, getSessao, formatarMoeda, rotuloPedido, linkWhatsApp, Order, OrderItem, Entrega, Motoboy } from "@/lib/supabase";
import { caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";
import {
  guardarCacheOffline,
  lerCacheOffline,
  listarPedidosOffline,
  type OfflineOrderRecord,
} from "@/lib/offline-pdv";

export default function Kds({
  refreshKey,
  aoPedidoCriado,
}: {
  refreshKey: number;
  aoPedidoCriado?: (texto: string, tipo?: "ok" | "erro") => void;
}) {
  const supabase = getSupabase();

  const [pedidos, setPedidos] = useState<Order[]>([]);
  const [itens, setItens] = useState<OrderItem[]>([]);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]);
  const [salvandoMotoboyId, setSalvandoMotoboyId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [idsOffline, setIdsOffline] = useState<Set<string>>(new Set());
  const carregamentoInicial = useRef(true);

  // ============================================================
  // CARREGAR PEDIDOS PENDENTES + ITENS
  // ============================================================
  async function carregar() {
    if (!supabase) {
      setCarregando(false);
      return;
    }
    if (carregamentoInicial.current) setCarregando(true);
    const sessao = getSessao();
    if (!sessao) {
      setCarregando(false);
      carregamentoInicial.current = false;
      return;
    }
    setMensagem(null);
    let registrosOffline: OfflineOrderRecord[] = [];
    try {
      registrosOffline = await listarPedidosOffline(sessao.id);
    } catch (error) {
      if (!navigator.onLine) {
        setMensagem(error instanceof Error ? error.message : "Não foi possível ler os pedidos locais.");
        setCarregando(false);
        carregamentoInicial.current = false;
        return;
      }
      console.error("Não foi possível ler pedidos offline:", error);
    }
    const pedidosLocais = registrosOffline.map((registro) => registro.pedido);
    const itensLocais = registrosOffline.flatMap((registro) => registro.itens);
    const entregasLocais = registrosOffline.flatMap((registro) =>
      registro.entrega
        ? [{ ...registro.entrega, created_at: registro.criadoEm }]
        : []
    );
    setIdsOffline(new Set(pedidosLocais.map((pedido) => pedido.id)));
    if (!navigator.onLine) {
      setPedidos(pedidosLocais);
      setItens(itensLocais as OrderItem[]);
      setEntregas(entregasLocais as Entrega[]);
      try {
        const motoboysSalvos = await lerCacheOffline<Motoboy[]>(sessao.id, "motoboys");
        setMotoboys(motoboysSalvos || []);
      } catch (error) {
        setMensagem(error instanceof Error ? error.message : "Não foi possível carregar os motoboys locais.");
      }
      setMensagem(
        pedidosLocais.length > 0
          ? `${pedidosLocais.length} pedido(s) salvo(s) neste dispositivo, aguardando sincronização.`
          : "Sem internet. Os pedidos pendentes aparecerão aqui após a sincronização."
      );
      setCarregando(false);
      carregamentoInicial.current = false;
      return;
    }

    const { data: peds, error } = await supabase
      .from("orders")
      .select("*")
      .in("status", ["pendente", "novo"])
      .eq("loja_id", sessao.id)
      .order("created_at", { ascending: true });
    if (error) {
      setPedidos(pedidosLocais);
      setItens(itensLocais as OrderItem[]);
      setEntregas(entregasLocais as Entrega[]);
      setMensagem("Erro ao carregar pedidos: " + error.message);
      setCarregando(false);
      carregamentoInicial.current = false;
      return;
    }
    const listaRemota = (peds || []) as Order[];
    const idsRemotos = new Set(listaRemota.map((pedido) => pedido.id));
    const lista = [...listaRemota, ...pedidosLocais.filter((pedido) => !idsRemotos.has(pedido.id))];
    setPedidos(lista);

    if (lista.length > 0) {
      const ids = lista.map((o) => o.id);
      const entregasIds = lista.filter((o) => o.type === "delivery").map((o) => o.id);
      const [resItens, resEntregas] = await Promise.all([
        supabase.from("order_items").select("*").in("order_id", ids),
        entregasIds.length > 0
          ? supabase.from("entregas").select("*").in("order_id", entregasIds)
          : Promise.resolve({ data: [] }),
      ]);
      setItens([...(resItens.data || []) as OrderItem[], ...itensLocais as OrderItem[]]);
      setEntregas([...(resEntregas.data || []) as Entrega[], ...entregasLocais as Entrega[]]);
    } else {
      setItens(itensLocais as OrderItem[]);
      setEntregas(entregasLocais as Entrega[]);
    }

    // Motoboys da loja (para permitir escolher quem entrega)
    if (lista.some((o) => o.type === "delivery")) {
      const { data: motos } = await supabase
        .from("motoboys")
        .select("*")
        .eq("loja_id", sessao.id)
        .eq("ativo", true)
        .order("nome");
      setMotoboys((motos || []) as Motoboy[]);
      if (motos) {
        try {
          await guardarCacheOffline(sessao.id, "motoboys", motos as Motoboy[]);
        } catch (cacheError) {
          console.error("Não foi possível atualizar o cache de motoboys:", cacheError);
        }
      }
    } else {
      setMotoboys([]);
    }
    setCarregando(false);
    carregamentoInicial.current = false;
  }

  useEffect(() => {
    void carregar();
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void carregar();
    }, 3000);
    return () => window.clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // ============================================================
  // FINALIZAR PEDIDO (pendente -> pago)
  // ============================================================
  async function finalizarPedido(pedido: Order) {
    const sessao = getSessao();
    if (!supabase || !sessao) return;
    if (idsOffline.has(pedido.id)) {
      setMensagem("Este pedido aguarda conexão e sincronização antes de ser finalizado.");
      return;
    }
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    const { error } = await supabase
      .from("orders")
      .update({ status: "pago" })
      .eq("id", pedido.id);
    if (error) {
      setMensagem("Erro ao atualizar: " + error.message);
      return;
    }
    setMensagem(`${rotuloPedido(pedido)} finalizado!`);
    // Avisa a página para atualizar os badges do menu e as outras telas
    aoPedidoCriado?.(`${rotuloPedido(pedido)} finalizado!`);
    carregar();
  }

  // ============================================================
  // VINCULAR MOTOBOY (pedidos vindos da loja online chegam sem entrega)
  // ============================================================
  async function atribuirMotoboy(pedido: Order, motoboyId: string) {
    const sessao = getSessao();
    if (!supabase || !sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      carregar();
      return;
    }
    setSalvandoMotoboyId(pedido.id);
    setMensagem(null);
    try {
      const existente = entregas.find((e) => e.order_id === pedido.id);
      let error: { message: string } | null = null;
      if (existente) {
        ({ error } = await supabase
          .from("entregas")
          .update({ motoboy_id: motoboyId || null })
          .eq("id", existente.id)
          .eq("loja_id", sessao.id));
      } else if (motoboyId) {
        ({ error } = await supabase.from("entregas").insert({
          order_id: pedido.id,
          motoboy_id: motoboyId,
          status: "pendente",
          taxa: 0,
          loja_id: sessao.id,
        }));
      }
      if (error) {
        setMensagem("Erro ao vincular motoboy: " + error.message);
        return;
      }
      const nome = motoboys.find((m) => m.id === motoboyId)?.nome;
      setMensagem(
        nome
          ? `${rotuloPedido(pedido)} com motoboy ${nome}!`
          : `Motoboy removido do ${rotuloPedido(pedido)}.`
      );
      await carregar();
    } finally {
      setSalvandoMotoboyId(null);
    }
  }

  // Hora curta para exibição
  function formatarHora(iso: string): string {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const itensDoPedido = (orderId: string) =>
    itens.filter((i) => i.order_id === orderId);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-extrabold">Cozinha</h1>
        <button
          onClick={carregar}
          className="bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold px-4 py-2 rounded-xl shadow-sm transition"
        >
          Atualizar
        </button>
      </div>

      {mensagem && (
        <div className="bg-green-50 border border-green-500 text-green-700 rounded-lg p-3 mb-4">
          {mensagem}
        </div>
      )}

      {carregando && (
        <p className="text-gray-500 text-center py-10">Carregando...</p>
      )}

      {!carregando && pedidos.length === 0 && (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-500 shadow-sm">
          Nenhum pedido pendente na cozinha.
        </div>
      )}

      {/* Grade de tickets da cozinha */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {pedidos.map((pedido) => (
          <div
            key={pedido.id}
            className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex flex-col gap-3"
          >
            {/* Cabeçalho do ticket */}
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-lg">{rotuloPedido(pedido)}</p>
              <span
                className={`text-xs font-bold px-2 py-1 rounded-full ${
                  pedido.type === "delivery"
                    ? "bg-blue-100 text-blue-700"
                    : pedido.type === "mesa"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-green-100 text-green-700"
                }`}
              >
                {pedido.type === "delivery"
                  ? "DELIVERY"
                  : pedido.type === "mesa"
                    ? "MESA"
                    : "BALCÃO"}
              </span>
              <span className="text-sm text-gray-500">
                {formatarHora(pedido.created_at)}
              </span>
              {pedido.status === "novo" && (
                <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-black text-red-700">
                  NOVO
                </span>
              )}
              {idsOffline.has(pedido.id) && (
                <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">
                  OFFLINE · PENDENTE
                </span>
              )}
            </div>

            {/* Cliente (delivery) */}
            {pedido.customer_name && (
              <p className="text-sm text-gray-600 -mt-1">
                Cliente: <b>{pedido.customer_name}</b>
              </p>
            )}
            {pedido.type === "delivery" && pedido.address && (
              <p className="text-sm text-gray-600 -mt-1">
                Endereço: <b>{pedido.address}</b>
                {pedido.complemento ? ` · ${pedido.complemento}` : ""}
              </p>
            )}
            {pedido.type === "delivery" && pedido.telefone && (
              <div className="flex items-center justify-between gap-2 -mt-1">
                <p className="text-sm text-gray-600">
                  Telefone: <b>{pedido.telefone}</b>
                </p>
                {linkWhatsApp(pedido.telefone) && (
                  <a
                    href={linkWhatsApp(pedido.telefone)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-lg bg-green-600 px-3 py-1 text-xs font-bold text-white hover:bg-green-700"
                  >
                    WhatsApp
                  </a>
                )}
              </div>
            )}

            {/* Escolha do motoboy (pedidos da loja online chegam sem motoboy) */}
            {pedido.type === "delivery" && (
              <div className="flex items-center gap-2 -mt-1">
                <label
                  htmlFor={`motoboy-${pedido.id}`}
                  className="shrink-0 text-sm font-semibold text-gray-600"
                >
                  Motoboy:
                </label>
                {motoboys.length === 0 ? (
                  <p className="text-xs text-amber-700">
                    Nenhum motoboy ativo cadastrado — cadastre na tela Motoboys.
                  </p>
                ) : (
                  <select
                    id={`motoboy-${pedido.id}`}
                    value={
                      entregas.find((e) => e.order_id === pedido.id)?.motoboy_id ?? ""
                    }
                    disabled={salvandoMotoboyId === pedido.id || idsOffline.has(pedido.id)}
                    onChange={(ev) => void atribuirMotoboy(pedido, ev.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-semibold disabled:opacity-50"
                  >
                    <option value="">— escolher —</option>
                    {motoboys.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </select>
                )}
                {salvandoMotoboyId === pedido.id && (
                  <span className="shrink-0 text-xs text-gray-400">salvando...</span>
                )}
              </div>
            )}
            {pedido.forma_pagamento && (
              <p className="text-xs text-gray-500 -mt-1">Pagamento: {pedido.forma_pagamento}</p>
            )}
            {pedido.observacao && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Observação: {pedido.observacao}
              </p>
            )}

            {/* Mesa (pedido de mesa) */}
            {pedido.type === "mesa" && pedido.mesa_numero && (
              <p className="text-sm text-amber-700 -mt-1">
                Mesa: <b>{pedido.mesa_numero}</b>
              </p>
            )}

            {/* Itens a preparar */}
            <ul className="space-y-2 flex-1">
              {(pedido.items?.length
                ? pedido.items.map((item, index) => ({
                    id: `${pedido.id}-item-${index}`,
                    product_id: item.product_id,
                    qty: item.qty,
                    price: item.price,
                    cost: 0,
                    observacao: item.observacao,
                    product_name: item.name,
                  }))
                : itensDoPedido(pedido.id)
              ).map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-bold">{item.qty}x {item.product_name || "Item"}{!item.product_id ? " (removido)" : ""}</p>
                    {item.observacao && (
                      <p className="text-xs text-amber-600 italic font-semibold">
                        Obs: {item.observacao}
                      </p>
                    )}
                  </div>
                  <span className="text-sm text-gray-500 shrink-0">
                    {formatarMoeda(Number(item.price) * item.qty)}
                  </span>
                </li>
              ))}
              {(pedido.items?.length || itensDoPedido(pedido.id).length) === 0 && (
                <li className="text-sm text-gray-400 text-center py-3">
                  Sem itens registrados.
                </li>
              )}
            </ul>

            {/* Ação */}
            <button
              onClick={() => finalizarPedido(pedido)}
              disabled={idsOffline.has(pedido.id)}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl transition"
            >
              {idsOffline.has(pedido.id) ? "AGUARDANDO SINCRONIZAÇÃO" : "FINALIZAR PEDIDO"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
