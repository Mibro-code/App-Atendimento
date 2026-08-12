-- Favoritos individuais por usuário.
CREATE TABLE "ConversationPin" (
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationPin_pkey" PRIMARY KEY ("userId", "conversationId")
);

-- Trilha de auditoria das ações realizadas no atendimento.
CREATE TABLE "ConversationActivity" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationPin_conversationId_idx" ON "ConversationPin"("conversationId");
CREATE INDEX "ConversationActivity_conversationId_createdAt_idx" ON "ConversationActivity"("conversationId", "createdAt");
CREATE INDEX "ConversationActivity_actorUserId_idx" ON "ConversationActivity"("actorUserId");

ALTER TABLE "ConversationPin" ADD CONSTRAINT "ConversationPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationPin" ADD CONSTRAINT "ConversationPin_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationActivity" ADD CONSTRAINT "ConversationActivity_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationActivity" ADD CONSTRAINT "ConversationActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
