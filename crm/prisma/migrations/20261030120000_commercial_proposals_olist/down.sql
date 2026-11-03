-- Reversão MANUAL de 20261030120000_commercial_proposals_olist.
-- Executar somente após backup e com o módulo desativado. Remove apenas os
-- objetos novos. Os valores adicionados a "OlistSyncAction" permanecem
-- (o PostgreSQL não remove valores de enum sem recriar o tipo, e as
-- tentativas registradas continuam válidas). Depois, apagar a linha desta
-- migration em "_prisma_migrations".


DROP INDEX IF EXISTS "CommercialProposal_active_source_key";

-- DropForeignKey
ALTER TABLE "CommercialProposal" DROP CONSTRAINT "CommercialProposal_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "CommercialProposal" DROP CONSTRAINT "CommercialProposal_customerId_fkey";

-- DropForeignKey
ALTER TABLE "CommercialProposal" DROP CONSTRAINT "CommercialProposal_sellerId_fkey";

-- DropForeignKey
ALTER TABLE "ProposalVersion" DROP CONSTRAINT "ProposalVersion_proposalId_fkey";

-- DropForeignKey
ALTER TABLE "ProposalApproval" DROP CONSTRAINT "ProposalApproval_proposalId_fkey";

-- DropForeignKey
ALTER TABLE "ProposalDispatch" DROP CONSTRAINT "ProposalDispatch_proposalId_fkey";

-- DropForeignKey
ALTER TABLE "ProposalAcceptance" DROP CONSTRAINT "ProposalAcceptance_proposalId_fkey";

-- DropForeignKey
ALTER TABLE "ProposalEvent" DROP CONSTRAINT "ProposalEvent_proposalId_fkey";

-- DropForeignKey
ALTER TABLE "SellerOlistLink" DROP CONSTRAINT "SellerOlistLink_userId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "commercialFunctions";

-- DropTable
DROP TABLE "CommercialProposal";

-- DropTable
DROP TABLE "ProposalVersion";

-- DropTable
DROP TABLE "ProposalApproval";

-- DropTable
DROP TABLE "ProposalDispatch";

-- DropTable
DROP TABLE "ProposalAcceptance";

-- DropTable
DROP TABLE "ProposalEvent";

-- DropTable
DROP TABLE "SellerOlistLink";

-- DropTable
DROP TABLE "ProposalDiscountLimit";

-- DropEnum
DROP TYPE "CommercialFunction";

-- DropEnum
DROP TYPE "ProposalCommercialStatus";

-- DropEnum
DROP TYPE "ProposalApprovalStatus";

-- DropEnum
DROP TYPE "ProposalAcceptanceStatus";

-- DropEnum
DROP TYPE "ProposalSyncStatus";

-- DropEnum
DROP TYPE "ProposalOrderStatus";

-- DropEnum
DROP TYPE "ProposalFinancialStatus";

-- DropEnum
DROP TYPE "ProposalApprovalDecision";

-- DropEnum
DROP TYPE "ProposalAcceptanceDecision";

-- DropEnum
DROP TYPE "ProposalDispatchChannel";

