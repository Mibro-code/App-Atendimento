# Análise técnica do app Shopify existente (C:\ShopifyApps)

Data da análise: 2026-08-28
Projeto analisado: `C:\ShopifyApps\clientes-login-tt` (repo git ativo, branch
`agent/dados-cnpj-ocultos-lp`). Os outros diretórios em `C:\ShopifyApps`
(`clientes-login-tt-backup`, `-release-retry`, `-review`, `login-clientes-teste-2`)
são cópias/backups e **não foram usados como referência** — o código-fonte
vivo é `clientes-login-tt`.

> Nada foi alterado em `C:\ShopifyApps`. Esta análise é somente leitura.

## 1. Framework e stack

- **React Router 7** (sucessor do Remix) via `@shopify/shopify-app-react-router`,
  rodando em modo SSR com `react-router-serve`.
- **Prisma 6** + **PostgreSQL** como ORM/banco (`app/db.server.js`,
  `prisma/schema.prisma`).
- **Shopify App Bridge React** para a parte embutida (admin embedded app).
- Deploy via **Docker** (`Dockerfile`, `compose.yaml`, `compose.sincrofit.yaml`)
  atrás de **Caddy** (`Caddyfile`) na VPS, domínio `app.mibrobrasil.com.br`.
- Multi-tenant "multi-marca": o mesmo código serve duas configurações
  (`shopify.app.toml` = Mibro, `shopify.app.sincrofit.toml` = Sincrofit),
  selecionadas por env vars (`WHOLESALE_BRAND`, `SHOPIFY_APP_URL`).
- Node >=20.19/22.

## 2. App Proxy da Shopify

Definido em `shopify.app.toml`:

```toml
[app_proxy]
url = "https://app.mibrobrasil.com.br/apps/cnpj-validator"
subpath = "cnpj-validator"
prefix = "apps"
```

Ou seja, tudo que a loja pública chama em
`https://mibrobrasil.com.br/apps/cnpj-validator/**` é encaminhado pela Shopify
(assinado com HMAC) para as rotas React Router com prefixo de arquivo
`apps.cnpj-validator.*`. A autenticação desse encaminhamento é feita por
`authenticateAppProxyShop()` (`app/services/app-proxy-auth.server.js`), que
usa `authenticate.public.appProxy(request)` do SDK oficial da Shopify — isso
já valida a assinatura HMAC do App Proxy automaticamente. **Não existe
validação manual de HMAC no código**, é delegada ao SDK.

Rotas do App Proxy (públicas, atrás da loja, sem exigir login do Shopify
admin):

| Rota (arquivo) | Rota pública | Método | Função |
|---|---|---|---|
| `apps.cnpj-validator.cnpj.jsx` | `/apps/cnpj-validator/cnpj?cnpj=...` | GET | Consulta CNPJ (BrasilAPI/CNPJá) + perfil de preço Olist |
| `apps.cnpj-validator.atacado.calcular-olist.jsx` | `/apps/cnpj-validator/atacado/calcular-olist` | POST | Calcula cotação de atacado e cria/atualiza pedido "aberto" no Olist |
| `apps.cnpj-validator.atacado.confirmar-pedido.jsx` | `/apps/cnpj-validator/atacado/confirmar-pedido` | POST | Marca o pedido Olist como "PARA ANÁLISE" (envia para aprovação manual) |
| `apps.cnpj-validator.atacado.enviar-email.jsx` | `/apps/cnpj-validator/atacado/enviar-email` | POST | Envia a proposta calculada por e-mail (Resend) |
| `apps.cnpj-validator.atacado.registrar-lead.jsx` | `/apps/cnpj-validator/atacado/registrar-lead` | POST | Registra lead da landing page (Google Sheets + app de atendimento) |
| `apps.cnpj-validator.atacado.config.jsx` | `/apps/cnpj-validator/atacado/config` | GET | Expõe config pública (ex.: modo teste) para a calculadora |
| `apps.cnpj-validator.portal-revendedor.jsx` | `/apps/cnpj-validator/portal-revendedor` | GET/POST | Portal de login/pedidos do revendedor (cliente final, não vendedor interno) |

