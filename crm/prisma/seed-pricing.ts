// Seed idempotente do catálogo comercial e das tabelas de atacado iniciais.
// Seguro para rodar várias vezes e em produção:
// - Product/ProductVariant: cria o que falta; NUNCA sobrescreve edições feitas
//   na Gestão Comercial (update vazio).
// - PriceTable: cria a versão 1 PUBLISHED de cada marca+grupo SOMENTE se o
//   escopo ainda não tiver nenhuma versão. Tabelas existentes nunca são tocadas.
// Uso: npm run db:seed-pricing
import { PrismaClient, type CommercialBrand, type PriceGroup, type PriceTier } from "@prisma/client";
import { SEED_EFFECTIVE_FROM, SEED_PRODUCTS } from "../src/lib/pricing/catalog-seed-data";
import { publishedKeyFor } from "../src/lib/pricing/pricing-rules";

const prisma = new PrismaClient();

async function seedCatalog(): Promise<Map<string, string>> {
  const productIds = new Map<string, string>(); // `${brand}:${slug}` -> id
  for (const p of SEED_PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { brand_slug: { brand: p.brand, slug: p.slug } },
      update: {},
      create: { brand: p.brand, slug: p.slug, name: p.name, sortOrder: p.sortOrder },
    });
    productIds.set(`${p.brand}:${p.slug}`, product.id);

    for (const [index, v] of p.variants.entries()) {
      const existing = await prisma.productVariant.findUnique({
        where: { brand_sku: { brand: p.brand, sku: v.sku } },
        select: { productId: true },
      });
      if (existing && existing.productId !== product.id) {
        throw new Error(`SKU ${v.sku} já pertence a outro produto; revise antes de rodar o seed.`);
      }
      await prisma.productVariant.upsert({
        where: { brand_sku: { brand: p.brand, sku: v.sku } },
        update: {},
        create: { productId: product.id, brand: p.brand, sku: v.sku, colorName: v.colorName, sortOrder: index },
      });
    }
  }
  return productIds;
}

async function seedTable(brand: CommercialBrand, priceGroup: PriceGroup, productIds: Map<string, string>) {
  const existing = await prisma.priceTable.count({ where: { brand, priceGroup } });
  if (existing > 0) {
    console.log(`= ${brand}/${priceGroup}: já possui ${existing} versão(ões), mantida.`);
    return;
  }

  const entries: Array<{ productId: string; tier: PriceTier; unitPriceCents: number }> = [];
  for (const p of SEED_PRODUCTS.filter((x) => x.brand === brand)) {
    const prices = priceGroup === "REPRESENTATIVE" ? p.representative : p.standard;
    for (const [tier, cents] of Object.entries(prices) as Array<[PriceTier, number]>) {
      entries.push({ productId: productIds.get(`${brand}:${p.slug}`)!, tier, unitPriceCents: cents });
    }
  }

  const table = await prisma.priceTable.create({
    data: {
      brand,
      priceGroup,
      version: 1,
      status: "PUBLISHED",
      effectiveFrom: SEED_EFFECTIVE_FROM,
      publishedAt: new Date(),
      publishedKey: publishedKeyFor(brand, priceGroup, SEED_EFFECTIVE_FROM),
      changeReason:
        priceGroup === "STANDARD"
          ? "Importação inicial: tabela validada pelo app Shopify (wholesale-pricing.server.js)."
          : "Importação inicial: catálogo de representantes de outubro/2026.",
      entries: { create: entries },
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "PRICE_TABLE_SEEDED",
      entityType: "PriceTable",
      entityId: table.id,
      metadata: { brand, priceGroup, version: 1, entries: entries.length },
    },
  });
  console.log(`+ ${brand}/${priceGroup}: versão 1 publicada com ${entries.length} preços.`);
}

async function main() {
  const productIds = await seedCatalog();
  for (const brand of ["MIBRO", "SINCROFIT"] as const) {
    for (const group of ["STANDARD", "REPRESENTATIVE"] as const) {
      await seedTable(brand, group, productIds);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
