# Evolução da Central — auditoria da v0.35.3 e plano (Fase 0)

Data: 2026-10-09 · Trabalho local, sem VPS, sem deploy, sem push.

## 0. Estado real encontrado (antes de qualquer alteração)

| Item | Encontrado |
|---|---|
| Pasta raiz `C:\App Whats` | branch `feature/financeiro-protegido-atendente-fixo`, HEAD `092567b`. **Não é a 0.35.3**: `public/js/changelog.js` diz 0.28.5; faltam 129 commits da linha publicada (supervisão por equipe, períodos de atendimento, relógio de expediente nos relatórios, WhatsApp unificado, envio pelo painel, Comercial → Atacado por template etc.). Muitos arquivos soltos não rastreados (patches, `.tar`, pastas de deploy) — **não foram tocados**. |
| 0.35.3 publicada | branch `codex/vps-preserved-local-features-20261008`, HEAD `2642143` (checkout em `backups/integration-worktree-20261008`). Confirmado por `backups/deploy-local-vps-20261008/ESTADO-V0353.md` e `APP_VERSION = "0.35.3"`. |
| Onde este trabalho foi feito | worktree novo `C:\App Whats\evolucao-v036`, branch **`feature/evolucao-central-v036`** criada a partir de `2642143`. Nenhum worktree/branch existente foi alterado. `node_modules` copiado (não compartilhado) para que `prisma generate` não afete outra cópia. `.env` local só com `DATABASE_URL` (testes usam o schema isolado `app_whats_test`) e segredos fictícios — **sem token do WhatsApp**. |
| Banco | Só o schema de testes `app_whats_test` (o `scripts/run-tests.js` faz `db push` nele). O schema principal local não foi migrado, lido para escrita nem resetado. |
| Linha de base de testes (antes de qualquer mudança) | `npm test`: **989 testes, 850 ok, 137 falhas, 2 skipped**. 122 falhas são dos testes do motor de Bots legado (`test/bot-*.test.js`, arquivados desde `flow_builder_only`); 15 em outros arquivos (`campaign-service` 4, `quick-reply-observation` 2, `unified-whatsapp` exige banco isolado próprio, `app`, `push-notifications`, `layout-fit-ui`, `navigation-settings-layout`, `composer-autoresize`, `audio-quick-replies`, `conversation-inactivity`, `mibro-assistant-observer`). O log anterior da integração (`integration-test-latest.log`) já registrava 201 falhas. Lista exata salva para comparação: nenhuma regressão é aceita contra ela. |
| Observação de ambiente | Pasta com segmento iniciado por ponto (`.worktrees/…`) faz o Express 5 devolver 404 em `sendFile` (dotfiles). Por isso o worktree ficou em `evolucao-v036/`. |

## 1. Módulos — classificação

Legenda: IMPLEMENTADO · PARCIAL · NÃO TESTADO · AUSENTE · DUPLICADO · COM RISCO

