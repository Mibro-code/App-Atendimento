-- Funil comercial persistido, tentativas de contato, ciclos, RCA, tipo/regiões
-- de representante e comissão por tipo/pedido. Migration puramente aditiva:
-- nenhuma coluna/tabela é removida e nenhum dado existente é apagado.

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('NOVO', 'EM_ATENDIMENTO', 'FOLLOW_UP', 'COTACAO', 'VENDIDO', 'RECICLAGEM', 'INATIVO');

-- CreateEnum
CREATE TYPE "CommissionSource" AS ENUM ('DEFAULT', 'CUSTOM_ORDER');

-- CreateEnum
CREATE TYPE "RepresentativeType" AS ENUM ('ATACADO', 'VAREJO', 'OUTRO');

-- AlterEnum
ALTER TYPE "StatusHistoryField" ADD VALUE 'PIPELINE_STAGE';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "addressComplement" TEXT,
ADD COLUMN     "commercialCycle" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "cycleContactAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastContactAttemptAt" TIMESTAMP(3),
ADD COLUMN     "pipelineStage" "PipelineStage" NOT NULL DEFAULT 'NOVO',
ADD COLUMN     "pipelineStageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "stageReason" TEXT,
ADD COLUMN     "stageReturnAt" TIMESTAMP(3),
ADD COLUMN     "stageReturnTo" "PipelineStage";

-- AlterTable
ALTER TABLE "CustomerActivity" ADD COLUMN     "commercialCycle" INTEGER,
ADD COLUMN     "isContactAttempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pipelineStage" "PipelineStage";

-- AlterTable
ALTER TABLE "CustomerStatusHistory" ADD COLUMN     "changedByRca" TEXT,
ADD COLUMN     "commercialCycle" INTEGER,
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "commissionCents" INTEGER,
ADD COLUMN     "commissionRateBps" INTEGER,
ADD COLUMN     "commissionSetAt" TIMESTAMP(3),
ADD COLUMN     "commissionSetById" TEXT,
ADD COLUMN     "commissionSource" "CommissionSource";

-- AlterTable
ALTER TABLE "SellerProfile" ADD COLUMN     "representativeType" "RepresentativeType";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "rca" TEXT;

