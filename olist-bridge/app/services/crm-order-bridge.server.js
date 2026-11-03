// Ponte CRM -> Olist. Usada SOMENTE pelas rotas /internal/crm/* (chamadas
// servidor a servidor pelo CRM, autenticadas por CRM_SHOPIFY_SHARED_SECRET).
// Não altera o fluxo da página de atacado: reaproveita a mesma conexão Olist,
// a mesma tabela WholesaleQuote (para a sincronização de aprovação já
// existente devolver o status ao CRM) e as mesmas funções da API Olist.

import process from "node:process";

import db from "../db.server";
import {
  OlistApiError,
  addOlistOrderMarker,
  createOlistContact,
  createOlistOrder,
  findOlistContactByTaxId,
  findOlistOrderSummary,
  findOlistProductBySku,
  getOlistCustomerPricingProfile,
  getOlistOrder,
  listOlistOrders,
  updateOlistOrderItems,
} from "./olist-api.server";
import { retryOlistOrderRead } from "./olist-order-read-retry.server";
import {
  allocateCommercialItemPrices,
  buildWholesaleOrderValues,
  findOlistOrderItemPriceMismatch,
} from "./wholesale-order-values.server";
import {
  CrmBridgeError,
  formatTaxId,
  identityHash,
  internalOrderNotes,
  isCompleteAddress,
  isValidTaxId,
  olistConfirmedItems,
  onlyDigits,
  payloadHash,
  taxIdPersonType,
  validateCrmOrderPayload,
} from "./crm-order-bridge-rules";

const OPEN_ORDER_STATUS = 0;
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const OLIST_REVIEW_MARKER = "PARA ANÁLISE";

function fail(message, code, status = 422, details) {
  throw new CrmBridgeError(message, { code, status, details });
}

/** Cada instalação atende uma única loja conectada ao Olist. */
export async function resolveBridgeShop() {
  const connections = await db.olistConnection.findMany({ select: { shop: true } });
  if (connections.length !== 1) {
    fail(
      connections.length === 0
        ? "Esta instalação não está conectada ao Olist."
        : "Mais de uma loja conectada ao Olist nesta instalação.",
      "BRIDGE_SHOP_UNRESOLVED",
      503,
    );
  }
  return connections[0].shop;
}

// ------------------------------------------------------------ perfil

/**
 * Cliente com pedido aprovado no Olist usa faixa por modelo (mesma regra da
 * página). Se o Olist não aceitar o documento para histórico (ex.: versão
 * sem suporte a CPF), cai para "mixed", que é o comportamento de cliente novo.
 */
export async function getCrmPricingProfile(shop, rawTaxId) {
  const taxId = onlyDigits(rawTaxId);
  if (!isValidTaxId(taxId)) fail("CPF ou CNPJ inválido.", "INVALID_TAX_ID");
  try {
    const profile = await getOlistCustomerPricingProfile(shop, taxId);
    return {
      success: true,
      pricing_mode: profile.pricingMode,
      recurring_customer: profile.recurringCustomer,
      qualifying_order_id: profile.qualifyingOrderId,
    };
  } catch (error) {
    if (error instanceof OlistApiError && error.status === 400) {
      return { success: true, pricing_mode: "mixed", recurring_customer: false, qualifying_order_id: null, fallback: true };
    }
    throw error;
  }
}

// ------------------------------------------------------------ cotação local

async function getOrCreateBridgeQuote(shop, payload) {
  let quote = await db.wholesaleQuote.findUnique({ where: { publicToken: payload.publicToken } });
  if (!quote) {
    try {
      quote = await db.wholesaleQuote.create({
        data: { shop, publicToken: payload.publicToken, cnpj: payload.taxId, status: "DRAFT" },
      });
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      quote = await db.wholesaleQuote.findUnique({ where: { publicToken: payload.publicToken } });
    }
  }
  if (!quote || quote.shop !== shop || quote.cnpj !== payload.taxId) {
    fail("A cotação não pertence a esta loja ou documento.", "QUOTE_OWNERSHIP_MISMATCH", 409);
  }
  if (quote.status === "READY_FOR_REVIEW" || quote.status === "APPROVED") {
    fail("Este pedido já foi enviado para análise e não pode mais ser recalculado.", "QUOTE_ALREADY_CONFIRMED", 409);
  }
  if (quote.olistOrderId && quote.identityHash && quote.identityHash !== identityHash(payload)) {
    fail(
      "Os dados do cliente ou da entrega mudaram após a criação do pedido. Gere uma nova cotação real.",
      "QUOTE_IDENTITY_CHANGED",
      409,
    );
  }
  return quote;
}

