// Fluxo completo com PostgreSQL real e descartável; somente a ponte Olist é
// simulada (sem rede). Ver vitest.proposals-pg.config.mts.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.PROPOSALS_PG_TEST_URL ?? "";
  // Proteção: só banco local cujo nome contenha "test".
  const safe = /^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\/[a-z0-9_]*test[a-z0-9_]*/i.test(url);
  if (safe) process.env.DATABASE_URL = url;
  process.env.CRM_PROPOSALS_OLIST_ENABLED = "1";
  return { safe };
});

const olist = vi.hoisted(() => ({
  seq: 900,
  proposals: new Map<string, any>(),
  convertCalls: 0,
  upserts: 0,
  calls: [] as string[],
}));

vi.mock("@/lib/olist/bridge-client", () => {
  class OlistBridgeError extends Error {
    constructor(message: string, public code: string, public status: number, public details?: unknown) {
      super(message);
    }
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function callOlistBridge(_brand: string, path: string, body: any) {
    olist.calls.push(path);
    switch (path) {
      case "/internal/crm/proposals/upsert": {
        olist.upserts += 1;
        const id = body.olist_proposal_id ?? String(++olist.seq);
        const subtotal = body.items.reduce((t: number, i: any) => t + i.quantity * i.unit_price_cents, 0);
        const snapshot = {
          id, number: `P${id}`, situation: "Rascunho", contact_id: "77", seller_id: body.seller_olist_id,
          items: body.items.map((i: any) => ({ sku: i.sku, quantity: i.quantity, unit_price_cents: i.unit_price_cents })),
          subtotal_cents: subtotal, total_cents: subtotal - body.discount_cents + body.freight_cents + 1234,
          discount_cents: body.discount_cents, freight_cents: body.freight_cents,
          payment: { type: body.payment.type, condition: body.payment.condition ?? null, text: body.payment.text ?? null },
          validity_days: body.validity_days, delivery_term: body.delivery_term,
        };
        olist.proposals.set(id, snapshot);
        return { olist_proposal_id: id, proposal_number: snapshot.number, contact_id: "77", created: !body.olist_proposal_id, snapshot };
      }
      case "/internal/crm/proposals/get":
        return { snapshot: olist.proposals.get(body.olist_proposal_id) };
      case "/internal/crm/proposals/email":
        return { email_id: "email-1" };
      case "/internal/crm/orders/consult":
        return { stock: body.skus.map((sku: string) => ({ sku, available: 1000, reserved: 0 })), checked_at: new Date().toISOString() };
      case "/internal/crm/orders/approve": {
        const p = [...olist.proposals.values()][0];
        return { order: { id: "5001", number: "7001", situation_code: 3, situation_label: "Aprovada", contact_tax_id: "11222333000181", seller_id: p.seller_id, items: p.items, total_cents: p.total_cents, invoice_id: null, receivables: [] }, already_approved: true };
      }
      case "/internal/crm/proposals/convert": {
        olist.convertCalls += 1;
        await sleep(30);
        const p = olist.proposals.get(body.olist_proposal_id);
        return {
          olist_order_id: "5001", order_number: "7001",
          order: { id: "5001", number: "7001", situation_code: 0, situation_label: "Aberta", contact_tax_id: "11222333000181", seller_id: p.seller_id, items: p.items, total_cents: p.total_cents, invoice_id: null, receivables: [] },
        };
      }
      case "/internal/crm/orders/inspect": {
        const p = [...olist.proposals.values()][0];
        return {
          order: {
            id: "5001", number: "7001", situation_code: 3, situation_label: "Aprovada", contact_tax_id: "11222333000181", seller_id: p.seller_id,
            items: p.items, total_cents: p.total_cents, invoice_id: null,
            receivables: [
              { id: "r1", situation: "pago", amount_cents: 100000, balance_cents: 0 },
              { id: "r2", situation: "aberto", amount_cents: 100000, balance_cents: 100000 },
            ],
          },
        };
      }
      default:
        return {};
    }
  }
  return { OlistBridgeError, callOlistBridge };
});

describe.skipIf(!env.safe)("propostas com PostgreSQL real", () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let service: typeof import("./proposal-service");
  let core: typeof import("./proposal-core");
  let realOrder: typeof import("@/lib/olist/real-order");
  const ids: Record<string, string> = {};
  let proposalId = "";

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    service = await import("./proposal-service");
    core = await import("./proposal-core");
    realOrder = await import("@/lib/olist/real-order");
    const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(`select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} cascade`);

    const mk = (name: string, role: "ADMIN" | "SUPERVISOR" | "VENDEDOR", supervisorId?: string) =>
      prisma.user.create({ data: { name, email: `${name.toLowerCase()}@teste.invalid`, role, passwordHash: "x", supervisorId } });
    const sup = await mk("Supervisor", "SUPERVISOR");
    const seller = await mk("Vendedor", "VENDEDOR", sup.id);
    const other = await mk("Outro", "VENDEDOR");
    const finance = await prisma.user.create({ data: { name: "Financeiro", email: "fin@teste.invalid", role: "VENDEDOR", passwordHash: "x", commercialFunctions: ["FINANCEIRO"] } });
    const master = await mk("Master", "ADMIN");
    Object.assign(ids, { sup: sup.id, seller: seller.id, other: other.id, finance: finance.id, master: master.id });

    const product = await prisma.product.create({ data: { brand: "MIBRO", slug: "c4", name: "Mibro C4" } });
    const variant = await prisma.productVariant.create({ data: { productId: product.id, brand: "MIBRO", sku: "C4-BLK", colorName: "Preto" } });
    const effectiveFrom = new Date("2026-01-01T00:00:00Z");
    const table = await prisma.priceTable.create({
      data: { brand: "MIBRO", priceGroup: "STANDARD", version: 1, status: "PUBLISHED", effectiveFrom, publishedAt: effectiveFrom, publishedKey: `MIBRO:STANDARD:${effectiveFrom.toISOString()}`,
        entries: { create: [{ productId: product.id, tier: "TIER1", unitPriceCents: 20000 }, { productId: product.id, tier: "TIER2", unitPriceCents: 18000 }, { productId: product.id, tier: "TIER3", unitPriceCents: 16000 }] } },
    });
    const customer = await prisma.customer.create({
      data: { contactName: "Ana", legalName: "Loja Ana LTDA", cnpjDigits: "11222333000181", email: "ana@loja.invalid", addressStreet: "Rua A", addressNumber: "1", addressDistrict: "Centro", city: "São Paulo", state: "SP", zipDigits: "01000000", sellerId: seller.id },
    });
    const simulation = await prisma.quote.create({
      data: {
        customerId: customer.id, sellerId: seller.id, brand: "MIBRO", origin: "CRM", mode: "SIMULATION", status: "CALCULADA", priceGroup: "STANDARD", quantityRule: "MIX",
        subtotalCents: 200000, discountCents: 0, totalValueCents: 200000,
        items: { create: [{ productId: product.id, variantId: variant.id, sku: "C4-BLK", productName: "Mibro C4", colorName: "Preto", quantity: 10, priceGroup: "STANDARD", priceTableId: table.id, priceTableVersion: 1, automaticTier: "TIER1", appliedTier: "TIER1", unitPriceCents: 20000, lineSubtotalCents: 200000 }] },
      },
    });
    Object.assign(ids, { customer: customer.id, simulation: simulation.id });
    await prisma.sellerOlistLink.create({ data: { userId: seller.id, brand: "MIBRO", olistSellerId: "55", olistSellerName: "Vendedor Olist", updatedById: sup.id } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const as = (key: string, role: "ADMIN" | "SUPERVISOR" | "VENDEDOR" = "VENDEDOR") => ({ id: ids[key], role });

  it("1-2. vendedor cria a proposta e ela recebe o ID do Olist; repetir não duplica", async () => {
    const first = await service.createProposalFromSimulation(as("seller"), ids.simulation, { validityDays: 10, paymentType: "Parcelas", paymentCondition: "30 60" });
    expect(first).toMatchObject({ created: true, syncError: null });
    proposalId = first.proposalId;
    const again = await service.createProposalFromSimulation(as("seller"), ids.simulation, {});
    expect(again).toMatchObject({ proposalId, created: false });
    const p = await prisma.commercialProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(p).toMatchObject({ olistProposalId: "901", olistProposalNumber: "P901", syncStatus: "SINCRONIZADA", syncedVersion: 1, olistSellerId: "55", olistTotalCents: 201234 });
    expect(await prisma.commercialProposal.count()).toBe(1);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: ids.simulation } })).status).toBe("CONVERTIDA");
  });

  it("3-5. escopo: outro vendedor não vê; supervisor da equipe vê; financeiro só após aprovação", async () => {
    await expect(core.authorize(as("other"), proposalId, "view")).rejects.toMatchObject({ status: 404 });
    await expect(core.authorize(as("sup", "SUPERVISOR"), proposalId, "view")).resolves.toBeTruthy();
    await expect(core.authorize(as("finance"), proposalId, "view")).rejects.toMatchObject({ status: 404 });
    const { loadProposalActor, proposalWhereForActor } = await import("./proposal-access");
    const count = async (key: string, role: "SUPERVISOR" | "VENDEDOR") => prisma.commercialProposal.count({ where: proposalWhereForActor(await loadProposalActor(as(key, role))) });
    expect(await count("other", "VENDEDOR")).toBe(0);
    expect(await count("sup", "SUPERVISOR")).toBe(1);
  });

  it("6-8. solicita aprovação; vendedor não aprova a própria; supervisor aprova", async () => {
    await service.submitForApproval(as("seller"), proposalId, null);
    await expect(service.decideApproval(as("seller"), proposalId, "approve", null)).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
    await service.decideApproval(as("sup", "SUPERVISOR"), proposalId, "approve", "ok");
    const p = await prisma.commercialProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(p).toMatchObject({ commercialStatus: "APROVADA_INTERNAMENTE", approvalStatus: "APROVADA", approvedVersion: 1 });
    await expect(core.authorize(as("finance"), proposalId, "view")).resolves.toBeTruthy();
  });

  it("9 e 13. alteração de quantidade cria nova versão, invalida a aprovação e reprecifica no servidor", async () => {
    const r = await service.updateProposal(as("seller"), proposalId, {
      expectedVersion: 1, items: [{ sku: "C4-BLK", quantity: 60 }], requestedTier: "AUTO", discountCents: 0,
      paymentType: "Parcelas", paymentCondition: "30 60", validityDays: 10, reason: "cliente pediu mais",
    });
    expect(r).toMatchObject({ version: 2, materialChanged: true, syncError: null });
    const p = await prisma.commercialProposal.findUniqueOrThrow({ where: { id: proposalId }, include: { quote: { include: { items: true } } } });
    expect(p).toMatchObject({ commercialStatus: "RASCUNHO", approvalStatus: "INVALIDADA", syncedVersion: 2, version: 2 });
    expect(p.quote.items[0]).toMatchObject({ quantity: 60, unitPriceCents: 18000, appliedTier: "TIER2" });
    expect(await prisma.proposalVersion.count({ where: { proposalId } })).toBe(2);
    await expect(service.updateProposal(as("seller"), proposalId, { expectedVersion: 1, items: [{ sku: "C4-BLK", quantity: 61 }], requestedTier: "AUTO", discountCents: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("10-11, 14. pendente não envia; aprovada envia; aceite registra a versão correta", async () => {
    await expect(service.sendProposalEmail(as("seller"), proposalId, null)).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
    await service.submitForApproval(as("seller"), proposalId, null);
    await expect(service.sendProposalEmail(as("seller"), proposalId, null)).rejects.toThrow(/aprovação/);
    await service.decideApproval(as("sup", "SUPERVISOR"), proposalId, "approve", null);
    await service.sendProposalEmail(as("seller"), proposalId, null);
    await expect(service.registerCustomerResponse(as("seller"), proposalId, { decision: "ACEITA", channel: "WHATSAPP", evidence: "", contactName: null, occurredAt: new Date() })).rejects.toMatchObject({ code: "EVIDENCE_REQUIRED" });
    await service.registerCustomerResponse(as("seller"), proposalId, { decision: "ACEITA", channel: "WHATSAPP", evidence: "Mensagem de aceite às 10h", contactName: "Ana", occurredAt: new Date() });
    const p = await prisma.commercialProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(p).toMatchObject({ commercialStatus: "ACEITA", acceptanceStatus: "ACEITA", acceptedVersion: 2 });
    expect(await prisma.proposalDispatch.count({ where: { proposalId, succeeded: true, version: 2 } })).toBe(1);
  });

  it("17, 19, 18. vendedor só solicita; clique duplo do supervisor gera um único pedido", async () => {
    await expect(service.convertToOrder(as("seller"), proposalId)).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
    await service.requestConversion(as("seller"), proposalId);
    const results = await Promise.allSettled([service.convertToOrder(as("sup", "SUPERVISOR"), proposalId), service.convertToOrder(as("sup", "SUPERVISOR"), proposalId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(olist.convertCalls).toBe(1);
    expect(await prisma.olistOrder.count()).toBe(1);
    const p = await prisma.commercialProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(p).toMatchObject({ commercialStatus: "CONVERTIDA", orderStatus: "PEDIDO_CRIADO", olistOrderId: "5001", olistOrderNumber: "7001", financialStatus: "SEM_COBRANCA" });
    await expect(service.convertToOrder(as("sup", "SUPERVISOR"), proposalId)).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
  });

  it("Master aprova pedido existente com evento persistido e sem modificar o financeiro", async () => {
    const { approveExistingOrder } = await import("./proposal-operations");
    await expect(approveExistingOrder(as("sup", "SUPERVISOR"), proposalId)).rejects.toMatchObject({ status: 403 });
    const before = await prisma.commercialProposal.findUniqueOrThrow({ where: { id: proposalId } });
    await approveExistingOrder(as("master", "ADMIN"), proposalId);
    const after = await prisma.commercialProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(after.orderStatus).toBe("PEDIDO_APROVADO");
    expect(after.financialStatus).toBe(before.financialStatus);
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.proposalEvent.count({ where: { proposalId, type: "ORDER_APPROVED_BY_MASTER", actorId: ids.master } })).toBe(1);
  });

  it("22-25. pedido aprovado com pagamento parcial: não é integral; vendedor não confere; financeiro confere", async () => {
    await service.refreshOrderStatus(as("sup", "SUPERVISOR"), proposalId);
    const p = await prisma.commercialProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(p).toMatchObject({ orderStatus: "PEDIDO_APROVADO", financialStatus: "PAGAMENTO_PARCIAL", financialPaidCents: 100000, financialOpenCents: 100000 });
    // Regra de venda existente preservada (aprovação gera Sale), sem confundir com o financeiro da proposta.
    expect(await prisma.sale.count({ where: { olistOrder: { olistOrderId: "5001" } } })).toBe(1);
    await expect(service.financeReview(as("seller"), proposalId, "conferido")).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
    await service.financeReview(as("finance"), proposalId, "Parcela 1 conferida no extrato");
    expect(await prisma.proposalEvent.count({ where: { proposalId, type: "FINANCE_REVIEW" } })).toBe(1);
  });

  it("26-27. o fluxo antigo de pedido direto recusa a cotação da proposta", async () => {
    const p = await prisma.commercialProposal.findUniqueOrThrow({ where: { id: proposalId } });
    await expect(realOrder.calculateRealOrder(as("seller"), p.quoteId)).rejects.toMatchObject({ code: "PROPOSAL_FLOW" });
    await expect(realOrder.emailProposal(as("seller"), p.quoteId, null)).rejects.toMatchObject({ code: "PROPOSAL_FLOW" });
  });

  it("15. proposta expirada não converte", async () => {
    const dup = await service.duplicateProposal(as("seller"), proposalId);
    await prisma.commercialProposal.update({
      where: { id: dup.proposalId },
      data: { commercialStatus: "ACEITA", approvalStatus: "APROVADA", acceptanceStatus: "ACEITA", approvedVersion: 1, acceptedVersion: 1, validUntil: new Date("2026-01-01T00:00:00Z") },
    });
    await expect(service.convertToOrder(as("sup", "SUPERVISOR"), dup.proposalId)).rejects.toThrow(/expirou/);
    expect(olist.convertCalls).toBe(1);
  });
});
