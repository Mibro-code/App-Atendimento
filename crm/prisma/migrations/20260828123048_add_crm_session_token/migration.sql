-- CreateTable
CREATE TABLE "CrmSessionToken" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmSessionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmSessionToken_jti_key" ON "CrmSessionToken"("jti");

-- CreateIndex
CREATE INDEX "CrmSessionToken_customerId_idx" ON "CrmSessionToken"("customerId");

-- CreateIndex
CREATE INDEX "CrmSessionToken_sellerId_idx" ON "CrmSessionToken"("sellerId");

-- CreateIndex
CREATE INDEX "CrmSessionToken_expiresAt_idx" ON "CrmSessionToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "CrmSessionToken" ADD CONSTRAINT "CrmSessionToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSessionToken" ADD CONSTRAINT "CrmSessionToken_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSessionToken" ADD CONSTRAINT "CrmSessionToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
