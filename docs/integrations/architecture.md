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
  pipeline de triagem continuam exatamente como estavam.
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

## Modelos novos (aditivos, sem alterar dados existentes)

- `ChannelAccount` — multi-conta por canal, segredos cifrados, status
  (`NOT_CONFIGURED`/`CONFIGURED`/`AUTH_PENDING`/`CONNECTED`/`DEGRADED`/`ERROR`/`NOT_SUPPORTED`).
- `ChannelOAuthState` — state CSRF de uso único.
- `ExternalChannelEvent` — idempotência de webhook.
- `IntegrationGlobalSettings` — chave-mestra de "novos canais" (nunca afeta
  Meta/WhatsApp).
- `Conversation.channelAccountId`, `Conversation.externalConversationId`,
  `Conversation.kind` (`PRIVATE_CONVERSATION`/`PUBLIC_QUESTION`/`REVIEW`/`COMPLAINT`/`EMAIL_THREAD`).
- `Bot.channels` (array, aditivo ao `channel` legado — um Bot single-channel
  nunca precisa preenchê-lo).
- `Contact.phone` passou a ser opcional (nem todo canal tem telefone).

## O que NÃO foi feito nesta fase

- SHEIN não foi integrado.
- Nenhum endpoint de API foi inventado para canais sem documentação
  confirmada (ver `shopee.md`, `amazon.md`, `tiktok-shop.md`).
- Nenhuma automação (bot, auto-resposta) foi ligada por padrão para canal
  novo.
