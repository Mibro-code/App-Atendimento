-- CreateEnum
CREATE TYPE "CommercialFunction" AS ENUM ('GERENTE_COMERCIAL', 'FINANCEIRO');

-- CreateEnum
CREATE TYPE "ProposalCommercialStatus" AS ENUM ('RASCUNHO', 'AGUARDANDO_APROVACAO', 'APROVADA_INTERNAMENTE', 'REPROVADA_INTERNAMENTE', 'ENVIADA', 'EM_NEGOCIACAO', 'ACEITA', 'RECUSADA', 'EXPIRADA', 'CONVERSAO_SOLICITADA', 'CONVERTIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ProposalApprovalStatus" AS ENUM ('NAO_SOLICITADA', 'PENDENTE', 'APROVADA', 'REPROVADA', 'INVALIDADA');

-- CreateEnum
CREATE TYPE "ProposalAcceptanceStatus" AS ENUM ('PENDENTE', 'ACEITA', 'RECUSADA', 'ALTERACAO_SOLICITADA');

-- CreateEnum
CREATE TYPE "ProposalSyncStatus" AS ENUM ('NAO_SINCRONIZADA', 'PENDENTE', 'SINCRONIZANDO', 'SINCRONIZADA', 'ERRO', 'CONFLITO');

-- CreateEnum
CREATE TYPE "ProposalOrderStatus" AS ENUM ('SEM_PEDIDO', 'CONVERSAO_EM_ANDAMENTO', 'CONVERSAO_INCERTA', 'PEDIDO_CRIADO', 'PEDIDO_APROVADO', 'FATURADO', 'ENVIADO', 'ENTREGUE', 'NAO_ENTREGUE', 'EM_DEVOLUCAO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "ProposalFinancialStatus" AS ENUM ('NAO_APLICAVEL', 'SEM_COBRANCA', 'AGUARDANDO_PAGAMENTO', 'PAGAMENTO_PARCIAL', 'PAGAMENTO_CONFIRMADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "ProposalApprovalDecision" AS ENUM ('APROVADA', 'REPROVADA', 'AJUSTE_SOLICITADO');

-- CreateEnum
CREATE TYPE "ProposalAcceptanceDecision" AS ENUM ('ACEITA', 'RECUSADA', 'ALTERACAO_SOLICITADA');

-- CreateEnum
CREATE TYPE "ProposalDispatchChannel" AS ENUM ('EMAIL', 'OUTRO_CANAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OlistSyncAction" ADD VALUE IF NOT EXISTS 'PROPOSAL_CREATE';
ALTER TYPE "OlistSyncAction" ADD VALUE IF NOT EXISTS 'PROPOSAL_UPDATE';
ALTER TYPE "OlistSyncAction" ADD VALUE IF NOT EXISTS 'PROPOSAL_READ';
ALTER TYPE "OlistSyncAction" ADD VALUE IF NOT EXISTS 'PROPOSAL_CONVERT';
ALTER TYPE "OlistSyncAction" ADD VALUE IF NOT EXISTS 'PROPOSAL_SITUATION';
ALTER TYPE "OlistSyncAction" ADD VALUE IF NOT EXISTS 'ORDER_STATUS';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "commercialFunctions" "CommercialFunction"[] DEFAULT ARRAY[]::"CommercialFunction"[];

-- CreateTable
CREATE TABLE "CommercialProposal" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sourceQuoteId" TEXT,
    "brand" "CommercialBrand" NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT NOT NULL,
    "commercialStatus" "ProposalCommercialStatus" NOT NULL DEFAULT 'RASCUNHO',
    "approvalStatus" "ProposalApprovalStatus" NOT NULL DEFAULT 'NAO_SOLICITADA',
    "acceptanceStatus" "ProposalAcceptanceStatus" NOT NULL DEFAULT 'PENDENTE',
    "syncStatus" "ProposalSyncStatus" NOT NULL DEFAULT 'NAO_SINCRONIZADA',
    "orderStatus" "ProposalOrderStatus" NOT NULL DEFAULT 'SEM_PEDIDO',
    "financialStatus" "ProposalFinancialStatus" NOT NULL DEFAULT 'NAO_APLICAVEL',
    "validityDays" INTEGER,
    "validUntil" TIMESTAMP(3),
    "paymentType" TEXT,
    "paymentCondition" TEXT,
    "paymentText" TEXT,
    "freightCents" INTEGER NOT NULL DEFAULT 0,
    "freightResponsibility" TEXT,
    "deliveryTerm" TEXT,
    "customerNotes" TEXT,
    "internalNotes" TEXT,
    "discountJustification" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedVersion" INTEGER,
    "approvedHash" TEXT,
    "approvedAt" TIMESTAMP(3),
    "acceptedVersion" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "olistSellerId" TEXT,
    "olistContactId" TEXT,
    "olistProposalId" TEXT,
    "olistProposalNumber" TEXT,
    "olistSituation" TEXT,
    "olistSubtotalCents" INTEGER,
    "olistTotalCents" INTEGER,
    "olistSnapshotHash" TEXT,
    "syncedVersion" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncErrorCode" TEXT,
    "lastSyncError" TEXT,
    "conversionRequestedAt" TIMESTAMP(3),
    "conversionRequestedById" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedById" TEXT,
    "olistOrderId" TEXT,
    "olistOrderNumber" TEXT,
    "olistOrderSituation" TEXT,
    "orderLastSyncedAt" TIMESTAMP(3),
    "financialDueCents" INTEGER,
    "financialPaidCents" INTEGER,
    "financialOpenCents" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVersion" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "freightCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalApproval" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "decision" "ProposalApprovalDecision" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "discountBps" INTEGER NOT NULL,
    "reason" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalDispatch" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "channel" "ProposalDispatchChannel" NOT NULL,
    "recipient" TEXT,
    "description" TEXT,
    "succeeded" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "providerRef" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalAcceptance" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "decision" "ProposalAcceptanceDecision" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'REGISTRO_MANUAL',
    "channel" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "contactName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalEvent" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'CRM',
    "version" INTEGER,
    "actorId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerOlistLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brand" "CommercialBrand" NOT NULL,
    "olistSellerId" TEXT NOT NULL,
    "olistSellerName" TEXT NOT NULL,
    "olistSellerCode" TEXT,
    "olistSituation" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerOlistLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalDiscountLimit" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "brandKey" TEXT NOT NULL DEFAULT '*',
    "maxDiscountBps" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalDiscountLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialProposal_quoteId_key" ON "CommercialProposal"("quoteId");

-- CreateIndex
CREATE INDEX "CommercialProposal_sellerId_idx" ON "CommercialProposal"("sellerId");

-- CreateIndex
CREATE INDEX "CommercialProposal_customerId_idx" ON "CommercialProposal"("customerId");

-- CreateIndex
CREATE INDEX "CommercialProposal_commercialStatus_idx" ON "CommercialProposal"("commercialStatus");

-- CreateIndex
CREATE INDEX "CommercialProposal_approvalStatus_idx" ON "CommercialProposal"("approvalStatus");

-- CreateIndex
CREATE INDEX "CommercialProposal_syncStatus_idx" ON "CommercialProposal"("syncStatus");

-- CreateIndex
CREATE INDEX "CommercialProposal_orderStatus_idx" ON "CommercialProposal"("orderStatus");

-- CreateIndex
CREATE INDEX "CommercialProposal_validUntil_idx" ON "CommercialProposal"("validUntil");

-- CreateIndex
CREATE INDEX "CommercialProposal_createdAt_idx" ON "CommercialProposal"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialProposal_brand_olistProposalId_key" ON "CommercialProposal"("brand", "olistProposalId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialProposal_brand_olistOrderId_key" ON "CommercialProposal"("brand", "olistOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalVersion_proposalId_version_key" ON "ProposalVersion"("proposalId", "version");

-- CreateIndex
CREATE INDEX "ProposalApproval_proposalId_createdAt_idx" ON "ProposalApproval"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "ProposalDispatch_proposalId_createdAt_idx" ON "ProposalDispatch"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "ProposalAcceptance_proposalId_createdAt_idx" ON "ProposalAcceptance"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "ProposalEvent_proposalId_createdAt_idx" ON "ProposalEvent"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "ProposalEvent_type_idx" ON "ProposalEvent"("type");

-- CreateIndex
CREATE UNIQUE INDEX "SellerOlistLink_userId_brand_key" ON "SellerOlistLink"("userId", "brand");

-- CreateIndex
CREATE UNIQUE INDEX "SellerOlistLink_brand_olistSellerId_key" ON "SellerOlistLink"("brand", "olistSellerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalDiscountLimit_scopeKey_brandKey_key" ON "ProposalDiscountLimit"("scopeKey", "brandKey");

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalApproval" ADD CONSTRAINT "ProposalApproval_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalDispatch" ADD CONSTRAINT "ProposalDispatch_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalAcceptance" ADD CONSTRAINT "ProposalAcceptance_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalEvent" ADD CONSTRAINT "ProposalEvent_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOlistLink" ADD CONSTRAINT "SellerOlistLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Uma única proposta ativa (não cancelada) por simulação de origem.
CREATE UNIQUE INDEX "CommercialProposal_active_source_key" ON "CommercialProposal"("sourceQuoteId") WHERE "sourceQuoteId" IS NOT NULL AND "commercialStatus" <> 'CANCELADA';

-- Integridade de valores.
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_values_check" CHECK ("version" >= 1 AND "freightCents" >= 0 AND ("validityDays" IS NULL OR "validityDays" BETWEEN 1 AND 365));
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_values_check" CHECK ("version" >= 1 AND "subtotalCents" >= 0 AND "discountCents" >= 0 AND "freightCents" >= 0 AND "totalCents" >= 0);
ALTER TABLE "ProposalDiscountLimit" ADD CONSTRAINT "ProposalDiscountLimit_bps_check" CHECK ("maxDiscountBps" BETWEEN 0 AND 10000);
