-- Configuração individual de follow-up e política de repasse da equipe.
ALTER TABLE "User"
  ADD COLUMN "followUpAfterDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "allowSellerCustomerTransfer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD CONSTRAINT "User_followUpAfterDays_check"
  CHECK ("followUpAfterDays" BETWEEN 1 AND 365);

ALTER TYPE "FollowUpSource" ADD VALUE IF NOT EXISTS 'AUTOMATICO_INATIVIDADE';

ALTER TABLE "FollowUp" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "FollowUp_dedupeKey_key" ON "FollowUp"("dedupeKey");

CREATE TABLE "CustomerTransferHistory" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "fromSellerId" TEXT NOT NULL,
  "toSellerId" TEXT NOT NULL,
  "transferredById" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerTransferHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerTransferHistory_customerId_createdAt_idx"
  ON "CustomerTransferHistory"("customerId", "createdAt");
CREATE INDEX "CustomerTransferHistory_fromSellerId_idx"
  ON "CustomerTransferHistory"("fromSellerId");
CREATE INDEX "CustomerTransferHistory_toSellerId_idx"
  ON "CustomerTransferHistory"("toSellerId");

ALTER TABLE "CustomerTransferHistory"
  ADD CONSTRAINT "CustomerTransferHistory_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerTransferHistory"
  ADD CONSTRAINT "CustomerTransferHistory_fromSellerId_fkey"
  FOREIGN KEY ("fromSellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerTransferHistory"
  ADD CONSTRAINT "CustomerTransferHistory_toSellerId_fkey"
  FOREIGN KEY ("toSellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerTransferHistory"
  ADD CONSTRAINT "CustomerTransferHistory_transferredById_fkey"
  FOREIGN KEY ("transferredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
