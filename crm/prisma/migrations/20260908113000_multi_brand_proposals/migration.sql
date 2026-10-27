-- Clientes e usuários continuam compartilhados. A marca é registrada nas
-- sessões, propostas e pedidos externos para separar Mibro e Sincrofit.
CREATE TYPE "CommercialBrand" AS ENUM ('MIBRO', 'SINCROFIT');

ALTER TABLE "Quote"
  ADD COLUMN "brand" "CommercialBrand" NOT NULL DEFAULT 'MIBRO';

ALTER TABLE "CrmSessionToken"
  ADD COLUMN "brand" "CommercialBrand" NOT NULL DEFAULT 'MIBRO';

ALTER TABLE "OlistOrder"
  ADD COLUMN "brand" "CommercialBrand" NOT NULL DEFAULT 'MIBRO';

DROP INDEX "Quote_shopifyQuoteToken_key";
DROP INDEX "OlistOrder_olistOrderId_key";

CREATE UNIQUE INDEX "Quote_brand_shopifyQuoteToken_key"
  ON "Quote"("brand", "shopifyQuoteToken");
CREATE UNIQUE INDEX "OlistOrder_brand_olistOrderId_key"
  ON "OlistOrder"("brand", "olistOrderId");

CREATE INDEX "Quote_brand_idx" ON "Quote"("brand");
CREATE INDEX "CrmSessionToken_brand_idx" ON "CrmSessionToken"("brand");
CREATE INDEX "OlistOrder_brand_idx" ON "OlistOrder"("brand");
