# Arquitetura Omnichannel

Fluxo padrão para qualquer canal, novo ou existente:

```
PLATAFORMA → ADAPTER (ChannelAdapter) → MODELO INTERNO (Conversation/Message) → CENTRAL → BOT / HUMANO
```

## Peças

- `src/services/channels/channel-adapter.js` — contrato base (`capabilities()`,
  `sendMessage`, `sendMedia`, `markAsRead`, `normalizeInboundEvent`,
  `validateWebhook`, `testConnection`, `refreshCredentials`). Todo método não
  suportado lança `NOT_SUPPORTED` em vez de fingir.
- `src/services/channels/channel-adapter-registry.js` — única fábrica que
  mapeia `Channel` → classe concreta. A Central/Bot nunca instanciam um
  adapter específico direto.
- `src/services/channels/meta-adapter.js` — **envolve** a integração
  WhatsApp/Meta já existente (`src/channels/meta-cloud-channel.js`) sem
  alterar uma linha do arquivo original. O webhook `/webhook/whatsapp` e o
  pipeline de triagem continuam exatamente como estavam. **Só o canal `META`
  (WhatsApp) usa esta classe.**
- `src/channels/meta-graph-messaging.js` + `src/services/channels/meta-messaging-adapter.js`
  — Instagram Direct, Instagram Comentários, Facebook Messenger e Facebook
  Comentários. Antes, esses 4 canais caíam na mesma `MetaAdapter` do
  WhatsApp e herdavam capabilities completas sem nenhuma chamada real por
  trás (bug corrigido). Agora cada um tem classe própria
  (`InstagramDirectAdapter`/`FacebookMessengerAdapter`/
  `InstagramCommentsAdapter`/`FacebookCommentsAdapter`), usando Page/IG
  Access Token por `ChannelAccount` (não o token global do WhatsApp) contra
  endpoints reais e estáveis da Graph API: Send API
  (`POST /{page-id}/messages`, `POST /{ig-user-id}/messages`) para
  Direct/Messenger, `POST /{comment-id}/comments` (Facebook) e
  `POST /{ig-comment-id}/replies` (Instagram) para responder comentários
  públicos. Validação de webhook reaproveita a mesma verificação HMAC
  (`X-Hub-Signature-256` com `META_APP_SECRET`) do WhatsApp, implementada à
  parte para não acoplar o webhook genérico à rota própria do WhatsApp.
- `src/services/channels/channel-account-service.js` — CRUD de `ChannelAccount`
  (Master-only), cifra segredos antes de gravar, nunca devolve segredo cru.
- `src/services/channels/channel-message-service.js` — dispatcher único de
  envio (`send()`), sempre confere `capabilities()` antes de chamar o adapter.
- `src/services/channels/integration-secret-service.js` — AES-256-GCM via
  `INTEGRATION_ENCRYPTION_KEY`.
- `src/services/channels/integration-oauth-service.js` +
  `oauth-providers.js` — fluxo OAuth genérico com proteção CSRF/replay
  (`ChannelOAuthState`, uso único, TTL de 15 minutos).
- `src/services/channels/external-event-service.js` — ledger de idempotência
  (`ExternalChannelEvent`, `@@unique([channel, externalEventId])`).
- `src/services/channels/channel-event-normalizer.js` — formato comum
  `NormalizedInboundMessage`.
- `src/services/channels/omnichannel-message-service.js` — persiste o
  normalizado em `Contact`/`Conversation`/`Message`, separado de
  `conversation-service.js`/`message-service.js` (exclusivos do WhatsApp).

## Master switch — quem fica de fora

`META_CHANNELS` = **só `META` (WhatsApp)**. Todos os outros 11 canais
gerenciados — incluindo os 4 sub-canais Meta "novos" (Instagram
Direct/Comentários, Facebook Messenger/Comentários), que reaproveitam o
mesmo app Meta mas são contas próprias por página/perfil — estão em
`NEW_CHANNELS` e por isso exigem o master switch (`IntegrationGlobalSettings.newChannelsEnabled`)
ligado antes de enviar/receber qualquer coisa. Isso corrige um gap: antes,
Instagram/Facebook (novos) ficavam fora do master switch por estarem
agrupados com WhatsApp em `META_CHANNELS`, mesmo sendo contas novas que
nunca deveriam ativar sozinhas.

## Roteamento de webhook com múltiplas contas no mesmo canal

`ChannelAdapter.matchesWebhookPayload(rawPayload)` (default `true`, nunca
quebra adapters existentes) permite que a rota genérica
`POST /webhooks/channels/:channel` escolha a `ChannelAccount` certa quando
há mais de uma conta ativa no mesmo canal (ex.: duas Páginas do Facebook) —
antes, a rota sempre pegava "a primeira conta ativa" (`findFirst`), o que
misturaria eventos de contas diferentes. Instagram/Facebook sobrescrevem
este método comparando o `pageId`/`igUserId` do payload (`entry[].id`) com
o da própria conta; os demais canais (uma conta por vez, hoje) mantêm o
comportamento default.

## Modelos novos (aditivos, sem alterar dados existentes)

