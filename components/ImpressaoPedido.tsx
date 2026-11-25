"use client";

import { useEffect, useRef, useState } from "react";
import { getSessao, rotuloPedido } from "@/lib/supabase";
import type { Order } from "@/lib/supabase";
import { carregarDadosImpressao, lerImpressora, montarDadosImpressaoLocal } from "@/lib/impressao";
import type { DadosImpressao, ItemImpressao, TipoImpressao } from "@/lib/impressao";
import { imprimirDadosQz } from "@/lib/qz";

type Props = {
  pedido: Order;
  itensLocais?: ItemImpressao[];
  rotuloBotao?: string;
  classNameBotao?: string;
};

export default function ImpressaoPedido({ pedido, itensLocais, rotuloBotao = "Imprimir", classNameBotao = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-800 hover:bg-gray-100" }: Props) {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<"ambos" | TipoImpressao>("ambos");
  const [confirmado, setConfirmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const dialogo = useRef<HTMLDialogElement>(null);
  const emCurso = useRef(false);
  const tituloId = `impressao-${pedido.id}`;
  useEffect(() => { if (aberto) dialogo.current?.showModal(); }, [aberto]);

  async function obterDados(): Promise<DadosImpressao> {
    if (itensLocais && itensLocais.length > 0) {
      return montarDadosImpressaoLocal({ pedido, itens: itensLocais });
    }
    if (Array.isArray(pedido.items) && pedido.items.length > 0) {
      return montarDadosImpressaoLocal({
        pedido,
        itens: pedido.items.map((item) => ({
          nome: item.name,
          quantidade: item.qty,
          preco: Number(item.price),
          observacao: item.observacao ?? null,
        })),
      });
    }
    return carregarDadosImpressao(pedido.id);
  }

  async function imprimir() {
    if (emCurso.current || !confirmado) return;
    emCurso.current = true;
    setEnviando(true);
    setErro("");
    setMensagem("");
    try {
      const sessao = getSessao();
      if (!sessao) throw new Error("Sessão da loja não encontrada.");
      const config = lerImpressora(sessao.id);
      const dados = await obterDados();
      const resultado = await imprimirDadosQz(dados, config, tipo === "ambos" ? ["comprovante", "comanda"] : [tipo]);
      setMensagem(resultado);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível enviar ao QZ Tray.");
    } finally {
      emCurso.current = false;
      setEnviando(false);
      setConfirmado(false);
    }
  }

  return <>
    <button type="button" onClick={() => { setAberto(true); setConfirmado(false); setErro(""); setMensagem(""); }} className={classNameBotao} aria-label={`${rotuloBotao} ${rotuloPedido(pedido)}`}>{rotuloBotao}</button>
    {aberto && <dialog ref={dialogo} onCancel={(event) => { event.preventDefault(); if (!emCurso.current) setAberto(false); }} aria-labelledby={tituloId} className="m-auto w-[95vw] max-w-lg rounded-2xl border border-gray-300 bg-white p-5 text-gray-900 shadow-2xl backdrop:bg-black/50">
      <header className="flex items-center justify-between gap-3"><h2 id={tituloId} className="text-lg font-bold">{rotuloBotao} {rotuloPedido(pedido)}</h2><button type="button" disabled={enviando} onClick={() => setAberto(false)} className="rounded border px-3 py-2 disabled:opacity-50">Fechar</button></header>
      <p className="my-3 text-sm text-gray-600">Envio direto por QZ Tray em bobina 80 mm, com corte. Confira o papel e a fila do Windows antes de reenviar para não duplicar. Nenhuma nova venda será criada.</p>
      <label className="block text-sm font-semibold">Documento<select value={tipo} disabled={enviando} onChange={(event) => { setTipo(event.target.value as typeof tipo); setConfirmado(false); }} className="my-2 block w-full rounded border p-2"><option value="ambos">1 comprovante + 1 comanda</option><option value="comprovante">Somente comprovante do cliente</option><option value="comanda">Somente comanda da cozinha</option></select></label>
      <label className="my-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmado} disabled={enviando} onChange={(event) => setConfirmado(event.target.checked)} className="mt-1" />Conferi o papel e a fila; quero enviar os documentos selecionados.</label>
      {erro && <p role="alert" className="my-3 whitespace-normal rounded bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      {mensagem && <p role="status" className="my-3 whitespace-normal rounded bg-green-50 p-3 text-sm text-green-800">{mensagem}</p>}
      <button type="button" disabled={enviando || !confirmado} onClick={() => void imprimir()} className="w-full rounded-lg bg-blue-700 p-3 text-sm font-bold text-white disabled:opacity-50">{enviando ? "Enviando ao QZ Tray..." : "Imprimir agora via QZ Tray"}</button>
    </dialog>}
  </>;
}
