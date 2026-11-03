import assert from "node:assert/strict";
import test from "node:test";

import { BRIDGE_BRANDS } from "../app/services/crm-order-bridge-rules.js";
import {
  buildOrcamentoBody,
  centsToReaisString,
  hasReference,
  normalizeOrcamento,
  normalizeOrder,
  normalizeSellers,
  validateProposalPayload,
} from "../app/services/crm-proposal-bridge-rules.js";

const mibro = BRIDGE_BRANDS.mibro;
const payload = (over = {}) => ({
  brand: "mibro",
  crm_proposal_id: "ckproposal0000000000000001",
  crm_reference: "CRM-0000000001",
  olist_proposal_id: null,
  seller_olist_id: "55",
  customer: {
    tax_id: "11222333000181",
    company_name: "Loja Ana LTDA",
    email: "ana@loja.invalid",
    address: { street: "Rua A", number: "1", district: "Centro", city: "São Paulo", state: "sp", zip: "01000-000" },
  },
  items: [{ sku: "c4-blk", description: "Mibro C4 — Preto", quantity: 10, unit_price_cents: 19990 }],
  discount_cents: 1000,
  freight_cents: 2550,
  freight_responsibility: "R",
  payment: { type: "Parcelas", condition: "30 60 90" },
  validity_days: 7,
  delivery_term: "10 dias úteis",
  customer_notes: "Obrigado pela preferência.",
  ...over,
});

test("valida payload e normaliza SKU, endereço e valores", () => {
  const p = validateProposalPayload(payload(), mibro);
  assert.equal(p.items[0].sku, "C4-BLK");
  assert.equal(p.customer.address.state, "SP");
  assert.equal(p.customer.address.zip, "01000000");
  assert.equal(p.sellerOlistId, "55");
});

test("recusa marca errada, vendedor ausente, desconto inválido e condição malformada", () => {
  assert.throws(() => validateProposalPayload(payload({ brand: "sincrofit" }), mibro), { code: "BRAND_MISMATCH" });
  assert.throws(() => validateProposalPayload(payload({ seller_olist_id: null }), mibro), { code: "INVALID_OLIST_ID" });
  assert.throws(() => validateProposalPayload(payload({ discount_cents: 199900 }), mibro), { code: "INVALID_DISCOUNT" });
  assert.throws(() => validateProposalPayload(payload({ payment: { type: "Parcelas", condition: "trinta dias" } }), mibro), { code: "INVALID_PAYMENT_CONDITION" });
  assert.throws(() => validateProposalPayload(payload({ items: [payload().items[0], payload().items[0]] }), mibro), { code: "DUPLICATE_SKU" });
});

test("monta o corpo do orçamento com vendedor, referência, extras em reais e preço como texto", () => {
  const p = validateProposalPayload(payload(), mibro);
  const body = buildOrcamentoBody(p, { contactId: "77", productIds: new Map([["C4-BLK", "333"]]), natureId: null, today: "2026-10-30" });
  assert.deepEqual(body.vendedor, { id: 55 });
  assert.deepEqual(body.contato, { id: 77 });
  assert.deepEqual(body.itens[0], { produto: { id: 333 }, quantidade: 10, valorUnitario: "199.90", descrComplementarOrc: "Mibro C4 — Preto" });
  assert.deepEqual(body.extras, { desconto: 10, frete: 25.5 });
  assert.deepEqual(body.condicoesComerciais, { tipo: "Parcelas", parcelas: [{ condicao: "30 60 90" }] });
  assert.deepEqual(body.condicoesGerais, { validade: 7, descricaoPrazoEntrega: "10 dias úteis" });
  assert.deepEqual(body.transportador, { fretePorConta: "R" });
  assert.ok(hasReference(body.observacao, "CRM-0000000001"));
  assert.ok(!hasReference("Ref. CRM-0000000001X", "CRM-0000000001"));
  assert.equal(centsToReaisString(5), "0.05");
});

test("normaliza a leitura do orçamento em centavos", () => {
  const s = normalizeOrcamento({
    id: 900, numeroProposta: "123", situacao: "Rascunho", contato: { id: 77 }, vendedor: { id: 55 },
    itens: [{ produto: { id: 333, sku: "c4-blk" }, quantidade: 10, valorUnitario: 199.9 }],
    valorSubtotal: 1999, valorTotal: 2014.5, extras: { desconto: 10, frete: 25.5 },
    condicoesComerciais: { tipo: "Parcelas", parcelas: [{ condicao: "30 60 90" }] }, condicoesGerais: { validade: 7 },
  });
  assert.deepEqual(s.items, [{ sku: "C4-BLK", quantity: 10, unit_price_cents: 19990 }]);
  assert.equal(s.total_cents, 201450);
  assert.equal(s.discount_cents, 1000);
  assert.equal(s.seller_id, "55");
  assert.equal(s.payment.condition, "30 60 90");
});

test("normaliza pedido com situação, documento e contas a receber", () => {
  const o = normalizeOrder(
    { id: 5001, numeroPedido: "7001", situacao: 3, cliente: { cpfCnpj: "11.222.333/0001-81" }, vendedor: { id: 55 }, itens: [{ produto: { sku: "C4-BLK" }, quantidade: 10, valorUnitario: 199.9 }], valorTotalPedido: 2014.5 },
    [{ id: 1, situacao: "parcial", valor: 1000, saldo: 400 }],
  );
  assert.equal(o.situation_code, 3);
  assert.equal(o.situation_label, "Aprovada");
  assert.equal(o.contact_tax_id, "11222333000181");
  assert.deepEqual(o.receivables, [{ id: "1", situation: "parcial", amount_cents: 100000, balance_cents: 40000 }]);
  assert.throws(() => normalizeOrder(null), { code: "OLIST_ORDER_NOT_FOUND" });
});

test("normaliza vendedores do Olist", () => {
  assert.deepEqual(normalizeSellers([{ id: 55, situacao: "A", contato: { nome: "Ana Vendas", codigo: "027", email: "ana@x.invalid" } }, { situacao: "A" }]), [
    { id: "55", name: "Ana Vendas", code: "027", situation: "A", email: "ana@x.invalid" },
  ]);
});
