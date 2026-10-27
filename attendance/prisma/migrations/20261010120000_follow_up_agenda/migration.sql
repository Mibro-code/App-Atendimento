-- Agenda e Follow-ups (v0.36): somente aditiva. Nenhuma tabela/coluna existente é alterada.
-- Reversão (opcional, sem afetar dados existentes): DROP TABLE "FollowUp"; DROP TYPE "FollowUpStatus";

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDENTE', 'CONCLUIDO', 'CANCELADO');

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "channelAccountId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "priority" "ConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDENTE',
    "privateCategoryId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceKey" TEXT,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "remindedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_sourceKey_key" ON "FollowUp"("sourceKey");

-- CreateIndex
CREATE INDEX "FollowUp_companyId_status_dueAt_idx" ON "FollowUp"("companyId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_assigneeId_status_dueAt_idx" ON "FollowUp"("assigneeId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_contactId_dueAt_idx" ON "FollowUp"("contactId", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_conversationId_idx" ON "FollowUp"("conversationId");

-- CreateIndex
CREATE INDEX "FollowUp_status_dueAt_idx" ON "FollowUp"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_privateCategoryId_fkey" FOREIGN KEY ("privateCategoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
