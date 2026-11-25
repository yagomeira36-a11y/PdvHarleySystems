"use client";

// ============================================================
// TELA PEDIDO FINALIZADO
// Lista os pedidos do expediente ATUAL (caixa aberto), incluindo
// pedidos finalizados offline ainda não sincronizados.
// ============================================================
import { useEffect, useState } from "react";
import {
  getSupabase,
  getSessao,
  formatarMoeda,
  rotuloPedido,
  linkWhatsApp,
  Order,
  OrderItem,
  Product,
} from "@/lib/supabase";
import { lerCaixas, caixaAberto, caixaReaberto, Caixa, caixaEstaAberto, MENSAGEM_CAIXA_FECHADO } from "@/lib/caixa";
import {
  atualizarPedidoOffline,
  enfileirarUpdateOffline,
  listarPedidosOffline,
  type OfflineOrderRecord,
} from "@/lib/offline-pdv";
import EditarPedidoModal, { ItemEdit } from "./EditarPedidoModal";
import ImpressaoPedido from "./ImpressaoPedido";

type PedidoFinalizado = Order & {
  _offline?: boolean;
  _sincronizado?: boolean;
  _offlineRecord?: OfflineOrderRecord;
  items?: Array<{ product_id?: string | null; name?: string; qty: number; price: number; observacao?: string | null }>;
};

// Cores do badge de cada status
const STATUS_COR: Record<string, string> = {
  pago: "bg-green-100 text-green-700",
  saiu_entrega: "bg-blue-100 text-blue-700",
  entregue: "bg-green-100 text-green-700",
};

const STATUS_NOME: Record<string, string> = {
  pago: "pago",
  saiu_entrega: "saiu p/ entrega",
  entregue: "entregue",
};

const STATUS_FINALIZADOS = new Set(["pago", "saiu_entrega", "entregue"]);

const MOTIVOS_CANCELAMENTO = [
  "Cliente desistiu",
  "Endereço errado / não encontrado",
  "Falta de ingrediente",
  "Erro no pedido",
  "Outro",
];

