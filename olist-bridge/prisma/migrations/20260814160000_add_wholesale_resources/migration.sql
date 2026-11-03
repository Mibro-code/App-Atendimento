CREATE TABLE "WholesaleResource" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "companyId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleResource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WholesaleResource_shop_type_active_idx"
ON "WholesaleResource"("shop", "type", "active");

CREATE INDEX "WholesaleResource_companyId_idx"
ON "WholesaleResource"("companyId");

ALTER TABLE "WholesaleResource"
ADD CONSTRAINT "WholesaleResource_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "WholesaleCompany"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
