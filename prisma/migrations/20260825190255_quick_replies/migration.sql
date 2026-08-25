-- CreateEnum
CREATE TYPE "QuickReplyType" AS ENUM ('QUICK_REPLY', 'SUGGESTED_REPLY', 'AUTOMATED_REPLY');

-- CreateEnum
CREATE TYPE "QuickReplyUsageSource" AS ENUM ('AGENT', 'BOT_SUGGESTION', 'OBSERVATION');

-- AlterTable
ALTER TABLE "BotObservation" ADD COLUMN     "suggestedQuickReplyId" TEXT,
ADD COLUMN     "suggestedQuickReplyName" TEXT;

-- CreateTable
CREATE TABLE "QuickReply" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "categoryId" TEXT,
    "channels" "Channel"[] DEFAULT ARRAY[]::"Channel"[],
    "availableToAgents" BOOLEAN NOT NULL DEFAULT true,
    "availableToBots" BOOLEAN NOT NULL DEFAULT false,
    "type" "QuickReplyType" NOT NULL DEFAULT 'QUICK_REPLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickReplyIntent" (
    "id" TEXT NOT NULL,
    "quickReplyId" TEXT NOT NULL,
    "botIntentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickReplyIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickReplyFavorite" (
    "id" TEXT NOT NULL,
    "quickReplyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickReplyFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickReplyUsage" (
    "id" TEXT NOT NULL,
    "quickReplyId" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "source" "QuickReplyUsageSource" NOT NULL DEFAULT 'AGENT',
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickReplyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuickReply_active_categoryId_idx" ON "QuickReply"("active", "categoryId");

-- CreateIndex
CREATE INDEX "QuickReply_shortcut_idx" ON "QuickReply"("shortcut");

-- CreateIndex
CREATE INDEX "QuickReply_createdAt_idx" ON "QuickReply"("createdAt");

-- CreateIndex
CREATE INDEX "QuickReplyIntent_botIntentId_idx" ON "QuickReplyIntent"("botIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickReplyIntent_quickReplyId_botIntentId_key" ON "QuickReplyIntent"("quickReplyId", "botIntentId");

-- CreateIndex
CREATE INDEX "QuickReplyFavorite_userId_idx" ON "QuickReplyFavorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickReplyFavorite_quickReplyId_userId_key" ON "QuickReplyFavorite"("quickReplyId", "userId");

-- CreateIndex
CREATE INDEX "QuickReplyUsage_quickReplyId_usedAt_idx" ON "QuickReplyUsage"("quickReplyId", "usedAt");

-- CreateIndex
CREATE INDEX "QuickReplyUsage_userId_idx" ON "QuickReplyUsage"("userId");

-- CreateIndex
CREATE INDEX "QuickReplyUsage_conversationId_idx" ON "QuickReplyUsage"("conversationId");

-- AddForeignKey
ALTER TABLE "BotObservation" ADD CONSTRAINT "BotObservation_suggestedQuickReplyId_fkey" FOREIGN KEY ("suggestedQuickReplyId") REFERENCES "QuickReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReplyIntent" ADD CONSTRAINT "QuickReplyIntent_quickReplyId_fkey" FOREIGN KEY ("quickReplyId") REFERENCES "QuickReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReplyIntent" ADD CONSTRAINT "QuickReplyIntent_botIntentId_fkey" FOREIGN KEY ("botIntentId") REFERENCES "BotIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReplyFavorite" ADD CONSTRAINT "QuickReplyFavorite_quickReplyId_fkey" FOREIGN KEY ("quickReplyId") REFERENCES "QuickReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReplyFavorite" ADD CONSTRAINT "QuickReplyFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReplyUsage" ADD CONSTRAINT "QuickReplyUsage_quickReplyId_fkey" FOREIGN KEY ("quickReplyId") REFERENCES "QuickReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReplyUsage" ADD CONSTRAINT "QuickReplyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReplyUsage" ADD CONSTRAINT "QuickReplyUsage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
