// Fluxos com banco e ponte simulados em memória: autorização por escopo,
// concorrência na conversão, falhas de rede e conflitos com o Olist.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ state: {} as Record<string, any>, bridge: vi.fn(), syncStatus: vi.fn() }));

function matches(row: Record<string, any>, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as any[]).some((w) => matches(row, w));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Object && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("notIn" in v) return !v.notIn.includes(row[k]);
      if ("lt" in v) return row[k] !== null && row[k] < v.lt;
      if ("not" in v) return row[k] !== v.not;
    }
    return row[k] === v;
  });
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => {
  const s = () => m.state;
  const db: any = {
    user: {
      findFirst: async ({ where }: any) => s().users.find((u: any) => u.id === where.id) ?? null,
      findMany: async ({ where }: any) => s().users.filter((u: any) => u.supervisorId === where.supervisorId),
    },
    commercialProposal: {
      findUnique: async ({ where }: any) => (s().proposal.id === where.id ? structuredClone(s().proposal) : null),
      update: async ({ data }: any) => Object.assign(s().proposal, data),
      updateMany: async ({ where, data }: any) => {
        if (!matches(s().proposal, where)) return { count: 0 };
        Object.assign(s().proposal, data);
        return { count: 1 };
      },
    },
    proposalVersion: { findFirst: async () => ({ createdById: s().proposal.createdById }) },
    proposalDispatch: { findFirst: async () => (s().dispatched ? { id: "d" } : null) },
    proposalDiscountLimit: { findMany: async () => [] },
    proposalApproval: { updateMany: async () => ({ count: 0 }) },
    proposalEvent: { create: async ({ data }: any) => s().events.push(data.type) },
    sellerOlistLink: { findFirst: async () => s().link },
    olistSyncAttempt: {
      create: async ({ data }: any) => {
        const a = { id: `attempt${String(s().attempts.length).padStart(16, "0")}`, status: "STARTED", ...data };
        s().attempts.push(a);
        return { id: a.id };
      },
      update: async ({ where, data }: any) => Object.assign(s().attempts.find((a: any) => a.id === where.id), data),
      findFirst: async ({ where }: any) => [...s().attempts].reverse().find((a: any) => a.action === where.action) ?? null,
    },
    olistOrder: {
      create: async ({ data }: any) => s().orders.push(data),
      findUnique: async () => null,
    },
    $transaction: async (fn: any) => fn(db),
  };
  return { prisma: db };
});
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/olist-order-status", () => ({ syncOlistOrderStatus: m.syncStatus }));
vi.mock("@/lib/olist/bridge-client", () => {
  class OlistBridgeError extends Error {
    constructor(message: string, public code: string, public status: number, public details?: unknown) {
      super(message);
    }
  }
  return { OlistBridgeError, callOlistBridge: m.bridge };
});
vi.mock("@/lib/olist/real-order-rules", () => import("../olist/real-order-rules"));
vi.mock("@/lib/proposals/proposal-rules", () => import("./proposal-rules"));
vi.mock("@/lib/proposals/proposal-permissions", () => import("./proposal-permissions"));
vi.mock("@/lib/proposals/proposal-olist-rules", () => import("./proposal-olist-rules"));
vi.mock("@/lib/proposals/proposal-config", () => import("./proposal-config"));
vi.mock("@/lib/proposals/proposal-access", () => import("./proposal-access"));
vi.mock("@/lib/proposals/proposal-core", () => import("./proposal-core"));

import { OlistBridgeError } from "@/lib/olist/bridge-client";
import { authorize } from "./proposal-core";
import { convertProposal, pushProposalToOlist } from "./proposal-olist";
import { materialHash } from "./proposal-rules";
import { materialFromOlist } from "./proposal-olist-rules";
import { approveExistingOrder, consultProposal, preflightProposal } from "./proposal-operations";

