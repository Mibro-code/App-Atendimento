# Shopee

**Status desta fase**: skeleton deliberado. `NOT_IMPLEMENTED` /
`AWAITING_API_ACCESS`.

## Por que não há chamada real

Não existe, nesta fase, documentação/contrato de API oficial confirmado para
a conta e região do projeto. Em vez de adivinhar um endpoint, o adapter é
honesto: `capabilities()` retorna tudo `false` e `testConnection()` sempre
devolve `NOT_SUPPORTED` com a mensagem "aguardando confirmação de
acesso/documentação oficial da API para esta conta".

## O que já está pronto

- Cadastro de conta (`ChannelAccount`) com `config` (`partnerId`, `shopId`,
  `partnerKey`) para quando o acesso for liberado.
- Registro no `channel-adapter-registry.js` — quando a Shopee liberar acesso
  e a implementação real for confirmada, só `shopee-adapter.js` precisa
  ganhar lógica; o resto da arquitetura (Central, Bot, painel) já funciona.

## Nunca fazer

Nunca inventar endpoint, payload ou contrato para a Shopee só para "parecer
funcionando". Isso é uma instrução explícita e permanente deste projeto.