| Módulo | Estado | Arquivos | Observações |
|---|---|---|---|
| FollowUp / Reminder / Task / Calendar | **AUSENTE** | — | Nenhum modelo, rota ou tela. "Agendamento" existente é só de **mensagem** (Campaign `scheduledAt`, envio em massa) — não serve para retorno de atendimento e não foi reaproveitado para isso. |
| Notificações internas | IMPLEMENTADO | `realtime/inbox-events.js` (SSE sem conteúdo, `publishToUsers`), `push-service.js` (Web Push, `notifyUser`) | Reaproveitáveis para lembretes. SSE só manda "algo mudou", a tela recarrega pela API com o RBAC — padrão mantido. |
| Workers | IMPLEMENTADO | `server.js`: inatividade, SLA, campanhas, Gmail, Flow Builder (`setInterval` + `unref`, em processo) | Sem fila externa. Novo worker de lembretes segue o mesmo padrão, com reivindicação atômica (`updateMany … where remindedAt = null`). |
| Conversation / Contact / ContactNote | IMPLEMENTADO | `inbox-service.js`, `contact-merge-service.js` | Conversa reaproveitada por contato (ciclos). Notas com `pinned` e `privateCategoryId`. |
| ConversationActivity | IMPLEMENTADO | idem | Fonte da linha do tempo. Carimbo privado automático em `database/prisma.js`. |
| ConversationAssignmentPeriod | IMPLEMENTADO | `assignment-period-service.js` | Períodos de atendimento (supervisão). |
| PreferredAssignee (atendente fixo) | IMPLEMENTADO | `preferred-assignee-service.js`, `preferred-assignee-routing-service.js` | Campos em `Contact`. Usado para sugerir responsável do follow-up. |
| Category / Financeiro protegido | IMPLEMENTADO | `private-segment-service.js` | `SECTOR_PRIVATE`; `readablePrivateCategoryIds`, `sanitizeActivities`, `collapseRestricted`. |
| Company / UserCompanyAccess | IMPLEMENTADO | `company-service.js` | Empresa inativa some de `companyAccess` (inclusive para Master). Sincrofit `active=false` (seed `cmp_sincrofit`). |
| ChannelAccount | IMPLEMENTADO | `whatsapp-account-service.js`, `meta-template-service.js` | Janela de 24h por número: `getCustomerServiceWindow(conversationId, now, channelAccountId)`. |
| SupervisorTeamMember | IMPLEMENTADO | `supervision-service.js`, `authorization.supervisedUserIds` | Supervisor enxerga a equipe definida pelo Master. |
| RBAC | IMPLEMENTADO | `authorization-service.js`, `auth-service.js` | `operationalScope` (agir), `conversationScope` (ler), `forCompany` (cargo por empresa). Não alterado. |
| Bot / BotFlow / FlowExecution | IMPLEMENTADO | `bot-visual-flow-graph.js` (registry), `-engine.js` (handlers), `-service.js` | Execução fixa a `versionId` publicada (`BotFlowExecution.versionId`) — conversa em andamento não muda de definição. Simulador devolve `trace` + `state`. |
| Nós do Flow Builder | PARCIAL | idem | Executáveis: start, message, media, menu, question, condition, delay, variable, transfer_category, transfer_user, human_handoff, end, goto_flow. **Webhook/API, IA, Conhecimento, Classificar intenção, Criar lead, Atualizar contato foram removidos** (`REMOVED_TYPES`, bloqueiam publicação). **Ausentes:** agendamento, template, subfluxo com retorno (só `goto_flow`, sem retorno). Pergunta não tem tipos DATA/HORA. |
| Editor visual | IMPLEMENTADO | `public/js/flow-builder.js` | Zoom, pan, minimapa, duplicar (Ctrl+D), copiar/colar, desfazer/refazer, validação visual com contagem de erros por nó. Sem organização automática. |
| Template (Meta) | IMPLEMENTADO (manual) | `meta-template-service.js` | Envio manual por permissão `canManageCampaigns`. Nenhum envio automático por fluxo. |
| Campaign / envio em massa | IMPLEMENTADO, **desativado** | `campaign-*`, `outbound-bulk-*` | `CampaignGlobalSettings.massMessagingEnabled=false`. Não tocado. |
| Central de Operação | IMPLEMENTADO | `operations-panel-service.js`, `public/operacao.html` | Cards, "Precisa de atenção", equipe com presença por SSE. **Faltam:** follow-ups vencidos, falhas de envio, saúde de canais/integrações, diagnóstico técnico (Master). |
| Produtividade e Qualidade | IMPLEMENTADO | `productivity-service.js` | Histórico — não confundir com Operação. Não alterado. |
| SLA | IMPLEMENTADO | `conversation-sla-service.js` | Não alterado. |
| CSAT / estrelas | IMPLEMENTADO (Bot) | `bot-rating-service.js`, `bot-question-answer-observation.js` | **Fora de escopo — não alterado.** |
| AuditLog | IMPLEMENTADO | `audit-service.js` | Usado pelas ações de follow-up. |
| IA | **pausada** | `ai/`, `local-ai-*` | Não ativada nem alterada. |

## 2. Bugs/riscos encontrados na auditoria

