-- Liga o Agent Planner (bot-agent-planner-service.js) e a escrita do Case
-- State (bot-case-state-service.js) no Assistente Mibro Brasil.
--
-- Sem isto, fora do menu guiado (SHOW_OPTIONS) o Bot decidia pelo caminho
-- legado (decide(), bot-decision-service.js), que nunca lê/grava Case State
-- — nenhuma memória de sintoma/app/sistema/tentativas sobrevivia entre
-- turnos fora de um fluxo já em andamento. Com agentPlannerEnabled=true:
--   - runDecisionPipeline (bot-orchestrator-service.js) passa a decidir
--     RESPOND/ASK/CLARIFY/SEARCH_KNOWLEDGE/USE_TOOL/HANDOFF via plan();
--   - Case State passa a ser lido/escrito a cada turno (produto/app/sistema/
--     tópico/tentativas — ver mergeCaseState/mergeFlowAttemptsIntoCaseState);
--   - dentro do Flow Engine, uma instrução (USE_RESPONSE_BLOCK) já registrada
--     como tentada nesta conversa deixa de ser repetida (wasAlreadyTried).
-- O menu guiado (guidedFlowEnabled) e o Flow Engine continuam exatamente
-- como estavam — o Planner só passa a decidir os turnos que NÃO são
-- etapa/opção de um fluxo em andamento.
UPDATE "Bot"
SET "featureFlags" = COALESCE("featureFlags", '{}'::jsonb) || '{"agentPlannerEnabled":true}'::jsonb
WHERE "id" = 'mibro-assistant-observer';
