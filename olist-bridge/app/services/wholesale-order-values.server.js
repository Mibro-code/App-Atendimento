export function calculateCommercialTotals(products, discountCents = 0) {
  const commercialSubtotalCents = products.reduce(
    (total, item) => total + item.quantity * item.unitPriceCents,
    0,
  );
  const commercialDiscountCents = Number(discountCents);

  return {
    commercialSubtotalCents,
    commercialDiscountCents,
    totalSentToOlistCents:
      commercialSubtotalCents - commercialDiscountCents,
  };
}

export function allocateCommercialItemPrices(products, discountCents = 0) {
  const { commercialSubtotalCents, totalSentToOlistCents } =
    calculateCommercialTotals(products, discountCents);

  const allocations = products.map((item, index) => {
    const lineSubtotalCents = item.quantity * item.unitPriceCents;
    const exactLineTotalCents =
      commercialSubtotalCents > 0
        ? (lineSubtotalCents * totalSentToOlistCents) /
          commercialSubtotalCents
        : lineSubtotalCents;
    const lineTotalCents = Math.floor(exactLineTotalCents);

    return {
      index,
      quantity: item.quantity,
      lineTotalCents,
      remainder: exactLineTotalCents - lineTotalCents,
    };
  });

  let centsToAllocate =
    totalSentToOlistCents -
    allocations.reduce((total, item) => total + item.lineTotalCents, 0);

  [...allocations]
    .sort(
      (left, right) =>
        right.remainder - left.remainder || left.index - right.index,
    )
    .forEach((allocation) => {
      if (centsToAllocate <= 0) return;
      allocation.lineTotalCents += 1;
      centsToAllocate -= 1;
    });

  return allocations
    .sort((left, right) => left.index - right.index)
    .map((allocation) => ({
      lineTotalCents: allocation.lineTotalCents,
      unitPrice: Number(
        (allocation.lineTotalCents / allocation.quantity / 100).toFixed(6),
      ),
    }));
}

export function parseOlistMoneyToCents(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  const text = String(value || "").trim();
  if (!text) return null;

  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function olistItemSku(item) {
  return String(
    item?.sku ||
      item?.codigo ||
      item?.codigoSku ||
      item?.produto?.sku ||
      item?.produto?.codigo ||
      "",
  )
    .trim()
    .toUpperCase();
}

function olistItemUnitPriceCents(item) {
  const candidates = [
    item?.valorUnitario,
    item?.precoUnitario,
    item?.valor_unitario,
    item?.unitPrice,
    item?.produto?.valorUnitario,
    item?.produto?.precoUnitario,
  ];

  for (const candidate of candidates) {
    const cents = parseOlistMoneyToCents(candidate);
    if (cents !== null) return cents;
  }

  return null;
}

export function findOlistOrderItemPriceMismatch(payload, order) {
  const returnedItems = order?.itens || order?.items || order?.produtos;
  if (!Array.isArray(returnedItems) || returnedItems.length === 0) return null;

  const sentPrices = allocateCommercialItemPrices(
    payload.products,
    payload.discountCents,
  );

  for (let index = 0; index < payload.products.length; index += 1) {
    const product = payload.products[index];
    const sku = String(product.sku || "").trim().toUpperCase();
    const returnedItem =
      returnedItems.find((item) => olistItemSku(item) === sku) ||
      returnedItems[index];
    if (!returnedItem) continue;

    const returnedUnitPriceCents = olistItemUnitPriceCents(returnedItem);
    if (returnedUnitPriceCents === null) continue;

    const sentUnitPriceCents = Math.round(sentPrices[index].unitPrice * 100);
    if (Math.abs(returnedUnitPriceCents - sentUnitPriceCents) > 1) {
      return {
        sku: product.sku,
        quantity: product.quantity,
        sent_unit_price: sentUnitPriceCents,
        returned_unit_price: returnedUnitPriceCents,
        selected_tier: product.priceTier || payload.priceTier || null,
      };
    }
  }

  return null;
}
export function buildWholesaleOrderValues(payload, order) {
  const totalConfirmedByOlistCents = parseOlistMoneyToCents(
    order?.valorTotalPedido,
  );
  const productsTotalConfirmedByOlistCents = parseOlistMoneyToCents(
    order?.valorTotalProdutos,
  );

  return {
    totalConfirmedByOlistCents,
    values: {
      commercial_subtotal: payload.subtotalCents,
      commercial_discount: payload.discountCents,
      total_sent_to_olist: payload.commercialTotalCents,
      total_confirmed_by_olist: totalConfirmedByOlistCents,
      olist_products_total: productsTotalConfirmedByOlistCents,
      // Compatibilidade temporária com versões anteriores do Liquid.
      products: payload.subtotalCents,
      discount: payload.discountCents,
      total: totalConfirmedByOlistCents,
    },
  };
}
