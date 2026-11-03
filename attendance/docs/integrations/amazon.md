# Amazon Marketplace

**Status desta fase**: base de autenticação (LWA) pronta; nenhuma capability
de mensageria ativada.

## Implementado

- `testConnection()`/`refreshCredentials()` validam o `refreshToken` contra o
  endpoint oficial de token LWA (`https://api.amazon.com/auth/o2/token`) —
  nunca chamam a SP-API de negócio (pedidos/mensagens) nesta fase.
- `capabilities()` inteiramente `false`: a Amazon não é chat livre como o
  WhatsApp — a Messaging API é limitada por política e ligada a pedidos
  específicos. Nada aqui finge suportar envio/recebimento.

## Não implementado nesta fase

- Qualquer chamada à SP-API de mensageria (Messaging API / Solicitations).
- OAuth clássico: a autorização Amazon é via **Login With Amazon (LWA)** e o
  vendedor gera o `refreshToken` manualmente no Seller Central ("Manage Your
  Apps") — por isso `supportsOAuth: false` (o fluxo não é um redirect
  gerenciado pelo nosso servidor).

## Credenciais necessárias

`lwaClientId`, `lwaClientSecret` (config da conta) + `refreshToken` (gerado
manualmente no Seller Central, colado no painel de Integrações).
