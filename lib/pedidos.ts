import type { Order } from "./supabase";

export function filtrarPedidosCancelados(
  pedidos: Order[],
  intervalo?: [number, number]
): Order[] {
  return pedidos
    .filter((pedido) => {
      if (pedido.status !== "cancelado") return false;
      if (!intervalo) return true;
      const instante = new Date(pedido.cancelado_em || pedido.created_at).getTime();
      return instante >= intervalo[0] && instante < intervalo[1];
    })
    .sort(
      (a, b) =>
        new Date(b.cancelado_em || b.created_at).getTime() -
        new Date(a.cancelado_em || a.created_at).getTime()
    );
}
