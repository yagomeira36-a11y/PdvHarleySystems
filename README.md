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

## Atendente IA pelo WhatsApp

1. Execute [`supabase/atendente-ia-whatsapp.sql`](supabase/atendente-ia-whatsapp.sql) no SQL Editor do Supabase. A migração cria configurações e conversas isoladas por loja, além da coluna `orders.origem`.
2. No servidor, configure `SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `WHATSAPP_WEBHOOK_SECRET`, `GEMINI_API_KEY` e `APP_URL`. O `APP_URL` deve ser público e alcançar `/api/whatsapp/webhook`; para desenvolvimento local, use um túnel HTTPS. Nunca exponha essas chaves com prefixo `NEXT_PUBLIC_`.
3. Configure `GEMINI_MODEL=gemini-3.1-flash-lite` (modelo disponível para esta integração). O código usa esse modelo como fallback se o configurado estiver indisponível.
4. Entre em Configurações → Bot Assistente → Atendente IA / WhatsApp e conecte o número da loja pelo QR Code. Cada loja usa a instância `loja_[store_id]`; escaneie com o WhatsApp do estabelecimento em **Aparelhos conectados**.
5. Salve a mensagem de boas-vindas e ligue a IA. A IA consulta o cardápio e as zonas da própria loja, pede confirmação antes de registrar pedido e não responde por cinco minutos depois de uma mensagem manual do dono. Use **Pausar IA** para interromper respostas automáticas sem desconectar.

O token `WHATSAPP_WEBHOOK_SECRET` deve ser um valor aleatório forte, compartilhado somente entre o servidor do PDV e o webhook Evolution. A tela informa quando alguma variável ou a migração ainda estiver faltando.

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
