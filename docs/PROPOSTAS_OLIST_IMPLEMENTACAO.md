# Propostas comerciais nativas do Olist — implementação local (30/10/2026)

**Situação:** tudo foi implementado e validado localmente, mas **nada foi publicado**. A migration só foi aplicada num PostgreSQL descartável, que já foi removido. Nenhuma chamada foi feita ao Olist real nem ao app Shopify real, e nada foi enviado a clientes. A auditoria prévia está em [AUDITORIA_PROPOSTAS_OLIST.md](AUDITORIA_PROPOSTAS_OLIST.md).

Branches locais, sem commit (os dois repositórios já tinham alterações locais de terceiros, preservadas):

- CRM: `merge-crm-atendimento-20261020`, branch `feature/propostas-olist-20261030`. Backup prévio em `C:\App Whats\backups\pre-propostas-olist-20261030`.
- Ponte: `C:\ShopifyApps\clientes-login-tt`, branch `feat/crm-olist-proposals`. Só **arquivos novos**.

## 1. Fluxo implementado

O fluxo é: simulação (CRM) → **Criar proposta comercial** → `POST /orcamentos` no Olist (recebe id e número) → solicitar aprovação → aprovar (supervisor, gerente ou admin, conforme a alçada) → enviar (e-mail do CRM ou registro de outro canal) → registrar a resposta do cliente (aceite, recusa ou pedido de alteração) → solicitar conversão (vendedor) → **converter** (supervisor da equipe, gerente ou admin) → `POST /orcamentos/{id}/venda` → pedido vinculado (`OlistOrder` existente) → consulta do pedido e do **contas a receber** (`idVenda`) → estado financeiro.

### Estados separados

| Dimensão | Valores |
| --- | --- |
| Comercial | Os 12 estados pedidos. EXPIRADA é calculada pela validade a cada leitura. |
| Aprovação | Não solicitada, pendente, aprovada, reprovada, invalidada |
| Aceite | Sem resposta, aceita, recusada, alteração solicitada |
| Sincronização | Os 6 estados pedidos |
| Pedido | Sem pedido, em conversão, conversão incerta, criado, aprovado, faturado, enviado, entregue, não entregue, em devolução, cancelado |
| Financeiro | Sem cobrança, aguardando pagamento, parcial, confirmado, cancelado |

### Regras

- Toda transição é validada no backend por uma tabela de estados com concorrência otimista (estado e versão). Nenhuma etapa pode ser pulada.
- **Versões.** Toda alteração cria uma `ProposalVersion` imutável. Uma mudança material (produtos, quantidades, preços, desconto, frete, pagamento, prazo, validade ou vendedor) invalida a aprovação, zera o aceite e volta a proposta para rascunho. Uma proposta aceita só muda depois de "Reabrir negociação", com motivo.
- **Preços.** O navegador envia apenas SKU, quantidade, faixa e desconto. O servidor reprecifica com a versão de tabela fixada na proposta.
- **Aceite.** É um registro manual, com canal, evidência obrigatória e versão. Exige que o envio daquela versão tenha sido registrado. Enviar um e-mail nunca marca aceite. Não existe confirmação digital pela API.

## 2. APIs Olist (V3)

**Confirmadas na especificação oficial e usadas:**

- `POST/GET/PUT /orcamentos`
- `GET /orcamentos` (busca de recuperação)
- `PUT /orcamentos/{id}/situacao` (opcional)
- `POST /orcamentos/{id}/marcadores`
- `POST /orcamentos/{id}/venda`
- `GET /vendedores`
- `GET /pedidos/{id}` e `GET /pedidos?numero=`
- `GET /contas-receber?idVenda=`
- Reaproveitados da ponte existente: `GET /contatos`, `POST /contatos`, `GET /produtos`

**Indisponíveis ou não automatizadas:**

- Webhook de propostas: não existe. A sincronização é por consulta.
- Envio, PDF ou link da proposta pelo Olist: não existem. O CRM usa o e-mail e o PDF próprios. Por isso não há botões "Visualizar no Olist" nem "Copiar link".
- Vínculo nativo entre orçamento e pedido: não existe. A conversão feita no painel do Olist exige conciliação manual com validação.
- Chave de idempotência: não existe. A recuperação usa a referência `Ref. CRM-…` na observação.
- Detalhamento de impostos: não existe. A tela mostra a diferença entre o total do Olist e o total comercial.
- Visualizações pelo cliente: não existem.
- Baixa financeira: **propositalmente não implementada**. O endpoint existe, mas exige regra validada.

