-- CreateEnum
CREATE TYPE "OlistSyncAction" AS ENUM ('CALCULATE', 'CONFIRM', 'EMAIL');

-- CreateEnum
CREATE TYPE "OlistSyncStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "olistLockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OlistSyncAttempt" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "brand" "CommercialBrand" NOT NULL,
    "action" "OlistSyncAction" NOT NULL,
    "status" "OlistSyncStatus" NOT NULL DEFAULT 'STARTED',
    "actorId" TEXT,
    "requestHash" TEXT,
    "olistOrderId" TEXT,
    "orderNumber" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "mismatch" JSONB,
    "response" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "OlistSyncAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OlistSyncAttempt_quoteId_startedAt_idx" ON "OlistSyncAttempt"("quoteId", "startedAt");

-- CreateIndex
CREATE INDEX "OlistSyncAttempt_status_idx" ON "OlistSyncAttempt"("status");

-- AddForeignKey
ALTER TABLE "OlistSyncAttempt" ADD CONSTRAINT "OlistSyncAttempt_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