async function claimQuote(quote) {
  const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
  const result = await db.wholesaleQuote.updateMany({
    where: {
      id: quote.id,
      status: { notIn: ["READY_FOR_REVIEW", "APPROVED"] },
      OR: [{ status: { not: "PROCESSING" } }, { processingStartedAt: null }, { processingStartedAt: { lt: staleBefore } }],
    },
    data: { status: "PROCESSING", processingStartedAt: new Date(), lastErrorCode: null },
  });
  if (result.count !== 1) {
    fail("Esta cotação já está sendo processada. Aguarde alguns segundos.", "QUOTE_ALREADY_PROCESSING", 409);
  }
}

async function recordFailure(quoteId, error) {
  try {
    await db.wholesaleQuote.update({
      where: { id: quoteId },
      data: {
        status: "ERROR",
        processingStartedAt: null,
        lastErrorCode: String(error?.code || error?.name || "UNKNOWN_ERROR").slice(0, 80),
      },
    });
  } catch (dbError) {
    console.error("CRM_BRIDGE_FAILURE_NOT_RECORDED", { quoteId, message: dbError?.message });
  }
}

// ------------------------------------------------------------ Olist

function toOlistAddress(address) {
  return {
    endereco: address.street,
    numero: address.number,
    complemento: address.complement || "",
    bairro: address.district,
    municipio: address.city,
    cep: address.zip,
    uf: address.state,
    pais: address.country || "Brasil",
  };
}

async function findOrCreateContact(shop, payload, brand) {
  try {
    return await findOlistContactByTaxId(shop, payload.taxId);
  } catch (error) {
    if (!(error instanceof OlistApiError) || error.status !== 404) throw error;
  }
  if (!isCompleteAddress(payload.registeredAddress)) {
    fail(
      "Endereço do cliente incompleto (rua, número, bairro, cidade, UF e CEP). Complete o cadastro no CRM.",
      "INCOMPLETE_ADDRESS",
    );
  }
  const personType = taxIdPersonType(payload.taxId);
  return createOlistContact(shop, {
    nome: payload.companyName,
    fantasia: payload.tradeName || payload.companyName,
    tipoPessoa: personType,
    cpfCnpj: formatTaxId(payload.taxId),
    inscricaoEstadual: personType === "F" ? "" : payload.stateRegistration || "",
    telefone: payload.phone,
    email: payload.email,
    emailNfe: payload.email,
    endereco: toOlistAddress(payload.registeredAddress),
    situacao: "B",
    observacoes: `Contato criado pelo CRM (${brand.label} Atacado).`,
  });
}

async function resolveOrderItems(shop, payload) {
  const prices = allocateCommercialItemPrices(payload.products, payload.discountCents);
  const items = [];
  for (const [index, item] of payload.products.entries()) {
    const product = await findOlistProductBySku(shop, item.sku);
    if (product.status && !["A", "ATIVO"].includes(String(product.status).toUpperCase())) {
      fail(`O produto ${item.sku} não está ativo no Olist.`, "OLIST_PRODUCT_INACTIVE");
    }
    items.push({
      produto: { id: Number(product.id) },
      quantidade: item.quantity,
      valorUnitario: prices[index].unitPrice,
      infoAdicional:
        payload.discountCents > 0
          ? `Preço de atacado (CRM) com desconto comercial rateado. SKU ${item.sku}.`
          : `Preço de atacado validado pelo CRM. SKU ${item.sku}.`,
    });
  }
  return items;
}

