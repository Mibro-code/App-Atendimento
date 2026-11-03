-- Registra a cotacao e o ID do pedido Olist para impedir pedidos duplicados.
CREATE TABLE "WholesaleQuote" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "publicToken" TEXT NOT NULL,
  "cnpj" TEXT NOT NULL,
  "olistOrderId" TEXT,
  "olistOrderNumber" TEXT,
  "identityHash" TEXT,
  "payloadHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "processingStartedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "calculatedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WholesaleQuote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WholesaleQuote_publicToken_key"
  ON "WholesaleQuote"("publicToken");

CREATE UNIQUE INDEX "WholesaleQuote_shop_olistOrderId_key"
  ON "WholesaleQuote"("shop", "olistOrderId");

CREATE INDEX "WholesaleQuote_shop_cnpj_idx"
  ON "WholesaleQuote"("shop", "cnpj");

CREATE INDEX "WholesaleQuote_olistOrderId_idx"
  ON "WholesaleQuote"("olistOrderId");