Rotas administrativas embutidas no Shopify Admin (exigem sessão OAuth do
comerciante, não são acessíveis publicamente): `app.jsx`, `app._index.jsx`,
`app.olist.jsx` (conexão OAuth com Olist), `app.wholesale-access.jsx`,
`app.additional.jsx`, `app.appearance.jsx`, `app.referrals.jsx`,
`app.central-links.jsx`.

Webhooks Shopify → app (assinados/validados pelo SDK):
`webhooks.app.uninstalled.jsx`, `webhooks.app.scopes_update.jsx`,
`webhooks.orders.paid.jsx` (pedido pago **na própria loja Shopify**, não
relacionado ao pedido de atacado no Olist).

**Não existe webhook nem polling de status de pedido vindo do Olist.** Ver
seção 5.

## 3. Autenticação — visão geral

Há **quatro mecanismos de autenticação distintos** no app, cada um para um
público diferente:

1. **Shopify OAuth (admin embutido)** — `shopify.server.js` +
   `@shopify/shopify-app-react-router`, sessão armazenada na tabela `Session`
   (Prisma). Usado pelas rotas `app.*`.
2. **App Proxy HMAC** — validado pelo SDK Shopify (`authenticate.public.appProxy`)
   para todas as rotas `apps.cnpj-validator.*`. Garante que a requisição veio
   de dentro da loja Shopify (`shop` confiável).
3. **Portal do revendedor (cliente final de atacado)** — login próprio com
   e-mail/senha (`WholesaleCredential`, hash de senha, bloqueio por tentativas,
   `WholesalePortalSession` com `tokenHash` + expiração). Serviços:
   `wholesale-portal-auth.server.js`, `wholesale-password.server.js`,
   `wholesale-customer-auth.server.js`.
4. **OAuth 2 com o Olist (Tiny ERP v3)** — `olist-auth.server.js` +
   `auth.olist.callback.jsx`. Tokens de acesso/refresh são **criptografados
   com AES-256-GCM** (`OLIST_TOKEN_ENCRYPTION_KEY`) antes de ir para o banco
   (`OlistConnection`). O app nunca expõe esses tokens ao frontend.

Padrão de autenticação **serviço-a-serviço** já usado no projeto (relevante
para o CRM):
- `atendimento-lead.server.js`: chama `https://atendimento.mibrobrasil.com.br/...`
  com `Authorization: Bearer <ATENDIMENTO_API_SECRET>`, valida a URL de
  destino por allowlist (protocolo, host e path exatos) antes de disparar o
  fetch.
- `wholesale-leads-sheet.server.js`: chama um Google Apps Script Webhook com
  um segredo compartilhado (`GOOGLE_SCRIPT_WEBHOOK_SECRET`).

Ou seja, o padrão estabelecido no projeto para integrações backend-to-backend
é **segredo compartilhado via Bearer token + allowlist de URL**, não HMAC de
payload nem JWT. É o padrão mais simples de reaproveitar para o CRM.

## 4. Integração com Olist (ERP Tiny v3)

Serviço central: `app/services/olist-api.server.js`, usando
`OLIST_API_BASE_URL=https://api.tiny.com.br/public-api/v3` com OAuth2
(`olist-auth.server.js`, `auth.olist.callback.jsx`).

Endpoints Olist usados hoje:
- `GET /produtos` (busca por SKU) → `findOlistProductBySku`
- `GET /contatos` (busca por CPF/CNPJ) → `findOlistContactByTaxId`
- `POST /contatos` → `createOlistContact`
- `POST /pedidos` → `createOlistOrder`
- `PUT /pedidos/{id}/itens` → `updateOlistOrderItems`
- `GET /pedidos/{id}` → `getOlistOrder`
- `GET /pedidos` (filtros: `cpfCnpj`, `numero`, `dataInicial`, `dataFinal`) → `listOlistOrders`
- `POST /pedidos/{id}/marcadores` → `addOlistOrderMarker` (usado para marcar
  "PARA ANÁLISE")

### Como o pedido é criado (fluxo real, `wholesale-order.server.js`)

1. Calculadora Shopify envia payload validado (produtos, preços, CNPJ, etc.)
   para `/apps/cnpj-validator/atacado/calcular-olist`.
2. App valida preço/tabela de atacado no servidor (nunca confia no preço do
   frontend).
3. Busca ou cria um `WholesaleQuote` no Postgres, identificado por
   `publicToken` (`quote_token` gerado no frontend) — isso evita pedidos
   duplicados por reenvio.
