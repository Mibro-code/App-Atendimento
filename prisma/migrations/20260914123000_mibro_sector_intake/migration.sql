-- Replace only the obsolete, assistant-specific guided seed. Shared Flow
-- Engine, Knowledge, synonyms and all other Bots remain untouched.
UPDATE "Bot"
SET
  "description" = 'Primeiro atendimento pos-triagem por setor. Em observacao: coleta contexto, consulta Knowledge e prepara o handoff sem enviar mensagens.',
  "featureFlags" = (COALESCE("featureFlags", '{}'::jsonb) - 'guidedEntryIntentId')
    || '{"sectorIntakeEnabled":true,"guidedFlowEnabled":false,"flowEngineEnabled":true}'::jsonb,
  "updatedAt" = NOW()
WHERE "id" = 'mibro-assistant-observer';

DELETE FROM "BotFlowStep"
WHERE "id" LIKE 'mibro-step-%'
  AND "intentId" IN (
    SELECT "id" FROM "BotIntent" WHERE "botId" = 'mibro-assistant-observer'
  );

DELETE FROM "BotIntent"
WHERE "botId" = 'mibro-assistant-observer'
  AND "id" IN (
    'mibro-guided-main',
    'mibro-guided-support',
    'mibro-guided-notifications',
    'mibro-guided-gps',
    'mibro-guided-screen',
    'mibro-guided-other'
  );

DELETE FROM "BotResponseBlock"
WHERE "botId" = 'mibro-assistant-observer'
  AND "id" LIKE 'mibro-block-%'
  AND NOT EXISTS (
    SELECT 1 FROM "BotFlowStep" WHERE "BotFlowStep"."responseBlockId" = "BotResponseBlock"."id"
  );
