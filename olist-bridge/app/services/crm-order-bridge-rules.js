// Regras puras da ponte CRM -> Olist (sem banco, sem rede).
//
// O CRM passou a ser a fonte oficial de preços de atacado (tabelas STANDARD e
// REPRESENTATIVE). Esta ponte NÃO reprecifica pelo catálogo fixo da página:
// ela aceita os preços enviados pelo CRM (autenticado pelo segredo
// compartilhado da marca), confere a integridade dos totais e repassa ao
// Olist exatamente esses valores, verificando depois o que o Olist gravou.

import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";

export class CrmBridgeError extends Error {
  constructor(message, { code = "CRM_BRIDGE_ERROR", status = 422, details } = {}) {
    super(message);
    this.name = "CrmBridgeError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(message, code, status = 422, details) {
  throw new CrmBridgeError(message, { code, status, details });
}

export const BRIDGE_BRANDS = {
  mibro: { key: "mibro", label: "Mibro", orderMarker: "MIBRO ATACADO" },
  sincrofit: { key: "sincrofit", label: "Sincrofit", orderMarker: "SINCROFIT ATACADO" },
};

/** Marca desta instalação (cada deploy atende uma única marca). */
export function deploymentBrand(env = process.env) {
  const configured = String(env.WHOLESALE_BRAND || "").trim().toLowerCase();
  const appUrl = String(env.SHOPIFY_APP_URL || "").toLowerCase();
  const key = BRIDGE_BRANDS[configured] ? configured : appUrl.includes("sincrofit") ? "sincrofit" : "mibro";
  return BRIDGE_BRANDS[key];
}

/** Comparação em tempo constante do Bearer com CRM_SHOPIFY_SHARED_SECRET. */
export function isAuthorizedCrmRequest(authorizationHeader, expectedSecret) {
  const expected = String(expectedSecret || "").trim();
  const header = String(authorizationHeader || "");
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------- documentos

export function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function isValidCpf(value) {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (let size = 9; size <= 10; size += 1) {
    const sum = [...d.slice(0, size)].reduce((t, digit, i) => t + Number(digit) * (size + 1 - i), 0);
    if (((sum * 10) % 11) % 10 !== Number(d[size])) return false;
  }
  return true;
}

export function isValidCnpj(value) {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const check = (size, weights) => {
    const sum = [...d.slice(0, size)].reduce((t, digit, i) => t + Number(digit) * weights[i], 0);
    return sum % 11 < 2 ? 0 : 11 - (sum % 11);
  };
  return (
    check(12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12]) &&
    check(13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13])
  );
}

export function isValidTaxId(value) {
  const d = onlyDigits(value);
  return d.length === 11 ? isValidCpf(d) : isValidCnpj(d);
}

export function formatTaxId(value) {
  const d = onlyDigits(value);
  return d.length === 11
    ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
    : d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function taxIdPersonType(value) {
  return onlyDigits(value).length === 11 ? "F" : "J";
}

// ------------------------------------------------------------- payload

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeAddress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    street: text(value.street, 120),
    number: text(value.number, 30),
    complement: text(value.complement, 80),
    district: text(value.district, 80),
    city: text(value.city, 80),
    state: text(value.state, 2).toUpperCase(),
    zip: onlyDigits(value.zip).slice(0, 8),
    country: text(value.country || "Brasil", 60),
  };
}

export function isCompleteAddress(address) {
  return Boolean(
    address?.street &&
      address?.number &&
      address?.district &&
      address?.city &&
      /^[A-Z]{2}$/.test(address?.state || "") &&
      /^\d{8}$/.test(address?.zip || ""),
  );
}

const TIERS = new Set(["tier1", "tier2", "tier3"]);
const GROUPS = new Set(["STANDARD", "REPRESENTATIVE"]);

/** Identificador estável da cotação do CRM na tabela WholesaleQuote. */
export function crmPublicToken(crmQuoteId) {
  return `crm-${crmQuoteId}`;
}

