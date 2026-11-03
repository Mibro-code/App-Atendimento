-- Mantem a calculadora em modo seguro ate que um administrador libere pedidos.
CREATE TABLE "WholesaleSettings" (
  "shop" TEXT NOT NULL,
  "testModeEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WholesaleSettings_pkey" PRIMARY KEY ("shop")
);
