import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
import { changeSimulationDeletion } from "./quote-trash";
const tx = { user: { findUnique: vi.fn() }, quote: { findUnique: vi.fn(), updateMany: vi.fn() }, auditLog: { create: vi.fn() } };
const base = {
  id: "q", customerId: "c", sellerId: "seller", mode: "SIMULATION", brand: "MIBRO", status: "CALCULADA",
  deletedAt: null, updatedAt: new Date(), totalValueCents: 712500, productsSummary: { products: [{ sku: "A3", quantity: 20, unitPriceCents: 37500 }] },
  customer: { tradeName: "Loja", contactName: "Contato", seller: { id: "seller", supervisorId: "sup" } }, seller: { name: "Vendedor" }, olistOrder: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  tx.user.findUnique.mockResolvedValue({ id: "sup", role: "SUPERVISOR", active: true, name: "Supervisor", deletedAt: null });
  tx.quote.findUnique.mockResolvedValue(base);
  tx.quote.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async fn => fn(tx));
});
describe("exclusão lógica e auditoria", () => {
  it("preserva valor e produtos em snapshot e grava auditoria na mesma transação", async () => {
    await changeSimulationDeletion("sup", "q", "DELETE");
    const data = tx.quote.updateMany.mock.calls[0][0].data;
    expect(data.deletedSnapshot.valueCents).toBe(712500);
    expect(data.deletedSnapshot.productsSummary).toEqual(base.productsSummary);
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: "sup", action: "SIMULATION_DELETED" }) }));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("rejeita vendedor e não altera a simulação", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "sup", role: "VENDEDOR", active: true, deletedAt: null });
    await expect(changeSimulationDeletion("sup", "q", "DELETE")).rejects.toMatchObject({ status: 403 });
    expect(tx.quote.updateMany).not.toHaveBeenCalled();
  });
  it("rejeita outra equipe", async () => {
    tx.quote.findUnique.mockResolvedValue({ ...base, customer: { ...base.customer, seller: { id: "other", supervisorId: "other-supervisor" } } });
    await expect(changeSimulationDeletion("sup", "q", "DELETE")).rejects.toMatchObject({ status: 403 });
    expect(tx.quote.updateMany).not.toHaveBeenCalled();
  });
  it("rejeita cotações reais ou simulações com pedido Olist", async () => {
    tx.quote.findUnique.mockResolvedValue({ ...base, mode: "REAL" });
    await expect(changeSimulationDeletion("sup", "q", "DELETE")).rejects.toMatchObject({ status: 403 });
    tx.quote.findUnique.mockResolvedValue({ ...base, olistOrder: { id: "olist" } });
    await expect(changeSimulationDeletion("sup", "q", "DELETE")).rejects.toMatchObject({ status: 409 });
  });
  it("restaura para admin e mantém snapshot original", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "admin", role: "ADMIN", active: true, deletedAt: null });
    tx.quote.findUnique.mockResolvedValue({ ...base, deletedAt: new Date(), deletedSnapshot: { valueCents: 712500, productsSummary: base.productsSummary } });
    await changeSimulationDeletion("admin", "q", "RESTORE");
    expect(tx.quote.updateMany.mock.calls[0][0].data).toEqual({ deletedAt: null, deletedById: null });
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe("SIMULATION_RESTORED");
  });
  it("bloqueia supervisor restaurando e prazo vencido", async () => {
    tx.quote.findUnique.mockResolvedValue({ ...base, deletedAt: new Date() });
    await expect(changeSimulationDeletion("sup", "q", "RESTORE")).rejects.toMatchObject({ status: 403 });
    tx.user.findUnique.mockResolvedValue({ id: "admin", role: "ADMIN", active: true, deletedAt: null });
    tx.quote.findUnique.mockResolvedValue({ ...base, deletedAt: new Date(Date.now() - 8 * 86_400_000) });
    await expect(changeSimulationDeletion("admin", "q", "RESTORE")).rejects.toMatchObject({ status: 410 });
  });
  it("não duplica exclusão, restauração ou auditoria com corrida", async () => {
    tx.quote.updateMany.mockResolvedValue({ count: 0 });
    await expect(changeSimulationDeletion("sup", "q", "DELETE")).rejects.toMatchObject({ status: 409 });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
