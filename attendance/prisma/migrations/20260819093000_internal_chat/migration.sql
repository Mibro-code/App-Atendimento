CREATE TYPE "InternalChatType" AS ENUM (
  'GENERAL',
  'SECTOR',
  'DIRECT'
);

CREATE TYPE "InternalMessageType" AS ENUM (
  'USER',
  'TRANSFER',
  'SYSTEM'
);

CREATE TABLE "InternalChat" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "type" "InternalChatType" NOT NULL,
  "name" TEXT,
  "categoryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InternalChat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalChatMember" (
  "chatId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InternalChatMember_pkey"
  PRIMARY KEY ("chatId", "userId")
);

CREATE TABLE "InternalMessage" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "senderUserId" TEXT,
  "type" "InternalMessageType" NOT NULL DEFAULT 'USER',
  "text" TEXT,
  "conversationId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InternalMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InternalChat_key_key"
ON "InternalChat"("key");

CREATE INDEX "InternalChat_type_idx"
ON "InternalChat"("type");

CREATE INDEX "InternalChat_categoryId_idx"
ON "InternalChat"("categoryId");

CREATE INDEX "InternalChatMember_userId_idx"
ON "InternalChatMember"("userId");

CREATE INDEX "InternalMessage_chatId_createdAt_idx"
ON "InternalMessage"("chatId", "createdAt");

CREATE INDEX "InternalMessage_senderUserId_idx"
ON "InternalMessage"("senderUserId");

CREATE INDEX "InternalMessage_conversationId_idx"
ON "InternalMessage"("conversationId");

ALTER TABLE "InternalChat"
ADD CONSTRAINT "InternalChat_categoryId_fkey"
FOREIGN KEY ("categoryId")
REFERENCES "Category"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "InternalChatMember"
ADD CONSTRAINT "InternalChatMember_chatId_fkey"
FOREIGN KEY ("chatId")
REFERENCES "InternalChat"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "InternalChatMember"
ADD CONSTRAINT "InternalChatMember_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "InternalMessage"
ADD CONSTRAINT "InternalMessage_chatId_fkey"
FOREIGN KEY ("chatId")
REFERENCES "InternalChat"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "InternalMessage"
ADD CONSTRAINT "InternalMessage_senderUserId_fkey"
FOREIGN KEY ("senderUserId")
REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "InternalMessage"
ADD CONSTRAINT "InternalMessage_conversationId_fkey"
FOREIGN KEY ("conversationId")
REFERENCES "Conversation"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
