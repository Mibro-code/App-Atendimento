import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ customer: vi.fn(), token: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { customer: { findUnique: mocks.customer } } }));
vi.mock("@/lib/api-auth", () => ({
  requireSession: async () => ({ user: { id: "seller", role: "VENDEDOR" }, error: null }),
  badRequest: (error: string) => NextResponse.json({ error }, { status: 400 }),
  forbidden: () => NextResponse.json({}, { status: 403 }),
  notFound: () => NextResponse.json({}, { status: 404 }),
}));
vi.mock("@/lib/authz", () => ({ canAccessCustomer: async () => true }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/crm-session", () => ({ createQuoteSessionToken: mocks.token }));
vi.mock("@/lib/config", async () => await import("./config"));
vi.mock("@/lib/location", async () => {
  const { z } = await import("zod");
  return { locationInputSchema: z.object({}), buildLocationCaptureData: vi.fn() };
});
import { POST } from "../app/api/customers/[id]/quote-session/route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SINCROFIT_SHOPIFY_WHOLESALE_URL", "https://sincrofit.com.br/pages/sincrofit");
  vi.stubEnv("MIBRO_SHOPIFY_WHOLESALE_URL", "https://mibrobrasil.com.br/pages/consulta-de-precos");
  mocks.customer.mockResolvedValue({ id: "customer", sellerId: "seller" });
  mocks.token.mockResolvedValue({ token: "test-session", expiresAt: new Date("2026-10-08T12:00:00Z") });
});
async function open(body: unknown) {
  return POST(new NextRequest("http://localhost/api/customers/customer/quote-session", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "customer" }) });
}
it.each(["REAL", "SIMULATION"])("Sincrofit abre exclusivamente sua calculadora (%s)", async mode => {
  const response = await open({ brand: "SINCROFIT", mode });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.brand).toBe("SINCROFIT");
  expect(new URL(body.url).hostname).toBe("sincrofit.com.br");
  expect(mocks.token).toHaveBeenCalledWith(expect.objectContaining({ brand: "SINCROFIT", mode }));
});
it("Mibro continua abrindo sua própria calculadora", async () => {
  const response = await open({ brand: "MIBRO", mode: "REAL" });
  expect(new URL((await response.json()).url).hostname).toBe("mibrobrasil.com.br");
});
it.each([{}, { brand: "OUTRA" }])("não escolhe Mibro silenciosamente sem empresa válida (%j)", async body => {
  expect((await open(body)).status).toBe(400);
  expect(mocks.token).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
});
