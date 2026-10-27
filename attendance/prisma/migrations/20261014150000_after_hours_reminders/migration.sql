-- Atendimento fora do expediente: configurações, feriados e lembretes.
-- Aditiva: só cria enum, tabelas e uma coluna com default; nenhum dado
-- existente é alterado ou removido.

-- CreateEnum
CREATE TYPE "AfterHoursReminderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'CANCELLED', 'SKIPPED', 'FAILED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canManageAfterHours" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AfterHoursSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "businessDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "businessStartTime" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "businessEndTime" VARCHAR(5) NOT NULL DEFAULT '17:00',
    "remindOnSaturday" BOOLEAN NOT NULL DEFAULT true,
    "remindOnSunday" BOOLEAN NOT NULL DEFAULT true,
    "remindOnHolidays" BOOLEAN NOT NULL DEFAULT true,
    "delayMinutes" INTEGER NOT NULL DEFAULT 600,
    "onlyPending" BOOLEAN NOT NULL DEFAULT true,
    "onlyWithoutHuman" BOOLEAN NOT NULL DEFAULT true,
    "maxPerCycle" INTEGER NOT NULL DEFAULT 1,
    "metaSafetyMarginMinutes" INTEGER NOT NULL DEFAULT 15,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietStartTime" VARCHAR(5) NOT NULL DEFAULT '22:00',
    "quietEndTime" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "reminderMessage" TEXT NOT NULL DEFAULT 'Olá! Passando para confirmar que sua solicitação continua registrada com nossa equipe.

Nosso atendimento humano está temporariamente indisponível.

Se ainda precisar de ajuda, basta responder a esta mensagem.

Retomaremos seu atendimento assim que nossa equipe estiver disponível.

Agradecemos pela compreensão!
Equipe Mibro Brasil',
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AfterHoursSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessHoliday" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "companyId" TEXT,
    "date" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'NACIONAL',
    "region" TEXT,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "openTime" VARCHAR(5),
    "closeTime" VARCHAR(5),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AfterHoursReminder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelAccountId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'AFTER_HOURS',
    "cycleKey" TEXT NOT NULL,
    "status" "AfterHoursReminderStatus" NOT NULL DEFAULT 'PENDING',
    "referenceMessageId" TEXT NOT NULL,
    "referenceAt" TIMESTAMP(3) NOT NULL,
    "windowExpiresAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "sendStartedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "metaMessageId" TEXT,
    "messageId" TEXT,
    "reason" TEXT,
    "reasonDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AfterHoursReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AfterHoursSettings_companyId_key" ON "AfterHoursSettings"("companyId");

-- CreateIndex
CREATE INDEX "BusinessHoliday_date_idx" ON "BusinessHoliday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHoliday_scopeKey_date_key" ON "BusinessHoliday"("scopeKey", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AfterHoursReminder_messageId_key" ON "AfterHoursReminder"("messageId");

-- CreateIndex
CREATE INDEX "AfterHoursReminder_status_dueAt_idx" ON "AfterHoursReminder"("status", "dueAt");

-- CreateIndex
CREATE INDEX "AfterHoursReminder_companyId_status_updatedAt_idx" ON "AfterHoursReminder"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AfterHoursReminder_conversationId_kind_cycleKey_key" ON "AfterHoursReminder"("conversationId", "kind", "cycleKey");

-- AddForeignKey
ALTER TABLE "AfterHoursSettings" ADD CONSTRAINT "AfterHoursSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessHoliday" ADD CONSTRAINT "BusinessHoliday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AfterHoursReminder" ADD CONSTRAINT "AfterHoursReminder_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AfterHoursReminder" ADD CONSTRAINT "AfterHoursReminder_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