export default function PedidosFinalizados({
  refreshKey,
  aoPedidoCriado,
}: {
  refreshKey: number;
  aoPedidoCriado?: (texto: string, tipo?: "ok" | "erro") => void;
}) {
  const supabase = getSupabase();

  const [pedidos, setPedidos] = useState<PedidoFinalizado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [caixaAberta, setCaixaAberta] = useState<Caixa | null>(null);
  const [confirmando, setConfirmando] = useState<{ id: string; acao: "voltar" } | null>(null);
  const [pedidoCancelando, setPedidoCancelando] = useState<PedidoFinalizado | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [outroMotivo, setOutroMotivo] = useState("");
  const [salvandoCancelamento, setSalvandoCancelamento] = useState(false);
  const [erroCancelamento, setErroCancelamento] = useState("");
  const [editandoPedido, setEditandoPedido] = useState<PedidoFinalizado | null>(null);
  const [editItensIniciais, setEditItensIniciais] = useState<ItemEdit[]>([]);
  const [produtos, setProdutos] = useState<Product[]>([]);

  async function carregar() {
    const sessao = getSessao();
    if (!sessao) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    try {
      const aberta = caixaAberto(lerCaixas(sessao.id));
      setCaixaAberta(aberta);

      const [resPedidos, resProdutos, registrosOffline] = await Promise.all([
        supabase
          ? supabase
              .from("orders")
              .select("*")
              .eq("loja_id", sessao.id)
              .in("status", ["pago", "saiu_entrega", "entregue"])
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [] as unknown[], error: null }),
        supabase
          ? supabase.from("products").select("*").eq("loja_id", sessao.id).order("code")
          : Promise.resolve({ data: [] as unknown[], error: null }),
        listarPedidosOffline(sessao.id).catch(() => [] as OfflineOrderRecord[]),
      ]);

      setProdutos(((resProdutos as { data?: unknown[] }).data || []) as Product[]);

      let listaRemota = (((resPedidos as { data?: unknown[] }).data || []) as PedidoFinalizado[]).map((p) => ({
        ...p,
      }));

      if (aberta) {
        const inicio = caixaReaberto(aberta)
          ? new Date(aberta.reabertoEm as string).getTime()
          : new Date(aberta.abertoEm).getTime();
        listaRemota = listaRemota.filter((p) => new Date(p.created_at).getTime() >= inicio);
      } else {
        listaRemota = [];
      }

      const idsRemotos = new Set(listaRemota.map((p) => p.id));
      let listaLocal: PedidoFinalizado[] = [];
      if (aberta) {
        const inicio = caixaReaberto(aberta)
          ? new Date(aberta.reabertoEm as string).getTime()
          : new Date(aberta.abertoEm).getTime();
        listaLocal = registrosOffline
          .filter((r) => {
            const st = r.statusLocal || r.pedido.status || "";
            if (!STATUS_FINALIZADOS.has(st)) return false;
            if (idsRemotos.has(r.id)) return false; // já veio do remoto
            const t = new Date(r.pedido.created_at || r.criadoEm).getTime();
            return t >= inicio;
          })
          .map((r) => ({
            ...r.pedido,
            id: r.id,
            status: (r.statusLocal || r.pedido.status) as Order["status"],
            numero_exibicao: r.numeroExibicao || r.pedido.numero_exibicao,
            created_at: r.pedido.created_at || r.criadoEm,
            items: r.itens.map((i) => ({
              product_id: i.product_id,
              name: (i as any).product_name || r.pedido.items?.find((it) => it.product_id === i.product_id)?.name || "Item",
              qty: i.qty,
              price: Number(i.price),
              observacao: i.observacao ?? null,
            })),
            _offline: !r.sincronizado,
            _sincronizado: Boolean(r.sincronizado),
            _offlineRecord: r,
          })) as PedidoFinalizado[];
      }

      const lista = [...listaLocal, ...listaRemota].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setPedidos(lista);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    const onChange = () => void carregar();
    window.addEventListener("pdv-offline-orders-changed", onChange);
    window.addEventListener("online", onChange);
    return () => {
      window.removeEventListener("pdv-offline-orders-changed", onChange);
      window.removeEventListener("online", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function voltarParaPreparo(p: PedidoFinalizado) {
    const sessao = getSessao();
    if (!sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    setConfirmando(null);
    try {
      const registro = p._offlineRecord;
      if (registro) {
        await atualizarPedidoOffline(registro.id, (atual) => ({
          ...atual,
          statusLocal: "em_preparo",
          pedido: { ...atual.pedido, status: "pendente", numero_exibicao: atual.numeroExibicao },
        }));
        if (registro.sincronizado) {
          await enfileirarUpdateOffline({
            id: crypto.randomUUID(),
            lojaId: sessao.id,
            orderId: registro.id,
            tipo: "order_status",
            payload: { status: "pendente" },
            criadoEm: new Date().toISOString(),
          });
          if (supabase && typeof navigator !== "undefined" && navigator.onLine) {
            try {
              await supabase.from("orders").update({ status: "pendente" }).eq("id", p.id).eq("loja_id", sessao.id);
            } catch {
              /* fila trata */
            }
          }
        }
      } else {
        if (!supabase) throw new Error("Sem conexão.");
        const { error } = await supabase.from("orders").update({ status: "pendente" }).eq("id", p.id);
        if (error) throw error;
      }
      aoPedidoCriado?.(`${rotuloPedido(p)} voltou para a cozinha!`);
      await carregar();
    } catch (error) {
      setMensagem("Erro ao voltar para o preparo: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  async function cancelarPedido(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const p = pedidoCancelando;
    const sessao = getSessao();
    if (!sessao) {
      setErroCancelamento("Não foi possível identificar a loja para cancelar o pedido.");
      return;
    }
    const motivo = motivoCancelamento === "Outro" ? outroMotivo.trim() : motivoCancelamento;
    if (!motivo) {
      setErroCancelamento("Informe o motivo do cancelamento.");
      return;
    }
    if (!p) return;

    setSalvandoCancelamento(true);
    setErroCancelamento("");
    try {
      const agora = new Date().toISOString();
      const registro = p._offlineRecord;
      if (registro) {
        await atualizarPedidoOffline(registro.id, (atual) => ({
          ...atual,
          statusLocal: "cancelado",
          pedido: {
            ...atual.pedido,
            status: "cancelado" as any,
            numero_exibicao: atual.numeroExibicao,
            motivo_cancelamento: motivo as any,
            cancelado_em: agora as any,
            cancelado_por: sessao.email_dono as any,
          } as any,
        }));
        if (registro.sincronizado) {
          await enfileirarUpdateOffline({
            id: crypto.randomUUID(),
            lojaId: sessao.id,
            orderId: registro.id,
            tipo: "order_status",
            payload: { status: "cancelado", motivo_cancelamento: motivo, cancelado_em: agora, cancelado_por: sessao.email_dono },
            criadoEm: agora,
          });
          if (supabase && typeof navigator !== "undefined" && navigator.onLine) {
            try {
              await supabase
                .from("orders")
                .update({ status: "cancelado", motivo_cancelamento: motivo, cancelado_em: agora, cancelado_por: sessao.email_dono })
                .eq("id", p.id)
                .eq("loja_id", sessao.id);
            } catch {
              /* fila trata */
            }
          }
        }
      } else {
        if (!supabase) throw new Error("Sem conexão.");
        const { error } = await supabase
          .from("orders")
          .update({ status: "cancelado", motivo_cancelamento: motivo, cancelado_em: agora, cancelado_por: sessao.email_dono })
          .eq("id", p.id)
          .eq("loja_id", sessao.id);
        if (error) throw error;
      }
      setPedidoCancelando(null);
      setMotivoCancelamento("");
      setOutroMotivo("");
      setMensagem(`${rotuloPedido(p)} cancelado e mantido no histórico.`);
      aoPedidoCriado?.(`${rotuloPedido(p)} cancelado!`);
      await carregar();
    } catch (error) {
      setErroCancelamento(
        "Erro ao cancelar o pedido: " + (error instanceof Error ? error.message : "Falha de comunicação.")
      );
    } finally {
      setSalvandoCancelamento(false);
    }
  }

  async function abrirEdicao(p: PedidoFinalizado) {
    const sessao = getSessao();
    if (!sessao) return;
    if (!caixaEstaAberto(sessao.id)) {
      setMensagem(MENSAGEM_CAIXA_FECHADO);
      return;
    }
    setMensagem(null);
    try {
      if (p._offlineRecord) {
        const r = p._offlineRecord;
        const lista: ItemEdit[] = r.itens.map((i) => ({
          key: i.id,
          product_id: i.product_id || null,
          nome:
            produtos.find((pr) => pr.id === i.product_id)?.name ||
            r.pedido.items?.find((it) => it.product_id === i.product_id)?.name ||
            "Item",
          qty: i.qty,
          price: Number(i.price),
          cost: Number(i.cost || 0),
          observacao: i.observacao ?? null,
        }));
        setEditandoPedido(p);
        setEditItensIniciais(lista);
        return;
      }
      if (!supabase) throw new Error("Sem conexão.");
      const { data: it } = await supabase.from("order_items").select("*").eq("order_id", p.id);
      const lista = ((it || []) as OrderItem[]).map((i) => ({
        key: i.id,
        product_id: i.product_id,
        nome: produtos.find((pr) => pr.id === i.product_id)?.name ?? "(produto removido)",
        qty: i.qty,
        price: Number(i.price),
        cost: Number(i.cost),
        observacao: i.observacao ?? null,
      }));
      setEditandoPedido(p);
      setEditItensIniciais(lista);
    } catch (error) {
      setMensagem("Erro ao abrir edição: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  function formatarHora(iso: string): string {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-extrabold">Pedido Finalizado</h1>
        <button
          onClick={() => void carregar()}
          className="bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold px-4 py-2 rounded-xl shadow-sm transition"
        >
          Atualizar
        </button>
      </div>

      {mensagem && (
        <div className="bg-green-50 border border-green-500 text-green-700 rounded-lg p-3 mb-4">{mensagem}</div>
      )}

      {carregando && <p className="text-gray-500 text-center py-10">Carregando...</p>}

      {!carregando && !caixaAberta && (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-500 shadow-sm">
          Nenhum caixa aberto. Abra o caixa para acompanhar os pedidos finalizados do expediente.
        </div>
      )}

      {!carregando && caixaAberta && pedidos.length === 0 && (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-500 shadow-sm">
          Nenhum pedido finalizado ainda.
        </div>
      )}

      {!carregando && caixaAberta && pedidos.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-2">Pedido</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Hora</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {pedidos.map((p) => {
                const itensLocais = p._offlineRecord
                  ? p._offlineRecord.itens.map((i) => ({
                      nome:
                        produtos.find((pr) => pr.id === i.product_id)?.name ||
                        p.items?.find((it) => it.product_id === i.product_id)?.name ||
                        "Item",
                      quantidade: i.qty,
                      preco: Number(i.price),
                      observacao: i.observacao ?? null,
                    }))
                  : p.items?.map((i) => ({
                      nome: i.name || "Item",
                      quantidade: i.qty,
                      preco: Number(i.price),
                      observacao: i.observacao ?? null,
                    }));
                return (
                  <tr key={p.id} className="hover:bg-gray-50 align-middle">
                    <td className="px-4 py-2 font-semibold">
                      <div className="flex flex-col gap-1">
                        <span>{rotuloPedido(p)}</span>
                        {p._offline && <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">OFFLINE</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {p.type === "delivery" ? "Delivery" : p.type === "mesa" ? `Mesa ${p.mesa_numero ?? ""}` : "Balcão"}
                    </td>
                    <td className="px-4 py-2">
                      <p className="font-medium text-gray-700">{p.customer_name ?? "—"}</p>
                      {p.type === "delivery" && p.address && (
                        <p className="text-xs text-gray-500">
                          {p.address}
                          {p.complemento ? ` · ${p.complemento}` : ""}
                        </p>
                      )}
                      {p.telefone && (
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                          <span>Tel: <b className="text-gray-700">{p.telefone}</b></span>
                          {linkWhatsApp(p.telefone) && (
                            <a href={linkWhatsApp(p.telefone)!} target="_blank" rel="noopener noreferrer" className="rounded-md bg-green-600 px-2 py-0.5 font-bold text-white hover:bg-green-700">WhatsApp</a>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{formatarHora(p.created_at)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatarMoeda(Number(p.total))}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${STATUS_COR[p.status] ?? "bg-gray-200 text-gray-600"}`}>
                        {STATUS_NOME[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center whitespace-nowrap">
                      <div className="flex gap-1 justify-center flex-wrap">
                        <ImpressaoPedido pedido={p} itensLocais={itensLocais} />
                        <button onClick={() => void abrirEdicao(p)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-2.5 py-1.5 rounded transition">Editar</button>
                        {confirmando?.id === p.id && confirmando.acao === "voltar" ? (
                          <button onClick={() => void voltarParaPreparo(p)} className="bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold px-2.5 py-1.5 rounded transition">Confirmar?</button>
                        ) : (
                          <button onClick={() => setConfirmando({ id: p.id, acao: "voltar" })} className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-2.5 py-1.5 rounded transition">Voltar p/ Preparo</button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setPedidoCancelando(p);
                            setConfirmando(null);
                            setMotivoCancelamento("");
                            setOutroMotivo("");
                            setErroCancelamento("");
                            setMensagem(null);
                          }}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-2.5 py-1.5 rounded transition"
                        >
                          CANCELAR PEDIDO
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editandoPedido && (
        <EditarPedidoModal
          pedido={editandoPedido}
          itensIniciais={editItensIniciais}
          produtos={produtos}
          offlineRecord={editandoPedido._offlineRecord}
          onClose={() => setEditandoPedido(null)}
          onSaved={(texto) => {
            setEditandoPedido(null);
            aoPedidoCriado?.(texto);
            void carregar();
          }}
        />
      )}

      {pedidoCancelando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="motivo-cancelamento-titulo" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 id="motivo-cancelamento-titulo" className="text-lg font-extrabold">Qual o motivo do cancelamento?</h2>
            <p className="mt-1 text-sm text-gray-600">{rotuloPedido(pedidoCancelando)} · {formatarMoeda(Number(pedidoCancelando.total))}</p>
            <form onSubmit={cancelarPedido} className="mt-4 space-y-3">
              <fieldset className="space-y-2">
                <legend className="sr-only">Motivo do cancelamento</legend>
                {MOTIVOS_CANCELAMENTO.map((motivo) => (
                  <label key={motivo} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="motivo-cancelamento" value={motivo} required checked={motivoCancelamento === motivo} onChange={() => setMotivoCancelamento(motivo)} />
                    {motivo}
                  </label>
                ))}
              </fieldset>
              {motivoCancelamento === "Outro" && (
                <label className="block text-sm font-semibold" htmlFor="outro-motivo-cancelamento">
                  Descreva o motivo
                  <input id="outro-motivo-cancelamento" type="text" required autoFocus maxLength={250} value={outroMotivo} onChange={(event) => setOutroMotivo(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal" />
                </label>
              )}
              {erroCancelamento && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{erroCancelamento}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" disabled={salvandoCancelamento} onClick={() => setPedidoCancelando(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Voltar</button>
                <button type="submit" disabled={salvandoCancelamento} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{salvandoCancelamento ? "Cancelando..." : "Confirmar cancelamento"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
