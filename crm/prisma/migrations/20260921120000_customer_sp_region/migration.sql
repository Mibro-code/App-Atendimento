ALTER TABLE "Customer" ADD COLUMN "spRegion" TEXT;

CREATE INDEX "Customer_spRegion_idx" ON "Customer"("spRegion");