function positiveIntegerEnv(name) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function buildCreateOrderBody(payload, contactId, items, brand) {
  const natureId = positiveIntegerEnv("OLIST_DEFAULT_OPERATION_NATURE_ID");
  const sellerId = positiveIntegerEnv("OLIST_DEFAULT_SELLER_ID");
  const depositId = positiveIntegerEnv("OLIST_DEFAULT_DEPOSIT_ID");
  const body = {
    situacao: OPEN_ORDER_STATUS,
    data: new Date().toISOString().slice(0, 10),
    numeroOrdemCompra: payload.purchaseNumber,
    valorDesconto: 0,
    valorFrete: 0,
    valorOutrasDespesas: 0,
    idContato: Number(contactId),
    observacoes: payload.notes || "Pedido de atacado aguardando análise e aprovação manual da responsável.",
    observacoesInternas: internalOrderNotes(payload, brand),
    itens: items,
    ...(natureId ? { naturezaOperacao: { id: natureId } } : {}),
    ...(sellerId ? { vendedor: { id: sellerId } } : {}),
    ...(depositId ? { deposito: { id: depositId } } : {}),
  };
  if (!payload.useRegisteredAddress) {
    if (!isCompleteAddress(payload.shippingAddress)) fail("Endereço de entrega incompleto.", "INCOMPLETE_SHIPPING_ADDRESS");
    body.enderecoEntrega = {
      ...toOlistAddress(payload.shippingAddress),
      enderecoNro: payload.shippingAddress.number,
      fone: payload.phone,
      nomeDestinatario: payload.companyName,
      cpfCnpj: formatTaxId(payload.taxId),
      ie: taxIdPersonType(payload.taxId) === "F" ? "" : payload.stateRegistration || "",
    };
    delete body.enderecoEntrega.numero;
  }
  return body;
}

/** Recupera pedido criado numa tentativa anterior que caiu antes de gravar o id. */
async function recoverExistingOrder(shop, payload) {
  const today = new Date().toISOString().slice(0, 10);
  const candidates = await listOlistOrders(shop, {
    cpfCnpj: formatTaxId(payload.taxId),
    dataInicial: today,
    dataFinal: today,
    limit: 100,
    offset: 0,
  });
  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    const order = await getOlistOrder(shop, candidate.id);
    if (String(order?.numeroOrdemCompra || "") === payload.purchaseNumber) {
      return { id: String(candidate.id), orderNumber: String(candidate.numeroPedido || order?.numeroPedido || ""), order };
    }
  }
  return null;
}

function isOpenStatus(value) {
  if (value === OPEN_ORDER_STATUS || String(value).trim() === "0") return true;
  return ["aberta", "aberto", "em aberto"].includes(String(value || "").trim().toLocaleLowerCase("pt-BR"));
}

const readOrder = (shop, id) => retryOlistOrderRead(() => getOlistOrder(shop, id));

async function assertOrderStillOpen(shop, quote, details = null) {
  const order = details || (await readOrder(shop, quote.olistOrderId));
  if (order?.idNotaFiscal || order?.dataFaturamento) {
    fail("O pedido já possui faturamento ou nota fiscal e não pode ser alterado pelo CRM.", "ORDER_ALREADY_INVOICED", 409);
  }
  const summary = await findOlistOrderSummary(shop, quote.olistOrderNumber, quote.olistOrderId);
  const status = summary?.situacao ?? order?.situacao;
  if (status === undefined || status === null || !isOpenStatus(status)) {
    fail("O pedido não está mais em situação Aberta. Revise-o diretamente no Olist.", "ORDER_NOT_OPEN", 409);
  }
  return order;
}

function responseFromOrder(quote, payload, order) {
  // Mesma conferência da página: preço unitário gravado x enviado.
  const mismatch = findOlistOrderItemPriceMismatch(payload, order);
  if (mismatch) {
    fail("O Olist devolveu um preço unitário diferente do enviado pelo CRM.", "OLIST_PRICE_MISMATCH", 502, {
      ...mismatch,
      olist_order_id: quote.olistOrderId,
    });
  }
  const { totalConfirmedByOlistCents, values } = buildWholesaleOrderValues(payload, order);
  if (!totalConfirmedByOlistCents || totalConfirmedByOlistCents <= 0) {
    fail("O Olist não devolveu um total válido para o pedido.", "OLIST_TOTAL_MISSING", 502, { olist_order_id: quote.olistOrderId });
  }
  return {
    success: true,
    olist_order_id: quote.olistOrderId,
    order_number: quote.olistOrderNumber || String(order?.numeroPedido || ""),
    purchase_number: payload.purchaseNumber,
    status: "em_aberto",
    values_in_cents: true,
    values,
    items_confirmed: olistConfirmedItems(order),
  };
}

