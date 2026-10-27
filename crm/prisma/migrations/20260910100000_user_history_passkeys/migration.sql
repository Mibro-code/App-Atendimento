ALTER TABLE "User"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "webAuthnChallenge" TEXT,
ADD COLUMN "webAuthnChallengePurpose" TEXT,
ADD COLUMN "webAuthnChallengeExpiresAt" TIMESTAMP(3);

CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

CREATE TABLE "PasskeyCredential" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "publicKey" BYTEA NOT NULL,
  "counter" BIGINT NOT NULL DEFAULT 0,
  "transports" TEXT[] NOT NULL,
  "deviceType" TEXT,
  "backedUp" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "PasskeyCredential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PasskeyCredential_userId_idx" ON "PasskeyCredential"("userId");

ALTER TABLE "PasskeyCredential"
ADD CONSTRAINT "PasskeyCredential_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