const ID = "ckproposal00000000000001";
const customer = {
  id: "cust", sellerId: "s1", contactName: "Ana", legalName: "Loja Ana LTDA", tradeName: null, cnpjDigits: "11222333000181", cpfDigits: null,
  email: "ana@loja.invalid", phoneDigits: null, addressStreet: "Rua", addressNumber: "1", addressDistrict: "Centro", addressComplement: null,
  city: "SP", state: "SP", zipDigits: "01000000", pipelineStage: "COTACAO",
};
const snapshot = (over: Record<string, unknown> = {}) => ({
  id: "900", number: "123", situation: "Rascunho", contact_id: "77", seller_id: "55",
  items: [{ sku: "C4-BLK", quantity: 10, unit_price_cents: 20000 }], subtotal_cents: 200000, total_cents: 200000,
  discount_cents: 0, freight_cents: 0, payment: { type: "Nenhuma", condition: null, text: null }, validity_days: 7, delivery_term: null,
  ...over,
});
const orderInspection = { id: "5001", number: "7001", situation_code: 0, situation_label: "Aberta", contact_tax_id: "11222333000181", seller_id: "55", items: [{ sku: "C4-BLK", quantity: 10, unit_price_cents: 20000 }], total_cents: 200000, invoice_id: null, receivables: [] };

function baseProposal(over: Record<string, unknown> = {}) {
  return {
    id: ID, quoteId: "ckquote000000000000000001", brand: "MIBRO", customerId: "cust", sellerId: "s1", version: 1, contentHash: "x",
    commercialStatus: "ACEITA", approvalStatus: "APROVADA", acceptanceStatus: "ACEITA", syncStatus: "SINCRONIZADA", orderStatus: "SEM_PEDIDO",
    financialStatus: "NAO_APLICAVEL", validityDays: 7, validUntil: new Date(Date.now() + 86_400_000), paymentType: "Nenhuma", paymentCondition: null,
    paymentText: null, freightCents: 0, freightResponsibility: null, deliveryTerm: null, customerNotes: null, internalNotes: null,
    approvedVersion: 1, approvedHash: null as string | null, acceptedVersion: 1, olistSellerId: "55", olistProposalId: "900", olistProposalNumber: "123",
    olistSituation: "Aprovado", olistSnapshotHash: null as string | null, syncedVersion: 1, olistOrderId: null, lockedAt: null, createdById: "s1",
    createdAt: new Date(), lastSyncedAt: null,
    quote: { discountCents: 0, quantityRule: "MIX", items: [{ sku: "C4-BLK", quantity: 10, unitPriceCents: 20000, productName: "C4", colorName: "Preto", priceTableId: "t" }], olistOrder: null },
    customer,
    seller: { id: "s1", name: "Vendedor", role: "VENDEDOR", supervisorId: "sup", sellerProfile: null },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRM_PROPOSALS_OLIST_ENABLED = "1";
  const p = baseProposal();
  const hash = materialHash(materialFromOlist(snapshot() as any));
  p.approvedHash = hash;
  p.olistSnapshotHash = hash;
  m.state = {
    proposal: p,
    users: [
      { id: "s1", role: "VENDEDOR", commercialFunctions: [], supervisorId: "sup" },
      { id: "s2", role: "VENDEDOR", commercialFunctions: [], supervisorId: "sup9" },
      { id: "sup", role: "SUPERVISOR", commercialFunctions: [], supervisorId: null },
    ],
    link: { userId: "s1", brand: "MIBRO", olistSellerId: "55", active: true },
    dispatched: true,
    events: [] as string[],
    attempts: [] as any[],
    orders: [] as any[],
  };
});