**A confirmar na homologação:**

- Se `idVenda` em contas a receber é exatamente o id do pedido.
- O formato aceito em `parcelas` (o envio usa só `condicao`).
- Se "gerar venda" exige alguma situação prévia.
- O significado de "Concluído".

## 3. Permissões

Os cargos existentes foram reaproveitados. **Gerente comercial** e **Financeiro** são funções adicionais (`User.commercialFunctions`), concedidas pelo ADMIN e somadas ao cargo. Não foi criado um sistema de usuários novo. Toda rota chama `authorize()`, que lê do banco o ator, a equipe, a proposta, os fatos e as alçadas **antes** de qualquer chamada ao Olist. Proposta fora do escopo responde **404**: trocar o ID na URL não revela nada.

| Ação | Vendedor/Repr. | Supervisor | Gerente | Financeiro | Admin |
| --- | --- | --- | --- | --- | --- |
| Ver | próprias | equipe | todas | aprovadas em diante | todas |
| Criar, editar, solicitar aprovação | próprias | equipe | todas | — | todas |
| Aprovar, reprovar, pedir ajustes | — | equipe, dentro da alçada, nunca a própria | até o teto configurado | — | sem limite |
| Enviar e registrar resposta | próprias | equipe | todas | — | todas |
| Solicitar conversão | próprias | equipe | todas | — | todas |
| Converter, vincular pedido, recusar solicitação | — | equipe (exceto as próprias) | todas | — | todas |
| Transferir responsável | — | dentro da equipe | todas | — | todas |
| Resolver conflito com o Olist | — | equipe | todas | — | todas |
| Cancelar | próprias até o aceite | equipe | todas | — | todas |
| Ver valores recebidos | — | sim | sim | sim | sim |
| Registrar conferência financeira | — | — | — | sim | sim |
| Vínculos, alçadas e funções | — | — | — | — | sim |

**Alçadas:** sem configuração não se presume nenhum percentual. O supervisor só aprova propostas sem desconto, qualquer desconto exige justificativa do vendedor e o gerente sem teto aprova qualquer desconto.

## 4. Conversão e financeiro

- **Antes de converter**, o sistema confere: permissão, aprovação da versão atual, aceite da versão atual, validade, vínculo do vendedor, versão sincronizada, leitura fresca do Olist (sem conflito e sem "Concluído") e ausência de pedido.
- **Claim atômico** `SEM_PEDIDO → CONVERSAO_EM_ANDAMENTO`. No teste com PostgreSQL, um clique duplo gerou um único pedido.
- **Falha ambígua** (timeout ou 5xx) vira `CONVERSAO_INCERTA`, sem nova tentativa. Fica disponível "Vincular pedido gerado no Olist", que confere CPF/CNPJ, vendedor, SKUs e quantidades. Valores iguais não bastam.
- **Recusa definitiva** do Olist libera a proposta, e **nenhum pedido é criado por outro caminho**. O fluxo antigo recusa no backend qualquer cotação que pertença a uma proposta (`PROPOSAL_FLOW`).
- **Pedido aprovado ou posterior** chama a regra **existente** `syncOlistOrderStatus`, que gera a `Sale`, a comissão e mexe no funil. Isso preserva os relatórios atuais. Essa regra antiga rotula o `OlistOrder` como `PAGAMENTO_CONFIRMADO` na aprovação. **Não foi alterada** (ver riscos). O financeiro da proposta vem só das contas a receber: parcial ≠ integral, e aprovação ≠ pagamento.

## 5. Sincronização

- **Envio:** antes de um PUT, o sistema compara o Olist com a última fotografia. Se alguém alterou lá, marca `CONFLITO`, invalida a aprovação e não sobrescreve. "Resolver conflito" reenvia a versão do CRM. Depois da conversão, a proposta nunca mais é enviada ao Olist.
- **Criação após timeout:** a nova tentativa procura pela referência antes de criar.
- **Leitura periódica** `POST /api/integrations/olist/proposals/sync` com Bearer `CRM_PROPOSAL_SYNC_SECRET`: lotes sequenciais (padrão 20, máximo 50), **somente leitura**. Detecta alterações e conclusões feitas no Olist e atualiza pedido e recebimento.

## 6. Offline

