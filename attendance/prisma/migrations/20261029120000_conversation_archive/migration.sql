BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "Conversation" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "archivedByUserId" TEXT;
CREATE INDEX "Conversation_companyId_archivedAt_lastMessageAt_idx" ON "Conversation"("companyId", "archivedAt", "lastMessageAt");
COMMIT;
