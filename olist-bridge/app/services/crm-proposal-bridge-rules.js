// Regras puras da ponte CRM -> Olist para PROPOSTAS COMERCIAIS (orçamentos,
// API V3). Sem banco e sem rede. O CRM envia valores em centavos; aqui eles
// viram reais no formato do Olist e as respostas voltam normalizadas.
//
// Campos usados (especificação oficial V3, swagger-mintlify.json):
//   POST/PUT /orcamentos            CriarOrcamentoModelRequest
//   GET /orcamentos/{id}            ObterOrcamentoModelResponse
//   POST /orcamentos/{id}/venda     -> { id, numeroPedido }
//   GET /pedidos/{id}               ObterPedidoModelResponse
//   GET /contas-receber?idVenda=    ListagemContasReceberResponseModel
//   GET /vendedores                 ListagemVendedoresModelResponse

import { CrmBridgeError, isValidTaxId, onlyDigits } from "./crm-order-bridge-rules.js";

function fail(message, code, status = 422, details) {
  throw new CrmBridgeError(message, { code, status, details });
}

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const ID_RE = /^\d{1,20}$/;

export const PAYMENT_TYPES = new Set(["Nenhuma", "Parcelas", "Texto livre"]);
export const FREIGHT_RESPONSIBILITY = new Set(["R", "D", "T", "3", "4", "S"]);
export const PROPOSAL_SITUATIONS = new Set(["Aguardando", "Aprovado", "Concluído", "Em aberto", "Não aprovado", "Pendente", "Rascunho"]);
export const ALLOWED_MARKERS = new Set(["CRM", "CANCELADA NO CRM"]);

export function centsToReais(cents) {
  return Math.round(Number(cents)) / 100;
}

export function centsToReaisString(cents) {
  return (Math.round(Number(cents)) / 100).toFixed(2);
}

export function reaisToCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function assertBrand(raw, brand) {
  const requested = text(raw?.brand, 20).toLowerCase();
  if (requested !== brand.key) {
    fail(`Esta integração atende somente ${brand.label}.`, "BRAND_MISMATCH", 409, { expected: brand.key, received: requested });
  }
}

export function requireOlistId(value, label) {
  const id = text(value, 20);
  if (!ID_RE.test(id)) fail(`Identificador ${label} inválido.`, "INVALID_OLIST_ID", 400);
  return id;
}