1. **Divergência de linhas de código** (alto): a raiz do projeto está numa linha anterior à publicada. Qualquer evolução feita na raiz geraria regressão das funções da VPS. Mitigação: trabalho em branch nova sobre `2642143`.
2. 137 testes falhando na linha publicada (maioria do motor legado arquivado). Não corrigidos aqui (fora de escopo e alguns testam comportamento removido de propósito); listados para revisão.
3. Presença "online" só existe em memória do processo (conexão SSE). Não há "último acesso" persistido — a Operação passa a mostrar **última mensagem enviada** como evidência e nunca chama isso de presença.
4. Diagnóstico de canal: `ChannelAccount.lastErrorMessage` pode conter texto do provedor — sanitizado antes de exibir.

## 3. Plano por etapa (resumo; detalhes e resultado nas seções 5+)

| Etapa | Mudança | Migration | Reversão |
|---|---|---|---|
| 1 Follow-up | Tabela nova `FollowUp` + enum `FollowUpStatus`; serviço, API `/api/follow-ups`, página `/agenda`, botão "Agendar retorno", aba "Agenda" no painel do contato, worker de lembretes | Aditiva (`CREATE TYPE`, `CREATE TABLE`, índices, FKs). Nenhum dado existente alterado | Código anterior ignora a tabela; `DROP TABLE "FollowUp"; DROP TYPE "FollowUpStatus";` só se desejado (sem perda de dados existentes) |
| 2 Flow Builder | Nó `schedule_followup` (idempotente por execução+nó+passo), tipos DATA/HORA na Pergunta, condição por dia da semana/feriado, simulador mostra o follow-up "que seria criado" | Nenhuma (grafo é JSON) | Fluxo publicado sem o nó continua igual; nó novo só existe em fluxos que o usarem |
| 3 Perfil 360° | `GET /api/contacts/:id/profile` e `/timeline` (paginada, sanitizada), seções no painel | Nenhuma | Só leitura |
| 4 Sincrofit | Auditoria + checklist + testes de isolamento; acento de empresa na Agenda | Nenhuma | — |
| 5 Monitoramento | Operação ganha follow-ups vencidos, falhas de envio, saúde de canais e diagnóstico (Master) | Nenhuma | Só leitura |
| 6 Pré-deploy | Revisão de migrations, regressão, `.env.example`, rollback | — | — |

---

# Resultado da implementação (2026-10-10)

Branch `feature/evolucao-central-v036`, criada a partir de `2642143` (v0.35.3). Versão local: **0.36.0-rc1**, em `changelog.js` e
`service-worker.js`. A versão só é comparada por igualdade e exibida, então o sufixo `-rc1` é compatível. Nada foi publicado.

## Etapa 1 — Agenda e Follow-ups — PRONTO PARA REVISÃO

- **Modelo `FollowUp`.** Guarda empresa, contato, conversa, número/canal, responsável, criador, data, motivo, observação e prioridade.
  - Status gravado: `PENDENTE/CONCLUIDO/CANCELADO`. **ATRASADO é derivado** (`PENDENTE` e `dueAt < agora`).
  - Também guarda: carimbo de setor protegido, origem `MANUAL/FLOW`, `sourceKey` único, contador de reagendamentos e marcas de lembrete.
- **Serviço:** `src/services/follow-up-service.js`.
- **API:**
  - `GET/POST /api/follow-ups`
  - `GET /api/follow-ups/summary`
  - `GET /api/follow-ups/options`
  - `GET/PATCH /api/follow-ups/:id`
  - `POST /api/follow-ups/:id/complete|cancel`
  - `GET /api/contacts/:contactId/follow-ups`
- **Página `/agenda`.**
  - Visões: Lista (Atrasados, Hoje, Amanhã, Esta semana, Próximos, Concluídos, Cancelados), Dia, Semana e Mês.
  - Filtros: empresa, responsável, motivo e prioridade.
  - Diálogo de detalhe com reagendar, trocar responsável, concluir e cancelar.
- **Na Central:**
  - item **Agenda** no menu, com contagem de atrasados ou de hoje;
  - botão **📅 Agendar retorno** na conversa;
  - aba **Agenda** no painel do contato;
  - chip "Retorno …" / "Retorno atrasado" na conversa.
- **Quem vê na Agenda:**
  - Atendente: os próprios retornos (é responsável ou criou).
  - Supervisor: nas empresas em que é Supervisor, os retornos da equipe definida pelo Master.
  - Master: todas as empresas que acessa.
  - Na ficha do cliente, quem acessa o contato vê os retornos dele (mesma regra das notas).
