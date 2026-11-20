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

## Cobrança com Asaas

Configure no servidor (incluindo as variáveis de ambiente da Vercel):

- `ASAAS_API_KEY`
- `ASAAS_API_URL=https://api.asaas.com/v3` (opcional; este é o padrão)
- `ASAAS_WEBHOOK_TOKEN` (opcional)

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

## Aplicativo desktop para Windows

1. Configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no ambiente usado para compilar.
2. Instale as ferramentas desktop: `npm.cmd install --prefix electron`.
3. Execute `npm.cmd run desktop:build`. O instalador NSIS será criado em `dist/`.
4. O aplicativo abre o servidor Next.js empacotado em uma janela maximizada, com barra de título e controles padrão. F11 alterna a tela cheia e Esc sai dela. Links externos (incluindo o cardápio online e `wa.me`) abrem no navegador padrão do Windows. A saída `.next-desktop` é separada da saída normal `.next`, sem alterar a configuração padrão da Vercel.

O PDV salva localmente o cardápio, motoboys, mesas e pedidos pendentes no IndexedDB. A primeira utilização deve ser feita com internet para entrar na loja e carregar esses dados. Depois, pedidos criados sem conexão ficam pendentes neste dispositivo e são enviados ao Supabase quando a conexão volta. A fila também registra itens, entregas, clientes, fiado e ocupação de mesa para que uma repetição da sincronização não crie outro pedido.

O Asaas neste sistema é usado para mensalidades da plataforma; pedidos de venda não são cobranças Asaas. A sincronização offline não cria cobranças financeiras nem inclui a chave privada Asaas no instalador. O QZ Tray continua usando a integração existente. Para impressão assinada no desktop, configure `QZ_CERTIFICATE_PATH`, `QZ_PRIVATE_KEY_PATH` e `QZ_ALLOWED_PRINTERS` no ambiente do servidor local; as chaves privadas não são empacotadas no aplicativo.

## Aplicativo Android com Capacitor

1. Publique primeiro a versão Next atual no Vercel. O APK abre `CAPACITOR_SERVER_URL` (padrão: `https://pdv-hamburgueria.vercel.app`). No momento, esse domínio não serve as rotas Next `/login` e `/pdv` (ambas retornam 404); publique a versão atual nesse domínio ou informe o domínio correto antes de gerar o APK final, por exemplo: `$env:CAPACITOR_SERVER_URL="https://seu-dominio"; npm.cmd run android:apk`.
2. Sincronize o projeto nativo com `npm.cmd run android:sync`.
3. Com JDK 21 e Android SDK instalados e configurados (`ANDROID_HOME` ou `ANDROID_SDK_ROOT`), execute `npm.cmd run android:apk`. O APK de depuração sai em `android/app/build/outputs/apk/debug/app-debug.apk`.

O Capacitor carrega o PDV hospedado, preservando as rotas/API Next e o uso atual do IndexedDB/Supabase. No Android, as barras do sistema ficam ocultas em modo imersivo e reaparecem temporariamente com gesto; o service worker armazena a página e os recursos estáticos já acessados para permitir reabrir o PDV sem conexão. Os pedidos ficam pendentes no IndexedDB e sincronizam quando a conexão retorna. O primeiro login e carregamento de dados precisam ser feitos online. O botão Voltar navega no histórico e, na tela inicial, minimiza o app. Links externos e o cardápio online abrem fora do app.

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
