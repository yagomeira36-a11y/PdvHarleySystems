import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { normalizarTelefone } from "@/lib/supabase";
import { verificarRateLimit, ipDoRequest } from "@/lib/rate-limit";
import { erroGenerico } from "@/lib/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckoutItemInput = {
  product_id?: unknown;
  quantity?: unknown;
  observation?: unknown;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function texto(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: NextRequest) {
  const ip = ipDoRequest(request);
  const rl = verificarRateLimit(`cardapio-order:${ip}`, 20, 15 * 60 * 1000, 15 * 60 * 1000);
  if (!rl.ok) return json({ error: "Muitas tentativas. Tente novamente em alguns minutos." }, 429);

  const supabase = getSupabaseAdmin();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Dados do pedido inválidos." }, 400);

  const input = body as Record<string, unknown>;
  const lojaId = texto(input.loja_id, 64);
  const nome = texto(input.customer_name, 100);
  const telefone = normalizarTelefone(texto(input.telefone, 30));
  const tipo = input.tipo === "Retirada" ? "Retirada" : "Entrega";
  const pagamento = texto(input.pagamento, 40);
  const rua = texto(input.endereco, 180);
  const numero = texto(input.numero, 30);
  const complemento = texto(input.complemento, 120);
  const bairro = texto(input.bairro, 100);
  const observacao = texto(input.observacao, 500);
  const taxaEntrega = Number(input.taxa_entrega || 0);
  const itemsInput = Array.isArray(input.items) ? input.items as CheckoutItemInput[] : [];

  if (!lojaId || !nome || telefone.length < 10 || telefone.length > 13) {
    return json({ error: "Informe loja, nome e telefone válido com DDD." }, 400);
  }
  if (!["Pix", "Dinheiro", "Cartão na entrega"].includes(pagamento)) {
    return json({ error: "Forma de pagamento inválida." }, 400);
  }
  if (tipo === "Entrega" && (!rua || !numero || !bairro)) {
    return json({ error: "Informe endereço, número e bairro para entrega." }, 400);
  }
  if (!Number.isFinite(taxaEntrega) || taxaEntrega < 0 || itemsInput.length < 1 || itemsInput.length > 30) {
    return json({ error: "Itens ou taxa de entrega inválidos." }, 400);
  }

  const itensNormalizados = itemsInput.map((item) => ({
    productId: texto(item.product_id, 64),
    quantidade: Number(item.quantity),
    observacao: texto(item.observation, 250),
  }));
  if (itensNormalizados.some((item) =>
    !item.productId || !Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 99
  )) {
    return json({ error: "Confira os produtos e as quantidades do pedido." }, 400);
  }

  const productIds = Array.from(new Set(itensNormalizados.map((item) => item.productId)));
  const { data: produtos, error: erroProdutos } = await supabase
    .from("products")
    .select("*")
    .eq("loja_id", lojaId)
    .in("id", productIds);
  if (erroProdutos) {
    console.error("Falha ao consultar produtos do checkout:", erroProdutos.message);
    return erroGenerico(502, "Não foi possível validar os produtos do pedido.");
  }

  const produtosPorId = new Map(
    (produtos || [])
      .filter((produto) => produto.available !== false)
      .map((produto) => [String(produto.id), produto])
  );
  if (itensNormalizados.some((item) => !produtosPorId.has(item.productId))) {
    return json({ error: "Um produto do pedido não está mais disponível. Atualize o cardápio." }, 409);
  }

  const itens = itensNormalizados.map((item) => {
    const produto = produtosPorId.get(item.productId)!;
    return {
      product_id: item.productId,
      name: String(produto.name),
      qty: item.quantidade,
      price: Number(produto.price),
      cost: Number(produto.cost || 0),
      observacao: item.observacao || null,
    };
  });
  const subtotal = itens.reduce((soma, item) => soma + item.qty * item.price, 0);
  const total = subtotal + (tipo === "Entrega" ? taxaEntrega : 0);
  const enderecoCompleto = tipo === "Entrega"
    ? [rua, numero, bairro].filter(Boolean).join(", ")
    : null;

  const { data: pedido, error: erroPedido } = await supabase
    .from("orders")
    .insert({
      loja_id: lojaId,
      type: tipo === "Entrega" ? "delivery" : "balcao",
      status: "novo",
      total,
      customer_name: nome,
      telefone,
      address: enderecoCompleto,
      complemento: complemento || null,
      forma_pagamento: pagamento,
      delivery_fee: tipo === "Entrega" ? taxaEntrega : 0,
      observacao: observacao || null,
      items: itens,
    })
    .select("id,numero_pedido,total,created_at")
    .single();

  if (erroPedido || !pedido) {
    console.error("Falha ao salvar pedido do cardápio:", erroPedido?.message || "Sem retorno do pedido");
    return erroGenerico(502, "Não foi possível salvar o pedido. Tente novamente.");
  }

  const { error: erroItens } = await supabase.from("order_items").insert(
    itens.map((item) => ({
      order_id: pedido.id,
      product_id: item.product_id,
      qty: item.qty,
      price: item.price,
      cost: item.cost,
      observacao: item.observacao,
      loja_id: lojaId,
    }))
  );
  if (erroItens) {
    const { error: erroRemocao } = await supabase
      .from("orders")
      .delete()
      .eq("id", pedido.id)
      .eq("loja_id", lojaId);
    console.error("Falha ao salvar itens do pedido:", erroItens.message, erroRemocao?.message || "");
    return erroGenerico(502, "O pedido não foi concluído porque não foi possível salvar os itens.");
  }

  if (tipo === "Entrega") {
    const { error: erroCliente } = await supabase.from("clientes").upsert(
      {
        loja_id: lojaId,
        nome,
        telefone,
        endereco: enderecoCompleto,
        complemento: complemento || null,
      },
      { onConflict: "loja_id,telefone" }
    );
    if (erroCliente) {
      console.error("Pedido delivery salvo, mas não foi possível salvar os dados do cliente:", erroCliente.message);
    }
  }

  return json({ pedido }, 201);
}
