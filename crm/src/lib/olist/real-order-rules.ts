// Regras puras do pedido real (CRM -> Olist). Sem banco e sem rede.

import type { PriceGroup, PriceTier } from "@prisma/client";
import { allocateDiscount, tierForQuantity } from "../pricing/pricing-rules";

// ------------------------------------------------------------ documento

const digits = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");

export function isValidCpf(value: string): boolean {
  const d = digits(value);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (let size = 9; size <= 10; size += 1) {
    let sum = 0;
    for (let i = 0; i < size; i += 1) sum += Number(d[i]) * (size + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[size])) return false;
  }
  return true;
}

export function isValidCnpj(value: string): boolean {
  const d = digits(value);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const check = (size: number, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < size; i += 1) sum += Number(d[i]) * weights[i];
    return sum % 11 < 2 ? 0 : 11 - (sum % 11);
  };
  return (
    check(12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12]) &&
    check(13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13])
  );
}

// ------------------------------------------------------------ cadastro

export interface OrderCustomer {
  contactName: string;
  legalName: string | null;
  tradeName: string | null;
  cnpjDigits: string | null;
  cpfDigits: string | null;
  email: string | null;
  phoneDigits: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressDistrict: string | null;
  addressComplement: string | null;
  city: string | null;
  state: string | null;
  zipDigits: string | null;
}

export interface ReadinessItem {
  field: string;
  label: string;
  /** blocking = impede o pedido; warning = só se o cliente ainda não existir no Olist. */
  level: "blocking" | "warning";
}

export function orderTaxId(c: OrderCustomer): string | null {
  const cnpj = digits(c.cnpjDigits);
  if (cnpj) return cnpj;
  const cpf = digits(c.cpfDigits);
  return cpf || null;
}

/** O que falta no cadastro do cliente para gerar o pedido no Olist. */
export function customerOrderReadiness(c: OrderCustomer): ReadinessItem[] {
  const missing: ReadinessItem[] = [];
  const taxId = orderTaxId(c);
  if (!taxId) missing.push({ field: "document", label: "CNPJ ou CPF", level: "blocking" });
  else if (taxId.length === 14 ? !isValidCnpj(taxId) : !isValidCpf(taxId)) {
    missing.push({ field: "document", label: "CNPJ/CPF válido", level: "blocking" });
  }
  if (!c.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) missing.push({ field: "email", label: "E-mail", level: "blocking" });
  const address: Array<[keyof OrderCustomer, string]> = [
    ["addressStreet", "Rua"],
    ["addressNumber", "Número"],
    ["addressDistrict", "Bairro"],
    ["city", "Cidade"],
  ];
  for (const [field, label] of address) if (!String(c[field] ?? "").trim()) missing.push({ field, label, level: "warning" });
  if (!/^[A-Z]{2}$/.test(String(c.state ?? "").trim().toUpperCase())) missing.push({ field: "state", label: "UF", level: "warning" });
  if (digits(c.zipDigits).length !== 8) missing.push({ field: "zipDigits", label: "CEP", level: "warning" });
  return missing;
}

// ------------------------------------------------------------ payload

export interface OrderItemSnapshot {
  sku: string;
  productName: string;
  colorName: string | null;
  quantity: number;
  unitPriceCents: number;
  appliedTier: PriceTier;
}

const lowerTier = (t: PriceTier | null | undefined) => (t ? t.toLowerCase() : null);

