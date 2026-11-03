CREATE TYPE "BusinessType" AS ENUM ('LOJA_VIRTUAL', 'LOJA_FISICA', 'LOJA_FISICA_E_VIRTUAL', 'OUTRO');
CREATE TYPE "CustomerInterest" AS ENUM ('SMARTWATCH', 'OCULOS_IA', 'FONE_DE_OUVIDO');

ALTER TABLE "Customer"
ADD COLUMN "businessType" "BusinessType",
ADD COLUMN "industrySegment" TEXT,
ADD COLUMN "worksWithSmartwatch" BOOLEAN,
ADD COLUMN "interests" "CustomerInterest"[] NOT NULL DEFAULT ARRAY[]::"CustomerInterest"[],
ADD COLUMN "interestedBrand" "CommercialBrand",
ADD COLUMN "leadCapturedAt" TIMESTAMP(3);

CREATE INDEX "Customer_state_idx" ON "Customer"("state");
CREATE INDEX "Customer_businessType_idx" ON "Customer"("businessType");
CREATE INDEX "Customer_industrySegment_idx" ON "Customer"("industrySegment");
CREATE INDEX "Customer_interestedBrand_idx" ON "Customer"("interestedBrand");
