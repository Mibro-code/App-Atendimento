import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), sync: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("./automatic-followups", () => ({ syncAutomaticFollowUpsForSellerIds: mocks.sync }));
import { deactivateTeamUserWithTransfer } from "./team-deactivation";

const actor = { id: "sup", name: "Supervisor", role: "SUPERVISOR", active: true, deletedAt: null, supervisorId: null };
const source = { id: "seller", name: "Vendedor", role: "VENDEDOR", active: true, deletedAt: null, supervisorId: "sup" };
const target = { ...source, id: "other", name: "Outro vendedor" };
const tx = {
  user: { findUnique: vi.fn(), update: vi.fn() },
  customer: { findMany: vi.fn(), updateMany: vi.fn() },
  followUp: { updateMany: vi.fn() },
  customerTransferHistory: { createMany: vi.fn() },
  auditLog: { createMany: vi.fn(), create: vi.fn() },
};
let records: Record<string, object>;
beforeEach(() => {
  vi.clearAllMocks();
  records = { sup: actor, seller: source, other: target };
  tx.user.findUnique.mockImplementation(({ where }) => Promise.resolve(records[where.id] ?? null));
  tx.customer.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
  tx.customer.updateMany.mockResolvedValue({ count: 2 });
  mocks.transaction.mockImplementation(async (work) => work(tx));
  mocks.sync.mockResolvedValue({ staleCount: 0 });
});
describe("desativação com repasse de carteira", () => {
  it("requires a destination even without customers", async () => {
    await expect(deactivateTeamUserWithTransfer("sup", "seller", "")).rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("allows supervisor to receive the whole portfolio and writes history inside the transaction", async () => {
    expect(await deactivateTeamUserWithTransfer("sup", "seller", "sup")).toEqual({ transferred: 2, transferToName: "Supervisor" });
    expect(tx.customer.updateMany).toHaveBeenCalledWith({ where: { sellerId: "seller" }, data: { sellerId: "sup" } });
    expect(tx.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { sellerId: "sup" } }));
    expect(tx.customerTransferHistory.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "USER_DEACTIVATED", metadata: expect.objectContaining({ transferredCustomers: 2, transferToId: "sup" }) }) }));
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "seller" }, data: { active: false } });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
  });
  it("allows another active member regardless of seller transfer policy", async () => {
    expect((await deactivateTeamUserWithTransfer("sup", "seller", "other")).transferred).toBe(2);
    expect(mocks.sync).toHaveBeenCalledWith(["other"]);
  });
  it.each([
    ["outside team", { ...target, supervisorId: "different" }],
    ["inactive recipient", { ...target, active: false }],
    ["deleted recipient", { ...target, deletedAt: new Date() }],
    ["admin recipient", { ...target, role: "ADMIN" }],
  ])("rejects %s without moving any customers", async (_name, invalid) => {
    records.other = invalid;
    await expect(deactivateTeamUserWithTransfer("sup", "seller", "other")).rejects.toMatchObject({ status: 403 });
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });
  it("rejects self-transfer and a source from another team", async () => {
    await expect(deactivateTeamUserWithTransfer("sup", "seller", "seller")).rejects.toMatchObject({ status: 403 });
    records.seller = { ...source, supervisorId: "different" };
    await expect(deactivateTeamUserWithTransfer("sup", "seller", "other")).rejects.toMatchObject({ status: 404 });
  });
  it("deactivates an empty portfolio with a selected recipient", async () => {
    tx.customer.findMany.mockResolvedValue([]); tx.customer.updateMany.mockResolvedValue({ count: 0 });
    expect((await deactivateTeamUserWithTransfer("sup", "seller", "sup")).transferred).toBe(0);
    expect(tx.customerTransferHistory.createMany).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalled();
  });
  it("aborts deactivation when the portfolio changes concurrently", async () => {
    tx.customer.updateMany.mockResolvedValue({ count: 3 });
    await expect(deactivateTeamUserWithTransfer("sup", "seller", "sup")).rejects.toMatchObject({ status: 409 });
    expect(tx.user.update).not.toHaveBeenCalled();
  });
  it("does not deactivate when the transfer fails", async () => {
    tx.customer.updateMany.mockRejectedValueOnce(new Error("Database failure"));
    await expect(deactivateTeamUserWithTransfer("sup", "seller", "sup")).rejects.toThrow("Database failure");
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
