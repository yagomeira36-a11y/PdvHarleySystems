# PDV Hamburgueria — tema dark estilo Safeh Food

Sistema PDV completo para hamburgueria com **Next.js 14**, **Tailwind CSS** e **Supabase**.
Inclui frente de caixa (balcão), delivery com motoboys e gestão de entregadores.

## Telas (abas do topo)

| Aba          | O que faz                                                                 |
|--------------|---------------------------------------------------------------------------|
| Balcão       | PDV principal: cardápio em grade, categorias, busca, carrinho e finalização |
| Delivery     | Pedidos delivery com status e botões "Saiu pra entrega" / "Entregue"      |
| Motoboys     | CRUD de motoboys, entregas de cada um e total de taxas do dia             |
| Comanda/Mesa/Integração | Placeholders (em desenvolvimento)                                |

## Como configurar o Supabase

1. No painel do seu projeto Supabase, abra o **SQL Editor** e cole todo o conteúdo
   de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
   Isso cria as 5 tabelas (`products`, `orders`, `order_items`, `motoboys`, `entregas`),
   o enum de categorias, as políticas de acesso e já insere **12 produtos** e **3 motoboys** de exemplo.
2. Copie `.env.example` para `.env.local` e preencha:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Como rodar

```bash
npm run dev
```

Abra http://localhost:3000 (será redirecionado para /pdv).

> **Observação sobre o Node:** este computador não tem Node instalado no sistema.
> O projeto inclui um Node portátil em `.nodejs/` (ignorado no git) e o atalho
> `iniciar.bat`, que sobe o servidor com dois cliques. Depois de instalar o Node
> oficialmente, a pasta `.nodejs` pode ser apagada.

## Fluxo de venda

1. **Balcão**: clique nos cards para montar o carrinho (ou filtre por categoria/busca).
2. Clique no botão verde com o total → o sistema pergunta **Balcão** ou **Delivery**.
3. **Balcão**: finaliza na hora (pedido `pago`).
4. **Delivery**: modal obrigatório com endereço do cliente, taxa de entrega (R$) e
   seleção do motoboy. A taxa soma no total, o pedido é salvo como `delivery`
   e uma **entrega** é criada linkada ao motoboy.
5. Acompanhe na aba **Delivery** e avance o status: `pendente` → `saiu_entrega` → `entregue`.
6. Na aba **Motoboys** veja as entregas e o total de taxas do dia por entregador.

## Atalhos

- **F11** ou botão "F11 Opções": alterna tela cheia
- **F12** ou botão "F12 Fechar": fecha a janela (o navegador pode bloquear)

## Aviso de segurança

As políticas RLS do `schema.sql` liberam acesso público para demonstração.
Em produção, use autenticação do Supabase e políticas restritas.