4. "Trava" a cotação (`claimQuote`, lease de 2 min) contra corrida.
5. Busca contato no Olist por CNPJ; se não existir, cria (`POST /contatos`).
6. Resolve os itens (SKU → produto Olist) e cria o pedido
   (`POST /pedidos`) com `situacao: 0` (**pedido aberto**, código Olist/Tiny),
   observação interna padrão dizendo "aguardando aprovação manual da
   responsável".
7. Guarda no banco: `olistOrderId` (`id` retornado pela Olist) e
   `olistOrderNumber` (`numeroPedido`), dentro de `WholesaleQuote`.
8. Retorna o resultado calculado para a calculadora (valores em centavos).

### Confirmação (`confirmar-pedido`)

Não muda o `situacao` do pedido — apenas adiciona um **marcador**
`"PARA ANÁLISE"` via `POST /pedidos/{id}/marcadores` e atualiza
`WholesaleQuote.status = "READY_FOR_REVIEW"`. A aprovação real (mudar status,
faturar, gerar NF) **é manual, feita por um humano dentro do próprio Olist**.

### Status Olist (`situacao`) realmente observados no código

O código só trata dois casos concretos, não existe um enum documentado com
todos os nomes:

- `OPEN_ORDER_STATUS = 0` → pedido "aberto" (`isOpenStatus()` também aceita
  as strings `"aberta"`, `"aberto"`, `"em aberto"`).
- `APPROVED_OR_LATER_ORDER_STATUSES = new Set(["1","3","4","5","6","7","9"])`
  → usado só para decidir se o CNPJ é "cliente recorrente" (não é uma
  tradução de cada código para um nome de negócio).

**Não há, no código atual, um dicionário `situacao → nome legível`.** Os
códigos acima são os únicos usados/validados. **Não inventar nomes para os
demais códigos** — antes de mapear no CRM, será necessário consultar a
documentação oficial da API Tiny/Olist v3 ou observar pedidos reais.
Campos adicionais observados na resposta de pedido: `idNotaFiscal`,
`dataFaturamento`, `numeroOrdemCompra`, `numeroPedido`, `id`.

### Modelo `WholesaleOrder` já existe no Prisma, mas **não está em uso**

`prisma/schema.prisma` já modela `WholesaleOrder`, `WholesaleOrderItem`,
`WholesaleInvoice`, `WholesaleTracking`, `WholesaleTrackingEvent` — com campos
como `status`, `paymentStatus`, `fulfillmentStatus`, `total`, tracking/NF.
Existe um leitor (`wholesale-order-read.server.js`, usado pelo portal do
revendedor). **Busquei em todo o projeto por `wholesaleOrder.create` /
`.upsert` / `.update` e não encontrei nenhuma chamada** — ou seja, essa
tabela foi desenhada para receber uma sincronização Olist → Postgres que
**ainda não foi implementada**. Não é seguro assumir que ela está populada.

### Sincronização de status: não existe ainda

- Não há webhook do Olist configurado (`shopify.app.toml` só lista webhooks
  do Shopify: `app/uninstalled`, `app/scopes_update`, `orders/paid`).
- Não há job de polling agendado no repositório (nenhum cron/worker
  encontrado).
- A única leitura de pedido pós-criação é sob demanda, dentro do próprio
  fluxo de cálculo (`assertOrderStillOpen`, com retry em
  `olist-order-read-retry.server.js`), para saber se o pedido "aberto" ainda
  pode ser alterado — não é uma sincronização de status de negócio.

**Conclusão prática:** o CRM não pode assumir que existe hoje um jeito de
"ficar sabendo" quando o status do pedido muda no Olist. Isso precisa ser
construído (novo endpoint de sync no app Shopify, ver seção 7).

## 5. Consulta de CNPJ

`app/services/cnpj.server.js`, exposto via
`GET /apps/cnpj-validator/cnpj?cnpj=...`:
- Fonte primária: BrasilAPI (`CNPJ_API_BASE_URL`, padrão
  `https://brasilapi.com.br/api/cnpj/v1`).
- Fonte alternativa/complementar: CNPJá (`CNPJA_API_BASE_URL`,
  `CNPJA_API_KEY`), plano gratuito (50 consultas/mês).
