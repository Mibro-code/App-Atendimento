import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  allocateCommercialItemPrices,
  buildWholesaleOrderValues,
  calculateCommercialTotals,
} from "../app/services/wholesale-order-values.server.js";

const products = [
  { sku: "A3-DARK-GRAY", quantity: 3, unitPriceCents: 37_500 },
  { sku: "GS-PRO2-WHITE", quantity: 2, unitPriceCents: 71_000 },
];

test("calcula subtotal, desconto e total comercial enviado ao Olist", () => {
  assert.deepEqual(calculateCommercialTotals(products, 1_234), {
    commercialSubtotalCents: 254_500,
    commercialDiscountCents: 1_234,
    totalSentToOlistCents: 253_266,
  });
});

test("distribui o desconto nos preços unitários sem perder centavos do total", () => {
  const prices = allocateCommercialItemPrices(products, 1_234);

  assert.equal(
    prices.reduce((total, item) => total + item.lineTotalCents, 0),
    253_266,
  );
  prices.forEach((price, index) => {
    assert.equal(
      Math.round(price.unitPrice * products[index].quantity * 100),
      price.lineTotalCents,
    );
  });
});

test("separa total enviado e total confirmado sem fabricar tributos", () => {
  const result = buildWholesaleOrderValues(
    {
      subtotalCents: 254_500,
      discountCents: 1_234,
      commercialTotalCents: 253_266,
    },
    {
      valorTotalProdutos: "2.532,66",
      valorTotalPedido: "2.610,42",
    },
  );

  assert.equal(result.totalConfirmedByOlistCents, 261_042);
  assert.equal(result.values.commercial_subtotal, 254_500);
  assert.equal(result.values.commercial_discount, 1_234);
  assert.equal(result.values.total_sent_to_olist, 253_266);
  assert.equal(result.values.total_confirmed_by_olist, 261_042);
  assert.equal(result.values.olist_products_total, 253_266);
  assert.equal("ipi" in result.values, false);
  assert.equal("icms_fcp" in result.values, false);
  assert.equal("pis" in result.values, false);
  assert.equal("cofins" in result.values, false);
  assert.equal("cbs" in result.values, false);
  assert.equal("ibs_state" in result.values, false);
  assert.equal("difal" in result.values, false);
});

test("Liquid não deduz tributos pela diferença dos totais", async () => {
  const liquid = await readFile(
    new URL("../shopify/sections/calculadora-atacado.liquid", import.meta.url),
    "utf8",
  );

  assert.equal(liquid.includes("combinedTaxes"), false);
  assert.match(liquid, /data-tax-breakdown-unavailable/);
  assert.match(liquid, /detalhamento oficial estará disponível na NF-e/i);
  assert.match(liquid, /Total comercial enviado ao Olist/);
  assert.match(liquid, /Total confirmado pelo Olist/);
  assert.match(liquid, /QUOTE_IDENTITY_CHANGED/);
  assert.match(liquid, /calculateWithOlist\(false\)/);
});
