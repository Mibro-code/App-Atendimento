# Mercado Livre

**Status desta fase**: adapter real, envio de mensagem ainda desligado por
segurança.

## Implementado

- OAuth (`MERCADO_LIVRE` em `oauth-providers.js`, endpoints oficiais).
- `testConnection()` valida o `accessToken` contra `GET /users/me`.
- Webhook (`POST /webhooks/channels/MERCADO_LIVRE`) recebe notificações
  (`{ resource, topic, user_id, sent }`), valida o formato mínimo
  (`validateWebhook`) e normaliza para `NormalizedInboundMessage` — perguntas
  (`topic: "questions"`) viram `type: "question"` e `kind: PUBLIC_QUESTION`.
- Idempotência via `ExternalChannelEvent` (chave: `topic:resource:sent`).

## Não implementado nesta fase

- Envio de mensagem (`canSendMessages: false`): a Messages API do Mercado
  Livre depende de contexto de pedido/pack que ainda não validamos contra a
  conta real — melhor recusar com `NOT_SUPPORTED` do que arriscar uma chamada
  errada.
- Busca do corpo completo da pergunta/mensagem a partir do `resource`
  recebido no webhook (hoje só o evento é persistido; o conteúdo requer uma
  chamada `GET` adicional a ser implementada quando o fluxo de resposta for
  priorizado).

## Credenciais necessárias

`MERCADO_LIVRE_CLIENT_ID`, `MERCADO_LIVRE_CLIENT_SECRET` (env, app OAuth) +
`accessToken`/`refreshToken` por conta (via fluxo OAuth do painel).

## Callback / Webhook

- OAuth callback: `POST /api/integrations/oauth/callback`
- Notificações: `POST /webhooks/channels/MERCADO_LIVRE`
