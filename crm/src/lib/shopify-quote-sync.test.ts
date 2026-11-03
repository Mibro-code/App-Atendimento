import { describe, expect, it } from "vitest";
import { quoteStatusForSync, shopifyQuoteSyncSchema } from "./shopify-quote-sync";

const validPayload = {
  event: "CALCULATED",
  customerId: "customer-1",
  sellerId: "seller-1",
  quoteToken: "quote-token-1234567890",
  valueCents: 12345,
  totalQuantity: 2,
  products: [
    {
      sku: "SKU-1",
      name: "Produto",
      quantity: 2,
      unitPriceCents: 6172,
      subtotalCents: 12344,
    },
  ],
};

describe("shopifyQuoteSyncSchema", () => {
  it("aceita uma cotação calculada válida", () => {
    expect(shopifyQuoteSyncSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejeita token curto e valor negativo", () => {
    const result = shopifyQuoteSyncSchema.safeParse({
      ...validPayload,
      quoteToken: "curto",
      valueCents: -1,
    });
    expect(result.success).toBe(false);
  });

  it("assume mode REAL por padrão quando não informado (compatibilidade)", () => {
    const result = shopifyQuoteSyncSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mode).toBe("REAL");
  });

  it("aceita mode SIMULATION e evento SENT explícitos", () => {
    const result = shopifyQuoteSyncSchema.safeParse({
      ...validPayload,
      event: "SENT",
      mode: "SIMULATION",
      sentToEmail: "cliente@example.com",
    });
    expect(result.success).toBe(true);
  });
});

describe("quoteStatusForSync", () => {
  it("avança de cálculo para análise", () => {
    expect(quoteStatusForSync(null, "CALCULATED")).toBe("CALCULADA");
    expect(quoteStatusForSync("CALCULADA", "READY_FOR_REVIEW")).toBe(
      "ENVIADA_PARA_ANALISE"
    );
  });

  it("não rebaixa uma cotação já enviada para análise", () => {
    expect(quoteStatusForSync("ENVIADA_PARA_ANALISE", "CALCULATED")).toBe(
      "ENVIADA_PARA_ANALISE"
    );
  });

  it("marca ENVIADA no evento SENT", () => {
    expect(quoteStatusForSync("CALCULADA", "SENT")).toBe("ENVIADA");
  });

  it("não rebaixa uma proposta enviada quando chega um recálculo tardio", () => {
    expect(quoteStatusForSync("ENVIADA", "CALCULATED")).toBe("ENVIADA");
  });

  it("nunca reabre uma cotação convertida ou cancelada", () => {
    expect(quoteStatusForSync("CONVERTIDA", "CALCULATED")).toBe("CONVERTIDA");
    expect(quoteStatusForSync("CANCELADA", "READY_FOR_REVIEW")).toBe("CANCELADA");
  });
});
