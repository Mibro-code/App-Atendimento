-- AlterTable
ALTER TABLE "WholesaleResource" ADD COLUMN     "allowDownload" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowDraft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deliveryType" TEXT NOT NULL DEFAULT 'LINK',
ADD COLUMN     "generatePdf" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "templateName" TEXT,
ADD COLUMN     "templatePath" TEXT,
ADD COLUMN     "templateVersion" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "url" DROP NOT NULL;

-- CreateTable
CREATE TABLE "WholesaleDocumentSubmission" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "templateVersion" INTEGER NOT NULL,
    "formData" JSONB NOT NULL,
    "finalDocxPath" TEXT,
    "finalPdfPath" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleDocumentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WholesaleDocumentSubmission_resourceId_idx" ON "WholesaleDocumentSubmission"("resourceId");

-- CreateIndex
CREATE INDEX "WholesaleDocumentSubmission_companyId_idx" ON "WholesaleDocumentSubmission"("companyId");

-- CreateIndex
CREATE INDEX "WholesaleDocumentSubmission_customerId_idx" ON "WholesaleDocumentSubmission"("customerId");

-- CreateIndex
CREATE INDEX "WholesaleDocumentSubmission_status_idx" ON "WholesaleDocumentSubmission"("status");

-- AddForeignKey
ALTER TABLE "WholesaleDocumentSubmission" ADD CONSTRAINT "WholesaleDocumentSubmission_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "WholesaleResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
