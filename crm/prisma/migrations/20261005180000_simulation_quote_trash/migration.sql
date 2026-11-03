ALTER TABLE "Quote" ADD COLUMN "deletedAt" TIMESTAMP(3),
                    ADD COLUMN "deletedById" TEXT,
                    ADD COLUMN "deletedSnapshot" JSONB;
CREATE INDEX "Quote_deletedAt_idx" ON "Quote"("deletedAt");