O CRM não tem fila offline (ver auditoria). Os rascunhos continuam sendo simulações salvas no servidor. Toda ação de proposta exige o servidor: com `navigator.onLine` falso ou sem resposta, a tela informa que nada foi enviado. Nenhum registro local aparece como se estivesse no Olist.

## 7. Arquivos

**CRM — novos**

- `prisma/migrations/20261030120000_commercial_proposals_olist/{migration.sql,down.sql}`
- `src/lib/proposals/`:
  - regras: `proposal-rules.ts`, `proposal-labels.ts`, `proposal-permissions.ts`, `proposal-olist-rules.ts`, `proposal-filters.ts`, `proposal-schemas.ts`, `proposal-config.ts`
  - serviços: `proposal-access.ts`, `proposal-core.ts`, `proposal-olist.ts`, `proposal-service.ts`, `proposal-admin.ts`, `proposal-sync-job.ts`, `proposal-api.ts`
  - testes: `proposal-rules.test.ts`, `proposal-permissions.test.ts`, `proposal-olist-rules.test.ts`, `proposal-flow.test.ts`, `proposal-flow.pg-test.ts`
- `src/app/api/proposals/{route.ts,[id]/route.ts,[id]/actions/route.ts,admin/route.ts}` e `src/app/api/integrations/olist/proposals/sync/route.ts`
- `src/app/(app)/propostas/{page.tsx,[id]/page.tsx,[id]/proposal-actions.tsx,[id]/editar/*,relatorio/page.tsx}` e `src/app/(app)/admin/propostas/*`
- `src/components/{proposal-badges.tsx,customer-proposals.tsx}`
- `vitest.proposals-pg.config.mts`, `tests/stubs/server-only.ts`

**CRM — alterados (acréscimos)**

| Arquivo | Alteração |
| --- | --- |
| `prisma/schema.prisma` | Modelos novos e enum |
| `src/lib/audit.ts` | Ações de auditoria |
| `src/lib/olist/bridge-client.ts` | Caminhos novos |
| `src/lib/olist/real-order.ts` | Trava `PROPOSAL_FLOW` e política do pedido direto |
| `src/lib/pricing/api-errors.ts` | Códigos novos |
| `src/app/(app)/cotacoes/[id]/{page.tsx,real-order-panel.tsx}` | Redirecionamento e botão "Criar proposta comercial" |
| `src/app/(app)/clientes/[id]/page.tsx` | Seção de propostas |
| `src/app/(app)/layout.tsx`, `src/components/app-shell.tsx` | Menu, somente com o módulo ativo |

**Ponte — novos**

- `app/services/crm-proposal-bridge-rules.js`, `app/services/crm-proposal-bridge.server.js`
- 8 rotas: `internal.crm.proposals.{upsert,find,get,situation,mark,convert}.jsx`, `internal.crm.orders.inspect.jsx`, `internal.crm.sellers.list.jsx`
- `test/crm-proposal-bridge-rules.test.js`
- `scripts/crm-proposals/{Dockerfile.crm-proposals-bridge,check-base-exports.sh}`

## 8. Testes executados

| Suíte | Resultado |
| --- | --- |
| CRM unitários (`vitest run`, sem banco) | **421/421**. Base antes da mudança: 370/370, sem regressão. |
| Fluxo com fakes em memória | 12 testes: IDOR, módulo desligado, clique duplo, timeout na conversão, recusa definitiva, conflito, "Concluído", recuperação sem duplicar, vendedor sem vínculo, divergência gravada |
| PostgreSQL 16 descartável | `migrate deploy` de todas as migrations, diff vazio com o schema, `down.sql` e reaplicação. **9/9** do fluxo real com ponte simulada (cenários 1–19, 22–27). |
| Ponte (`node --test`) | **19/19** (6 novos e 13 existentes). ESLint dos arquivos novos sem erro. |
| TypeScript, ESLint e `next build` | Sem erros. O build foi feito em `.next-validation`. |
| Navegador (Chrome real, servidor isolado com rede externa bloqueada, banco descartável) | **26/26**: lista, detalhe, ficha do cliente, indicadores, celular 390 px sem rolagem horizontal, outro vendedor sem acesso pela URL e pela API, supervisor, financeiro, admin, sem erros JS. Recibo: `propostas-olist-browser-results.json`. |

**Não testados aqui:** chamadas ao Olist real (exigem homologação autorizada), cenário 30 (integração com o Atendimento, sem arquivos alterados nessa área) e a rotina de sincronização agendada no servidor.

