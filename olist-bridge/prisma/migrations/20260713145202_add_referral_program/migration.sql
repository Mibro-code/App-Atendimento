-- CreateTable
CREATE TABLE "ReferralCoupon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "code" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "totalUses" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "ReferralUse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "referralCouponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "buyerCustomerId" TEXT,
    "buyerEmail" TEXT,
    "orderTotal" REAL,
    "currencyCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferralUse_referralCouponId_fkey" FOREIGN KEY ("referralCouponId") REFERENCES "ReferralCoupon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RewardCoupon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "referralUseId" TEXT NOT NULL,
    "ownerCustomerId" TEXT NOT NULL,
    "ownerEmail" TEXT,
    "code" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "usageLimit" INTEGER NOT NULL DEFAULT 1,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RewardCoupon_referralUseId_fkey" FOREIGN KEY ("referralUseId") REFERENCES "ReferralUse" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReferralCoupon_shop_idx" ON "ReferralCoupon"("shop");

-- CreateIndex
CREATE INDEX "ReferralCoupon_customerId_idx" ON "ReferralCoupon"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCoupon_shop_code_key" ON "ReferralCoupon"("shop", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCoupon_shop_customerId_key" ON "ReferralCoupon"("shop", "customerId");

-- CreateIndex
CREATE INDEX "ReferralUse_referralCouponId_idx" ON "ReferralUse"("referralCouponId");

-- CreateIndex
CREATE INDEX "ReferralUse_buyerCustomerId_idx" ON "ReferralUse"("buyerCustomerId");

-- CreateIndex
CREATE INDEX "ReferralUse_buyerEmail_idx" ON "ReferralUse"("buyerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralUse_shop_orderId_key" ON "ReferralUse"("shop", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardCoupon_referralUseId_key" ON "RewardCoupon"("referralUseId");

-- CreateIndex
CREATE INDEX "RewardCoupon_shop_idx" ON "RewardCoupon"("shop");

-- CreateIndex
CREATE INDEX "RewardCoupon_ownerCustomerId_idx" ON "RewardCoupon"("ownerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardCoupon_shop_code_key" ON "RewardCoupon"("shop", "code");
