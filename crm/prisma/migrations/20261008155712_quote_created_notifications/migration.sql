-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'QUOTE_CREATED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "quoteId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_quoteId_idx" ON "Notification"("quoteId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
