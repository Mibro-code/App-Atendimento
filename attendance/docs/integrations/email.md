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
- `sendMessage`/`sendMedia` reais: Gmail via MIME cru
  (`messages/send`, threading por `In-Reply-To`/`References` + `threadId`);
  Microsoft via `sendMail` ou `/messages/{id}/reply` quando `inReplyTo` é
  informado (anexo + resposta de thread juntos não é suportado no Graph
  nesta fase — ver código, lança `NOT_SUPPORTED` explicando).
- `normalizeInboundEvent` já pronto para consumir uma mensagem vinda de uma
  futura busca/poll (Gmail `messages.get` ou Graph `GET /me/messages/{id}`)
  — só não há, ainda, o poller/push que alimenta isso.

## Não implementado nesta fase

- Recebimento por push (Gmail Pub/Sub watch / Microsoft Graph subscriptions)
  ou por polling: `supportsWebhook: false` deliberadamente — a rota de
  webhook genérica não aceita eventos de `EMAIL` até isso ser implementado.
  `normalizeInboundEvent` está pronto, falta o job que chama a API e
  alimenta ele.

## Credenciais necessárias

`GOOGLE_OAUTH_CLIENT_ID`/`SECRET` ou `MICROSOFT_OAUTH_CLIENT_ID`/`SECRET`
(env, app OAuth) + `accessToken`/`refreshToken` por conta.

## Scopes esperados

- Gmail: `gmail.readonly`, `gmail.send` (a confirmar no momento de ativar
  envio real).
- Microsoft 365: `Mail.Read`, `Mail.Send`, `offline_access`.
