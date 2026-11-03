# CRM + Olist — complemento local de 30/10/2026

Implementação autorizada dos itens 1 e 3–9 da lista apresentada ao usuário. **Somente local; sem deploy, push, chamadas ao ERP real, mensagens ou e-mails reais.** Não há nova migration nesta rodada. A migration aditiva do módulo original continua necessária antes de uma futura publicação.

## Escopo entregue

| Item | Implementação |
| --- | --- |
| 1 — Base auditada | Busca de recuperação paginada; criação incerta nunca repete POST por um resultado negativo. Readback 404 após criar também é incerto. PDF e WhatsApp legados passam pela política da proposta. PDF soma frete, condições e versão; prévias internas não aprovadas/canceladas/expiradas são identificadas. E-mail soma frete e inclui condições/versão na chave de idempotência. Acesso PDF usa o escopo da proposta, inclusive Financeiro. Origem da conversa é preservada no redirecionamento e na edição. |
| 2 — Regra financeira antiga | **Não alterada, por escolha do usuário.** O adaptador legado ainda contabiliza aprovação como confirmação na venda/comissão/funil. A consulta financeira da proposta continua baseada nas cobranças reais. Isso exige avaliação explícita antes de publicar; não foi escondido nem tratado como recebimento comprovado. |
| 3 — Aprovação Master | Nova ação `approve_order`, exclusiva de `Role.ADMIN` (Master no padrão atual dos sistemas). Só depois de converter. Não concede essa ação a gerente, supervisor, financeiro, vendedor ou representante. Revalida ator no banco, pedido, documento, vendedor, itens, preços, total e situação. Ponte faz PUT `/pedidos/{id}/situacao` com `situacao:3`, com leitura antes/depois. Atualiza `PEDIDO_APROVADO` e evento com ator, sem chamar o adaptador financeiro. |
| 4 — Pendências | `/propostas/pendencias`, exclusiva do Master: propostas aguardando condições, conversões solicitadas, pedidos aguardando Master, erros e divergências. Filtros de empresa/etapa, paginação de 50 registros. Abrir a página não dispara operações no ERP. |
| 5 — Recuperação | Busca paginada, bloqueio em resultado parcial/múltiplo/incerto, consulta antes de repetir aprovação. POST de criação/conversão não é repetido automaticamente. Uma incerteza sem referência localizada permanece bloqueada para conciliação, mesmo após nova tentativa. Trava só é liberada pelo proprietário da aquisição. Falhas periódicas têm pausa de cinco minutos para não monopolizar o lote. |
| 6 — Acompanhamento | Etapas de proposta, aceite, pedido, aprovação, pagamento e entrega, com histórico de autor/data. Etiqueta de pedido visível também na lista. Condições aprovadas e pedido aprovado têm rótulos distintos. Motivos de etapas indisponíveis ficam recolhidos. |
| 7 — Financeiro consultivo | Parcelas/vencimentos/valores/saldos/recebimentos sob demanda, apenas para os perfis já autorizados a ver valores financeiros. Paginação completa ou falha explícita; nenhuma baixa, estorno ou lançamento implementado. |
| 8 — Conferência | Cadastro/documento/endereço, vínculo do vendedor, sincronização/validade, frete/pagamento/prazo e estoque. Conversão pelo serviço passa pela conferência de estoque e revalida autorização/versão antes de gerar pedido. Consulta não reserva estoque; quantidade pode mudar no ERP depois da consulta. |
| 9 — Pós-venda | Nota vinculada e link fiscal disponível, código/link de rastreamento. Resumo com esses links pode ser preparado no Atendimento para revisão e envio humano, mantendo conversa de origem, empresa/número, permissões e janela do WhatsApp. Não emite NF nem envia mensagem automaticamente. |

## Arquivos principais