- **Para quem cada um pode agendar:**
  - Atendente: para si ou para o atendente fixo do cliente.
  - Supervisor: também para a equipe.
  - Master: para qualquer usuário elegível (ativo, humano, com acesso à empresa).
- **Supervisão continua somente leitura na conversa.** Agendar exige poder agir na conversa; o Supervisor reatribui retornos da equipe pela Agenda.
- **Atendente fixo:** é sugerido como responsável. Agendar nunca altera o atendente fixo.
- **Lembretes.**
  - Worker em processo (`startFollowUpReminderWorker`, a cada 60 s, `unref`).
  - Cada aviso é reivindicado com `updateMany … where remindedAt/overdueNotifiedAt = null`, então **nunca avisa duas vezes**, nem com dois processos.
  - Avisos emitidos:
    - retorno próximo (antecedência em `FOLLOW_UP_REMINDER_LEAD_MINUTES`, padrão 15);
    - retorno vencido;
    - retorno atribuído ou reagendado;
    - cliente com retorno pendente voltou a escrever (no máximo 1 vez a cada 30 min por retorno).
  - Canais: SSE direcionado **sem conteúdo** e Web Push só com nome do cliente e horário (nunca motivo ou observação).
  - Empresa inativa não gera aviso.
- **Janela de 24h.**
  - O detalhe do retorno mostra a janela **do número do retorno** (`getCustomerServiceWindow` com o `channelAccountId` do retorno). A janela de outro número não vale.
  - O envio continua seguindo as regras atuais do composer.
- **Envio automático:** **não existe** nesta versão. Nada é enviado ao cliente.
- **Financeiro protegido.**
  - Retorno criado com a conversa em setor protegido herda o carimbo do setor.
  - Quem não lê o setor não vê a observação, inclusive o responsável.
  - O evento na linha do tempo é privado, e terceiros não editam a observação.
- **Testes:** `test/follow-up.test.js` (16).

## Etapa 2 — Flow Builder — PARCIAL

O que foi feito está pronto para revisão; o restante está listado em "Pendente".

A auditoria dos nós está na seção 1.
- Nós executáveis e testados: start, message, media, menu, question, condition, delay, variable, transfer_category, transfer_user, human_handoff, end e goto_flow.
- Webhook/API, IA e afins continuam **removidos** (bloqueiam a publicação). Não foram reintroduzidos.

### Feito

- **Nó "Agendar retorno" (`schedule_followup`).**
  - Quando: prazo fixo (horas ou dias, com horário) ou data e hora informadas pelo cliente.
  - Responsável: o atendente fixo, se elegível; senão, o usuário definido no nó. Em ambos os casos, precisa ter acesso à empresa da conversa.
  - Saídas: **Próximo** e **Não agendado**. Data no passado ou falta de responsável vão para "Não agendado" — o nó nunca confirma um retorno que não existe.
  - Variáveis: `{{flow.followUpAt}}` e `{{flow.followUpError}}`.
  - Idempotente por execução + nó + mensagem + passo: reentrega do webhook não duplica.
  - Nunca envia nada ao cliente; registra `BOT_FLOW_FOLLOW_UP_SCHEDULED`.
- **Pergunta com tipos Data e Horário**, no fuso de Brasília.
  - Data aceita "hoje", "amanhã", "depois de amanhã", "10/10" e "10/10/26".
  - Horário aceita "14h", "14:30" e "às 9".
- **Variáveis de sistema para Condições:**
  - `conversation.weekday`, `conversation.localDate`, `conversation.localTime`;
  - `bot.isHoliday` (feriados cadastrados no Bot).
  - O horário de funcionamento continua configurado por Bot; nada foi fixado em código.
- **Simulador.** Mostra "Agendaria retorno … — nada é gravado no teste", além do trace que já existia (nó, entrada, saída escolhida e variáveis no estado).
- **Versionamento (confirmado e testado).** A execução fica presa à `versionId` em que começou. Publicar uma versão nova não muda conversas em andamento.

### Pendente (não implementado — decisão de segurança e escopo)

- **Nó de envio de template.**
  - Motivo: exige uma política de automação de envio — consentimento, custo Meta, WABA por número e idempotência de envio. Não foi feito para não criar envio automático nesta entrega.
  - Proposta: nó desativado por padrão e liberado só por chave global do Master.
  - O template seria validado na WABA do número da conversa.
  - Janela fechada ou falta de consentimento iriam para uma saída "falhou".
