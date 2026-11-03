-- Guarda estados temporarios para impedir falsificacao e replay no OAuth.
CREATE TABLE "OlistOAuthState" (
  "state" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OlistOAuthState_pkey" PRIMARY KEY ("state")
);

CREATE INDEX "OlistOAuthState_expiresAt_idx"
ON "OlistOAuthState"("expiresAt");

CREATE INDEX "OlistOAuthState_shop_idx"
ON "OlistOAuthState"("shop");

-- Os tokens sao cifrados pela aplicacao antes de chegar ao PostgreSQL.
CREATE TABLE "OlistConnection" (
  "shop" TEXT NOT NULL,
  "accessTokenCiphertext" TEXT NOT NULL,
  "refreshTokenCiphertext" TEXT NOT NULL,
  "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
  "scope" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OlistConnection_pkey" PRIMARY KEY ("shop")
);
