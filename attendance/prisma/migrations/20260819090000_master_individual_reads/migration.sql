CREATE TABLE "ConversationMasterRead" (
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMasterRead_pkey"
    PRIMARY KEY ("userId", "conversationId")
);

CREATE INDEX "ConversationMasterRead_conversationId_idx"
ON "ConversationMasterRead"("conversationId");

ALTER TABLE "ConversationMasterRead"
ADD CONSTRAINT "ConversationMasterRead_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "ConversationMasterRead"
ADD CONSTRAINT "ConversationMasterRead_conversationId_fkey"
FOREIGN KEY ("conversationId")
REFERENCES "Conversation"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
