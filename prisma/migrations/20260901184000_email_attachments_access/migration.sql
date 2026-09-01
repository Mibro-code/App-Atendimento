ALTER TABLE "Contact" ADD COLUMN "email" TEXT;
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

UPDATE "Contact"
SET "email" = split_part("externalId", ':', 2)
WHERE "channel" = 'EMAIL' AND "externalId" LIKE '%:%';

CREATE TABLE "ChannelAccountUserAccess" (
  "channelAccountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelAccountUserAccess_pkey" PRIMARY KEY ("channelAccountId", "userId")
);
CREATE INDEX "ChannelAccountUserAccess_userId_idx" ON "ChannelAccountUserAccess"("userId");
ALTER TABLE "ChannelAccountUserAccess" ADD CONSTRAINT "ChannelAccountUserAccess_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelAccountUserAccess" ADD CONSTRAINT "ChannelAccountUserAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
