-- Vínculo não destrutivo entre contatos de canais diferentes.
CREATE TABLE "ContactIdentity" (
  "id" TEXT NOT NULL,
  "displayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactIdentity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Contact" ADD COLUMN "identityId" TEXT;
ALTER TABLE "User" ADD COLUMN "canMergeContacts" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Contact_identityId_idx" ON "Contact"("identityId");
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "ContactIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
