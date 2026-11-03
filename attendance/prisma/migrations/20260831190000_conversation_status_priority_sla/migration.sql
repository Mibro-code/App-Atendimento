-- Gestão operacional de conversas: status mais claros, prioridade manual e
-- SLA de resposta durante atendimento. Aditiva/renomeação de enum apenas —
-- nenhum dado existente é apagado ou perde sentido.

-- AGUARDANDO_RESPOSTA -> AGUARDANDO_EQUIPE: mesmo significado exato (última
-- mensagem válida foi do cliente), só o nome era ambíguo (não dizia de quem
-- era a vez). Todas as linhas existentes com esse status são preservadas.
ALTER TYPE "ConversationStatus" RENAME VALUE 'AGUARDANDO_RESPOSTA' TO 'AGUARDANDO_EQUIPE';
ALTER TYPE "ConversationStatus" ADD VALUE IF NOT EXISTS 'AGUARDANDO_CLIENTE' AFTER 'AGUARDANDO_EQUIPE';
ALTER TYPE "ConversationStatus" ADD VALUE IF NOT EXISTS 'HANDOFF_BOT' AFTER 'AGUARDANDO_CLIENTE';

CREATE TYPE "ConversationPriority" AS ENUM ('NORMAL', 'ALTA', 'URGENTE');

ALTER TABLE "Conversation"
  ADD COLUMN "responseSlaBreached" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "priority" "ConversationPriority" NOT NULL DEFAULT 'NORMAL';

CREATE INDEX "Conversation_priority_idx" ON "Conversation"("priority");
CREATE INDEX "Conversation_firstResponseSlaBreached_idx" ON "Conversation"("firstResponseSlaBreached");
CREATE INDEX "Conversation_responseSlaBreached_idx" ON "Conversation"("responseSlaBreached");

ALTER TABLE "ConversationSettings"
  ADD COLUMN "slaNearBreachAlertEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "slaNearBreachPercent" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN "unassignedConversationAlertEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "unassignedConversationAlertMinutes" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "User"
  ADD COLUMN "canSetConversationPriority" BOOLEAN NOT NULL DEFAULT false;