/** Valida o payload de criação/atualização vindo do CRM (autenticado pelo segredo da marca). */
export function validateProposalPayload(raw, brand) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Payload inválido.", "INVALID_PAYLOAD", 400);
  assertBrand(raw, brand);

  const crmProposalId = text(raw.crm_proposal_id, 60);
  if (!/^[a-z0-9]{20,40}$/i.test(crmProposalId)) fail("Identificador da proposta do CRM inválido.", "INVALID_CRM_PROPOSAL_ID", 400);
  const reference = text(raw.crm_reference, 30);
  if (!/^CRM-[A-Z0-9]{6,20}$/.test(reference)) fail("Referência do CRM inválida.", "INVALID_CRM_REFERENCE", 400);
  const olistProposalId = raw.olist_proposal_id ? requireOlistId(raw.olist_proposal_id, "da proposta no Olist") : null;
  const sellerOlistId = requireOlistId(raw.seller_olist_id, "do vendedor no Olist");

  const c = raw.customer || {};
  const taxId = onlyDigits(c.tax_id);
  if (!isValidTaxId(taxId)) fail("CPF ou CNPJ inválido.", "INVALID_TAX_ID");
  const companyName = text(c.company_name, 200);
  if (!companyName) fail("Informe o nome ou razão social do cliente.", "COMPANY_NAME_MISSING");

  if (!Array.isArray(raw.items) || raw.items.length === 0) fail("Nenhum produto na proposta.", "EMPTY_PRODUCTS");
  if (raw.items.length > 100) fail("Produtos demais na proposta.", "TOO_MANY_PRODUCTS");
  const seen = new Set();
  const items = raw.items.map((item, index) => {
    const sku = text(item?.sku, 120).toUpperCase();
    const quantity = Number(item?.quantity);
    const unitPriceCents = Number(item?.unit_price_cents);
    if (!sku) fail(`SKU ausente no item ${index + 1}.`, "PRODUCT_SKU_MISSING");
    if (seen.has(sku)) fail(`SKU ${sku} repetido.`, "DUPLICATE_SKU");
    seen.add(sku);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100_000) fail(`Quantidade inválida para ${sku}.`, "INVALID_QUANTITY");
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0 || unitPriceCents > 100_000_000) fail(`Preço inválido para ${sku}.`, "INVALID_UNIT_PRICE");
    return { sku, description: text(item?.description || sku, 200), quantity, unitPriceCents };
  });
  const subtotalCents = items.reduce((t, i) => t + i.quantity * i.unitPriceCents, 0);
  const discountCents = Number(raw.discount_cents ?? 0);
  if (!Number.isSafeInteger(discountCents) || discountCents < 0 || discountCents >= subtotalCents) fail("Desconto inválido.", "INVALID_DISCOUNT");
  const freightCents = Number(raw.freight_cents ?? 0);
  if (!Number.isSafeInteger(freightCents) || freightCents < 0 || freightCents > 100_000_000) fail("Frete inválido.", "INVALID_FREIGHT");
  const freightResponsibility = raw.freight_responsibility ? text(raw.freight_responsibility, 2) : null;
  if (freightResponsibility && !FREIGHT_RESPONSIBILITY.has(freightResponsibility)) fail("Responsável pelo frete inválido.", "INVALID_FREIGHT_RESPONSIBILITY");

  const paymentType = text(raw.payment?.type || "Nenhuma", 20);
  if (!PAYMENT_TYPES.has(paymentType)) fail("Tipo de condição de pagamento inválido.", "INVALID_PAYMENT_TYPE");
  const paymentCondition = text(raw.payment?.condition, 60);
  if (paymentType === "Parcelas" && !/^[0-9x+ ,]+$/i.test(paymentCondition)) fail("Condição de pagamento inválida (ex.: 30 60 90, 3x, 30+2x).", "INVALID_PAYMENT_CONDITION");
  const paymentText = text(raw.payment?.text, 500);
  if (paymentType === "Texto livre" && !paymentText) fail("Descreva a condição de pagamento.", "PAYMENT_TEXT_MISSING");

  const validityDays = raw.validity_days === null || raw.validity_days === undefined ? null : Number(raw.validity_days);
  if (validityDays !== null && (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365)) fail("Validade inválida.", "INVALID_VALIDITY");
  const natureId = raw.nature_id ? requireOlistId(raw.nature_id, "da natureza de operação") : null;

  return {
    crmProposalId,
    reference,
    olistProposalId,
    sellerOlistId,
    customer: {
      taxId,
      companyName,
      tradeName: text(c.trade_name, 200),
      email: text(c.email, 200),
      phone: text(c.phone, 40),
      address: {
        street: text(c.address?.street, 200),
        number: text(c.address?.number, 20),
        complement: text(c.address?.complement, 100),
        district: text(c.address?.district, 100),
        city: text(c.address?.city, 100),
        state: text(c.address?.state, 2).toUpperCase(),
        zip: onlyDigits(c.address?.zip).slice(0, 8),
      },
    },
    items,
    discountCents,
    freightCents,
    freightResponsibility,
    payment: { type: paymentType, condition: paymentCondition || null, text: paymentText || null },
    validityDays,
    deliveryTerm: text(raw.delivery_term, 200) || null,
    customerNotes: text(raw.customer_notes, 2000) || null,
    natureId,
  };
}

export function referenceLine(reference) {
  return `Ref. ${reference}`;
}

/** Corpo de POST/PUT /orcamentos. Desconto e frete vão em `extras` (valores absolutos). */
export function buildOrcamentoBody(p, { contactId, productIds, natureId, today }) {
  const body = {
    contato: { id: Number(contactId) },
    data: today,
    vendedor: { id: Number(p.sellerOlistId) },
    observacao: [p.customerNotes, referenceLine(p.reference)].filter(Boolean).join("\n\n"),
    condicoesComerciais:
      p.payment.type === "Parcelas"
        ? { tipo: "Parcelas", parcelas: [{ condicao: p.payment.condition }] }
        : p.payment.type === "Texto livre"
          ? { tipo: "Texto livre", textoLivre: p.payment.text }
          : { tipo: "Nenhuma" },
    condicoesGerais: {
      ...(p.validityDays ? { validade: p.validityDays } : {}),
      ...(p.deliveryTerm ? { descricaoPrazoEntrega: p.deliveryTerm } : {}),
    },
    itens: p.items.map((item) => ({
      produto: { id: Number(productIds.get(item.sku)) },
      quantidade: item.quantity,
      valorUnitario: centsToReaisString(item.unitPriceCents),
      descrComplementarOrc: item.description,
    })),
    extras: { desconto: centsToReais(p.discountCents), frete: centsToReais(p.freightCents) },
  };
  const nature = natureId ?? p.natureId;
  if (nature) body.naturezaOperacao = { id: Number(nature) };
  if (p.freightResponsibility) body.transportador = { fretePorConta: p.freightResponsibility };
  return body;
}