- Subfluxo com retorno ao fluxo de origem (hoje existe só `goto_flow`).
- Organização automática do canvas.
- Testes antigos de `test/bot-visual-flow-service.test.js`: chamam `setExecutionMode`, removido em `flow_builder_only`, e falham desde a linha de base. Os novos testes de execução real estão em `test/flow-follow-up.test.js` (8).

## Etapa 3 — Perfil 360° — PRONTO PARA REVISÃO

- **Rotas:** `GET /api/contacts/:contactId/profile` e `GET /api/contacts/:contactId/timeline?before=&limit=` (`contact-profile-service.js`).
- **Tela:** diálogo **Perfil 360° do cliente**, aberto pela aba Detalhes.
- **Seções:**
  - Visão geral: empresa, número, atendente fixo, responsável, setor, status, primeiro contato, última interação, atendimentos finalizados, transferências e contatos fundidos.
  - Agenda.
  - Observações: fixadas primeiro, com autor e data.
  - Informações comerciais: origem registrada na conversa mais antiga e setores atendidos. **Pedidos e faturamento não são exibidos — não há integração.**
  - Conversas.
  - Linha do tempo.
- **Sem mensagens.** O perfil carrega só agregados e eventos. A linha do tempo é paginada por cursor, 30 eventos por página.
- **Regras reaproveitadas, não reescritas:**
  - Conversas visíveis pelo `conversationScope`.
  - Eventos só para quem tem permissão de histórico, e dentro das mesmas janelas que a Central já usa (`readVisibility`).
  - Financeiro protegido por `sanitizeActivities` e `readableWhere`.
  - Contatos fundidos só da mesma empresa. O mesmo telefone em outra empresa nunca entra.
- **Testes:** `test/contact-profile.test.js` (6).

## Etapa 4 — Sincrofit — estrutura validada; empresa continua DESATIVADA

Nada foi ativado. Checklist (evidência = testes executados nesta branch):

| Item | Status | Evidência |
|---|---|---|
| Empresa do atendimento = número que recebeu | PRONTO | `multiempresa.test.js` (webhook) |
| Mesmo telefone = dois clientes com históricos separados | PRONTO | `multiempresa.test.js`, `contact-profile.test.js` |
| Usuário A (Mibro+Sincrofit), B (só Mibro), C (Supervisor na Mibro, Atendente na Sincrofit) | PRONTO | `multiempresa.test.js`, `follow-up.test.js` |
| Permissões recalculadas por empresa | PRONTO | `multiempresa.test.js` |
| Categorias, respostas rápidas, templates por WABA, opt-out e SLA por empresa | PRONTO | `multiempresa.test.js`, `meta-templates-loading.test.js` |
| Financeiro protegido por setor da empresa | PRONTO | `private-segments*.test.js` |
| Agenda por empresa (filtro Todas/Mibro/Sincrofit; usuário de uma empresa não recebe a outra) | PRONTO | `follow-up.test.js` |
| Bot/fluxo da Sincrofit nunca roda em conversa da Mibro | PRONTO | `flow-follow-up.test.js` |
| Responsável de outra empresa nunca é atribuído (agenda e fluxo) | PRONTO | `follow-up.test.js`, `flow-follow-up.test.js` |
| Desativar/reativar empresa oculta e restaura sem perder vínculos | PRONTO | `company-activation.test.js` |
| Empresa inativa não gera lembretes nem aparece na Agenda | PRONTO | `follow-up.test.js` |
| Relatórios e Operação por empresa | PRONTO | `productivity.test.js`, `operations-panel.test.js`, `operations-monitoring.test.js` |
| Números WhatsApp da Sincrofit cadastrados e conectados | PENDENTE | Cadastro na VPS (fora do escopo) |
| Categorias, equipe, Bot e fluxos próprios da Sincrofit | PENDENTE | Configuração operacional |
| Templates aprovados na WABA da Sincrofit | PENDENTE | Meta |
| Teste real de envio/recebimento no número da Sincrofit | NÃO TESTADO | Exige ambiente real (proibido aqui) |
| Ativação | BLOQUEADO | Aguardando autorização do responsável |

