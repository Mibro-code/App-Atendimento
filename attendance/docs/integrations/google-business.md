# Google Reviews / Perfil da Empresa

**Status desta fase**: OAuth real; leitura/resposta de avaliação ainda
pendente de reconfirmação de endpoint.

## Implementado

- OAuth (`GOOGLE` em `oauth-providers.js`).
- `testConnection()` valida o `accessToken` contra
  `mybusinessaccountmanagement.googleapis.com/v1/accounts`.
- `kind: REVIEW` na `Conversation` quando uma avaliação é normalizada.
- Auto-resposta **sempre desligada** nesta fase — `replyToReview()` lança
  `NOT_SUPPORTED` de propósito, mesmo com token válido. Resposta é sempre
  manual (a política do Google e a experiência do cliente exigem revisão
  humana antes de qualquer resposta pública).

## Não implementado nesta fase

- `fetchReviews()` real: o Google já migrou esta família de APIs mais de uma
  vez; o endpoint precisa ser reconfirmado contra a versão atual antes de
  ativar de verdade (por isso lança `NOT_SUPPORTED` em vez de arriscar um
  endpoint desatualizado).

## Credenciais necessárias

`GOOGLE_OAUTH_CLIENT_ID`/`SECRET` (env) + `accessToken`/`refreshToken` por
conta, escopo `business.manage`.
