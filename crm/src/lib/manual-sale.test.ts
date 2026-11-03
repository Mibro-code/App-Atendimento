import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ role: "VENDEDOR", find: vi.fn(), update: vi.fn(), audit: vi.fn(), move: vi.fn(), card: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { sale: { findUnique: mocks.find, update: mocks.update }, customer: { findUnique: mocks.find } } }));
vi.mock("@/lib/api-auth", () => ({
  requireSession: async () => ({ user: { id: "actor", role: mocks.role }, error: null }),
  forbidden: (error: string) => NextResponse.json({ error }, { status: 403 }),
  badRequest: (error: string) => NextResponse.json({ error }, { status: 400 }),
  notFound: (error: string) => NextResponse.json({ error }, { status: 404 }),
}));
vi.mock("@/lib/authz", () => ({ canAccessCustomer: async () => true }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/pipeline-rules", async () => await import("./pipeline-rules"));
vi.mock("@/lib/pipeline", () => ({ moveCustomerStage: mocks.move, scheduleStageReturn: mocks.move, PipelineError: class extends Error {} }));
vi.mock("@/lib/pipeline-board", () => ({ loadPipelineCardById: mocks.card }));
vi.mock("@/lib/automatic-followups", () => ({ syncAutomaticFollowUpsForCustomerIds: vi.fn() }));
import { PATCH } from "../app/api/sales/[id]/route";
import { POST } from "../app/api/customers/[id]/stage/route";
beforeEach(() => { vi.clearAllMocks(); mocks.find.mockResolvedValue({ id: "sale", stage: "AGUARDANDO_APROVACAO", customer: { sellerId: "actor" } }); });
describe("pagamento é confirmado somente pela integração Olist", () => {
  it.each(["VENDEDOR", "REPRESENTANTE", "SUPERVISOR", "ADMIN"])("bloqueia confirmação manual via API para %s", async role => {
    mocks.role = role;
    const request = new NextRequest("http://localhost/api/sales/sale", { method: "PATCH", body: JSON.stringify({ action: "CONFIRM" }) });
    const response = await PATCH(request, { params: Promise.resolve({ id: "sale" }) });
    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["VENDEDOR", "REPRESENTANTE", "SUPERVISOR", "ADMIN"])("bloqueia mover para Vendidos mesmo enviando valor e referência (%s)", async role => {
    mocks.role = role;
    mocks.find.mockResolvedValue({ sellerId: "actor", pipelineStage: "COTACAO" });
    const request = new NextRequest("http://localhost/api/customers/c/stage", { method: "POST", body: JSON.stringify({ action: "MOVE", to: "VENDIDO", sale: { valueCents: 712500, orderReference: "001" } }) });
    const response = await POST(request, { params: Promise.resolve({ id: "c" }) });
    expect(response.status).toBe(403);
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.card).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
