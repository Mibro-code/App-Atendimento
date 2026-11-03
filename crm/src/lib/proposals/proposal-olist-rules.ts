// Regras puras da integração das propostas com o Olist (via ponte do app
// Shopify da marca). Valores sempre em centavos; a ponte converte para reais.

import type { ProposalFinancialStatus, ProposalOrderStatus } from "@prisma/client";
import { orderTaxId, type OrderCustomer } from "../olist/real-order-rules";
import { canonicalMaterial, type MaterialContent, type ProposalContent } from "./proposal-rules";

// ------------------------------------------------------------ envio

export interface BridgeProposalItem {
  sku: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
}

export function buildBridgeProposalPayload(input: {
  proposalId: string;
  version: number;
  brand: "MIBRO" | "SINCROFIT";
  customer: OrderCustomer;
  content: ProposalContent;
  itemNames: Record<string, string>;
  olistProposalId: string | null;
  natureId: number | null;
}) {
  const c = input.customer;
  const p = input.content;
  return {
    crm_proposal_id: input.proposalId,
    crm_reference: crmReference(input.proposalId),
    version: input.version,
    brand: input.brand.toLowerCase(),
    olist_proposal_id: input.olistProposalId,
    seller_olist_id: p.olistSellerId,
    customer: {
      tax_id: orderTaxId(c),
      company_name: c.legalName || c.tradeName || c.contactName,
      trade_name: c.tradeName || "",
      email: c.email || "",
      phone: c.phoneDigits || "",
      address: {
        street: c.addressStreet || "",
        number: c.addressNumber || "",
        complement: c.addressComplement || "",
        district: c.addressDistrict || "",
        city: c.city || "",
        state: (c.state || "").toUpperCase(),
        zip: (c.zipDigits || "").replace(/\D/g, ""),
      },
    },
    items: p.items.map<BridgeProposalItem>((i) => ({
      sku: i.sku,
      description: input.itemNames[i.sku] || i.sku,
      quantity: i.quantity,
      unit_price_cents: i.unitPriceCents,
    })),
    discount_cents: p.discountCents,
    freight_cents: p.freightCents,
    freight_responsibility: p.freightResponsibility,
    payment: { type: p.paymentType || "Nenhuma", condition: p.paymentCondition, text: p.paymentText },
    validity_days: p.validityDays,
    delivery_term: p.deliveryTerm,
    customer_notes: p.customerNotes,
    nature_id: input.natureId,
  };
}

/** Referência gravada na observação da proposta no Olist (permite recuperar após timeout). */
export function crmReference(proposalId: string): string {
  return `CRM-${proposalId.slice(-10).toUpperCase()}`;
}

// ------------------------------------------------------------ leitura

/** Proposta normalizada devolvida pela ponte (GET /orcamentos/{id}). */
export interface OlistProposalSnapshot {
  id: string;
  number: string | null;
  situation: string | null;
  contact_id: string | null;
  seller_id: string | null;
  items: Array<{ sku: string; quantity: number; unit_price_cents: number }>;
  subtotal_cents: number | null;
  total_cents: number | null;
  discount_cents: number;
  freight_cents: number;
  payment: { type: string | null; condition: string | null; text: string | null };
  validity_days: number | null;
  delivery_term: string | null;
}

export function materialFromOlist(s: OlistProposalSnapshot): MaterialContent {
  return canonicalMaterial({
    items: s.items.map((i) => ({ sku: i.sku, quantity: i.quantity, unitPriceCents: i.unit_price_cents })),
    discountCents: s.discount_cents,
    freightCents: s.freight_cents,
    paymentType: s.payment.type,
    paymentCondition: s.payment.condition,
    paymentText: s.payment.text,
    validityDays: s.validity_days,
    deliveryTerm: s.delivery_term,
    olistSellerId: s.seller_id,
  });
}