**Identidade visual:**
- Borda, fundo levemente tonalizado e badge com `company.primaryColor` também na Agenda, nos itens de atenção e nos canais da Operação.
- O push informa a empresa.

## Etapa 5 — Monitoramento operacional — PRONTO PARA REVISÃO

A Central de Operação existente foi complementada, não duplicada.

- **Indicadores novos:**
  - falhas de envio nas últimas 24 h (conversas ativas do escopo);
  - follow-ups vencidos e follow-ups para hoje;
  - atendente fixo ausente (cliente esperando o fixo, que está sem conexão).
- **"Precisa de atenção" ganhou três motivos:**
  - falha de envio (crítico);
  - atendente fixo ausente;
  - follow-up atrasado (abre na Agenda).
- **Equipe:** passa a mostrar follow-ups pendentes e a **última resposta enviada**. Isso é evidência de atividade, não presença: "online" só aparece quando há uma conexão SSE aberta.
- **Canais e integrações** (`GET /api/operations/channels`), por número:
  - cadastro: status, ligado, configurado;
  - último webhook válido — guardado em memória desde o último reinício, e a tela informa isso;
  - última mensagem recebida, último envio aceito e falhas em 24 h — consultados nas 20 conversas mais recentes do número, recorte informado na tela;
  - último erro, **sanitizado**.
  - "Conectado" nunca é tratado como teste de envio: um número sem atividade aparece como "Sem evidência de uso".
- **Diagnóstico técnico** (`GET /api/operations/diagnostics`, **só Master**):
  - aplicação: versão, Node e tempo no ar;
  - banco: latência e última migration;
  - jobs: timers do Flow Builder (pendentes e atrasados) e worker de lembretes;
  - automação: Bots, envio em massa (deve aparecer desligado) e fila de campanhas;
  - erros: falhas do Flow Builder em 24 h e erros recentes sanitizados.
  - Workers sem telemetria são declarados como tal, sem um "ok" inventado.
- **Atualização:** usa o mesmo SSE (`inbox.updated`) com debounce. Canais e diagnóstico atualizam no máximo uma vez por minuto.
- **Testes:** `test/operations-monitoring.test.js` (6).

## Etapa 6 — Pré-deploy e segurança

### Migrations

- **Única migration nova:** `20261010120000_follow_up_agenda`. É **aditiva**: um enum, uma tabela, 6 índices e 7 FKs.
  - Nenhuma tabela ou coluna existente foi alterada, e não há backfill.
  - Comportamento das FKs:
    - Contact: `CASCADE` (igual às notas);
    - Conversation, ChannelAccount e User: `SET NULL`;
    - Company e Category: `RESTRICT`.
- **Aplicação verificada.**
  - Todas as migrations do repositório foram aplicadas do zero num schema temporário (`app_whats_migcheck`) com `prisma migrate deploy`: sucesso.
  - `migrate diff` contra `schema.prisma`: **sem diferença**.
- **Reversão verificada no mesmo schema.**
  - Após `DROP TABLE "FollowUp"; DROP TYPE "FollowUpStatus";` a estrutura ficou idêntica à v0.35.3.
  - O schema temporário foi removido em seguida.
- **Atenção:** essa reversão apaga os retornos criados. Por isso o rollback recomendado é **só de código** — a tabela pode ficar, e o código anterior a ignora.

### Regressão

- **`npm test` final:** 1025 testes, 886 ok, 137 falhas, 2 skipped.
  - As 137 falhas são **exatamente** as da linha de base (comparação nome a nome): nenhuma falha nova, nenhuma corrigida.
  - 36 testes novos, todos passando.
- **Suítes de segurança e multiempresa executadas isoladamente: 73/73.**
  - `multiempresa`, `company-activation`, `multiempresa-ui`;
  - `private-segments`, `private-segments-http`;
  - `preferred-assignee`, `security-idor`;
  - `operations-panel`, `productivity`, `meta-templates-loading`.
- **Autorização e IDOR nas rotas novas:**
  - retornos de outra empresa ou pessoa → 404 (GET, PATCH, complete e criação pela conversa);
  - perfil e linha do tempo de outra empresa → 403 ou 404;
  - diagnóstico → 403 para quem não é Master;
  - canais → só as empresas do escopo.
