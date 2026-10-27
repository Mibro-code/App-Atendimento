-- CreateEnum
CREATE TYPE "ProposalMode" AS ENUM ('SIMULATION', 'REAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QuoteStatus" ADD VALUE 'ENVIADA';
ALTER TYPE "QuoteStatus" ADD VALUE 'CONVERTIDA';
ALTER TYPE "QuoteStatus" ADD VALUE 'EXPIRADA';

-- AlterTable
ALTER TABLE "CrmSessionToken" ADD COLUMN     "mode" "ProposalMode" NOT NULL DEFAULT 'REAL',
ADD COLUMN     "resumeQuoteId" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "discountCents" INTEGER,
ADD COLUMN     "mode" "ProposalMode" NOT NULL DEFAULT 'REAL',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentToEmail" TEXT,
ADD COLUMN     "sourceQuoteId" TEXT;

-- CreateIndex
CREATE INDEX "CrmSessionToken_resumeQuoteId_idx" ON "CrmSessionToken"("resumeQuoteId");

-- CreateIndex
CREATE INDEX "Quote_mode_idx" ON "Quote"("mode");

-- CreateIndex
CREATE INDEX "Quote_sourceQuoteId_idx" ON "Quote"("sourceQuoteId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_sourceQuoteId_fkey" FOREIGN KEY ("sourceQuoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSessionToken" ADD CONSTRAINT "CrmSessionToken_resumeQuoteId_fkey" FOREIGN KEY ("resumeQuoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
