import { describe, expect, it } from "vitest";
import {
  buildBridgeProposalPayload,
  crmReference,
  financialFromReceivables,
  isAmbiguousFailure,
  isApprovedOrLater,
  isConcludedSituation,
  orderStatusFromSituation,
  validateOrderForProposal,
  verifyProposalReadback,
  type OlistOrderInspection,
  type OlistProposalSnapshot,
} from "./proposal-olist-rules";

const customer = {
  contactName: "Ana", legalName: "Loja Ana LTDA", tradeName: "Loja Ana", cnpjDigits: "11222333000181", cpfDigits: null,
  email: "ana@loja.invalid", phoneDigits: "11999990000", addressStreet: "Rua A", addressNumber: "1", addressDistrict: "Centro",
  addressComplement: null, city: "São Paulo", state: "sp", zipDigits: "01000-000",
};
const content = {
  items: [{ sku: "C4-BLK", quantity: 10, unitPriceCents: 20000 }],
  discountCents: 1000, freightCents: 500, freightResponsibility: "R", paymentType: "Parcelas", paymentCondition: "30 60",
  paymentText: null, validityDays: 7, deliveryTerm: "10 dias", olistSellerId: "55", customerNotes: "Obrigado",
};
const snapshot = (over: Partial<OlistProposalSnapshot> = {}): OlistProposalSnapshot => ({
  id: "900", number: "123", situation: "Rascunho", contact_id: "77", seller_id: "55",
  items: [{ sku: "C4-BLK", quantity: 10, unit_price_cents: 20000 }], subtotal_cents: 200000, total_cents: 210000,
  discount_cents: 1000, freight_cents: 500, payment: { type: "Parcelas", condition: "30 60", text: null }, validity_days: 7, delivery_term: "10 dias",
  ...over,
});

describe("payload da ponte", () => {
  it("envia vendedor Olist vinculado, referência do CRM e valores em centavos", () => {
    const p = buildBridgeProposalPayload({ proposalId: "ckproposal0000000001", version: 2, brand: "MIBRO", customer, content, itemNames: { "C4-BLK": "Mibro C4 — Preto" }, olistProposalId: null, natureId: null });
    expect(p).toMatchObject({ brand: "mibro", seller_olist_id: "55", version: 2, discount_cents: 1000, freight_cents: 500, crm_reference: crmReference("ckproposal0000000001") });
    expect(p.customer).toMatchObject({ tax_id: "11222333000181", company_name: "Loja Ana LTDA" });
    expect(p.customer.address).toMatchObject({ state: "SP", zip: "01000000" });
    expect(p.items[0]).toEqual({ sku: "C4-BLK", description: "Mibro C4 — Preto", quantity: 10, unit_price_cents: 20000 });
  });
});

describe("conferência e conflitos", () => {
  it("aceita leitura idêntica e acusa alteração feita no Olist (21)", () => {
    expect(verifyProposalReadback(content, snapshot())).toEqual([]);
    expect(verifyProposalReadback(content, snapshot({ items: [{ sku: "C4-BLK", quantity: 12, unit_price_cents: 20000 }] }))).toEqual(["itens, quantidades ou preços"]);
    expect(verifyProposalReadback(content, snapshot({ discount_cents: 0, seller_id: "99" }))).toEqual(["desconto", "vendedor"]);
  });

  it("reconhece proposta concluída no Olist", () => {
    expect(isConcludedSituation("Concluído")).toBe(true);
    expect(isConcludedSituation("Aprovado")).toBe(false);
  });

  it("falhas de rede e 5xx são ambíguas e não são repetidas às cegas (20)", () => {
    expect(isAmbiguousFailure("BRIDGE_TIMEOUT", 504)).toBe(true);
    expect(isAmbiguousFailure("BRIDGE_UNREACHABLE", 504)).toBe(true);
    expect(isAmbiguousFailure("OLIST_REQUEST_REJECTED", 400)).toBe(false);
    expect(isAmbiguousFailure("INTERNAL_ERROR", 500)).toBe(true);
  });
});

describe("pedido e financeiro", () => {
  it("mapeia códigos documentados e preserva o anterior quando desconhecido", () => {
    expect(orderStatusFromSituation(0, "SEM_PEDIDO")).toBe("PEDIDO_CRIADO");
    expect(orderStatusFromSituation(3, "PEDIDO_CRIADO")).toBe("PEDIDO_APROVADO");
    expect(orderStatusFromSituation(1, "PEDIDO_APROVADO")).toBe("FATURADO");
    expect(orderStatusFromSituation(2, "PEDIDO_APROVADO")).toBe("CANCELADO");
    expect(orderStatusFromSituation(42, "PEDIDO_APROVADO")).toBe("PEDIDO_APROVADO");
    expect(isApprovedOrLater(0)).toBe(false);
    expect(isApprovedOrLater(3)).toBe(true);
  });

  it("pedido criado ou aprovado não é pagamento (22)", () => {
    expect(financialFromReceivables([]).status).toBe("SEM_COBRANCA");
    expect(financialFromReceivables([{ id: "1", situation: "aberto", amount_cents: 1000, balance_cents: 1000 }]).status).toBe("AGUARDANDO_PAGAMENTO");
  });

  it("pagamento parcial não é confundido com integral (23)", () => {
    const partial = financialFromReceivables([
      { id: "1", situation: "pago", amount_cents: 1000, balance_cents: 0 },
      { id: "2", situation: "aberto", amount_cents: 1000, balance_cents: 1000 },
    ]);
    expect(partial).toEqual({ status: "PAGAMENTO_PARCIAL", dueCents: 2000, paidCents: 1000, openCents: 1000 });
    const full = financialFromReceivables([
      { id: "1", situation: "pago", amount_cents: 1000, balance_cents: 0 },
      { id: "2", situation: "pago", amount_cents: 1000, balance_cents: null },
      { id: "3", situation: "cancelada", amount_cents: 500, balance_cents: 500 },
    ]);
    expect(full).toEqual({ status: "PAGAMENTO_CONFIRMADO", dueCents: 2000, paidCents: 2000, openCents: 0 });
    expect(financialFromReceivables([{ id: "1", situation: "cancelada", amount_cents: 1, balance_cents: 1 }]).status).toBe("CANCELADO");
  });

  it("vínculo manual exige mesmo cliente, vendedor e itens — não só valores", () => {
    const order: OlistOrderInspection = {
      id: "5", number: "1001", situation_code: 0, situation_label: "Aberta", contact_tax_id: "11.222.333/0001-81", seller_id: "55",
      items: [{ sku: "c4-blk", quantity: 10, unit_price_cents: 20000 }], total_cents: 199500, invoice_id: null, receivables: [],
    };
    const expected = { taxId: "11222333000181", olistSellerId: "55", items: [{ sku: "C4-BLK", quantity: 10 }] };
    expect(validateOrderForProposal(order, expected)).toEqual([]);
    expect(validateOrderForProposal({ ...order, contact_tax_id: "99999999000199" }, expected)).toHaveLength(1);
    expect(validateOrderForProposal({ ...order, seller_id: "77" }, expected)).toHaveLength(1);
    expect(validateOrderForProposal({ ...order, items: [{ sku: "C4-BLK", quantity: 9, unit_price_cents: 20000 }] }, expected)).toHaveLength(1);
    expect(validateOrderForProposal({ ...order, situation_code: 2 }, expected)).toContain("O pedido está cancelado no Olist.");
  });
});
