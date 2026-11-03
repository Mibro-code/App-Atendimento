-- Additive only. No existing users, passwords, messages or IDs are modified.
CREATE TABLE "CentralCrmIdentity" (
  "id" TEXT NOT NULL, "attendanceUserId" TEXT NOT NULL, "crmUserId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false, "confirmation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CentralCrmIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CentralCrmIdentity_attendanceUserId_key" ON "CentralCrmIdentity"("attendanceUserId");
CREATE UNIQUE INDEX "CentralCrmIdentity_crmUserId_key" ON "CentralCrmIdentity"("crmUserId");
ALTER TABLE "CentralCrmIdentity" ADD CONSTRAINT "CentralCrmIdentity_attendanceUserId_fkey" FOREIGN KEY ("attendanceUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "CentralIdentityGrant" (
  "codeHash" TEXT NOT NULL, "audience" TEXT NOT NULL, "attendanceUserId" TEXT,
  "crmUserId" TEXT NOT NULL, "sessionVersion" INTEGER, "pkceChallenge" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CentralIdentityGrant_pkey" PRIMARY KEY ("codeHash")
);
CREATE INDEX "CentralIdentityGrant_expiresAt_idx" ON "CentralIdentityGrant"("expiresAt");
CREATE TABLE "CentralIdentityNonce" (
  "id" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CentralIdentityNonce_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CentralIdentityNonce_expiresAt_idx" ON "CentralIdentityNonce"("expiresAt");
