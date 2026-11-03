import assert from "node:assert/strict";
import test from "node:test";

import {
  BRIDGE_BRANDS,
  crmPurchaseNumber,
  deploymentBrand,
  formatTaxId,
  identityHash,
  internalOrderNotes,
  isAuthorizedCrmRequest,
  isValidTaxId,
  olistConfirmedItems,
  payloadHash,
  taxIdPersonType,
  validateCrmOrderPayload,
} from "../app/services/crm-order-bridge-rules.js";
import { buildCrmProposalHtml, validateCrmProposalEmail } from "../app/services/crm-proposal-email.server.js";
import { allocateCommercialItemPrices, findOlistOrderItemPriceMismatch } from "../app/services/wholesale-order-values.server.js";

const mibro = BRIDGE_BRANDS.mibro;
const QUOTE_ID = "cmuzq1a2b3c4d5e6f7g8h9i0";

function payload(overrides = {}) {
  return {
    crm_quote_id: QUOTE_ID,
    brand: "mibro",
    tax_id: "11.222.333/0001-81",
    company_name: "Loja Teste LTDA",
    email: "compras@loja.com.br",
    price_group: "REPRESENTATIVE",
    selected_tier: "tier3",
    automatic_tier: "tier1",
    products: [{ sku: "c4-black", name: "Mibro C4", quantity: 10, unit_price_cents: 24200, price_tier: "tier3" }],
    discount_cents: 0,
    subtotal_cents: 242000,
    total_cents: 242000,
    ...overrides,
  };
}

test("aceita o preço validado pelo CRM (representante C4 x10 na Tabela 3 = R$ 242)", () => {
  const p = validateCrmOrderPayload(payload(), mibro);
  assert.equal(p.products[0].sku, "C4-BLACK");
  assert.equal(p.products[0].unitPriceCents, 24200);
  assert.equal(p.commercialTotalCents, 242000);
  assert.equal(p.priceTier, "tier3");
  assert.equal(p.publicToken, `crm-${QUOTE_ID}`);
  assert.equal(p.totalQuantity, 10);
});

test("sem pedido mínimo: 1 unidade é aceita", () => {
  const p = validateCrmOrderPayload(payload({ products: [{ sku: "C4-BLACK", quantity: 1, unit_price_cents: 27800 }], subtotal_cents: 27800, total_cents: 27800 }), mibro);
  assert.equal(p.totalQuantity, 1);
});

test("recusa totais que não fecham, preço zero, desconto inválido e SKU repetido", () => {
  assert.throws(() => validateCrmOrderPayload(payload({ subtotal_cents: 1 }), mibro), { code: "SUBTOTAL_MISMATCH" });
  assert.throws(() => validateCrmOrderPayload(payload({ total_cents: 1 }), mibro), { code: "TOTAL_MISMATCH" });
  assert.throws(() => validateCrmOrderPayload(payload({ products: [{ sku: "X", quantity: 1, unit_price_cents: 0 }] }), mibro), { code: "INVALID_UNIT_PRICE" });
  assert.throws(() => validateCrmOrderPayload(payload({ discount_cents: 242000 }), mibro), { code: "INVALID_DISCOUNT" });
  assert.throws(
    () => validateCrmOrderPayload(payload({ products: [{ sku: "A", quantity: 1, unit_price_cents: 1 }, { sku: "a", quantity: 1, unit_price_cents: 1 }] }), mibro),
    { code: "DUPLICATE_SKU" },
  );
});

test("marcas não se misturam: pedido Sincrofit na instalação Mibro é recusado", () => {
  assert.throws(() => validateCrmOrderPayload(payload({ brand: "sincrofit" }), mibro), { code: "BRAND_MISMATCH" });
});

test("documento: CPF e CNPJ válidos, inválidos recusados", () => {
  assert.equal(isValidTaxId("11222333000181"), true);
  assert.equal(isValidTaxId("52998224725"), true);
  assert.equal(isValidTaxId("11111111111"), false);
  assert.equal(isValidTaxId("11222333000180"), false);
  assert.equal(formatTaxId("52998224725"), "529.982.247-25");
  assert.equal(taxIdPersonType("52998224725"), "F");
  assert.equal(taxIdPersonType("11222333000181"), "J");
  assert.throws(() => validateCrmOrderPayload(payload({ tax_id: "123" }), mibro), { code: "INVALID_TAX_ID" });
});

