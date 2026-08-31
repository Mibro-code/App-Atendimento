# TikTok Shop

**Status desta fase**: skeleton estrutural, aguardando confirmação de acesso
ao escopo `seller.customer_service`.

## Implemented / prepared

- `capabilities()` reflete o que a Customer Service API do TikTok Shop
  documenta (mensagens, mídia limitada, marcar como lido, webhook), mas
  `testConnection()` nunca afirma `CONNECTED` sozinho: valida só a presença
  estrutural de `appKey`/`appSecret`/`shopId` e, com token, retorna
  `NEEDS_APPROVAL` (status honesto: a API existe, mas a TikTok ainda não
  aprovou o escopo do app) com mensagem explicando que o acesso ao Customer
  Service ainda não foi aprovado/verificado para a conta.
- Sem token: retorna `AUTH_PENDING` (não é erro de código — é apenas
  autorização pendente).

## Não implementado nesta fase

- Envio/recebimento reais de mensagem (`sendMessage` lança `NOT_SUPPORTED`).
- Webhooks "New Conversation"/"New Message" (rota genérica já aceitaria,
  mas normalização real depende de confirmar o payload contra uma conta com
  o escopo liberado).

## Credenciais necessárias

`appKey`, `appSecret`, `shopId` (config da conta) + `accessToken` (OAuth,
quando o escopo for aprovado).

## Importante

Nunca tratar ausência do escopo `customer_service` como erro de código —
é uma condição de negócio (aprovação pendente na TikTok), refletida como
`AUTH_PENDING`/`NEEDS_APPROVAL`, nunca como exceção não tratada.
