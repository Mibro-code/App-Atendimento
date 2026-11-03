import db from "../db.server";

function decimalToNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function serializeInvoice(invoice) {
  if (!invoice) return null;

  return {
    invoiceNumber: invoice.invoiceNumber,
    invoiceSeries: invoice.invoiceSeries,
    invoiceKey: invoice.invoiceKey,
    danfeUrl: invoice.danfeUrl,
    xmlUrl: invoice.xmlUrl,
    issuedAt: invoice.issuedAt,
  };
}

function serializeTracking(tracking) {
  if (!tracking) return null;

  return {
    trackingCode: tracking.trackingCode,
    carrier: tracking.carrier,
    service: tracking.service,
    status: tracking.status,
    lastUpdate: tracking.lastUpdate,
    events: (tracking.events || []).map((event) => ({
      id: event.id,
      status: event.status,
      description: event.description,
      city: event.city,
      state: event.state,
      eventDate: event.eventDate,
    })),
  };
}

function serializeOrder(order, { includeDetails = false } = {}) {
  const result = {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    currencyCode: order.currencyCode,
    subtotal: decimalToNumber(order.subtotal),
    discountValue: decimalToNumber(order.discountValue),
    shippingValue: decimalToNumber(order.shippingValue),
    total: decimalToNumber(order.total),
    orderedAt: order.orderedAt,
    lastSyncedAt: order.lastSyncedAt,
    itemCount: order._count?.items ?? order.items?.length ?? 0,
    deliveryStatus: order.tracking?.status ?? null,
    trackingCode: order.tracking?.trackingCode ?? null,
    carrier: order.tracking?.carrier ?? null,
  };

  if (includeDetails) {
    result.items = order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      sku: item.sku,
      quantity: decimalToNumber(item.quantity),
      unitPrice: decimalToNumber(item.unitPrice),
      discountValue: decimalToNumber(item.discountValue),
      totalPrice: decimalToNumber(item.totalPrice),
    }));
    result.invoice = serializeInvoice(order.invoice);
    result.tracking = serializeTracking(order.tracking);
  }

  return result;
}

export async function listWholesaleOrders({
  shop,
  companyIds,
  status,
  limit = 50,
}) {
  const orders = await db.wholesaleOrder.findMany({
    where: {
      shop,
      companyId: { in: companyIds },
      ...(status ? { status } : {}),
    },
    include: {
      _count: { select: { items: true } },
      tracking: {
        select: { status: true, trackingCode: true, carrier: true },
      },
    },
    orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(Number(limit) || 50, 1), 100),
  });

  return orders.map((order) => serializeOrder(order));
}

export async function getWholesaleOrder({ shop, companyIds, orderId }) {
  const order = await db.wholesaleOrder.findFirst({
    where: {
      id: orderId,
      shop,
      companyId: { in: companyIds },
    },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      invoice: true,
      tracking: {
        include: {
          events: { orderBy: { eventDate: "desc" } },
        },
      },
    },
  });

  return order ? serializeOrder(order, { includeDetails: true }) : null;
}
