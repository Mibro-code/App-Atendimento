# E-mail

**Status desta fase**: adapter real via OAuth, dois providers.

## Implementado

- `EmailAdapter` com `config.provider = "GMAIL" | "MICROSOFT_365"`.
- `testConnection()` valida o `accessToken` contra o endpoint de perfil real
  de cada provider (`gmail/v1/users/me/profile` ou `graph.microsoft.com/v1.0/me`).
- Threading preservado via `externalConversationId` (o `threadId`/
  `conversationId` do próprio provider) — a conversa interna nunca usa esse
  valor como `Conversation.id`.
- `kind: EMAIL_THREAD` na `Conversation`.

## Não implementado nesta fase

- Recebimento por push (Gmail Pub/Sub watch / Microsoft Graph subscriptions):
  `supportsWebhook: false` deliberadamente — nesta fase o recebimento seria
  por consulta periódica, não por webhook. A rota de webhook genérica não
  aceita eventos de `EMAIL` até isso ser implementado.
- Envio real de e-mail (o método existe na interface, mas ainda não foi
  ligado a uma chamada de envio real do Gmail/Graph).

## Credenciais necessárias

`GOOGLE_OAUTH_CLIENT_ID`/`SECRET` ou `MICROSOFT_OAUTH_CLIENT_ID`/`SECRET`
(env, app OAuth) + `accessToken`/`refreshToken` por conta.

## Scopes esperados

- Gmail: `gmail.readonly`, `gmail.send` (a confirmar no momento de ativar
  envio real).
- Microsoft 365: `Mail.Read`, `Mail.Send`, `offline_access`.