- `ChannelAccount` — multi-conta por canal, segredos cifrados, status
  (`NOT_CONFIGURED`/`CONFIGURED`/`AUTH_PENDING`/`CONNECTED`/`DEGRADED`/`ERROR`/`NOT_SUPPORTED`/`NEEDS_APPROVAL`/`NEEDS_CONTRACT`).
  Os dois últimos são honestos por design: `NEEDS_APPROVAL` = a API existe
  mas a plataforma ainda não aprovou o escopo do app (TikTok Shop Customer
  Service hoje); `NEEDS_CONTRACT` = exige contrato comercial que ainda não
  existe (Reclame Aqui hoje). Nenhum dos dois finge `CONNECTED`.
- `ChannelOAuthState` — state CSRF de uso único.
- `ExternalChannelEvent` — idempotência de webhook.
- `IntegrationGlobalSettings` — chave-mestra de "novos canais" (nunca afeta
  Meta/WhatsApp).
- `Conversation.channelAccountId`, `Conversation.externalConversationId`,
  `Conversation.kind` (`PRIVATE_CONVERSATION`/`PUBLIC_QUESTION`/`REVIEW`/`COMPLAINT`/`EMAIL_THREAD`).
- `Bot.channels` (array, aditivo ao `channel` legado — um Bot single-channel
  nunca precisa preenchê-lo).
- `Contact.phone` passou a ser opcional (nem todo canal tem telefone).

## Canais realmente funcionais nesta fase (chamadas reais, sem simulação)

- **WhatsApp (META)** — já era produção, intocado.
- **Instagram Direct / Facebook Messenger** — envio/recebimento real via
  Graph API (Send API), marcar como lido, webhook validado por HMAC.
- **Instagram Comentários / Facebook Comentários** — receber e responder
  comentário público real via Graph API. Sem envio de mídia/marcar como
  lido (não existe nesse tipo de interação).
- **E-mail (Gmail/Microsoft 365)** — envio real preservando thread
  (`In-Reply-To`/`References` no Gmail, `/messages/{id}/reply` no Graph),
  com anexo. Recebimento ainda não tem push (`supportsWebhook: false`) —
  `normalizeInboundEvent` já está pronto para quando um poller/push for
  implementado.
- **Mercado Livre** — responder pergunta pública (`POST /answers`) e enviar
  mensagem pós-venda (`POST /messages/packs/{pack_id}/sellers/{seller_id}`),
  webhook validado por formato mínimo + `application_id`, refresh de token
  via OAuth genérico.

## Canais que exigem aprovação/contrato externo (status honesto, não fingem `CONNECTED`)

- **TikTok Shop** — `NEEDS_APPROVAL`: token técnico pode até validar, mas o
  escopo de Customer Service não está aprovado pela TikTok ainda. Nenhuma
  chamada de mensageria é feita.
- **Reclame Aqui** — `NOT_CONFIGURED` (sem nada configurado) ou
  `NEEDS_CONTRACT` (configurado mas sem contrato comercial confirmado com a
  API oficial). Nenhum endpoint é chamado.
- **Amazon Marketplace** — testa credenciais LWA reais (`CONNECTED` só
  reflete que a conta SP-API está acessível), mas nenhuma capability de
  mensageria está ligada — a consulta de ações de mensagem permitidas por
  pedido não foi implementada nesta fase (ver `docs/integrations/amazon.md`).
- **Google Reviews** — testa OAuth real, mas listar/responder review segue
  `NOT_SUPPORTED` até confirmar o endpoint certo (ver `google-business.md`).
- **Shopee** — estrutura de adapter/capabilities pronta, `NOT_SUPPORTED`
  sempre — nenhum endpoint foi inventado (ver `shopee.md`).

## O que NÃO foi feito nesta fase

- SHEIN não foi integrado.
- Nenhum endpoint de API foi inventado para canais sem documentação
  confirmada (ver `shopee.md`, `amazon.md`, `tiktok-shop.md`).
- Nenhuma automação (bot, auto-resposta) foi ligada por padrão para canal
  novo.
- Instagram/Facebook (novos) não têm OAuth automatizado ainda
  (`supportsOAuth: false`) — a conta é conectada colando manualmente o
  Page/IG Access Token gerado no Meta Business Suite/Graph API Explorer,
  igual ao padrão já usado pelo WhatsApp. Um fluxo de "selecionar Página"
  via Facebook Login for Business fica como próximo passo natural.
- `ContactIdentity` unificado entre canais **não foi criado**: `Contact`
  continua particionado por `channel` (`@@unique([channel, externalId])`).
  O mesmo cliente falando por WhatsApp e Instagram gera dois registros de
  `Contact` distintos hoje. Unificar isso é uma migração de maior risco
  (toca a tabela `Contact` já em produção do WhatsApp) e foi deixada como
  decisão explícita a tomar, não uma correção silenciosa.
- Processamento de webhook do canal genérico continua síncrono dentro do
  próprio handler HTTP (não há fila/worker) — aceitável hoje porque o
  trabalho é só banco de dados (sem chamada lenta a terceiro no meio), mas
  é um ponto a revisitar se o volume crescer.
