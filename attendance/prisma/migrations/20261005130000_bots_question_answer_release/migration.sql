-- Additive only: conversations, messages, knowledge, credentials and backups are preserved.
ALTER TYPE "BotStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED_LEGACY';
ALTER TABLE "Bot" ADD COLUMN IF NOT EXISTS "holidayMessage" TEXT;
ALTER TABLE "Bot" ALTER COLUMN "executionMode" SET DEFAULT 'FLOW_BUILDER';
CREATE TABLE IF NOT EXISTS "BotResponse" (
  "id" TEXT NOT NULL PRIMARY KEY, "key" TEXT NOT NULL, "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'GERAL', "text" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT, "createdByName" TEXT, "updatedByUserId" TEXT, "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "BotResponse_key_key" ON "BotResponse"("key");
CREATE INDEX IF NOT EXISTS "BotResponse_category_active_idx" ON "BotResponse"("category", "active");
