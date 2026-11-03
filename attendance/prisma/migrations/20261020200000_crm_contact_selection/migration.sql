CREATE TABLE "CrmContactSelection" (
  "codeHash" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "crmUserId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL, "recipients" JSONB NOT NULL, "skipSent" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3) NOT NULL, "campaignId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CrmContactSelection_campaignId_key" ON "CrmContactSelection"("campaignId");
CREATE INDEX "CrmContactSelection_expiresAt_idx" ON "CrmContactSelection"("expiresAt");
ALTER TABLE "CampaignContact" ADD COLUMN "crmCustomerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "CampaignContact_crmCustomerIds_idx" ON "CampaignContact" USING GIN ("crmCustomerIds");
