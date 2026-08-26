# Reclame Aqui

**Status desta fase**: skeleton. `NOT_SUPPORTED`.

## Por que é tratado como caso, não como chat

Reclame Aqui não é um canal conversacional em tempo real — é modelado como
`kind: COMPLAINT` (caso/reclamação). Não existe, nesta fase, contrato de API
oficial confirmado; nenhuma chamada real é feita.

## O que já está pronto

- `capabilities()` inteiramente `false`.
- `testConnection()` sempre `NOT_SUPPORTED` com mensagem explicando a espera
  por documentação/contrato oficial.
- Config da conta (`companyId`) já pode ser cadastrada.
- Bot automático **sempre desligado** para este canal — resposta é sempre
  manual, por definição de escopo (reclamação pública exige revisão humana).

## Nunca fazer

Nunca inventar endpoint ou credencial para o Reclame Aqui.
