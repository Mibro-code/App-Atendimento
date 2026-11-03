# Produtividade e Qualidade — definições das métricas

Página: `/produtividade` (mesma página do antigo `/relatorio-conversas`, que continua funcionando).
Backend: `src/services/productivity-service.js` (por ciclo), `src/services/conversation-analytics-service.js` (seção "Conversas"),
escopo em `src/services/report-access-service.js`. Testes: `test/productivity.test.js`.

## Ciclo de atendimento

A mesma `Conversation` é reaproveitada a cada novo contato do cliente, então **nenhuma métrica de produtividade conta linhas de Conversation**.
Não há tabela de sessão: os ciclos são reconstruídos de dados já gravados.

| Evento | Fonte |
|---|---|
| Início do ciclo | 1ª mensagem (cliente, atendente ou Bot) depois da finalização anterior; ou a criação da conversa |
| Fim do ciclo | `ConversationActivity` `STATUS_CHANGED → FINALIZADO` (manual), `AUTO_FINALIZED_INACTIVITY`, `BOT_FLOW_COMPLETED` com `finalizeConversation` (só vale se nenhum humano falou no ciclo) |
| Reabertura | `REOPENED_BY_CUSTOMER_MESSAGE` até 24h após a finalização |
| Assumir | `CONVERSATION_CLAIMED` (manual ou ao responder primeiro) |
| Transferência | `CONVERSATION_TRANSFERRED` (de → para) |

Mensagens lidas: período + 14 dias antes (para achar o início do ciclo e a mensagem que uma resposta respondeu).
Ciclo que começou antes dessa janela não entra no tempo de atendimento nem na média de 1ª resposta (não há como saber o início real).

## Vocabulário de mensagens

- **Cliente**: `Message` RECEBIDA (reações ignoradas).
- **Humano**: `Message` ENVIADA com `sentByUserId`. A despedida automática da finalização (`closingMessage`) **não** conta como atendimento.
- **Bot**: ENVIADA sem `sentByUserId` — nunca conta como resposta.

## Indicadores

| Indicador | Definição |
|---|---|
| Atendimentos iniciados | Ciclos cujo início caiu no período |
| Iniciados pela equipe | Ciclos cuja 1ª mensagem foi de um atendente (contato ativo) |
| Assumidos | Eventos de assumir no período, por quem assumiu |
| Finalizados | Ciclos finalizados no período (manual, inatividade ou Bot) |
| Finalizados com atendente / sem humano | Com ou sem atendente atribuído (ver atribuição) |
| Ativos agora | Conversas abertas atribuídas agora (não depende do período) |
| Transferiu / Recebeu | Transferências no período por origem/destino. A transferência automática que a despedida gerava para quem finalizava é ignorada |
| Reabertos em 24h | Ciclos finalizados no período em que o cliente voltou em até 24h. Taxa = ÷ finalizados com atendente |
| 1ª resposta humana | Da 1ª mensagem do cliente no ciclo até a 1ª mensagem humana depois dela. Atribuída a quem respondeu |
| Tempo médio de resposta | Cada mensagem do cliente sem resposta → próxima mensagem humana (inclui a 1ª). Atribuída a quem respondeu |
| Tempo médio de atendimento | Início do ciclo → finalização, contando somente o expediente configurado, sem noites, dias fechados ou feriados habilitados |
| SLA cumprido | Por resposta humana: 1ª resposta comparada a `firstResponseSlaMinutes`, demais a `responseSlaMinutes` da empresa (Configurações → Conversas). "Próximo do limite" = acima de `slaNearBreachPercent`. Cumprido = dentro + próximo, ÷ respostas medidas. SLA desligado = não medido (nunca conta como cumprido) |
| Mensagens enviadas | Mensagens humanas no período (sem a despedida). Não é medida de atendimento concluído |

Toda média é exibida com o número de amostras (`n`). Sem dados, o valor é `null` → "—"/"Sem dados".

## Atribuição (atendimentos com mais de uma pessoa)

O ciclo finalizado pertence a **quem finalizou, se essa pessoa enviou mensagem no ciclo**; senão ao **último humano que respondeu**; senão a ninguém
("sem humano": Bot ou inatividade sem atendimento). Os demais participantes ficam em `participants` (auditoria) e cada resposta conta para quem a enviou.
Ex.: Carlos começa, transfere para Ana, Ana responde, Supervisor finaliza → o atendimento é da Ana; a 1ª resposta é do Carlos.

## Escopo e permissões (aplicado no backend, inclusive CSV)

| Papel | Vê |
|---|---|
| Master | Todas as empresas (ou a filtrada), todos os atendentes, comparação, exportação |
| Supervisor | Só empresas em que é Supervisor; dentro delas, o escopo de conversa dele (`authorization.conversationScope`: setores que gerencia + as suas). Pedir outra empresa = 403; atendente fora do alcance = 404 |
| Atendente | Só com "Ver minha produtividade" (`User.canViewOwnProductivity` ou permissão por empresa). Somente os próprios números; sem comparação |

Financeiro protegido: agregados (contagens/tempos) contam normalmente para quem enxerga a conversa; prévia de mensagem e eventos privados aparecem
como "[Conteúdo de setor protegido]"/marcador estrutural para quem não é do setor (`private-segment-service`).

## Período e fuso

Todos os períodos (Hoje, Ontem, 7/30 dias, Este mês, Mês anterior, Personalizado) e buckets dos gráficos usam o calendário de
`America/Sao_Paulo` (`src/services/operation-time.js`), independentemente do fuso do servidor. Fim do intervalo é exclusivo.

## Limitações conhecidas

- Equipe/categoria = setor **atual** da conversa (o histórico de setor por ciclo não é gravado).
- Supervisor: conversa que saiu do setor dele deixa de entrar no escopo (escopo atual, não histórico).
- Respostas, atendimento e SLA do painel usam tempo útil do calendário atual da empresa/número; volume e janela de reabertura de 24h continuam em tempo real.
- Mensagem de cliente que ficou sem resposta humana não gera violação de SLA nesta métrica (só respostas são medidas).
- Períodos com mais de 8.000 conversas ou 250.000 mensagens retornam "período grande demais" em vez de números parciais.
- Dados anteriores a esta versão: a transferência automática gerada pela despedida é filtrada por heurística (mesmo usuário finalizando até 2 min depois).