export function buildBridgeOrderPayload(input: {
  quoteId: string;
  brand: "MIBRO" | "SINCROFIT";
  customer: OrderCustomer;
  sellerName: string | null;
  notes: string | null;
  priceGroup: PriceGroup;
  selectedTier: PriceTier | null;
  quantityRule: "MIX" | "PER_MODEL";
  discountCents: number;
  items: OrderItemSnapshot[];
}) {
  const c = input.customer;
  const subtotal = input.items.reduce((t, i) => t + i.quantity * i.unitPriceCents, 0);
  const totalQuantity = input.items.reduce((t, i) => t + i.quantity, 0);
  return {
    crm_quote_id: input.quoteId,
    brand: input.brand.toLowerCase(),
    tax_id: orderTaxId(c),
    company_name: c.legalName || c.tradeName || c.contactName,
    trade_name: c.tradeName || "",
    email: c.email,
    phone: c.phoneDigits || "",
    state_registration: "",
    registered_address: {
      street: c.addressStreet || "",
      number: c.addressNumber || "",
      complement: c.addressComplement || "",
      district: c.addressDistrict || "",
      city: c.city || "",
      state: (c.state || "").toUpperCase(),
      zip: digits(c.zipDigits),
    },
    use_registered_address: true,
    seller_name: input.sellerName || "",
    buyer_name: c.contactName,
    notes: input.notes || "",
    price_group: input.priceGroup,
    selected_tier: lowerTier(input.selectedTier),
    automatic_tier: lowerTier(tierForQuantity(totalQuantity)),
    quantity_rule: input.quantityRule === "PER_MODEL" ? "per_model" : "mixed",
    products: input.items.map((i) => ({
      sku: i.sku,
      name: [i.productName, i.colorName].filter(Boolean).join(" — "),
      quantity: i.quantity,
      unit_price_cents: i.unitPriceCents,
      price_tier: lowerTier(i.appliedTier),
    })),
    discount_cents: input.discountCents,
    subtotal_cents: subtotal,
    total_cents: subtotal - input.discountCents,
  };
}

// ------------------------------------------------------------ conferência

export interface OlistCalculateResponse {
  olist_order_id: string;
  order_number?: string;
  purchase_number?: string;
  values?: {
    commercial_subtotal?: number;
    commercial_discount?: number;
    total_sent_to_olist?: number;
    total_confirmed_by_olist?: number | null;
    olist_products_total?: number | null;
  };
  items_confirmed?: Array<{ sku: string; quantity: number; unit_price_cents: number | null }>;
}

export interface OlistVerification {
  verified: boolean;
  problems: Array<{ sku?: string; field: string; expected: number | string | null; received: number | string | null }>;
}

/**
 * Conferência independente (além da feita pelo app Shopify): cada item
 * precisa voltar do Olist com a quantidade e o preço unitário enviados
 * (desconto rateado, tolerância de 1 centavo), e o total comercial enviado
 * precisa ser o calculado pelo CRM. Sem itens na resposta = não verificado.
 */
export function verifyOlistOrder(
  items: OrderItemSnapshot[],
  discountCents: number,
  response: OlistCalculateResponse
): OlistVerification {
  const problems: OlistVerification["problems"] = [];
  const subtotal = items.reduce((t, i) => t + i.quantity * i.unitPriceCents, 0);
  const expectedTotal = subtotal - discountCents;
  const sentTotal = response.values?.total_sent_to_olist;
  if (sentTotal !== expectedTotal) problems.push({ field: "total_sent_to_olist", expected: expectedTotal, received: sentTotal ?? null });

  const confirmed = response.items_confirmed ?? [];
  if (confirmed.length === 0) {
    problems.push({ field: "items_confirmed", expected: items.length, received: 0 });
    return { verified: false, problems };
  }
  const allocations = allocateDiscount(items, discountCents);
  items.forEach((item, index) => {
    const back = confirmed.find((c) => c.sku === item.sku.toUpperCase()) ?? null;
    if (!back) {
      problems.push({ sku: item.sku, field: "item", expected: item.sku, received: null });
      return;
    }
    if (back.quantity !== item.quantity) problems.push({ sku: item.sku, field: "quantity", expected: item.quantity, received: back.quantity });
    const expectedUnit = Math.round(allocations[index].unitPrice * 100);
    if (back.unit_price_cents === null || Math.abs(back.unit_price_cents - expectedUnit) > 1) {
      problems.push({ sku: item.sku, field: "unit_price_cents", expected: expectedUnit, received: back.unit_price_cents });
    }
  });
  return { verified: problems.length === 0, problems };
}