describe("autorização no backend", () => {
  it("vendedor que altera o ID na URL recebe 404, sem chamar o Olist", async () => {
    await expect(authorize({ id: "s2", role: "VENDEDOR" }, ID, "edit")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(m.bridge).not.toHaveBeenCalled();
  });

  it("módulo desativado responde 404", async () => {
    process.env.CRM_PROPOSALS_OLIST_ENABLED = "";
    await expect(authorize({ id: "s1", role: "VENDEDOR" }, ID, "view")).rejects.toMatchObject({ code: "FEATURE_DISABLED", status: 404 });
  });

  it("vendedor não converte a própria proposta; supervisor da equipe sim", async () => {
    await expect(authorize({ id: "s1", role: "VENDEDOR" }, ID, "convert")).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED", status: 403 });
    await expect(authorize({ id: "sup", role: "SUPERVISOR" }, ID, "convert")).resolves.toBeTruthy();
  });
});

describe("conversão nativa", () => {
  it("converte uma única vez e vincula o pedido (18, 19)", async () => {
    m.bridge.mockImplementation(async (_b: string, path: string) =>
      path === "/internal/crm/proposals/get" ? { snapshot: snapshot({ situation: "Aprovado" }) } : { olist_order_id: "5001", order_number: "7001", order: orderInspection }
    );
    const first = await convertProposal("sup", ID);
    expect(first).toMatchObject({ olistOrderId: "5001", problems: [] });
    await expect(convertProposal("sup", ID)).rejects.toMatchObject({ code: "CONVERSION_IN_PROGRESS" });
    expect(m.bridge.mock.calls.filter((c) => c[1] === "/internal/crm/proposals/convert")).toHaveLength(1);
    expect(m.state.orders).toHaveLength(1);
    expect(m.state.proposal).toMatchObject({ commercialStatus: "CONVERTIDA", orderStatus: "PEDIDO_CRIADO", financialStatus: "SEM_COBRANCA", olistOrderId: "5001" });
  });

  it("falha de rede na conversão vira CONVERSAO_INCERTA e não é repetida", async () => {
    m.bridge.mockImplementation(async (_b: string, path: string) => {
      if (path === "/internal/crm/proposals/get") return { snapshot: snapshot() };
      throw new OlistBridgeError("O Olist demorou para responder.", "BRIDGE_TIMEOUT", 504);
    });
    await expect(convertProposal("sup", ID)).rejects.toMatchObject({ code: "CONVERSION_UNCERTAIN" });
    expect(m.state.proposal.orderStatus).toBe("CONVERSAO_INCERTA");
    expect(m.state.orders).toHaveLength(0);
    await expect(convertProposal("sup", ID)).rejects.toMatchObject({ code: "CONVERSION_IN_PROGRESS" });
    expect(m.bridge.mock.calls.filter((c) => c[1] === "/internal/crm/proposals/convert")).toHaveLength(1);
  });

  it("recusa definitiva do Olist libera a proposta sem criar pedido", async () => {
    m.bridge.mockImplementation(async (_b: string, path: string) => {
      if (path === "/internal/crm/proposals/get") return { snapshot: snapshot() };
      throw new OlistBridgeError("A Olist recusou a solicitação.", "OLIST_REQUEST_REJECTED", 400);
    });
    await expect(convertProposal("sup", ID)).rejects.toMatchObject({ code: "OLIST_REQUEST_REJECTED" });
    expect(m.state.proposal.orderStatus).toBe("SEM_PEDIDO");
  });

  it("alteração feita no Olist bloqueia a conversão e invalida a aprovação (21)", async () => {
    m.bridge.mockResolvedValue({ snapshot: snapshot({ items: [{ sku: "C4-BLK", quantity: 12, unit_price_cents: 20000 }] }) });
    await expect(convertProposal("sup", ID)).rejects.toMatchObject({ code: "OLIST_CONFLICT" });
    expect(m.state.proposal).toMatchObject({ syncStatus: "CONFLITO", approvalStatus: "INVALIDADA", orderStatus: "SEM_PEDIDO" });
    expect(m.state.events).toContain("OLIST_EXTERNAL_CHANGE");
  });

  it("proposta concluída no Olist sem pedido conhecido não é convertida de novo", async () => {
    m.bridge.mockResolvedValue({ snapshot: snapshot({ situation: "Concluído" }) });
    await expect(convertProposal("sup", ID)).rejects.toMatchObject({ code: "OLIST_ALREADY_CONCLUDED" });
    expect(m.bridge.mock.calls.some((c) => c[1] === "/internal/crm/proposals/convert")).toBe(false);
  });
});

describe("envio ao Olist sem duplicar (20)", () => {
  beforeEach(() => {
    Object.assign(m.state.proposal, { commercialStatus: "RASCUNHO", approvalStatus: "NAO_SOLICITADA", olistProposalId: null, olistSnapshotHash: null, syncedVersion: null, syncStatus: "PENDENTE" });
  });

  it("timeout na criação marca ERRO; a nova tentativa procura antes de criar", async () => {
    m.bridge.mockRejectedValueOnce(new OlistBridgeError("O Olist demorou para responder.", "BRIDGE_TIMEOUT", 504));
    await expect(pushProposalToOlist("s1", ID)).rejects.toMatchObject({ code: "BRIDGE_TIMEOUT" });
    expect(m.state.proposal.syncStatus).toBe("ERRO");

    m.bridge.mockImplementation(async (_b: string, path: string, body: any) => {
      if (path === "/internal/crm/proposals/find") return { found: true, olist_proposal_id: "900" };
      expect(body.olist_proposal_id).toBe("900");
      return { olist_proposal_id: "900", proposal_number: "123", contact_id: "77", created: false, snapshot: snapshot() };
    });
    await pushProposalToOlist("s1", ID);
    // 1ª chamada = criação que caiu; depois busca e atualização do registro encontrado (sem 2ª criação).
    expect(m.bridge.mock.calls.map((c) => c[1])).toEqual(["/internal/crm/proposals/upsert", "/internal/crm/proposals/find", "/internal/crm/proposals/upsert"]);
    expect(m.state.proposal).toMatchObject({ syncStatus: "SINCRONIZADA", olistProposalId: "900", syncedVersion: 1 });
    expect(m.state.events).toContain("OLIST_RECOVERED");
  });

  it("recusa de validação (4xx) não dispara busca de recuperação", async () => {
    m.bridge.mockRejectedValueOnce(new OlistBridgeError("Produto inexistente.", "OLIST_REQUEST_REJECTED", 400));
    await expect(pushProposalToOlist("s1", ID)).rejects.toMatchObject({ status: 422 });
    m.bridge.mockResolvedValueOnce({ olist_proposal_id: "901", proposal_number: "124", contact_id: "77", created: true, snapshot: snapshot({ id: "901" }) });
    await pushProposalToOlist("s1", ID);
    expect(m.bridge.mock.calls.map((c) => c[1])).toEqual(["/internal/crm/proposals/upsert", "/internal/crm/proposals/upsert"]);
  });

  it("vendedor sem vínculo Olist é bloqueado antes da chamada externa", async () => {
    m.state.link = null;
    await expect(pushProposalToOlist("s1", ID)).rejects.toMatchObject({ code: "SELLER_NOT_LINKED" });
    expect(m.bridge).not.toHaveBeenCalled();
  });

  it("valores gravados diferentes viram CONFLITO e não contam como sincronizados", async () => {
    m.bridge.mockResolvedValueOnce({ olist_proposal_id: "902", proposal_number: "125", contact_id: "77", created: true, snapshot: snapshot({ discount_cents: 999 }) });
    const r = await pushProposalToOlist("s1", ID);
    expect(r.problems).toEqual(["desconto"]);
    expect(m.state.proposal).toMatchObject({ syncStatus: "CONFLITO", syncedVersion: null });
  });
});


describe('local order operations',()=>{
 function pendingOrder(){Object.assign(m.state.proposal,{commercialStatus:'CONVERTIDA',orderStatus:'PEDIDO_CRIADO',olistOrderId:'5001',olistTotalCents:200000,financialStatus:'AGUARDANDO_PAGAMENTO'});m.state.users.push({id:'master',role:'ADMIN',commercialFunctions:[]});}
 it('uncertain negative search never creates another budget, even after another click',async()=>{
   Object.assign(m.state.proposal,{commercialStatus:'RASCUNHO',olistProposalId:null,olistSnapshotHash:null});
   m.state.attempts.push({action:'PROPOSAL_CREATE',status:'FAILED',errorCode:'BRIDGE_TIMEOUT',response:{bridgeStatus:504}});
   m.bridge.mockResolvedValue({found:false,complete:true});
   for(let i=0;i<2;i++)await expect(pushProposalToOlist('s1',ID)).rejects.toMatchObject({code:'OLIST_CREATE_UNCERTAIN'});
   expect(m.bridge.mock.calls.every(c=>c[1].endsWith('/find'))).toBe(true);
 });
 it('seller and supervisor cannot approve orders, including forged session role',async()=>{
   pendingOrder();for(const user of [{id:'s1',role:'ADMIN' as const},{id:'sup',role:'SUPERVISOR' as const}])await expect(approveExistingOrder(user,ID)).rejects.toMatchObject({status:403});expect(m.bridge).not.toHaveBeenCalled();
 });
 it('Master approves existing order, updates badge, audits and leaves payment untouched',async()=>{
   pendingOrder();m.bridge.mockImplementation(async(_b:string,p:string)=>p.endsWith('/inspect')?{order:orderInspection}:{order:{...orderInspection,situation_code:3},already_approved:false});
   await approveExistingOrder({id:'master',role:'ADMIN'},ID);
   expect(m.bridge.mock.calls.map(c=>c[1])).toEqual(['/internal/crm/orders/inspect','/internal/crm/orders/approve']);
   expect(m.state.proposal).toMatchObject({orderStatus:'PEDIDO_APROVADO',financialStatus:'AGUARDANDO_PAGAMENTO'});expect(m.state.events).toContain('ORDER_APPROVED_BY_MASTER');expect(m.syncStatus).not.toHaveBeenCalled();
 });
 it.each([{...orderInspection,contact_tax_id:'99999999999'},{...orderInspection,seller_id:'66'},{...orderInspection,total_cents:999},{...orderInspection,situation_code:2}])('does not approve divergent or cancelled order',async(order)=>{
   pendingOrder();m.bridge.mockResolvedValue({order});await expect(approveExistingOrder({id:'master',role:'ADMIN'},ID)).rejects.toBeTruthy();expect(m.bridge).toHaveBeenCalledTimes(1);
 });
 it('uncertain approval keeps local badge pending and does not repeat the write automatically',async()=>{
   pendingOrder();m.bridge.mockResolvedValueOnce({order:orderInspection}).mockRejectedValueOnce(new OlistBridgeError('Timeout','BRIDGE_TIMEOUT',504));
   await expect(approveExistingOrder({id:'master',role:'ADMIN'},ID)).rejects.toMatchObject({code:'ORDER_APPROVAL_UNCERTAIN'});expect(m.bridge).toHaveBeenCalledTimes(2);expect(m.state.proposal.orderStatus).toBe('PEDIDO_CRIADO');
 });
 it('financial values are not exposed to seller; stock query stays in proposal brand',async()=>{
   await expect(consultProposal({id:'s1',role:'VENDEDOR'},ID,'financial')).rejects.toMatchObject({status:403});expect(m.bridge).not.toHaveBeenCalled();
   m.bridge.mockResolvedValue({stock:[{sku:'C4-BLK',available:9,reserved:0}],checked_at:new Date().toISOString()});
   const check=await preflightProposal({id:'s1',role:'VENDEDOR'},ID);expect(check.problems.join(' ')).toContain('disponível 9');expect(m.bridge.mock.calls[0][0]).toBe('MIBRO');expect(m.bridge.mock.calls[0][2]).toMatchObject({brand:'mibro',kind:'stock',skus:['C4-BLK']});
 });
 it('inactive/removed account cannot reuse session role',async()=>{
   await expect(authorize({id:'deleted-master',role:'ADMIN'},ID,'view')).rejects.toMatchObject({status:401});expect(m.bridge).not.toHaveBeenCalled();
 });
});
