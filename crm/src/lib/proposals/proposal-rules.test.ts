import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  contentHash,
  diffMaterial,
  discountBps,
  effectiveCommercialStatus,
  materialHash,
  needsDiscountJustification,
  proposalTotals,
  requiredApproverLevel,
  validUntilFrom,
  type ProposalContent,
} from "./proposal-rules";

const content = (over: Partial<ProposalContent> = {}): ProposalContent => ({
  items: [{ sku: "C4-BLK", quantity: 10, unitPriceCents: 20000 }],
  discountCents: 0,
  freightCents: 0,
  freightResponsibility: null,
  paymentType: "Parcelas",
  paymentCondition: "30 60",
  paymentText: null,
  validityDays: 7,
  deliveryTerm: null,
  olistSellerId: "55",
  customerNotes: null,
  ...over,
});

describe("máquina de estados comercial", () => {
  it("não permite pular etapas obrigatórias", () => {
    expect(canTransition("RASCUNHO", "ENVIADA")).toBe(false);
    expect(canTransition("RASCUNHO", "ACEITA")).toBe(false);
    expect(canTransition("APROVADA_INTERNAMENTE", "CONVERTIDA")).toBe(false);
    expect(canTransition("ENVIADA", "CONVERTIDA")).toBe(false);
    expect(() => assertTransition("AGUARDANDO_APROVACAO", "ENVIADA")).toThrow(/Transição não permitida/);
  });

  it("segue o fluxo completo até a conversão", () => {
    const path = ["RASCUNHO", "AGUARDANDO_APROVACAO", "APROVADA_INTERNAMENTE", "ENVIADA", "ACEITA", "CONVERSAO_SOLICITADA", "CONVERTIDA"] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i])).toBe(true);
  });

  it("estados finais não têm saída", () => {
    for (const to of ["RASCUNHO", "ENVIADA", "ACEITA", "CANCELADA"] as const) {
      expect(canTransition("CONVERTIDA", to)).toBe(false);
      expect(canTransition("CANCELADA", to)).toBe(false);
    }
  });

  it("validade vencida transforma estados abertos em EXPIRADA, mas não os finais", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const past = new Date("2026-11-01T00:00:00Z");
    expect(effectiveCommercialStatus({ commercialStatus: "ACEITA", validUntil: past }, now)).toBe("EXPIRADA");
    expect(effectiveCommercialStatus({ commercialStatus: "CONVERTIDA", validUntil: past }, now)).toBe("CONVERTIDA");
    expect(effectiveCommercialStatus({ commercialStatus: "ENVIADA", validUntil: null }, now)).toBe("ENVIADA");
  });

  it("validade termina no fim do dia em Brasília", () => {
    const end = validUntilFrom(new Date("2026-10-30T15:00:00Z"), 7)!;
    expect(end.toISOString()).toBe("2026-11-07T02:59:59.999Z");
    expect(validUntilFrom(new Date(), null)).toBeNull();
  });
});

describe("versão material", () => {
  it("alteração de preço, quantidade, desconto, frete, pagamento ou validade muda o hash material", () => {
    const base = materialHash(content());
    expect(materialHash(content({ items: [{ sku: "C4-BLK", quantity: 11, unitPriceCents: 20000 }] }))).not.toBe(base);
    expect(materialHash(content({ items: [{ sku: "C4-BLK", quantity: 10, unitPriceCents: 19999 }] }))).not.toBe(base);
    expect(materialHash(content({ discountCents: 100 }))).not.toBe(base);
    expect(materialHash(content({ freightCents: 100 }))).not.toBe(base);
    expect(materialHash(content({ paymentCondition: "30 60 90" }))).not.toBe(base);
    expect(materialHash(content({ validityDays: 10 }))).not.toBe(base);
  });

  it("observação ao cliente cria nova versão sem exigir nova aprovação", () => {
    const changed = content({ customerNotes: "Entrega combinada" });
    expect(materialHash(changed)).toBe(materialHash(content()));
    expect(contentHash(changed)).not.toBe(contentHash(content()));
  });

  it("ordem dos itens e espaços não alteram o hash", () => {
    const a = content({ items: [{ sku: "A", quantity: 1, unitPriceCents: 1 }, { sku: "B", quantity: 2, unitPriceCents: 2 }] });
    const b = content({ items: [{ sku: "b ", quantity: 2, unitPriceCents: 2 }, { sku: "a", quantity: 1, unitPriceCents: 1 }], paymentCondition: " 30  60 " });
    expect(materialHash(a)).toBe(materialHash(b));
    expect(diffMaterial(a, content({ ...a, freightCents: 5 }))).toEqual(["freightCents"]);
  });

  it("totais incluem frete e descontam o desconto", () => {
    expect(proposalTotals(content({ discountCents: 1000, freightCents: 500 }))).toEqual({ subtotalCents: 200000, totalCents: 199500 });
    expect(discountBps(1000, 200000)).toBe(50);
    expect(discountBps(0, 0)).toBe(0);
  });
});

describe("alçadas de desconto", () => {
  it("sem configuração não presume percentual: supervisor aprova só sem desconto", () => {
    const none = { seller: null, supervisor: null, manager: null };
    expect(requiredApproverLevel(0, none)).toBe("SUPERVISOR");
    expect(requiredApproverLevel(1, none)).toBe("GERENTE_COMERCIAL");
    expect(needsDiscountJustification(1, none)).toBe(true);
    expect(needsDiscountJustification(0, none)).toBe(false);
  });

  it("respeita os limites configurados", () => {
    const limits = { seller: 300, supervisor: 800, manager: 1500 };
    expect(requiredApproverLevel(800, limits)).toBe("SUPERVISOR");
    expect(requiredApproverLevel(801, limits)).toBe("GERENTE_COMERCIAL");
    expect(requiredApproverLevel(1501, limits)).toBe("ADMIN");
    expect(needsDiscountJustification(300, limits)).toBe(false);
    expect(needsDiscountJustification(301, limits)).toBe(true);
  });
});
