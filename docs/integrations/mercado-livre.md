# Mercado Livre

**Status desta fase**: adapter real, envio de mensagem já ligado (perguntas
e mensagens pós-venda).

## Implementado

- OAuth (`MERCADO_LIVRE` em `oauth-providers.js`, endpoints oficiais) +
  `refreshCredentials()` real via o serviço genérico de refresh.
- `testConnection()` valida o `accessToken` contra `GET /users/me`.
- `sendMessage({kind:"question", questionId, text})` → `POST /answers`
  (responder pergunta pública).
- `sendMessage({kind:"post_sale", packId, buyerUserId, text})` →
  `POST /messages/packs/{packId}/sellers/{sellerId}?tag=post_sale`
  (`sellerId` vem de `ChannelAccount.externalAccountId`, capturado no
  `testConnection`).
- Webhook (`POST /webhooks/channels/MERCADO_LIVRE`) recebe notificações
  (`{ resource, topic, user_id, application_id, sent }`), valida o formato
  mínimo + (quando `MERCADO_LIVRE_CLIENT_ID` está configurado)
  `application_id` contra o client id do app, e normaliza para
  `NormalizedInboundMessage` — perguntas (`topic: "questions"`) viram
  `type: "question"` e `kind: PUBLIC_QUESTION`.
- Idempotência via `ExternalChannelEvent` (chave: `topic:resource:sent`).

## Não implementado nesta fase

- Busca do corpo completo da pergunta/mensagem a partir do `resource`
  recebido no webhook (hoje só o evento é persistido; o conteúdo requer uma
  chamada `GET` adicional a ser implementada quando o fluxo de leitura for
  priorizado).

## Credenciais necessárias

`MERCADO_LIVRE_CLIENT_ID`, `MERCADO_LIVRE_CLIENT_SECRET` (env, app OAuth) +
`accessToken`/`refreshToken` por conta (via fluxo OAuth do painel).

## Callback / Webhook

- OAuth callback: `POST /api/integrations/oauth/callback`
- Notificações: `POST /webhooks/channels/MERCADO_LIVRE`
