-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SUPERVISOR', 'VENDEDOR');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('NOVO', 'CONTATO_REALIZADO', 'EM_NEGOCIACAO', 'COTACAO_ENVIADA', 'AGUARDANDO_RETORNO', 'AGUARDANDO_PAGAMENTO', 'CLIENTE_ATIVO', 'SEM_INTERESSE', 'VENDA_PERDIDA', 'INATIVO');

-- CreateEnum
CREATE TYPE "Temperature" AS ENUM ('QUENTE', 'MORNO', 'FRIO', 'SEM_CLASSIFICACAO');

-- CreateEnum
CREATE TYPE "StatusHistoryField" AS ENUM ('STATUS', 'TEMPERATURE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('WHATSAPP', 'TELEFONE', 'EMAIL', 'VISITA', 'REUNIAO', 'ANOTACAO', 'COTACAO', 'PEDIDO', 'PAGAMENTO', 'VENDA', 'CANCELAMENTO', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDENTE', 'CONCLUIDO', 'ADIADO');

-- CreateEnum
CREATE TYPE "FollowUpSource" AS ENUM ('AUTOMATICO_30_DIAS', 'MANUAL');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('ABERTA', 'CALCULADA', 'ENVIADA_PARA_ANALISE', 'CANCELADA');

-- CreateEnum
CREATE TYPE "SaleStage" AS ENUM ('COTACAO', 'PEDIDO_CRIADO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_PAGAMENTO', 'PAGAMENTO_CONFIRMADO', 'EM_PREPARACAO', 'ENVIADO', 'ENTREGUE', 'CANCELADO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'VENDEDOR',
    "jobTitle" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl" TEXT,
    "passwordHash" TEXT NOT NULL,
    "monthlyGoalCents" INTEGER,
    "region" TEXT,
    "internalNotes" TEXT,
    "supervisorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "legalName" TEXT,
    "tradeName" TEXT,
    "cnpjDigits" TEXT,
    "cpfDigits" TEXT,
    "email" TEXT,
    "phoneDigits" TEXT,
    "addressStreet" TEXT,
    "addressNumber" TEXT,
    "addressDistrict" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipDigits" TEXT,
    "sellerId" TEXT NOT NULL,
    "leadOrigin" TEXT,
    "notes" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'NOVO',
    "temperature" "Temperature" NOT NULL DEFAULT 'SEM_CLASSIFICACAO',
    "lastInteractionAt" TIMESTAMP(3),
    "nextInteractionAt" TIMESTAMP(3),
    "lastSaleAt" TIMESTAMP(3),
    "totalSoldCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#FF6633',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerStatusHistory" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "field" "StatusHistoryField" NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerActivity" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "description" TEXT NOT NULL,
    "nextActionAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDENTE',
    "source" "FollowUpSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "shopifyQuoteToken" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'ABERTA',
    "totalValueCents" INTEGER,
    "productsSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OlistOrder" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quoteId" TEXT,
    "olistOrderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "valueCents" INTEGER NOT NULL,
    "olistStatusRaw" TEXT,
    "crmStatus" TEXT NOT NULL DEFAULT 'PEDIDO_CRIADO',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OlistOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OlistStatusHistory" (
    "id" TEXT NOT NULL,
    "olistOrderId" TEXT NOT NULL,
    "olistStatusRaw" TEXT,
    "crmStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OlistStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "olistOrderId" TEXT,
    "stage" "SaleStage" NOT NULL DEFAULT 'COTACAO',
    "valueCents" INTEGER NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CustomerTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CustomerTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_supervisorId_idx" ON "User"("supervisorId");

-- CreateIndex
CREATE INDEX "Customer_cnpjDigits_idx" ON "Customer"("cnpjDigits");

-- CreateIndex
CREATE INDEX "Customer_cpfDigits_idx" ON "Customer"("cpfDigits");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "Customer_phoneDigits_idx" ON "Customer"("phoneDigits");

-- CreateIndex
CREATE INDEX "Customer_sellerId_idx" ON "Customer"("sellerId");

-- CreateIndex
CREATE INDEX "Customer_status_idx" ON "Customer"("status");

-- CreateIndex
CREATE INDEX "Customer_temperature_idx" ON "Customer"("temperature");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "CustomerStatusHistory_customerId_createdAt_idx" ON "CustomerStatusHistory"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerActivity_customerId_createdAt_idx" ON "CustomerActivity"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerActivity_sellerId_createdAt_idx" ON "CustomerActivity"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerActivity_type_idx" ON "CustomerActivity"("type");

-- CreateIndex
CREATE INDEX "FollowUp_sellerId_status_dueAt_idx" ON "FollowUp"("sellerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_customerId_status_idx" ON "FollowUp"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_shopifyQuoteToken_key" ON "Quote"("shopifyQuoteToken");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX "Quote_sellerId_idx" ON "Quote"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "OlistOrder_quoteId_key" ON "OlistOrder"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "OlistOrder_olistOrderId_key" ON "OlistOrder"("olistOrderId");

-- CreateIndex
CREATE INDEX "OlistOrder_customerId_idx" ON "OlistOrder"("customerId");

-- CreateIndex
CREATE INDEX "OlistOrder_crmStatus_idx" ON "OlistOrder"("crmStatus");

-- CreateIndex
CREATE INDEX "OlistStatusHistory_olistOrderId_createdAt_idx" ON "OlistStatusHistory"("olistOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_olistOrderId_key" ON "Sale"("olistOrderId");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex
CREATE INDEX "Sale_sellerId_idx" ON "Sale"("sellerId");

-- CreateIndex
CREATE INDEX "Sale_stage_idx" ON "Sale"("stage");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "_CustomerTags_B_index" ON "_CustomerTags"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerStatusHistory" ADD CONSTRAINT "CustomerStatusHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerStatusHistory" ADD CONSTRAINT "CustomerStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OlistOrder" ADD CONSTRAINT "OlistOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OlistOrder" ADD CONSTRAINT "OlistOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OlistStatusHistory" ADD CONSTRAINT "OlistStatusHistory_olistOrderId_fkey" FOREIGN KEY ("olistOrderId") REFERENCES "OlistOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_olistOrderId_fkey" FOREIGN KEY ("olistOrderId") REFERENCES "OlistOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CustomerTags" ADD CONSTRAINT "_CustomerTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CustomerTags" ADD CONSTRAINT "_CustomerTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
