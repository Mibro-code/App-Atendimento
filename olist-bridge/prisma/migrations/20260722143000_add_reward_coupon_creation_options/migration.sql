-- Registra as regras escolhidas para cupons de recompensa avulsos.
-- As colunas permanecem opcionais para nao atribuir valores incorretos
-- aos cupons criados antes desta funcionalidade.
ALTER TABLE "RewardCoupon"
ADD COLUMN "discountType" TEXT,
ADD COLUMN "discountValue" DOUBLE PRECISION,
ADD COLUMN "durationDays" INTEGER,
ADD COLUMN "couponName" TEXT,
ADD COLUMN "customerEligibility" TEXT,
ADD COLUMN "appliesOncePerCustomer" BOOLEAN;