test("número de ordem de compra é determinístico por cotação (idempotência/recuperação)", () => {
  assert.equal(crmPurchaseNumber(QUOTE_ID), crmPurchaseNumber(QUOTE_ID));
  assert.notEqual(crmPurchaseNumber(QUOTE_ID), crmPurchaseNumber(`${QUOTE_ID}x`));
  assert.match(crmPurchaseNumber(QUOTE_ID), /^CRM-[0-9A-Z]{8}$/);
});

test("hash muda com preço/faixa, identidade só com dados do cliente", () => {
  const a = validateCrmOrderPayload(payload(), mibro);
  const b = validateCrmOrderPayload(payload({ selected_tier: "tier2", products: [{ sku: "C4-BLACK", quantity: 10, unit_price_cents: 25700 }], subtotal_cents: 257000, total_cents: 257000 }), mibro);
  assert.notEqual(payloadHash(a), payloadHash(b));
  assert.equal(identityHash(a), identityHash(b));
});

test("observações internas registram grupo, faixa manual e automática", () => {
  const notes = internalOrderNotes(validateCrmOrderPayload(payload(), mibro), mibro);
  assert.match(notes, /MIBRO ATACADO/);
  assert.match(notes, /representantes/);
  assert.match(notes, /Tabela 3 \(manual; automática seria Tabela 1\)/);
});

test("autenticação em tempo constante com o segredo da marca", () => {
  assert.equal(isAuthorizedCrmRequest("Bearer segredo-mibro", "segredo-mibro"), true);
  assert.equal(isAuthorizedCrmRequest("Bearer outro", "segredo-mibro"), false);
  assert.equal(isAuthorizedCrmRequest("", "segredo-mibro"), false);
  assert.equal(isAuthorizedCrmRequest("Bearer x", ""), false);
});

test("marca da instalação vem do ambiente", () => {
  assert.equal(deploymentBrand({ WHOLESALE_BRAND: "sincrofit" }).key, "sincrofit");
  assert.equal(deploymentBrand({ SHOPIFY_APP_URL: "https://sincrofit-app.example" }).key, "sincrofit");
  assert.equal(deploymentBrand({}).key, "mibro");
});

test("19. divergência de preço devolvida pelo Olist é detectada", () => {
  const p = validateCrmOrderPayload(payload(), mibro);
  const ok = { itens: [{ produto: { sku: "C4-BLACK" }, quantidade: 10, valorUnitario: 242 }] };
  const wrong = { itens: [{ produto: { sku: "C4-BLACK" }, quantidade: 10, valorUnitario: 235 }] };
  assert.equal(findOlistOrderItemPriceMismatch(p, ok), null);
  assert.equal(findOlistOrderItemPriceMismatch(p, wrong).returned_unit_price, 23500);
  assert.deepEqual(olistConfirmedItems(ok), [{ sku: "C4-BLACK", quantity: 10, unit_price_cents: 24200 }]);
});

test("18. valor unitário enviado ao Olist = preço do CRM (com desconto rateado)", () => {
  const p = validateCrmOrderPayload(payload({ discount_cents: 2000, total_cents: 240000 }), mibro);
  const [line] = allocateCommercialItemPrices(p.products, p.discountCents);
  assert.equal(line.lineTotalCents, 240000);
  assert.equal(line.unitPrice, 240);
});

test("e-mail da proposta: valida e escapa conteúdo", () => {
  const p = validateCrmProposalEmail(
    { brand: "mibro", crm_quote_id: QUOTE_ID, to: "Cliente@Loja.com", customer_name: "<b>Loja</b>", items: [{ name: "Mibro C4", sku: "C4-BLACK", quantity: 10, unit_price_cents: 24200 }] },
    mibro,
  );
  assert.equal(p.to, "cliente@loja.com");
  assert.equal(p.total, 242000);
  const html = buildCrmProposalHtml(p, { name: "Mibro", primary: "#f63", background: "#fff", border: "#eee" });
  assert.match(html, /&lt;b&gt;Loja&lt;\/b&gt;/);
  assert.throws(() => validateCrmProposalEmail({ brand: "sincrofit", crm_quote_id: QUOTE_ID }, mibro), { code: "BRAND_MISMATCH" });
});
