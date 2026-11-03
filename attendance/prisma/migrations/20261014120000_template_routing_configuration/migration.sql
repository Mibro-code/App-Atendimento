-- Destino interno fixo por template WhatsApp (categoria/subcategoria).
-- Aditiva: só cria a tabela nova; nenhum dado existente é alterado.
CREATE TABLE "TemplateRoutingConfiguration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL,
    "metaTemplateId" TEXT,
    "metaCategory" TEXT,
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateRoutingConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TemplateRoutingConfiguration_companyId_wabaId_templateName__key" ON "TemplateRoutingConfiguration"("companyId", "wabaId", "templateName", "templateLanguage");
CREATE INDEX "TemplateRoutingConfiguration_companyId_wabaId_idx" ON "TemplateRoutingConfiguration"("companyId", "wabaId");
CREATE INDEX "TemplateRoutingConfiguration_categoryId_idx" ON "TemplateRoutingConfiguration"("categoryId");
CREATE INDEX "TemplateRoutingConfiguration_subcategoryId_idx" ON "TemplateRoutingConfiguration"("subcategoryId");

ALTER TABLE "TemplateRoutingConfiguration" ADD CONSTRAINT "TemplateRoutingConfiguration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TemplateRoutingConfiguration" ADD CONSTRAINT "TemplateRoutingConfiguration_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TemplateRoutingConfiguration" ADD CONSTRAINT "TemplateRoutingConfiguration_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TemplateRoutingConfiguration" ADD CONSTRAINT "TemplateRoutingConfiguration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
