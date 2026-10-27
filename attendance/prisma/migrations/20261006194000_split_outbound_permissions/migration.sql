ALTER TABLE "User" ADD COLUMN "canStartEmailConversations" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "canStartWhatsAppConversations" BOOLEAN NOT NULL DEFAULT false;
-- Preserva a autorização atual; a permissão antiga deixa de decidir o canal.
UPDATE "User" SET "canStartEmailConversations" = "canStartConversations",
 "canStartWhatsAppConversations" = "canStartConversations";
