-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('PRIVATE_CONVERSATION', 'PUBLIC_QUESTION', 'REVIEW', 'COMPLAINT', 'EMAIL_THREAD');

-- CreateEnum
CREATE TYPE "ChannelAccountStatus" AS ENUM ('DISABLED', 'NOT_CONFIGURED', 'CONFIGURED', 'AUTH_PENDING', 'CONNECTED', 'DEGRADED', 'ERROR', 'NOT_SUPPORTED');

-- CreateEnum
CREATE TYPE "ExternalEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'ERROR');

-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "channels" "Channel"[] DEFAULT ARRAY[]::"Channel"[];

-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "phone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "channelAccountId" TEXT,
ADD COLUMN     "externalConversationId" TEXT,
ADD COLUMN     "kind" "ConversationKind" NOT NULL DEFAULT 'PRIVATE_CONVERSATION';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "channelAccountId" TEXT;

-- CreateTable
CREATE TABLE "ChannelAccount" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ChannelAccountStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "externalAccountId" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "encryptedSecrets" BYTEA,
    "encryptionIv" BYTEA,
    "encryptionAuthTag" BYTEA,
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelOAuthState" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "channelAccountId" TEXT,
    "state" TEXT NOT NULL,
    "redirectUri" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ChannelOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalChannelEvent" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "channelAccountId" TEXT,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" "ExternalEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorCode" TEXT,
    "payload" JSONB,

    CONSTRAINT "ExternalChannelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationGlobalSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "newChannelsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationGlobalSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelAccount_channel_enabled_idx" ON "ChannelAccount"("channel", "enabled");

-- CreateIndex
CREATE INDEX "ChannelAccount_status_idx" ON "ChannelAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAccount_channel_name_key" ON "ChannelAccount"("channel", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelOAuthState_state_key" ON "ChannelOAuthState"("state");

-- CreateIndex
CREATE INDEX "ChannelOAuthState_channel_createdAt_idx" ON "ChannelOAuthState"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalChannelEvent_channel_status_receivedAt_idx" ON "ExternalChannelEvent"("channel", "status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalChannelEvent_channel_externalEventId_key" ON "ExternalChannelEvent"("channel", "externalEventId");

-- CreateIndex
CREATE INDEX "Conversation_channelAccountId_idx" ON "Conversation"("channelAccountId");

-- CreateIndex
CREATE INDEX "Conversation_channel_externalConversationId_idx" ON "Conversation"("channel", "externalConversationId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelOAuthState" ADD CONSTRAINT "ChannelOAuthState_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalChannelEvent" ADD CONSTRAINT "ExternalChannelEvent_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