/** Número de ordem de compra curto e determinístico (usado para recuperar o pedido). */
export function crmPurchaseNumber(crmQuoteId) {
  const digest = crypto.createHash("sha256").update(`crm:${crmQuoteId}`).digest("hex");
  return `CRM-${parseInt(digest.slice(0, 10), 16).toString(36).toUpperCase().padStart(8, "0").slice(-8)}`;
}

/**
 * Valida o pedido enviado pelo CRM. Preço vem do CRM (fonte oficial), mas
 * todos os totais precisam fechar: subtotal = Σ qtd × unitário; total =
 * subtotal − desconto; desconto < subtotal; nada zero ou negativo.
 */
export function validateCrmOrderPayload(raw, brand) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Payload inválido.", "INVALID_PAYLOAD", 400);

  const crmQuoteId = text(raw.crm_quote_id, 60);
  if (!/^[a-z0-9]{20,40}$/i.test(crmQuoteId)) fail("Identificador da cotação do CRM inválido.", "INVALID_CRM_QUOTE_ID", 400);

  const requestedBrand = text(raw.brand, 20).toLowerCase();
  if (requestedBrand !== brand.key) {
    fail(`Esta integração atende somente ${brand.label}.`, "BRAND_MISMATCH", 409, { expected: brand.key, received: requestedBrand });
  }

  const taxId = onlyDigits(raw.tax_id);
  if (!isValidTaxId(taxId)) fail("CPF ou CNPJ inválido.", "INVALID_TAX_ID");

  const companyName = text(raw.company_name, 200);
  if (!companyName) fail("Informe o nome ou razão social do cliente.", "COMPANY_NAME_MISSING");
  const email = text(raw.email, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("E-mail do cliente inválido.", "INVALID_EMAIL");

  if (!Array.isArray(raw.products) || raw.products.length === 0) fail("Nenhum produto no pedido.", "EMPTY_PRODUCTS");
  if (raw.products.length > 100) fail("Produtos demais no pedido.", "TOO_MANY_PRODUCTS");

  const seen = new Set();
  const products = raw.products.map((item, index) => {
    const sku = text(item?.sku, 120).toUpperCase();
    const quantity = Number(item?.quantity);
    const unitPriceCents = Number(item?.unit_price_cents);
    if (!sku) fail(`SKU ausente no item ${index + 1}.`, "PRODUCT_SKU_MISSING");
    if (seen.has(sku)) fail(`SKU ${sku} repetido.`, "DUPLICATE_SKU");
    seen.add(sku);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100_000) fail(`Quantidade inválida para ${sku}.`, "INVALID_QUANTITY");
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0 || unitPriceCents > 100_000_000) {
      fail(`Preço inválido para ${sku}.`, "INVALID_UNIT_PRICE");
    }
    const priceTier = text(item?.price_tier, 10).toLowerCase();
    return {
      sku,
      name: text(item?.name || sku, 200),
      quantity,
      unitPriceCents,
      subtotalCents: quantity * unitPriceCents,
      priceTier: TIERS.has(priceTier) ? priceTier : null,
    };
  });

  const subtotalCents = products.reduce((t, p) => t + p.subtotalCents, 0);
  const discountCents = Number(raw.discount_cents ?? 0);
  if (!Number.isSafeInteger(discountCents) || discountCents < 0 || discountCents >= subtotalCents) {
    fail("Desconto inválido.", "INVALID_DISCOUNT");
  }
  if (Number(raw.subtotal_cents) !== subtotalCents) {
    fail("O subtotal enviado não confere com os itens.", "SUBTOTAL_MISMATCH", 422, { expected: subtotalCents, received: raw.subtotal_cents });
  }
  const totalCents = subtotalCents - discountCents;
  if (Number(raw.total_cents) !== totalCents) {
    fail("O total enviado não confere com subtotal e desconto.", "TOTAL_MISMATCH", 422, { expected: totalCents, received: raw.total_cents });
  }

  const priceGroup = text(raw.price_group, 20).toUpperCase();
  if (!GROUPS.has(priceGroup)) fail("Grupo comercial inválido.", "INVALID_PRICE_GROUP");
  const selectedTier = text(raw.selected_tier, 10).toLowerCase();
  const automaticTier = text(raw.automatic_tier, 10).toLowerCase();

  return {
    crmQuoteId,
    publicToken: crmPublicToken(crmQuoteId),
    purchaseNumber: crmPurchaseNumber(crmQuoteId),
    brand: brand.key,
    cnpj: taxId, // nome legado do campo em WholesaleQuote: guarda CPF ou CNPJ
    taxId,
    companyName,
    tradeName: text(raw.trade_name, 200),
    email,
    phone: text(raw.phone, 40),
    stateRegistration: text(raw.state_registration, 40),
    registeredAddress: normalizeAddress(raw.registered_address),
    shippingAddress: normalizeAddress(raw.shipping_address),
    useRegisteredAddress: raw.use_registered_address !== false,
    seller: text(raw.seller_name, 160),
    buyer: text(raw.buyer_name, 160),
    notes: text(raw.notes, 1000),
    products,
    subtotalCents,
    discountCents,
    commercialTotalCents: totalCents,
    totalQuantity: products.reduce((t, p) => t + p.quantity, 0),
    priceGroup,
    selectedTier: TIERS.has(selectedTier) ? selectedTier : null,
    automaticTier: TIERS.has(automaticTier) ? automaticTier : null,
    priceTier: TIERS.has(selectedTier) ? selectedTier : TIERS.has(automaticTier) ? automaticTier : null,
    quantityRule: raw.quantity_rule === "per_model" ? "per_model" : "mixed",
  };
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function identityHash(p) {
  return hash({
    taxId: p.taxId,
    companyName: p.companyName,
    email: p.email,
    phone: p.phone,
    registeredAddress: p.registeredAddress,
    shippingAddress: p.shippingAddress,
    useRegisteredAddress: p.useRegisteredAddress,
  });
}

