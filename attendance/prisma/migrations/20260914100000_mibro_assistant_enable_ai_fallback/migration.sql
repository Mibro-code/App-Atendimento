-- Liga o fallback de IA externa (Gemini) no Assistente Mibro Brasil.
-- A seed original (20260911151000_mibro_assistant_guided_seed) deixou
-- "externalAiFallbackEnabled": false de propósito (default seguro de
-- interpretCore, bot-interpreter-service.js) e nunca definiu
-- "externalAiProvider". Sem isso, o Bot nunca tentava o Gemini quando não
-- reconhecia a resposta do cliente a uma opção do menu guiado (bot-flow-
-- service.js/matchOptionWithAi) — ia direto para nova tentativa/handoff.
--
-- Aqui só ativamos a ESCOLHA de provider por Bot; a CREDENCIAL do Gemini
-- continua sendo global (painel Configurações > IA, ou env GEMINI_API_KEY —
-- ver ai/get-ai-provider.js) e não é tocada por esta migration. Sem
-- credencial configurada, o Bot continua funcionando normalmente só com o
-- classificador local (getPrimaryProvider() cai em LOCAL_FALLBACK).
-- Se o Master já escolheu outro provider para este Bot, a escolha existente
-- é preservada; Gemini é definido apenas quando ainda não há provider.
UPDATE "Bot"
SET "featureFlags" =
  jsonb_set(COALESCE("featureFlags", '{}'::jsonb), '{externalAiFallbackEnabled}', 'true'::jsonb, true)
  || CASE
    WHEN COALESCE("featureFlags", '{}'::jsonb) ? 'externalAiProvider' THEN '{}'::jsonb
    ELSE '{"externalAiProvider":"GEMINI"}'::jsonb
  END
WHERE "id" = 'mibro-assistant-observer';
