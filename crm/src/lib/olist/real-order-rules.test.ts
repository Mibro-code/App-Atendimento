import { describe, expect, it } from "vitest";
import { buildBridgeOrderPayload, customerOrderReadiness, isValidCnpj, isValidCpf, verifyOlistOrder, type OrderCustomer } from "./real-order-rules";

const customer: OrderCustomer = {
  contactName: "Ana Compras",
  legalName: "Loja Teste LTDA",
  tradeName: "Loja Teste",
  cnpjDigits: "11222333000181",
  cpfDigits: null,
  email: "compras@loja.com.br",
  phoneDigits: "11999990000",
  addressStreet: "Rua A",
  addressNumber: "10",
  addressDistrict: "Centro",
  addressComplement: null,
  city: "São Paulo",
  state: "SP",
  zipDigits: "01001000",
};

const items = [{ sku: "C4-BLACK", productName: "Mibro C4", colorName: "Black", quantity: 10, unitPriceCents: 24200, appliedTier: "TIER3" as const }];

describe("cadastro para pedido real", () => {
  it("valida CNPJ/CPF", () => {
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("11111111111")).toBe(false);
  });

  it("cadastro completo não tem pendências", () => {
    expect(customerOrderReadiness(customer)).toEqual([]);
  });

  it("documento e e-mail bloqueiam; endereço só avisa", () => {
    const r = customerOrderReadiness({ ...customer, cnpjDigits: null, email: null, addressStreet: null, zipDigits: "123" });
    expect(r.filter((m) => m.level === "blocking").map((m) => m.field)).toEqual(["document", "email"]);
    expect(r.filter((m) => m.level === "warning").map((m) => m.field)).toEqual(["addressStreet", "zipDigits"]);
  });

  it("aceita CPF quando não há CNPJ", () => {
    expect(customerOrderReadiness({ ...customer, cnpjDigits: null, cpfDigits: "52998224725" })).toEqual([]);
  });
});

describe("payload enviado à ponte", () => {
  it("leva preço do CRM, grupo e faixas (representante C4 x10 Tabela 3)", () => {
    const p = buildBridgeOrderPayload({
      quoteId: "q1", brand: "MIBRO", customer, sellerName: "Rep", notes: null, priceGroup: "REPRESENTATIVE",
      selectedTier: "TIER3", quantityRule: "MIX", discountCents: 0, items,
    });
    expect(p).toMatchObject({
      brand: "mibro", tax_id: "11222333000181", company_name: "Loja Teste LTDA", price_group: "REPRESENTATIVE",
      selected_tier: "tier3", automatic_tier: "tier1", quantity_rule: "mixed", subtotal_cents: 242000, total_cents: 242000,
    });
    expect(p.products[0]).toEqual({ sku: "C4-BLACK", name: "Mibro C4 — Black", quantity: 10, unit_price_cents: 24200, price_tier: "tier3" });
  });
});

describe("conferência do pedido gravado no Olist", () => {
  const response = (unit: number | null, total = 242000, extra = {}) => ({
    olist_order_id: "1",
    values: { total_sent_to_olist: total },
    items_confirmed: [{ sku: "C4-BLACK", quantity: 10, unit_price_cents: unit }],
    ...extra,
  });

  it("18. valores iguais = verificado", () => {
    expect(verifyOlistOrder(items, 0, response(24200))).toEqual({ verified: true, problems: [] });
  });

  it("19. preço diferente devolvido pelo Olist é divergência", () => {
    const v = verifyOlistOrder(items, 0, response(23500));
    expect(v.verified).toBe(false);
    expect(v.problems).toEqual([{ sku: "C4-BLACK", field: "unit_price_cents", expected: 24200, received: 23500 }]);
  });

  it("desconto rateado é considerado (R$ 20 em 10 un. → R$ 240,00)", () => {
    expect(verifyOlistOrder(items, 2000, response(24000, 240000)).verified).toBe(true);
  });

  it("sem itens na resposta não é declarado como verificado", () => {
    expect(verifyOlistOrder(items, 0, { olist_order_id: "1", values: { total_sent_to_olist: 242000 }, items_confirmed: [] }).verified).toBe(false);
  });

  it("total ou quantidade diferentes são divergência", () => {
    expect(verifyOlistOrder(items, 0, response(24200, 999)).problems[0].field).toBe("total_sent_to_olist");
    expect(verifyOlistOrder(items, 0, { ...response(24200), items_confirmed: [{ sku: "C4-BLACK", quantity: 9, unit_price_cents: 24200 }] }).problems[0].field).toBe("quantity");
  });
});
