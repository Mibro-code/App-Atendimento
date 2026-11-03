import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveWholesalePrice,
  WholesalePricingError,
} from "../app/services/wholesale-pricing.server.js";
import {
  allocateCommercialItemPrices,
  calculateCommercialTotals,
  findOlistOrderItemPriceMismatch,
} from "../app/services/wholesale-order-values.server.js";

function resolve(overrides = {}) {
  return resolveWholesalePrice({
    brand: "mibro",
    sku: "C4-BLACK",
    quantity: 10,
    automaticQuantity: 10,
    selectedTier: "auto",
    manualTierApplied: false,
    frontendUnitPrice: 27000,
    minimumQuantity: 10,
    ...overrides,
  });
}

test("automático usa tier1 entre 10 e 49 unidades", () => {
  assert.equal(resolve().unitPriceCents, 27000);
  assert.equal(resolve().appliedTier, "tier1");
});

test("automático usa tier2 entre 50 e 99 unidades", () => {
  const result = resolve({ automaticQuantity: 60, frontendUnitPrice: 1 });
  assert.equal(result.unitPriceCents, 25000);
  assert.equal(result.appliedTier, "tier2");
});

test("automático usa tier3 a partir de 100 unidades", () => {
  const result = resolve({ automaticQuantity: 100, frontendUnitPrice: 1 });
  assert.equal(result.unitPriceCents, 23500);
  assert.equal(result.appliedTier, "tier3");
});

test("manual permite tier3 com 10 unidades", () => {
  const result = resolve({
    selectedTier: "tier3",
    manualTierApplied: true,
    frontendUnitPrice: 23500,
  });
  assert.equal(result.unitPriceCents, 23500);
  assert.equal(result.automaticTier, "tier1");
  assert.equal(result.manualOverride, true);
});

test("manual permite tier2 com 10 unidades", () => {
  assert.equal(
    resolve({
      selectedTier: "tier2",
      manualTierApplied: true,
      frontendUnitPrice: 25000,
    }).unitPriceCents,
    25000,
  );
});

test("manual permite tier1 com 80 unidades", () => {
  const result = resolve({
    quantity: 80,
    automaticQuantity: 80,
    selectedTier: "tier1",
    manualTierApplied: true,
    frontendUnitPrice: 27000,
  });
  assert.equal(result.unitPriceCents, 27000);
  assert.equal(result.automaticTier, "tier2");
});

test("preço adulterado em faixa manual é recusado", () => {
  assert.throws(
    () =>
      resolve({
        selectedTier: "tier3",
        manualTierApplied: true,
        frontendUnitPrice: 1,
      }),
    (error) =>
      error instanceof WholesalePricingError &&
      error.code === "WHOLESALE_PRICE_MISMATCH",
  );
});

test("Sincrofit recusa tier3 não configurada", () => {
  assert.throws(
    () =>
      resolveWholesalePrice({
        brand: "sincrofit",
        sku: "TITAN-PRO-PRETO",
        quantity: 10,
        automaticQuantity: 10,
        selectedTier: "tier3",
        manualTierApplied: true,
        frontendUnitPrice: 1,
      }),
    (error) =>
      error instanceof WholesalePricingError &&
      error.code === "PRICE_TIER_NOT_CONFIGURED",
  );
});

test("retornar para automático remove a sobrescrita manual", () => {
  const result = resolve({
    selectedTier: "auto",
    manualTierApplied: false,
    automaticQuantity: 60,
    frontendUnitPrice: 27000,
  });
  assert.equal(result.appliedTier, "tier2");
  assert.equal(result.manualOverride, false);
});

test("catálogos Mibro e Sincrofit permanecem separados", () => {
  assert.throws(
    () =>
      resolveWholesalePrice({
        brand: "sincrofit",
        sku: "C4-BLACK",
        quantity: 10,
        automaticQuantity: 10,
        selectedTier: "tier1",
        manualTierApplied: true,
        frontendUnitPrice: 27000,
      }),
    (error) => error.code === "WHOLESALE_SKU_NOT_CONFIGURED",
  );
});

test("desconto é aplicado depois da faixa selecionada", () => {
  const products = [{ quantity: 10, unitPriceCents: 23500 }];
  assert.deepEqual(calculateCommercialTotals(products, 10000), {
    commercialSubtotalCents: 235000,
    commercialDiscountCents: 10000,
    totalSentToOlistCents: 225000,
  });
});

test("rateio do desconto preserva o total enviado ao Olist", () => {
  const products = [
    { quantity: 3, unitPriceCents: 23500 },
    { quantity: 7, unitPriceCents: 23500 },
  ];
  const allocated = allocateCommercialItemPrices(products, 10000);
  const total = allocated.reduce(
    (sum, item, index) =>
      sum + Math.round(item.unitPrice * products[index].quantity * 100),
    0,
  );
  assert.ok(Math.abs(total - 225000) <= 1);
});

test("preço devolvido igual ao enviado não gera divergência", () => {
  const payload = {
    products: [
      {
        sku: "C4-BLACK",
        quantity: 10,
        unitPriceCents: 23500,
        priceTier: "tier3",
      },
    ],
    discountCents: 0,
    priceTier: "tier3",
  };
  assert.equal(
    findOlistOrderItemPriceMismatch(payload, {
      itens: [{ codigo: "C4-BLACK", valorUnitario: 235 }],
    }),
    null,
  );
});

test("preço alterado pelo Olist retorna OLIST_PRICE_MISMATCH detalhável", () => {
  const payload = {
    products: [
      {
        sku: "C4-BLACK",
        quantity: 10,
        unitPriceCents: 23500,
        priceTier: "tier3",
      },
    ],
    discountCents: 0,
    priceTier: "tier3",
  };
  assert.deepEqual(
    findOlistOrderItemPriceMismatch(payload, {
      itens: [{ codigo: "C4-BLACK", valorUnitario: 270 }],
    }),
    {
      sku: "C4-BLACK",
      quantity: 10,
      sent_unit_price: 23500,
      returned_unit_price: 27000,
      selected_tier: "tier3",
    },
  );
});

test("ausência de itens na resposta do Olist não fabrica comparação", () => {
  const payload = {
    products: [{ sku: "C4-BLACK", quantity: 10, unitPriceCents: 23500 }],
    discountCents: 0,
  };
  assert.equal(findOlistOrderItemPriceMismatch(payload, {}), null);
});

