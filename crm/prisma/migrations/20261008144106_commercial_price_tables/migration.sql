-- CreateEnum
CREATE TYPE "PriceGroup" AS ENUM ('STANDARD', 'REPRESENTATIVE');

-- CreateEnum
CREATE TYPE "PriceTier" AS ENUM ('TIER1', 'TIER2', 'TIER3');

-- CreateEnum
CREATE TYPE "PricingQuantityRule" AS ENUM ('MIX', 'PER_MODEL');

-- CreateEnum
CREATE TYPE "PriceTableStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuoteOrigin" AS ENUM ('SHOPIFY', 'CRM');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "draftState" JSONB,
ADD COLUMN     "origin" "QuoteOrigin" NOT NULL DEFAULT 'SHOPIFY',
ADD COLUMN     "priceGroup" "PriceGroup",
ADD COLUMN     "quantityRule" "PricingQuantityRule",
ADD COLUMN     "selectedTier" "PriceTier",
ADD COLUMN     "subtotalCents" INTEGER;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "brand" "CommercialBrand" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Smartwatch',
    "imageUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "brand" "CommercialBrand" NOT NULL,
    "sku" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTable" (
    "id" TEXT NOT NULL,
    "brand" "CommercialBrand" NOT NULL,
    "priceGroup" "PriceGroup" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PriceTableStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "changeReason" TEXT,
    "publishedKey" TEXT,
    "createdById" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceEntry" (
    "id" TEXT NOT NULL,
    "priceTableId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tier" "PriceTier" NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,

    CONSTRAINT "PriceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "colorName" TEXT,
    "quantity" INTEGER NOT NULL,
    "priceGroup" "PriceGroup" NOT NULL,
    "priceTableId" TEXT NOT NULL,
    "priceTableVersion" INTEGER NOT NULL,
    "automaticTier" "PriceTier" NOT NULL,
    "appliedTier" "PriceTier" NOT NULL,
    "manualTier" BOOLEAN NOT NULL DEFAULT false,
    "unitPriceCents" INTEGER NOT NULL,
    "lineSubtotalCents" INTEGER NOT NULL,
    "lineDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_brand_active_idx" ON "Product"("brand", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Product_brand_slug_key" ON "Product"("brand", "slug");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_brand_sku_key" ON "ProductVariant"("brand", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "PriceTable_publishedKey_key" ON "PriceTable"("publishedKey");

-- CreateIndex
CREATE INDEX "PriceTable_brand_priceGroup_status_effectiveFrom_idx" ON "PriceTable"("brand", "priceGroup", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PriceTable_brand_priceGroup_version_key" ON "PriceTable"("brand", "priceGroup", "version");

-- CreateIndex
CREATE INDEX "PriceEntry_productId_idx" ON "PriceEntry"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceEntry_priceTableId_productId_tier_key" ON "PriceEntry"("priceTableId", "productId", "tier");

-- CreateIndex
CREATE INDEX "QuoteItem_quoteId_idx" ON "QuoteItem"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteItem_priceTableId_idx" ON "QuoteItem"("priceTableId");

-- CreateIndex
CREATE INDEX "QuoteItem_appliedTier_idx" ON "QuoteItem"("appliedTier");

-- CreateIndex
CREATE INDEX "Quote_origin_idx" ON "Quote"("origin");

-- CreateIndex
CREATE INDEX "Quote_priceGroup_idx" ON "Quote"("priceGroup");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTable" ADD CONSTRAINT "PriceTable_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTable" ADD CONSTRAINT "PriceTable_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceEntry" ADD CONSTRAINT "PriceEntry_priceTableId_fkey" FOREIGN KEY ("priceTableId") REFERENCES "PriceTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceEntry" ADD CONSTRAINT "PriceEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_priceTableId_fkey" FOREIGN KEY ("priceTableId") REFERENCES "PriceTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integridade monetária (Prisma não expressa CHECK; não gera drift).
ALTER TABLE "PriceEntry" ADD CONSTRAINT "PriceEntry_unitPriceCents_positive" CHECK ("unitPriceCents" > 0);
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_unitPriceCents_positive" CHECK ("unitPriceCents" > 0);
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_lineSubtotal_consistent" CHECK ("lineSubtotalCents" = "quantity" * "unitPriceCents");
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_lineDiscount_range" CHECK ("lineDiscountCents" >= 0 AND "lineDiscountCents" <= "lineSubtotalCents");
ALTER TABLE "PriceTable" ADD CONSTRAINT "PriceTable_version_positive" CHECK ("version" > 0);
ALTER TABLE "PriceTable" ADD CONSTRAINT "PriceTable_publishedKey_matches_status" CHECK (("status" = 'PUBLISHED') = ("publishedKey" IS NOT NULL));