export function payloadHash(p) {
  return hash({
    identity: identityHash(p),
    products: p.products,
    priceGroup: p.priceGroup,
    selectedTier: p.selectedTier,
    automaticTier: p.automaticTier,
    quantityRule: p.quantityRule,
    discountCents: p.discountCents,
    commercialTotalCents: p.commercialTotalCents,
    notes: p.notes,
  });
}

const TIER_LABEL = { tier1: "Tabela 1", tier2: "Tabela 2", tier3: "Tabela 3" };

/** Observações internas do pedido no Olist (rastreabilidade da negociação). */
export function internalOrderNotes(p, brand) {
  const tierText = p.selectedTier
    ? `${TIER_LABEL[p.selectedTier]} (manual; automática seria ${TIER_LABEL[p.automaticTier] || "—"})`
    : `${TIER_LABEL[p.automaticTier] || "—"} (automática)`;
  return [
    `[${brand.orderMarker}] Cotação CRM ${p.crmQuoteId} (${p.purchaseNumber}).`,
    `Vendedor: ${p.seller || "não informado"}.`,
    `Comprador: ${p.buyer || "não informado"}.`,
    `Grupo comercial: ${p.priceGroup === "REPRESENTATIVE" ? "representantes" : "vendedores"}.`,
    `Faixa: ${tierText}.`,
    `Regra de quantidade: ${p.quantityRule === "per_model" ? "por modelo (cliente recorrente)" : "mix total"}.`,
    `Desconto comercial aplicado nos itens: R$ ${(p.discountCents / 100).toFixed(2)}.`,
    "Preços validados pelo CRM. Aguardando aprovação manual; não cobrar, faturar ou emitir nota antes da aprovação.",
  ].join(" ");
}

function moneyToCents(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  const t = String(value ?? "").trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Itens como o Olist gravou (para o CRM conferir de forma independente). */
export function olistConfirmedItems(order) {
  const items = order?.itens || order?.items || order?.produtos;
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    sku: String(item?.sku || item?.codigo || item?.produto?.sku || item?.produto?.codigo || "").trim().toUpperCase(),
    quantity: Number(item?.quantidade ?? item?.quantity ?? NaN),
    unit_price_cents: moneyToCents(item?.valorUnitario ?? item?.precoUnitario ?? item?.produto?.valorUnitario ?? item?.produto?.precoUnitario),
  }));
}
