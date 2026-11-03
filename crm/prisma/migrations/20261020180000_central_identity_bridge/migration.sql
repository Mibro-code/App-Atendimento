-- Additive only; credentials remain in their original application databases.
CREATE TABLE "CentralIdentityLink" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "attendanceUserId" TEXT NOT NULL,
  "primaryEmail" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false, "confirmation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CentralIdentityLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CentralIdentityLink_userId_key" ON "CentralIdentityLink"("userId");
CREATE UNIQUE INDEX "CentralIdentityLink_attendanceUserId_key" ON "CentralIdentityLink"("attendanceUserId");
CREATE UNIQUE INDEX "CentralIdentityLink_primaryEmail_key" ON "CentralIdentityLink"("primaryEmail");
ALTER TABLE "CentralIdentityLink" ADD CONSTRAINT "CentralIdentityLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