- **Webhooks.**
  - Mudança 1: registrar o horário do último webhook válido, depois da verificação de assinatura.
  - Mudança 2: o aviso "cliente com retorno pendente". É assíncrono e nunca derruba o webhook.
  - A idempotência do fluxo (`lastMessageId`) está preservada e testada para o nó novo.
- **SSE.** Os eventos novos (`followup.updated`, `followup.reminder`) vão só para o responsável e carregam apenas `{ id, kind }`.
- **PWA.**
  - `service-worker.js` com versão `0.36.0-rc1`, revisão de cache nova e os novos CSS/JS na lista estática.
  - Nenhuma rota `/api/` vai para o cache; o teste existente `app.test.js` continua cobrindo isso.
  - Telas conferidas em 390 px e 1366 px, tema claro e escuro, sem rolagem horizontal: Agenda, Operação, diálogo de agendamento e Perfil 360°.
- **Performance.**
  - Não foram executados benchmarks de carga, só testes funcionais.
  - As consultas novas usam índices existentes ou os índices novos de `FollowUp`.
  - O painel não varre a tabela de mensagens.

### Variáveis de ambiente

- Nova e opcional: `FOLLOW_UP_REMINDER_LEAD_MINUTES` (0–1440, padrão 15), documentada em `.env.example`.
- Nenhuma variável nova é obrigatória.

### Rollback (futura publicação)

1. **Antes:** fazer backup do banco (`pg_dump -Fc`) e da imagem/código atual, pelo mesmo procedimento usado na 0.35.3, e conferir o SHA256.
2. **Código:** voltar para a imagem/commit anterior. A tabela `FollowUp` pode permanecer (é aditiva e o código anterior não a usa).
3. **Migration:** remover a tabela só se for realmente necessário, porque isso apaga os retornos criados:
   `DROP TABLE "FollowUp"; DROP TYPE "FollowUpStatus"; DELETE FROM "_prisma_migrations" WHERE migration_name = '20261010120000_follow_up_agenda';`
4. **Configuração:** nenhuma configuração existente foi alterada. Remover `FOLLOW_UP_REMINDER_LEAD_MINUTES` se tiver sido definida.
5. **Workers:** o worker de lembretes sai junto com o código. Não há fila externa nem job persistido.
6. **Frontend/PWA:** a versão anterior do service worker troca o cache pelo próprio nome de versão.
7. Não restaurar o banco automaticamente depois de novas mensagens recebidas.

## Riscos pendentes e limitações

- **Presença e último webhook ficam em memória do processo.** Somem no reinício, e com mais de um processo cada um vê só o seu. A tela informa isso.
- **Falhas de envio no painel têm recorte.** Consideram as conversas ativas e as 20 conversas mais recentes de cada número. Não há índice global por status em `Message`, e criar um exigiria migration numa tabela grande.
- **O aviso "cliente voltou a escrever" é limitado em memória** (uma vez a cada 30 min por retorno).
- **Supervisor não agenda pela conversa supervisionada**, porque a supervisão segue somente leitura. Ele reatribui pela Agenda.
- **Pendentes da Etapa 2:** nó de template, subfluxo com retorno e organização automática do canvas.
- **137 testes antigos falham desde a linha de base**, 122 deles do motor de Bots legado arquivado. Vale revisá-los ou removê-los numa tarefa própria.

## Estado final

**PRONTO PARA REVISÃO.** Não é "pronto para deploy": há pendências declaradas na Etapa 2, e a ativação da Sincrofit depende de itens que precisam de ambiente real.

Confirmações:
- Nenhum deploy.
- Nenhuma conexão à VPS.
- Nenhum push.
- Nenhuma mensagem real enviada: os testes usam canais em memória, e o `.env` local não tem token do WhatsApp.
- Nenhuma campanha ativada: o envio em massa continua desligado.
- Sincrofit não ativada.
- IA não ativada.
- CSAT/estrelas não alterado.
- Histórico Financeiro preservado: os testes de setor protegido passam.
- Nenhum dado existente excluído. Os únicos dados criados foram:
  - dados fictícios dos testes e da prévia, no schema `app_whats_test`;
  - o schema temporário de verificação de migrations, já removido.
