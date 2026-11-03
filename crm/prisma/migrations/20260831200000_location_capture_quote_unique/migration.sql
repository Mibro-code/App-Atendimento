-- Localização da proposta: garante que a mesma proposta+origem nunca gera
-- mais de um LocationCapture (idempotência em reenvios do Shopify). Não cria
-- model nova — LocationCapture já cobre exatamente os campos pedidos
-- (sellerId, customerId, quoteId, latitude/longitude/accuracyMeters/
-- capturedAt, locationStatus, locationSource já incluem PROPOSAL_STARTED/
-- PROPOSAL_SENT desde a Fase 1). Múltiplos NULLs em quoteId continuam
-- permitidos (comportamento padrão de UNIQUE com NULL no Postgres).
CREATE UNIQUE INDEX "LocationCapture_quoteId_locationSource_key" ON "LocationCapture"("quoteId", "locationSource");