/** Cria (ou atualiza, se ainda aberto) o pedido no Olist com os preços do CRM. */
export async function calculateCrmOrder(shop, rawPayload, brand) {
  const payload = validateCrmOrderPayload(rawPayload, brand);
  let quote = await getOrCreateBridgeQuote(shop, payload);
  const currentPayloadHash = payloadHash(payload);
  const currentIdentityHash = identityHash(payload);
  await claimQuote(quote);

  const markCalculated = (data = {}) =>
    db.wholesaleQuote.update({
      where: { id: quote.id },
      data: {
        identityHash: currentIdentityHash,
        payloadHash: currentPayloadHash,
        status: "CALCULATED",
        processingStartedAt: null,
        lastErrorCode: null,
        calculatedAt: new Date(),
        ...data,
      },
    });

  try {
    if (quote.olistOrderId) {
      const existing = await assertOrderStillOpen(shop, quote);
      if (quote.payloadHash !== currentPayloadHash) {
        await updateOlistOrderItems(shop, quote.olistOrderId, await resolveOrderItems(shop, payload));
      }
      const refreshed = quote.payloadHash === currentPayloadHash ? existing : await readOrder(shop, quote.olistOrderId);
      quote = await markCalculated();
      return responseFromOrder(quote, payload, refreshed);
    }

    const recovered = await recoverExistingOrder(shop, payload);
    if (recovered) {
      quote = await db.wholesaleQuote.update({
        where: { id: quote.id },
        data: { olistOrderId: recovered.id, olistOrderNumber: recovered.orderNumber, identityHash: currentIdentityHash, status: "PROCESSING" },
      });
      await assertOrderStillOpen(shop, quote, recovered.order);
      await updateOlistOrderItems(shop, quote.olistOrderId, await resolveOrderItems(shop, payload));
      const refreshed = await readOrder(shop, quote.olistOrderId);
      quote = await markCalculated();
      return responseFromOrder(quote, payload, refreshed);
    }

    const [contact, items] = await Promise.all([findOrCreateContact(shop, payload, brand), resolveOrderItems(shop, payload)]);
    const created = await createOlistOrder(shop, buildCreateOrderBody(payload, contact.id, items, brand));
    quote = await db.wholesaleQuote.update({
      where: { id: quote.id },
      data: {
        olistOrderId: String(created.id),
        olistOrderNumber: String(created.orderNumber || ""),
        identityHash: currentIdentityHash,
        status: "PROCESSING",
      },
    });
    const order = await readOrder(shop, quote.olistOrderId);
    quote = await markCalculated();
    return responseFromOrder(quote, payload, order);
  } catch (error) {
    await recordFailure(quote.id, error);
    throw error;
  }
}

/** Mantém o pedido em aberto e adiciona o marcador PARA ANÁLISE (mesmo fluxo da página). */
export async function confirmCrmOrder(shop, rawPayload) {
  const crmQuoteId = String(rawPayload?.crm_quote_id || "").trim();
  const olistOrderId = String(rawPayload?.olist_order_id || "").trim();
  if (!/^[a-z0-9]{20,40}$/i.test(crmQuoteId) || !olistOrderId) {
    fail("Identificação da cotação ou do pedido ausente.", "CONFIRMATION_IDENTIFIERS_MISSING");
  }
  const quote = await db.wholesaleQuote.findUnique({ where: { publicToken: `crm-${crmQuoteId}` } });
  if (!quote || quote.shop !== shop || quote.olistOrderId !== olistOrderId) {
    fail("O pedido não pertence a esta cotação.", "ORDER_OWNERSHIP_MISMATCH", 409);
  }
  if (quote.status === "READY_FOR_REVIEW" || quote.status === "APPROVED") {
    return { success: true, olist_order_id: quote.olistOrderId, order_number: quote.olistOrderNumber, status: "aguardando_aprovacao", already_confirmed: true };
  }
  if (quote.status !== "CALCULATED") {
    fail("Calcule o pedido novamente antes de enviá-lo para análise.", "QUOTE_NOT_CALCULATED", 409);
  }
  await assertOrderStillOpen(shop, quote);
  await addOlistOrderMarker(shop, quote.olistOrderId, OLIST_REVIEW_MARKER);
  await db.wholesaleQuote.update({
    where: { id: quote.id },
    data: { status: "READY_FOR_REVIEW", confirmedAt: new Date(), processingStartedAt: null, lastErrorCode: null },
  });
  return { success: true, olist_order_id: quote.olistOrderId, order_number: quote.olistOrderNumber, status: "aguardando_aprovacao", already_confirmed: false };
}