/** "Concluído" no Olist sem pedido conhecido pelo CRM exige conciliação manual. */
export function isConcludedSituation(situation: string | null | undefined): boolean {
  const s = (situation ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return s === "concluido" || s === "concluida";
}

// ------------------------------------------------------------ erros

/** Falha em que a operação pode ter sido aplicada no Olist (não repetir às cegas). */
export function isAmbiguousFailure(code: string, status: number | undefined): boolean {
  if (["BRIDGE_TIMEOUT", "BRIDGE_UNREACHABLE"].includes(code)) return true;
  return status === undefined || status === 0 || status >= 500;
}

// ------------------------------------------------------------ pedido

/** Pedido normalizado devolvido pela ponte (GET /pedidos/{id} + contas a receber por idVenda). */
export interface OlistOrderInspection {
  id: string;
  number: string | null;
  situation_code: number | null;
  situation_label: string | null;
  contact_tax_id: string | null;
  seller_id: string | null;
  items: Array<{ sku: string; quantity: number; unit_price_cents: number }>;
  total_cents: number | null;
  invoice_id: string | null;
  receivables: Array<{ id: string; situation: string | null; amount_cents: number; balance_cents: number | null }>;
}

const ORDER_BY_CODE: Record<number, ProposalOrderStatus> = {
  8: "PEDIDO_CRIADO", // Dados incompletos
  0: "PEDIDO_CRIADO", // Aberta
  3: "PEDIDO_APROVADO",
  4: "PEDIDO_APROVADO", // Preparando envio
  7: "PEDIDO_APROVADO", // Pronto para envio
  1: "FATURADO",
  5: "ENVIADO",
  6: "ENTREGUE",
  9: "NAO_ENTREGUE",
  10: "EM_DEVOLUCAO",
  2: "CANCELADO",
};

/** Códigos documentados da situação do pedido (V3). Desconhecido mantém o estado anterior. */
export function orderStatusFromSituation(code: number | null, previous: ProposalOrderStatus): ProposalOrderStatus {
  return code !== null && code in ORDER_BY_CODE ? ORDER_BY_CODE[code] : previous;
}

/** Aprovado ou posterior (para a regra existente de venda/comissão). */
export function isApprovedOrLater(code: number | null): boolean {
  return code !== null && [3, 4, 7, 1, 5, 6].includes(code);
}

/**
 * Estado financeiro pelas contas a receber vinculadas à venda. Aprovação de
 * pedido NUNCA é tratada como pagamento.
 */
export function financialFromReceivables(receivables: OlistOrderInspection["receivables"]): {
  status: ProposalFinancialStatus;
  dueCents: number;
  paidCents: number;
  openCents: number;
} {
  const active = receivables.filter((r) => (r.situation ?? "").toLowerCase() !== "cancelada");
  if (receivables.length === 0) return { status: "SEM_COBRANCA", dueCents: 0, paidCents: 0, openCents: 0 };
  if (active.length === 0) return { status: "CANCELADO", dueCents: 0, paidCents: 0, openCents: 0 };
  let due = 0;
  let open = 0;
  for (const r of active) {
    due += r.amount_cents;
    const situation = (r.situation ?? "").toLowerCase();
    // Saldo é o valor em aberto; sem saldo informado, só "pago" conta como quitado.
    open += r.balance_cents ?? (situation === "pago" ? 0 : r.amount_cents);
  }
  open = Math.max(0, Math.min(open, due));
  const paid = due - open;
  const status: ProposalFinancialStatus = open === 0 && due > 0 ? "PAGAMENTO_CONFIRMADO" : paid > 0 ? "PAGAMENTO_PARCIAL" : "AGUARDANDO_PAGAMENTO";
  return { status, dueCents: due, paidCents: paid, openCents: open };
}

/**
 * Valida se um pedido do Olist pertence à proposta antes de vinculá-lo
 * manualmente. Valores iguais não bastam: exige mesmo cliente (documento),
 * mesmo vendedor e exatamente os mesmos SKUs e quantidades.
 */
export function validateOrderForProposal(
  order: OlistOrderInspection,
  expected: { taxId: string | null; olistSellerId: string | null; items: Array<{ sku: string; quantity: number }> }
): string[] {
  const problems: string[] = [];
  const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");
  if (!expected.taxId || digits(order.contact_tax_id) !== digits(expected.taxId)) problems.push("O cliente do pedido (CPF/CNPJ) é diferente do cliente da proposta.");
  if (expected.olistSellerId && order.seller_id && order.seller_id !== expected.olistSellerId) problems.push("O vendedor do pedido é diferente do vendedor da proposta.");
  const norm = (list: Array<{ sku: string; quantity: number }>) =>
    JSON.stringify([...list].map((i) => [i.sku.trim().toUpperCase(), i.quantity]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  if (order.items.length === 0) problems.push("O pedido não tem itens.");
  else if (norm(order.items) !== norm(expected.items)) problems.push("Os produtos ou quantidades do pedido são diferentes da versão aceita.");
  if (order.situation_code === 2) problems.push("O pedido está cancelado no Olist.");
  return problems;
}

/** Conferência do que o Olist gravou após criar/atualizar a proposta. */
export function verifyProposalReadback(sent: MaterialContent, snapshot: OlistProposalSnapshot): string[] {
  const a = canonicalMaterial(sent);
  const b = materialFromOlist(snapshot);
  const problems: string[] = [];
  if (JSON.stringify(a.items) !== JSON.stringify(b.items)) problems.push("itens, quantidades ou preços");
  if (a.discountCents !== b.discountCents) problems.push("desconto");
  if (a.freightCents !== b.freightCents) problems.push("frete");
  if (a.olistSellerId && a.olistSellerId !== b.olistSellerId) problems.push("vendedor");
  return problems;
}

// ------------------------------------------------------------ situação (opcional)

/**
 * Mapeamento para PUT /orcamentos/{id}/situacao. A semântica operacional das
 * situações do Olist não é documentada; por isso só é usado quando
 * OLIST_PROPOSAL_SITUATION_SYNC=1, depois de homologado.
 */
export const OLIST_SITUATION_FOR: Partial<Record<string, string>> = {
  ENVIADA: "Aguardando",
  ACEITA: "Aprovado",
  RECUSADA: "Não aprovado",
};
