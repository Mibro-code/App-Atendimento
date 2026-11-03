-- Configuracoes globais de conversas e indicador de SLA da primeira resposta.
ALTER TABLE "Conversation"
ADD COLUMN "firstResponseSlaBreached" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ConversationSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "firstResponseSlaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "firstResponseSlaMinutes" INTEGER NOT NULL DEFAULT 10,
    "responseSlaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "responseSlaMinutes" INTEGER NOT NULL DEFAULT 15,
    "unansweredConversationAlertEnabled" BOOLEAN NOT NULL DEFAULT false,
    "unansweredConversationAlertMinutes" INTEGER NOT NULL DEFAULT 30,
    "stalledConversationAlertEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stalledConversationAlertMinutes" INTEGER NOT NULL DEFAULT 360,
    "botContextTtlMinutes" INTEGER NOT NULL DEFAULT 120,
    "botResumeAfterHumanEnabled" BOOLEAN NOT NULL DEFAULT false,
    "botResumeAfterHumanMinutes" INTEGER NOT NULL DEFAULT 60,
    "reopenConversationOnCustomerMessage" BOOLEAN NOT NULL DEFAULT true,
    "reopenWindowMinutes" INTEGER,
    "slaBusinessHoursOnly" BOOLEAN NOT NULL DEFAULT false,
    "autoFinalizationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoFinalizationMinutes" INTEGER NOT NULL DEFAULT 1440,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationSettings_pkey" PRIMARY KEY ("id")
);
