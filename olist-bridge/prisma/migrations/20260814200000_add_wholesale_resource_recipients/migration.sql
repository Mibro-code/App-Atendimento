-- CreateTable
CREATE TABLE "WholesaleResourceRecipient" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesaleResourceRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleResourceRecipient_resourceId_customerId_key"
ON "WholesaleResourceRecipient"("resourceId", "customerId");

-- CreateIndex
CREATE INDEX "WholesaleResourceRecipient_customerId_idx"
ON "WholesaleResourceRecipient"("customerId");

-- AddForeignKey
ALTER TABLE "WholesaleResourceRecipient"
ADD CONSTRAINT "WholesaleResourceRecipient_resourceId_fkey"
FOREIGN KEY ("resourceId") REFERENCES "WholesaleResource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleResourceRecipient"
ADD CONSTRAINT "WholesaleResourceRecipient_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "WholesaleCustomer"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