## 9. Ativar, desativar e reverter

### Variáveis do CRM

| Variável | Efeito |
| --- | --- |
| `CRM_PROPOSALS_OLIST_ENABLED=1` | Liga o módulo. Ausente = comportamento idêntico ao atual, telas ocultas e APIs 404. |
| `OLIST_PROPOSAL_CONVERSION_MODE=api` | Padrão. `manual` = só vínculo supervisionado. |
| `OLIST_PROPOSAL_SITUATION_SYNC=1` | Opcional, desligado. Atualiza a situação no Olist ao enviar, aceitar ou recusar. |
| `CRM_LEGACY_DIRECT_ORDER=all` | Padrão (atual). `admin` = só o ADMIN. `off` = desliga o "Gerar pedido real" antigo. Pedidos existentes não são afetados. |
| `CRM_PROPOSAL_SYNC_SECRET` | Segredo do agendador de leitura. |

### Ponte

`OLIST_PROPOSAL_OPERATION_NATURE_ID` é opcional. Na ausência, a ponte usa `OLIST_DEFAULT_OPERATION_NATURE_ID`. A conversão respeita o **modo teste** do admin Shopify.

### Ordem de publicação (exige autorização)

1. Backup.
2. Ponte: rodar `check-base-exports.sh` (precisa terminar em `BASE_OK`) e fazer o build incremental com o Dockerfile novo, nas duas marcas.
3. CRM: `prisma migrate deploy` (migration aditiva) e imagem nova, com o módulo **desligado**.
4. Configurar vínculos e alçadas.
5. Ligar a variável.

### Desativar e reverter

- **Desativar:** remover `CRM_PROPOSALS_OLIST_ENABLED`. Os dados ficam preservados e o fluxo antigo volta inteiro.
- **Reverter o banco** (opcional, após backup): `down.sql` e remover a linha em `_prisma_migrations`.
- **Ponte:** remover os 10 arquivos novos e reconstruir.

## 10. O que configurar no Olist

1. Aplicativo da API V3 de cada conta com escopos de **Orçamentos** (leitura e escrita), **Vendedores**, **Pedidos**, **Contatos**, **Produtos** e **Contas a receber** (leitura). Conferir se o token OAuth atual da ponte já tem esses escopos. Se não tiver, é preciso reautorizar.
2. Vendedores cadastrados no Olist para todos os representantes.
3. Natureza de operação padrão para propostas.
4. Opcional: app "Webhooks" para vendas. Não é necessário, porque o CRM consulta.

## 11. Homologação sugerida (exige autorização)

Use, em cada marca, um cliente interno de teste:

1. Criar a proposta e conferir número, vendedor, itens, desconto, frete, condição e validade no Olist.
2. Editar no Olist e ver o `CONFLITO` no CRM.
3. Aprovar, enviar e registrar o aceite.
4. Converter e conferir o pedido gerado, os itens e o vendedor.
5. Confirmar `idVenda` nas contas a receber e a situação "Concluído".
6. Excluir os registros de teste no Olist.

Depois, agendar a sincronização (por exemplo, a cada 10 min, `limit=20`).

## 12. Riscos e pendências

- **A regra existente trata aprovação como pagamento** para a `Sale` e a comissão. Ela foi mantida para não mudar relatórios e comissões em produção. Recomendo uma decisão de negócio antes de alterá-la.
- **A ponte em produção pode diferir de `C:\ShopifyApps\clientes-login-tt`** (há pacotes `cpf-sem-minimo` e `short-order-references` aplicados depois). O deploy só acrescenta arquivos e confere os símbolos antes.
- **O e-mail reutiliza o template de proposta da ponte**, que não mostra frete, condição de pagamento nem validade. O PDF do CRM também não mostra essas condições. As duas melhorias ficam pendentes.
- **Pendentes:**
  - notificações de aprovação pendente (hoje há o filtro "Aguardando minha decisão");
  - importar para o CRM uma alteração feita no Olist (hoje só "reenviar versão do CRM");
  - inscrição estadual e endereço de entrega alternativo;
  - exportação CSV;
  - alçadas por produto, cliente ou campanha;
  - baixa financeira;
  - integração da proposta com o Atendimento além do link existente.
- **Transferência de proposta não muda a carteira do cliente.** A comissão segue a regra atual (`customer.sellerId`).
- **`C:\MATHEUS--\App- Vendedores` não recebeu as mudanças.** É uma cópia divergente e não é a linha publicada.