- Retorna razão social, nome fantasia, endereço, situação cadastral, etc.
  (campo `registrationStatus`/`registrationStatusDate` vêm de
  `descricao_situacao_cadastral`/`data_situacao_cadastral`).
- Combina com `getOlistCustomerPricingProfile(shop, cnpj)` para dizer se é
  "cliente recorrente" (preço por modelo) ou não (preço pelo mix).

## 6. Envio de e-mail

`app/services/wholesale-email.server.js`, exposto via
`POST /apps/cnpj-validator/atacado/enviar-email`. Usa **Resend**
(`RESEND_API_KEY`, `WHOLESALE_EMAIL_FROM`, `WHOLESALE_EMAIL_TO`) para enviar a
proposta calculada por e-mail ao time comercial.

## 7. Variáveis de ambiente relevantes (`.env.example`)

```
APP_DOMAIN, SHOPIFY_APP_URL
SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES
POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, DATABASE_URL
CNPJ_API_BASE_URL, CNPJA_API_BASE_URL, CNPJA_API_KEY
OLIST_CLIENT_ID, OLIST_CLIENT_SECRET, OLIST_REDIRECT_URI
OLIST_TOKEN_ENCRYPTION_KEY (AES-256-GCM, base64, 32 bytes)
OLIST_API_BASE_URL, OLIST_AUTHORIZATION_URL, OLIST_TOKEN_URL
OLIST_DEFAULT_OPERATION_NATURE_ID/SELLER_ID/DEPOSIT_ID (opcionais)
WHOLESALE_BRAND, WHOLESALE_MINIMUM_QUANTITY
RESEND_API_KEY, WHOLESALE_EMAIL_FROM, WHOLESALE_EMAIL_TO
GOOGLE_SCRIPT_WEBHOOK_URL, GOOGLE_SCRIPT_WEBHOOK_SECRET
ATENDIMENTO_API_URL, ATENDIMENTO_API_SECRET
```

Nenhum token do Olist ou segredo Shopify fica acessível ao frontend — tudo é
lido só em código `*.server.js`, padrão React Router/Remix.

## 8. O que pode ser reaproveitado pelo CRM

- **Padrão de autenticação B2B**: Bearer token com segredo compartilhado +
  allowlist de URL (`atendimento-lead.server.js`) — replicável para
  `CRM ↔ Shopify app`.
- **Padrão de sessão de curta duração com hash em banco**
  (`WholesalePortalSession`: `tokenHash` + `expiresAt`) — bom modelo para o
  "crm_session" que abrirá a calculadora já preenchida.
- **`WholesaleQuote`** já é a entidade que liga uma cotação da calculadora a
  um pedido Olist (`olistOrderId`, `olistOrderNumber`, `status`). O CRM pode
  se ancorar no `publicToken` dela.
- Estrutura `WholesaleOrder`/`WholesaleOrderItem`/`WholesaleInvoice`/
  `WholesaleTracking` já modelada — pode inspirar (não substituir) os campos
  que o CRM vai querer replicar/espelhar para pedidos, mas hoje está vazia.
- `cnpj.server.js` resolve exatamente a mesma consulta de CNPJ que o CRM quer
  (evitar duplicar chamada a BrasilAPI/CNPJá — o CRM pode chamar um novo
  endpoint no app Shopify em vez de reimplementar).

## 9. Riscos e cuidados

1. **Não existe hoje sincronização de status Olist → banco.** Qualquer
   "status do pedido" que o CRM mostrar hoje será, na melhor das hipóteses,
   o que foi capturado no momento da criação/cálculo (via
   `calcular-olist`/`confirmar-pedido`), não um status atualizado em tempo
   real. É necessário implementar um endpoint novo no app Shopify (polling
   dirigido pelo CRM, ou um job periódico que o app Shopify expõe) — **isto é
   trabalho novo, não algo já pronto para reaproveitar**.
2. Os **códigos de `situacao` do Olist não estão documentados no código**
   além de `0` (aberto) e do conjunto genérico de "aprovado ou posterior".
   Antes de implementar o mapeamento `Olist status → CRM status`, será
   necessário levantar a tabela oficial de códigos da API Tiny v3 (ou
   observar pedidos reais no ambiente de teste) — **não adivinhar**.
