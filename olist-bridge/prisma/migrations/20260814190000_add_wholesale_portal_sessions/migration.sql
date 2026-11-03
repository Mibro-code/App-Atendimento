CREATE TABLE "WholesalePortalSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesalePortalSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WholesalePortalSession_tokenHash_key"
ON "WholesalePortalSession"("tokenHash");

CREATE INDEX "WholesalePortalSession_customerId_idx"
ON "WholesalePortalSession"("customerId");

CREATE INDEX "WholesalePortalSession_expiresAt_idx"
ON "WholesalePortalSession"("expiresAt");

ALTER TABLE "WholesalePortalSession"
ADD CONSTRAINT "WholesalePortalSession_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "WholesaleCustomer"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