- `crm/src/lib/proposals/proposal-operations.ts`, `proposal-channel.ts`, `proposal-permissions.ts`, `proposal-core.ts`, `proposal-service.ts`, `proposal-olist.ts`, `proposal-sync-job.ts`.
- `crm/src/app/api/proposals/[id]/{actions,consult}/route.ts`, `api/quote-whatsapp/route.ts`, `api/quotes/[id]/pdf/route.ts`.
- `crm/src/app/(app)/propostas/{page.tsx,pendencias/page.tsx,[id]/**}` e retorno em `cotacoes/[id]/page.tsx`.
- `crm/src/components/{proposal-order-consult,quote-whatsapp-button}.tsx`, `lib/quotes/quote-pdf*.ts`, `lib/olist/bridge-client.ts`.
- Ponte `C:/ShopifyApps/clientes-login-tt`: serviços `crm-proposal-bridge.server.js`, `crm-proposal-email.server.js`; rotas novas `internal.crm.orders.{approve,consult}.jsx`; `test/order-operations.test.js`. Os arquivos Liquid preexistentes não foram tocados.

## Verificações desta rodada

- 94 testes de regras/serviços/canais/PDF aprovados (`vitest.olist-flow.config.mts`), incluindo resumo de NF/rastreamento revisado no chat de origem.
- 22 testes da ponte aprovados, incluindo resposta perdida, segunda página, situação oficial 3, ausência de lançamentos e links seguros.
- 10 testes com PostgreSQL real **descartável**, incluindo fluxo completo, clique concorrente e aprovação Master auditada sem alteração financeira. Contêiner/volume da rodada removidos ao terminar; prévia preservada.
- 15 verificações HTTP com sessões sintéticas separadas: cinco perfis bloqueados em aprovação/fila Master, valores financeiros protegidos, corpo de requisição não escolhe empresa/SKUs, aprovado sai da fila de pedidos pendentes. Next pode transmitir o 404 da página dentro do streaming com HTTP 200; o teste confirma o fallback 404 e ausência da tela restrita. APIs recusam com 403/404.
- TypeScript completo passou; checagem de espaços dos arquivos desta entrega e sintaxe da ponte passaram. Uma checagem global também apontou espaços preexistentes em arquivos do Atendimento e `next.config.mjs`, que foram preservados.
- Navegador: fila Master, detalhe, estoque, parcelas e rastreamento; pedido fictício aprovado com etiqueta persistida e pagamento ainda pendente. Captura em `C:/App Whats/olist-flow-local-20261030/pedido-aprovado.png`.

Recibos: `C:/App Whats/olist-flow-local-20261030/{unit-results.log,bridge-results.log,pg-results.log,api-results.json}`. Backup de fontes antes das alterações: `.../before` e `.../bridge/before`. Não são backups de conversas; nenhum dado real foi alterado nesta etapa.

## Prévia para revisar

- http://localhost:4060/propostas e http://localhost:4060/propostas/pendencias
- Perfis, senha fictícia e operação em `C:/App Whats/proposals-preview-20261030/LEIA-ME.md`.
- Banco/simulador exclusivos de demonstração. A aprovação feita durante a revisão afeta só o exemplo LOCAL-9000. Consultas externas do CRM de prévia bloqueadas.

## Limites antes de produção

1. Homologar permissões e efeitos reais na conta Olist autorizada. O contrato foi conferido na especificação pública oficial (`https://erp.olist.com/public-api/v3/swagger/swagger-mintlify.json`), copiada em `C:/App Whats/olist-flow-local-20261030/olist-openapi.json`. Mocks não validam gatilhos configurados no ERP: aprovar pode acionar regras próprias do Olist, mesmo sem chamada explícita de lançamento pela ponte.
2. Item 2 continua excluído: a sincronização legada pode continuar alimentando venda/comissão/funil segundo a regra antiga. A ação nova de aprovação isoladamente não altera esses registros.
3. Necessário publicar ponte e CRM compatíveis, incluir fontes PDF/configurações que estavam fora do commit antigo e aplicar a migration original na ordem correta. O commit `3079be1` isolado continua uma referência histórica incompleta: usar a fonte completa revisada, nunca só aquele commit. Não houve novo commit ou inclusão de alterações alheias.
4. Validar envio pelo Atendimento em homologação integrada autorizada. Nesta prévia a identidade entre apps está desligada; as rotas foram testadas com mocks para não usar sessões, remetentes ou contatos reais.
5. Emissão/cancelamento fiscal, baixa financeira, estornos, reserva de estoque e alterações administrativas do ERP não foram adicionados. Não se promete eliminar todas as exceções que exigem Olist.

Sem dependências adicionais, mudanças de autenticação, alteração de modelos de banco, modificação do Atendimento, infraestrutura ou VPS nesta rodada.
