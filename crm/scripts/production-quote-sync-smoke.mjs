import { PrismaClient } from "@prisma/client";

const mode = process.argv[2];
const smokeToken = process.env.SMOKE_QUOTE_TOKEN || "codex-smoke-quote-20260828";

if (mode === "lookup") {
  const prisma = new PrismaClient();
  const customer = await prisma.customer.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, sellerId: true },
  });
  console.log(JSON.stringify(customer));
  await prisma.$disconnect();
} else if (mode === "cleanup") {
  const prisma = new PrismaClient();
  const quote = await prisma.quote.findUnique({
    where: { brand_shopifyQuoteToken: { brand: "MIBRO", shopifyQuoteToken: smokeToken } },
    select: { id: true },
  });
  if (quote) {
    await prisma.olistOrder.deleteMany({ where: { quoteId: quote.id } });
    await prisma.quote.delete({ where: { id: quote.id } });
  }
  console.log(JSON.stringify({ cleaned: Boolean(quote) }));
  await prisma.$disconnect();
} else if (mode === "sync") {
  const customerId = process.env.SMOKE_CUSTOMER_ID;
  const sellerId = process.env.SMOKE_SELLER_ID;
  const baseUrl = process.env.CRM_API_URL;
  const secret = process.env.CRM_SHOPIFY_SHARED_SECRET;
  if (!customerId || !sellerId || !baseUrl || !secret) {
    throw new Error("Variáveis do smoke test ausentes.");
  }

  const endpoint = `${new URL(baseUrl).origin}/api/integrations/shopify/quotes/upsert`;
  const basePayload = {
    shop: "mibro-brasil.myshopify.com",
    customerId,
    sellerId,
    quoteToken: smokeToken,
    valueCents: 12345,
    totalQuantity: 1,
    products: [
      {
        sku: "SMOKE-TEST",
        name: "Teste descartável de integração",
        quantity: 1,
        unitPriceCents: 12345,
        subtotalCents: 12345,
      },
    ],
  };

  const send = async (event) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...basePayload, event }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true) {
      throw new Error(`Falha ${response.status}: ${body?.code || "UNKNOWN"}`);
    }
    return { status: response.status, quote: body.quote };
  };

  const first = await send("CALCULATED");
  const repeated = await send("CALCULATED");
  const advanced = await send("READY_FOR_REVIEW");
  console.log(JSON.stringify({ first, repeated, advanced }));
} else {
  throw new Error("Use lookup, sync ou cleanup.");
}
