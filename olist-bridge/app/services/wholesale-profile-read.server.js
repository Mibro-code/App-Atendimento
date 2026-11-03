import db from "../db.server";

function decimalToNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

export async function listWholesalePurchasedProducts({ shop, companyIds }) {
  const items = await db.wholesaleOrderItem.findMany({
    where: {
      order: {
        shop,
        companyId: { in: companyIds },
      },
    },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          orderedAt: true,
          currencyCode: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  const products = new Map();

  for (const item of items) {
    const key = item.sku?.trim().toLowerCase() || item.productName.trim().toLowerCase();
    const current = products.get(key) || {
      productName: item.productName,
      sku: item.sku,
      totalQuantity: 0,
      totalPurchased: 0,
      currencyCode: item.order.currencyCode || "BRL",
      orderIds: new Set(),
      lastPurchasedAt: null,
      lastOrderNumber: null,
    };

    current.totalQuantity += decimalToNumber(item.quantity) || 0;
    current.totalPurchased += decimalToNumber(item.totalPrice) || 0;
    current.orderIds.add(item.order.id);

    if (
      item.order.orderedAt &&
      (!current.lastPurchasedAt || item.order.orderedAt > current.lastPurchasedAt)
    ) {
      current.lastPurchasedAt = item.order.orderedAt;
      current.lastOrderNumber = item.order.orderNumber;
    }

    products.set(key, current);
  }

  return [...products.values()]
    .map(({ orderIds, ...product }) => ({
      ...product,
      orderCount: orderIds.size,
    }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);
}

export async function listWholesaleResources({ shop, companyIds, customerId }) {
  const resources = await db.wholesaleResource.findMany({
    where: {
      shop,
      active: true,
      AND: [
        { OR: [{ companyId: null }, { companyId: { in: companyIds } }] },
        {
          OR: [
            { recipients: { none: {} } },
            { recipients: { some: { customerId } } },
          ],
        },
      ],
    },
select: {
  id: true,
  companyId: true,
  type: true,
  title: true,
  description: true,

  deliveryType: true,

  url: true,

  allowDraft: true,
  allowDownload: true,
  generatePdf: true,
  requiresApproval: true,

  templateName: true,
  templateVersion: true,

  updatedAt: true,
},
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });

  return resources;
}
