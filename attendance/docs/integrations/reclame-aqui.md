# Reclame Aqui

**Status desta fase**: skeleton. `NOT_CONFIGURED` (sem `companyId`) ou
`NEEDS_CONTRACT` (`companyId` configurado, mas sem contrato oficial).

## Por que é tratado como caso, não como chat

Reclame Aqui não é um canal conversacional em tempo real — é modelado como
`kind: COMPLAINT` (caso/reclamação). Não existe, nesta fase, contrato de API
oficial confirmado; nenhuma chamada real é feita.

## O que já está pronto

- `capabilities()` inteiramente `false`.
- `testConnection()` nunca chama a rede: retorna `NOT_CONFIGURED` quando a
  conta não tem `config.companyId`, ou `NEEDS_CONTRACT` (status honesto —
  a API exigiria contrato comercial que ainda não existe) quando tem.
- Config da conta (`companyId`) já pode ser cadastrada.
- Bot automático **sempre desligado** para este canal — resposta é sempre
  manual, por definição de escopo (reclamação pública exige revisão humana).

## Nunca fazer

Nunca inventar endpoint ou credencial para o Reclame Aqui.