-- CreateTable
CREATE TABLE "RepresentativeTypeCommission" (
    "type" "RepresentativeType" NOT NULL,
    "rateBps" INTEGER,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepresentativeTypeCommission_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "RepresentativeRegion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepresentativeRegion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepresentativeRegion_state_city_idx" ON "RepresentativeRegion"("state", "city");

-- CreateIndex
CREATE UNIQUE INDEX "RepresentativeRegion_userId_state_city_key" ON "RepresentativeRegion"("userId", "state", "city");

-- CreateIndex
CREATE INDEX "Customer_sellerId_pipelineStage_idx" ON "Customer"("sellerId", "pipelineStage");

-- CreateIndex
CREATE INDEX "Customer_pipelineStage_stageReturnAt_idx" ON "Customer"("pipelineStage", "stageReturnAt");

-- CreateIndex
CREATE INDEX "Customer_cycleContactAttempts_idx" ON "Customer"("cycleContactAttempts");

-- CreateIndex
CREATE UNIQUE INDEX "User_rca_key" ON "User"("rca");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_commissionSetById_fkey" FOREIGN KEY ("commissionSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepresentativeTypeCommission" ADD CONSTRAINT "RepresentativeTypeCommission_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepresentativeRegion" ADD CONSTRAINT "RepresentativeRegion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill: etapa inicial do funil para clientes existentes, a partir dos
-- mesmos sinais que a tela usava para calcular o funil. Só preenche as novas
-- colunas; status, histórico, atividades e vendas não são alterados.
-- ---------------------------------------------------------------------------
WITH last_sale AS (
  SELECT "customerId", MAX("confirmedAt") AS confirmed_at
  FROM "Sale"
  WHERE "stage" = 'PAGAMENTO_CONFIRMADO' AND "confirmedAt" IS NOT NULL
  GROUP BY "customerId"
),
classified AS (
  SELECT
    c."id",
    ls.confirmed_at,
    CASE
      WHEN c."status" IN ('INATIVO', 'SEM_INTERESSE') THEN 'INATIVO'
      WHEN c."status" = 'VENDA_PERDIDA' THEN 'RECICLAGEM'
      WHEN ls.confirmed_at IS NOT NULL
        AND ls.confirmed_at + make_interval(days => GREATEST(1, u."followUpAfterDays")) > NOW() THEN 'VENDIDO'
      WHEN ls.confirmed_at IS NOT NULL THEN 'NOVO'
      WHEN c."status" IN ('COTACAO_ENVIADA', 'AGUARDANDO_PAGAMENTO')
        OR EXISTS (
          SELECT 1 FROM "Quote" q
          WHERE q."customerId" = c."id" AND q."status" IN ('CALCULADA', 'ENVIADA', 'ENVIADA_PARA_ANALISE')
        ) THEN 'COTACAO'
      WHEN c."status" = 'AGUARDANDO_RETORNO'
        OR EXISTS (
          SELECT 1 FROM "FollowUp" f
          WHERE f."customerId" = c."id" AND f."source" = 'MANUAL' AND f."status" IN ('PENDENTE', 'ADIADO')
        ) THEN 'FOLLOW_UP'
      WHEN c."status" <> 'NOVO'
        OR EXISTS (SELECT 1 FROM "CustomerActivity" a WHERE a."customerId" = c."id")
        OR EXISTS (SELECT 1 FROM "Quote" q WHERE q."customerId" = c."id") THEN 'EM_ATENDIMENTO'
      ELSE 'NOVO'
    END AS stage
  FROM "Customer" c
  JOIN "User" u ON u."id" = c."sellerId"
  LEFT JOIN last_sale ls ON ls."customerId" = c."id"
)
UPDATE "Customer" c
SET
  "pipelineStage" = classified.stage::"PipelineStage",
  "pipelineStageChangedAt" = CASE WHEN classified.stage = 'VENDIDO' THEN classified.confirmed_at ELSE NOW() END,
  -- Cliente que já comprou e voltou como recompra inicia o 2º ciclo.
  "commercialCycle" = CASE WHEN classified.stage = 'NOVO' AND classified.confirmed_at IS NOT NULL THEN 2 ELSE 1 END,
  "stageReason" = CASE
    WHEN c."status" = 'SEM_INTERESSE' THEN 'Sem interesse'
    WHEN c."status" = 'INATIVO' THEN 'Marcado como inativo antes do novo funil'
    WHEN c."status" = 'VENDA_PERDIDA' THEN 'Venda perdida'
    ELSE NULL
  END
FROM classified
WHERE classified."id" = c."id";

-- ---------------------------------------------------------------------------
-- Backfill: RCA sequencial de 3 dígitos por ordem de criação. Usuários com
-- exclusão lógica também recebem, para que o código nunca seja reaproveitado.
-- ---------------------------------------------------------------------------
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n
  FROM "User"
  WHERE "rca" IS NULL
)
UPDATE "User" u
SET "rca" = LPAD(numbered.n::text, 3, '0')
FROM numbered
WHERE numbered."id" = u."id";

-- ---------------------------------------------------------------------------
-- Comissão padrão por tipo de representante. Varejo = 5%. Atacado e Outro
-- ficam sem percentual (nulo) até a política comercial ser definida.
-- ---------------------------------------------------------------------------
INSERT INTO "RepresentativeTypeCommission" ("type", "rateBps", "updatedAt") VALUES
  ('VAREJO', 500, NOW()),
  ('ATACADO', NULL, NOW()),
  ('OUTRO', NULL, NOW())
ON CONFLICT ("type") DO NOTHING;
