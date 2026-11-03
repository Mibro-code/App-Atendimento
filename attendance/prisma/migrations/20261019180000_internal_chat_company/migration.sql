-- Chat interno por empresa (workspaces). Somente ADITIVA: nenhuma linha é
-- apagada, nenhuma mensagem/anexo/participante/leitura é alterado.
-- Reversão (se necessário, antes de existirem chats novos por empresa):
--   ALTER TABLE "InternalChat" DROP CONSTRAINT "InternalChat_companyId_fkey";
--   DROP INDEX "InternalChat_companyId_type_idx";
--   ALTER TABLE "InternalChat" DROP COLUMN "companyId", DROP COLUMN "description";
ALTER TABLE "InternalChat" ADD COLUMN "companyId" TEXT;
ALTER TABLE "InternalChat" ADD COLUMN "description" TEXT;

ALTER TABLE "InternalChat" ADD CONSTRAINT "InternalChat_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "InternalChat_companyId_type_idx" ON "InternalChat"("companyId", "type");

-- Única evidência determinística: chat de SETOR herda a empresa da categoria.
-- Geral, diretas e grupos antigos ficam com companyId nulo (ambíguos).
UPDATE "InternalChat" chat
SET "companyId" = category."companyId"
FROM "Category" category
WHERE chat.type = 'SECTOR' AND chat."categoryId" = category.id AND chat."companyId" IS NULL;