3. O app Shopify tem **dois alvos de marca** (Mibro/Sincrofit) compartilhando
   o mesmo código — qualquer nova rota deve ser neutra a isso ou usar
   `wholesaleBrandContext()`.
4. O modo teste (`WholesaleSettings.testModeEnabled`, padrão `true`) bloqueia
   criação real de pedidos — isso já é uma trava de segurança existente,
   deve continuar valendo também para chamadas originadas do CRM.
5. Repositório tem alterações não commitadas em
   `app/routes/app.jsx`, `app/services/olist-auth.server.js`,
   `app/services/wholesale-order.server.js` (git status no momento da
   análise) — o CRM não deve depender de comportamento não commitado; validar
   com o time antes de assumir qualquer coisa desses arquivos como definitivo.
6. **Nenhuma alteração foi feita neste app** durante esta análise.

## 10. Proposta de integração CRM ↔ Shopify (visão geral)

Ver plano detalhado na entrega final da Fase 1, mas o desenho geral:

- **CRM → Shopify (abrir calculadora pré-preenchida):** o CRM gera um token
  assinado de curta duração (JWT, HS256, segredo compartilhado
  `CRM_SHOPIFY_SHARED_SECRET`, TTL curto ex. 10 min, claims mínimas:
  `customerId`, `sellerId`, `exp`, `jti`), e abre
  `https://mibrobrasil.com.br/pages/consulta-de-precos?crm_session=<token>`. **Nenhum
  dado pessoal (CNPJ/e-mail/telefone) vai na URL** — só o token opaco. A
  calculadora (tema Shopify) chama uma **nova rota App Proxy** a ser criada
  no app Shopify, por exemplo
  `GET /apps/cnpj-validator/crm/session?token=...`, que valida a assinatura
  e devolve os dados do cliente/vendedor lidos do CRM (o app Shopify precisa
  então chamar de volta o CRM, ou o token já carrega os dados assinados sem
  round-trip — a decidir na Fase 2, ver riscos de exposição de dados no
  token vs. round-trip autenticado).
- **Shopify → CRM (pedido criado/atualizado):** nova chamada
  backend-to-backend do app Shopify para um endpoint do CRM (ex.
  `POST /api/integrations/olist/orders`), autenticada com
  **Bearer + segredo compartilhado** (mesmo padrão de
  `atendimento-lead.server.js`), disparada nos pontos onde hoje
  `calculateWholesaleOrder` e `confirmWholesaleOrderForReview` já têm sucesso
  — é só adicionar uma chamada de saída ali, sem mudar o comportamento atual.
- **Atualização de status:** como não existe sync hoje, a opção mais segura
  na Fase 3 é o **CRM fazer polling controlado** apenas dos pedidos ainda
  "abertos"/não finalizados, chamando um novo endpoint de leitura no app
  Shopify (ex. `GET /apps/cnpj-validator/crm/orders/:olistOrderId`), que por
  sua vez chama `getOlistOrder`. Isso evita o CRM guardar credenciais Olist e
  reaproveita a auth/rate-limit já existentes no app Shopify.

## 11. Arquivos do app Shopify que provavelmente precisarão ser alterados (futuro)

Nenhum deles foi alterado nesta etapa. Listados apenas como mapa para as
Fases 2/3 (exigem aprovação explícita antes de qualquer edição):

- `app/routes/` — novas rotas `apps.cnpj-validator.crm.session.jsx` (Fase 2)
  e `apps.cnpj-validator.crm.orders.$olistOrderId.jsx` (Fase 3).
- `app/services/wholesale-order.server.js` — adicionar chamada de saída para
  o CRM após `calculateWholesaleOrder`/`confirmWholesaleOrderForReview`
  (Fase 3), seguindo o mesmo padrão não bloqueante já usado para a planilha
  de leads (`sheet_sync`).
- Novo serviço `app/services/crm-integration.server.js` (Fase 2/3): geração/
  validação de token, chamada HTTP ao CRM.
- `.env.example` / `.env` da VPS — novas variáveis
  `CRM_API_URL`, `CRM_SHOPIFY_SHARED_SECRET`.
- `prisma/schema.prisma` — possivelmente um novo modelo leve
  `CrmIntegrationLog` ou reaproveitar `WholesaleQuote` (a decidir).