/** Normaliza GET /orcamentos/{id} para o formato do CRM (centavos). */
export function normalizeOrcamento(raw) {
  if (!raw?.id) fail("O Olist não devolveu a proposta.", "OLIST_PROPOSAL_MISSING", 502);
  const parcelas = Array.isArray(raw.condicoesComerciais?.parcelas) ? raw.condicoesComerciais.parcelas : [];
  return {
    id: String(raw.id),
    number: raw.numeroProposta ? String(raw.numeroProposta) : null,
    situation: raw.situacao ?? null,
    contact_id: raw.contato?.id ? String(raw.contato.id) : null,
    seller_id: raw.vendedor?.id ? String(raw.vendedor.id) : null,
    items: (Array.isArray(raw.itens) ? raw.itens : []).map((i) => ({
      sku: String(i?.produto?.sku ?? "").trim().toUpperCase(),
      quantity: Number(i?.quantidade),
      unit_price_cents: reaisToCents(i?.valorUnitario),
    })),
    subtotal_cents: raw.valorSubtotal === null || raw.valorSubtotal === undefined ? null : reaisToCents(raw.valorSubtotal),
    total_cents: raw.valorTotal === null || raw.valorTotal === undefined ? null : reaisToCents(raw.valorTotal),
    discount_cents: reaisToCents(raw.extras?.desconto ?? 0),
    freight_cents: reaisToCents(raw.extras?.frete ?? 0),
    payment: {
      type: raw.condicoesComerciais?.tipo ?? null,
      condition: parcelas.map((x) => x?.condicao).filter(Boolean)[0] ?? null,
      text: raw.condicoesComerciais?.textoLivre ?? null,
    },
    validity_days: raw.condicoesGerais?.validade ?? null,
    delivery_term: raw.condicoesGerais?.descricaoPrazoEntrega ?? null,
  };
}

/** A observação contém a referência exata do CRM? (recuperação após timeout) */
export function hasReference(observacao, reference) {
  return String(observacao ?? "").split(/\r?\n/).some((line) => line.trim() === referenceLine(reference));
}

const ORDER_SITUATION_LABELS = {
  8: "Dados incompletos", 0: "Aberta", 3: "Aprovada", 4: "Preparando envio", 1: "Faturada", 7: "Pronto para envio",
  5: "Enviada", 6: "Entregue", 10: "Em devolução", 2: "Cancelada", 9: "Não entregue",
};

/** Normaliza o pedido + contas a receber da venda. */
export function normalizeOrder(raw, receivables = []) {
  if (!raw?.id) fail("Pedido não encontrado no Olist.", "OLIST_ORDER_NOT_FOUND", 404);
  const code = raw.situacao === null || raw.situacao === undefined || raw.situacao === "" ? null : Number(raw.situacao);
  return {
    id: String(raw.id),
    number: raw.numeroPedido ? String(raw.numeroPedido) : null,
    situation_code: Number.isInteger(code) ? code : null,
    situation_label: Number.isInteger(code) ? ORDER_SITUATION_LABELS[code] ?? String(code) : null,
    contact_tax_id: raw.cliente?.cpfCnpj ? onlyDigits(raw.cliente.cpfCnpj) : null,
    seller_id: raw.vendedor?.id ? String(raw.vendedor.id) : null,
    items: (Array.isArray(raw.itens) ? raw.itens : []).map((i) => ({
      sku: String(i?.produto?.sku ?? "").trim().toUpperCase(),
      quantity: Number(i?.quantidade),
      unit_price_cents: reaisToCents(i?.valorUnitario),
    })),
    total_cents: raw.valorTotalPedido === null || raw.valorTotalPedido === undefined ? null : reaisToCents(raw.valorTotalPedido),
    invoice_id: raw.idNotaFiscal ? String(raw.idNotaFiscal) : null,
    receivables: receivables.map((r) => ({
      id: String(r.id),
      situation: r.situacao ?? null,
      amount_cents: reaisToCents(r.valor),
      balance_cents: r.saldo === null || r.saldo === undefined ? null : reaisToCents(r.saldo),
    })),
  };
}

export function normalizeSellers(list) {
  return (Array.isArray(list) ? list : [])
    .filter((v) => v?.id)
    .map((v) => ({
      id: String(v.id),
      name: String(v.contato?.nome || v.contato?.fantasia || `Vendedor ${v.id}`),
      code: v.contato?.codigo ? String(v.contato.codigo) : null,
      situation: v.situacao ?? null,
      email: v.contato?.email ? String(v.contato.email) : null,
    }));
}
