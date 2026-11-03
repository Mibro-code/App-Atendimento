import { createHash } from "node:crypto";

import db from "../db.server";
import {
  addOlistOrderMarker,
  createOlistContact,
  createOlistOrder,
  findOlistContactByTaxId,
  getOlistCustomerPricingProfile,
  findOlistOrderSummary,
  findOlistProductBySku,
  getOlistOrder,
  listOlistOrders,
  OlistApiError,
  updateOlistOrderItems,
} from "./olist-api.server";
import { retryOlistOrderRead } from "./olist-order-read-retry.server";
import {
  allocateCommercialItemPrices,
  findOlistOrderItemPriceMismatch,
  buildWholesaleOrderValues,
  calculateCommercialTotals,
} from "./wholesale-order-values.server";
import {
  getWholesaleCatalog,
  normalizeWholesaleBrand,
  resolveWholesalePrice,
  wholesaleTierForQuantity,
  WholesalePricingError,
} from "./wholesale-pricing.server";

const OPEN_ORDER_STATUS = 0;
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_MINIMUM_QUANTITY = 10;
const OLIST_REVIEW_MARKER = "PARA ANÁLISE";
const WHOLESALE_BRANDS = {
  mibro: {
    label: "Mibro",
    orderMarker: "MIBRO ATACADO",
    maximumAutomaticQuantity: null,
  },
  sincrofit: {
    label: "Sincrofit",
    orderMarker: "SINCROFIT ATACADO",
    maximumAutomaticQuantity: 99,
  },
};

function wholesaleBrandContext() {
  const configuredBrand = String(process.env.WHOLESALE_BRAND || "")
    .trim()
    .toLowerCase();

  const appUrl = String(process.env.SHOPIFY_APP_URL || "").toLowerCase();
  const key = normalizeWholesaleBrand(
    configuredBrand || (appUrl.includes("sincrofit") ? "sincrofit" : "mibro"),
  );
  return { key, ...WHOLESALE_BRANDS[key], catalog: getWholesaleCatalog(key) };
}

export class WholesaleOrderError extends Error {
  constructor(
    message,
    { status = 400, code = "WHOLESALE_ORDER_ERROR", details } = {},
  ) {
    super(message);
    this.name = "WholesaleOrderError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, status = 400, details) {
  throw new WholesaleOrderError(message, { code, status, details });
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function limitedText(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function positiveIntegerEnvironment(name) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function minimumWholesaleQuantity() {
  return (
    positiveIntegerEnvironment("WHOLESALE_MINIMUM_QUANTITY") ||
    DEFAULT_MINIMUM_QUANTITY
  );
}

async function assertWholesalePricing(shop, payload) {
  const brand = wholesaleBrandContext();

  if (
    brand.maximumAutomaticQuantity &&
    payload.totalQuantity > brand.maximumAutomaticQuantity
  ) {
    fail(
      `Pedidos ${brand.label} com 100 ou mais unidades precisam ser negociados com um especialista.`,
      "SPECIALIST_QUOTE_REQUIRED",
      422,
    );
  }

  const pricingProfile = await getOlistCustomerPricingProfile(
    shop,
    payload.cnpj,
  );
  const modelQuantities = new Map();

  for (const item of payload.products) {
    const catalogItem = brand.catalog[item.sku.toUpperCase()];
    if (!catalogItem) {
      fail(
        `O SKU ${item.sku} não está cadastrado na tabela de atacado do servidor.`,
        "WHOLESALE_SKU_NOT_CONFIGURED",
        422,
      );
    }

    modelQuantities.set(
      catalogItem.model,
      (modelQuantities.get(catalogItem.model) || 0) + item.quantity,
    );
  }

  if (pricingProfile.pricingMode === "per_model") {
    const invalidModel = [...modelQuantities.entries()].find(
      ([, quantity]) => quantity < minimumWholesaleQuantity(),
    );

    if (invalidModel) {
      fail(
        `Cliente recorrente: o modelo ${invalidModel[0]} precisa ter pelo menos ${minimumWholesaleQuantity()} unidades.`,
        "MODEL_MINIMUM_QUANTITY_NOT_REACHED",
        422,
      );
    }
  }

  const products = payload.products.map((item) => {
    const catalogItem = brand.catalog[item.sku.toUpperCase()];
    const automaticQuantity =
      pricingProfile.pricingMode === "per_model"
        ? modelQuantities.get(catalogItem.model)
        : payload.totalQuantity;

    try {
      const resolved = resolveWholesalePrice({
        brand: brand.key,
        sku: item.sku,
        quantity: item.quantity,
        automaticQuantity,
        selectedTier: payload.priceTierSelection,
        manualTierApplied: payload.manualPriceTierApplied,
        frontendUnitPrice: item.unitPriceCents,
        minimumQuantity: minimumWholesaleQuantity(),
      });

      return {
        ...item,
        unitPriceCents: resolved.unitPriceCents,
        subtotalCents: item.quantity * resolved.unitPriceCents,
        priceTier: resolved.appliedTier,
        automaticPriceTier: resolved.automaticTier,
        priceSource: resolved.manualOverride
          ? "wholesale_page_manual_tier"
          : item.priceSource || "wholesale_page",
      };
    } catch (error) {
      if (error instanceof WholesalePricingError) {
        fail(error.message, error.code, error.status, error.details);
      }
      throw error;
    }
  });

  const automaticPriceTier = wholesaleTierForQuantity(
    payload.totalQuantity,
    minimumWholesaleQuantity(),
  );
  const pricingMode = payload.manualPriceTierApplied
    ? "manual_tier"
    : pricingProfile.pricingMode;

  if (payload.manualPriceTierApplied) {
    console.info("WHOLESALE_PRICE_TIER_OVERRIDE", {
      sellerId: payload.crmSellerId || payload.seller || null,
      customerId: payload.crmCustomerId || payload.cnpj || null,
      proposalId: payload.publicToken,
      brand: brand.key,
      quantity: payload.totalQuantity,
      automaticTier: automaticPriceTier,
      selectedTier: payload.priceTierSelection,
      reason: "manual_price_tier_selection",
      context: "wholesale_page",
      timestamp: new Date().toISOString(),
    });
  }

  return {
    products,
    brand: brand.key,
    priceTier: payload.manualPriceTierApplied
      ? payload.priceTierSelection
      : automaticPriceTier,
    automaticPriceTier,
    priceTierSelection: payload.priceTierSelection,
    manualPriceTierApplied: payload.manualPriceTierApplied,
    pricingMode,
    originalPricingMode:
      payload.originalPricingMode || pricingProfile.pricingMode,
  };
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeAddress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return {
    street: limitedText(value.street, 120),
    number: limitedText(value.number, 30),
    complement: limitedText(value.complement, 80),
    district: limitedText(value.district, 80),
    city: limitedText(value.city, 80),
    state: limitedText(value.state, 2).toUpperCase(),
    zip: onlyDigits(value.zip).slice(0, 8),
    country: limitedText(value.country || "Brasil", 60),
  };
}

export function validateWholesalePayload(
  payload,
  { allowMissingCnpj = false } = {},
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("Payload inválido.", "INVALID_PAYLOAD");
  }

  const publicToken = limitedText(payload.quote_token, 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(publicToken)) {
    fail(
      "Identificador da cotação ausente ou inválido. Atualize a página.",
      "INVALID_QUOTE_TOKEN",
    );
  }

  const cnpj = onlyDigits(payload.cnpj);
  if (
    (!allowMissingCnpj && !/^\d{14}$/.test(cnpj)) ||
    (allowMissingCnpj && cnpj && !/^\d{14}$/.test(cnpj))
  ) {
    fail("CNPJ inválido.", "INVALID_CNPJ", 422);
  }

  if (!Array.isArray(payload.products) || payload.products.length === 0) {
    fail("Selecione ao menos um produto.", "EMPTY_PRODUCTS");
  }

  if (payload.products.length > 100) {
    fail("A cotação possui produtos demais.", "TOO_MANY_PRODUCTS", 422);
  }

  const products = payload.products.map((item, index) => {
    const sku = limitedText(item?.sku, 120);
    const name = limitedText(item?.name || sku, 200);
    const quantity = Number(item?.quantity);
    const unitPriceCents = Number(item?.unit_price_cents);

    if (!sku) {
      fail(`SKU ausente no item ${index + 1}.`, "PRODUCT_SKU_MISSING", 422);
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 10000) {
      fail(`Quantidade inválida para ${sku}.`, "INVALID_QUANTITY", 422);
    }
    if (
      !Number.isSafeInteger(unitPriceCents) ||
      unitPriceCents <= 0 ||
      unitPriceCents > 100_000_000
    ) {
      fail(`Preço inválido para ${sku}.`, "INVALID_UNIT_PRICE", 422);
    }

    const itemSubtotalCents =
      item?.subtotal_cents === undefined
        ? quantity * unitPriceCents
        : Number(item.subtotal_cents);

    if (
      !Number.isSafeInteger(itemSubtotalCents) ||
      itemSubtotalCents !== quantity * unitPriceCents
    ) {
      fail(`Subtotal inválido para ${sku}.`, "ITEM_SUBTOTAL_MISMATCH", 422);
    }

    return {
      sku,
      name,
      quantity,
      unitPriceCents,
      subtotalCents: itemSubtotalCents,
      priceTier: limitedText(item?.price_tier, 20).toLowerCase(),
      priceSource: limitedText(item?.price_source, 80),
    };
  });

  const calculatedSubtotal = calculateCommercialTotals(
    products,
    payload.discount_cents || 0,
  ).commercialSubtotalCents;
  const calculatedQuantity = products.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  let priceTierSelection = limitedText(
    payload.price_tier_selection || payload.priceTierSelection || "auto",
    20,
  ).toLowerCase();
  const explicitManualTier = payload.manual_price_tier_applied === true;

  if (explicitManualTier && priceTierSelection === "auto") {
    const itemTiers = [
      ...new Set(products.map((item) => item.priceTier).filter(Boolean)),
    ];
    if (itemTiers.length === 1) priceTierSelection = itemTiers[0];
  }

  if (!["auto", "tier1", "tier2", "tier3"].includes(priceTierSelection)) {
    fail("A faixa de preço selecionada é inválida.", "INVALID_PRICE_TIER", 422);
  }

  const manualPriceTierApplied =
    explicitManualTier || priceTierSelection !== "auto";
  const subtotalCents = Number(payload.subtotal_cents);
  const totalQuantity = Number(payload.total_quantity);
  const discountCents = Number(payload.discount_cents || 0);
  const commercialTotalCents = Number(payload.commercial_total_cents);

  if (
    !Number.isSafeInteger(subtotalCents) ||
    subtotalCents !== calculatedSubtotal
  ) {
    fail(
      "O subtotal enviado não confere com os itens.",
      "SUBTOTAL_MISMATCH",
      422,
    );
  }
  if (
    !Number.isSafeInteger(totalQuantity) ||
    totalQuantity !== calculatedQuantity ||
    totalQuantity < minimumWholesaleQuantity()
  ) {
    fail(
      `O pedido precisa ter pelo menos ${minimumWholesaleQuantity()} unidades.`,
      "MINIMUM_QUANTITY_NOT_REACHED",
      422,
    );
  }

  if (manualPriceTierApplied) {
    const brand = wholesaleBrandContext();
    for (const item of products) {
      try {
        resolveWholesalePrice({
          brand: brand.key,
          sku: item.sku,
          quantity: item.quantity,
          automaticQuantity: totalQuantity,
          selectedTier: priceTierSelection,
          manualTierApplied: true,
          frontendUnitPrice: item.unitPriceCents,
          minimumQuantity: minimumWholesaleQuantity(),
        });
      } catch (error) {
        if (error instanceof WholesalePricingError) {
          fail(error.message, error.code, error.status, error.details);
        }
        throw error;
      }
    }
  }
  if (
    !Number.isSafeInteger(discountCents) ||
    discountCents < 0 ||
    discountCents >= subtotalCents
  ) {
    fail("O desconto informado é inválido.", "INVALID_DISCOUNT", 422);
  }
  if (
    !Number.isSafeInteger(commercialTotalCents) ||
    commercialTotalCents !== subtotalCents - discountCents
  ) {
    fail(
      "O total comercial não confere com o subtotal e o desconto.",
      "COMMERCIAL_TOTAL_MISMATCH",
      422,
    );
  }

  const companyName =
    limitedText(
      payload.company_name || payload.trade_name || payload.buyer,
      200,
    ) || cnpj || "Simula\u00e7\u00e3o sem cadastro";
  const email = limitedText(payload.email, 200);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("E-mail comercial inválido.", "INVALID_EMAIL", 422);
  }

  return {
    publicToken,
    cnpj,
    providedOrderId: limitedText(payload.olist_order_id, 50),
    companyName,
    tradeName: limitedText(payload.trade_name, 200),
    email,
    phone: limitedText(payload.phone, 40),
    buyer: limitedText(payload.buyer, 160),
    seller: limitedText(payload.seller, 160),
    crmCustomerId: limitedText(payload.crm_customer_id, 100),
    crmSellerId: limitedText(payload.crm_seller_id, 100),
    stateRegistration: limitedText(payload.state_registration, 40),
    notes: limitedText(payload.notes, 1000),
    registeredAddress: normalizeAddress(payload.registered_address_fields),
    shippingAddress: normalizeAddress(payload.shipping_address_fields),
    useRegisteredAddress: payload.use_registered_address !== false,
    products,
    subtotalCents,
    discountCents,
    commercialTotalCents,
    totalQuantity,
    priceTier: manualPriceTierApplied
      ? priceTierSelection
      : wholesaleTierForQuantity(totalQuantity, minimumWholesaleQuantity()),
    automaticPriceTier: wholesaleTierForQuantity(
      totalQuantity,
      minimumWholesaleQuantity(),
    ),
    priceTierSelection,
    manualPriceTierApplied,
    pricingMode: manualPriceTierApplied
      ? "manual_tier"
      : limitedText(payload.pricing_mode, 40) || "mixed",
    originalPricingMode:
      limitedText(payload.original_pricing_mode, 40) ||
      limitedText(payload.pricing_mode, 40) ||
      null,
  };
}

function identityHash(payload) {
  return hash({
    cnpj: payload.cnpj,
    companyName: payload.companyName,
    email: payload.email,
    phone: payload.phone,
    registeredAddress: payload.registeredAddress,
    shippingAddress: payload.shippingAddress,
    useRegisteredAddress: payload.useRegisteredAddress,
  });
}

function payloadHash(payload) {
  return hash({
    identity: identityHash(payload),
    products: payload.products,
    brand: payload.brand,
    priceTier: payload.priceTier,
    automaticPriceTier: payload.automaticPriceTier,
    priceTierSelection: payload.priceTierSelection,
    manualPriceTierApplied: payload.manualPriceTierApplied,
    pricingMode: payload.pricingMode,
    originalPricingMode: payload.originalPricingMode,
    discountCents: payload.discountCents,
    commercialTotalCents: payload.commercialTotalCents,
    notes: payload.notes,
  });
}

async function getOrCreateQuote(shop, payload) {
  let quote = await db.wholesaleQuote.findUnique({
    where: { publicToken: payload.publicToken },
  });

  if (!quote) {
    try {
      quote = await db.wholesaleQuote.create({
        data: {
          shop,
          publicToken: payload.publicToken,
          cnpj: payload.cnpj,
          status: "DRAFT",
        },
      });
    } catch (error) {
      if (error?.code !== "P2002") {
        throw error;
      }
      quote = await db.wholesaleQuote.findUnique({
        where: { publicToken: payload.publicToken },
      });
    }
  }

  if (!quote || quote.shop !== shop || quote.cnpj !== payload.cnpj) {
    fail(
      "A cotação não pertence a esta loja ou CNPJ.",
      "QUOTE_OWNERSHIP_MISMATCH",
      409,
    );
  }

  if (
    payload.providedOrderId &&
    quote.olistOrderId &&
    payload.providedOrderId !== quote.olistOrderId
  ) {
    fail(
      "O pedido informado não pertence a esta cotação.",
      "ORDER_OWNERSHIP_MISMATCH",
      409,
    );
  }

  if (quote.status === "READY_FOR_REVIEW") {
    fail(
      "Este pedido já foi enviado para análise e não pode mais ser recalculado.",
      "QUOTE_ALREADY_CONFIRMED",
      409,
    );
  }

  const currentIdentityHash = identityHash(payload);
  if (
    quote.olistOrderId &&
    quote.identityHash &&
    quote.identityHash !== currentIdentityHash
  ) {
    fail(
      "Os dados do cliente ou da entrega mudaram após a criação do pedido. Abra uma nova cotação para evitar alterar o comprador do pedido existente.",
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
      status: { not: "READY_FOR_REVIEW" },
      OR: [
        { status: { not: "PROCESSING" } },
        { processingStartedAt: null },
        { processingStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "PROCESSING",
      processingStartedAt: new Date(),
      lastErrorCode: null,
    },
  });

  if (result.count !== 1) {
    fail(
      "Esta cotação já está sendo processada. Aguarde alguns segundos.",
      "QUOTE_ALREADY_PROCESSING",
      409,
    );
  }
}

function requireCompleteAddress(address, label) {
  if (
    !address?.street ||
    !address?.number ||
    !address?.district ||
    !address?.city ||
    !/^[A-Z]{2}$/.test(address?.state || "") ||
    !/^\d{8}$/.test(address?.zip || "")
  ) {
    fail(
      `${label} incompleto. Consulte novamente o CNPJ ou revise o endereço.`,
      "INCOMPLETE_ADDRESS",
      422,
    );
  }
}

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

function formatCnpj(cnpj) {
  return cnpj.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
}

async function findOrCreateContact(shop, payload) {
  const brand = wholesaleBrandContext();

  try {
    return await findOlistContactByTaxId(shop, payload.cnpj);
  } catch (error) {
    if (!(error instanceof OlistApiError) || error.status !== 404) {
      throw error;
    }
  }

  requireCompleteAddress(payload.registeredAddress, "Endereço cadastral");

  const created = await createOlistContact(shop, {
    nome: payload.companyName,
    fantasia: payload.tradeName || payload.companyName,
    tipoPessoa: "J",
    cpfCnpj: formatCnpj(payload.cnpj),
    inscricaoEstadual: payload.stateRegistration || "",
    telefone: payload.phone,
    email: payload.email,
    emailNfe: payload.email,
    endereco: toOlistAddress(payload.registeredAddress),
    situacao: "B",
    observacoes: `Contato criado pela página interna ${brand.label} Atacado.`,
  });

  return {
    ...created,
    name: payload.companyName,
    taxId: payload.cnpj,
  };
}

async function resolveOrderItems(shop, payload) {
  const commercialPrices = allocateCommercialItemPrices(
    payload.products,
    payload.discountCents,
  );
  const items = [];

  for (const [index, item] of payload.products.entries()) {
    const product = await findOlistProductBySku(shop, item.sku);

    if (
      product.status &&
      !["A", "ATIVO"].includes(String(product.status).toUpperCase())
    ) {
      fail(
        `O produto ${item.sku} não está ativo no Olist.`,
        "OLIST_PRODUCT_INACTIVE",
        422,
      );
    }

    items.push({
      produto: { id: Number(product.id) },
      quantidade: item.quantity,
      valorUnitario: commercialPrices[index].unitPrice,
      infoAdicional:
        payload.discountCents > 0
          ? `Preço de atacado com desconto comercial aplicado. SKU ${item.sku}.`
          : `Preço de atacado definido pela página. SKU ${item.sku}.`,
    });
  }

  return items;
}

function optionalOrderDefaults() {
  const natureId = positiveIntegerEnvironment(
    "OLIST_DEFAULT_OPERATION_NATURE_ID",
  );
  const sellerId = positiveIntegerEnvironment("OLIST_DEFAULT_SELLER_ID");
  const depositId = positiveIntegerEnvironment("OLIST_DEFAULT_DEPOSIT_ID");

  return {
    ...(natureId ? { naturezaOperacao: { id: natureId } } : {}),
    ...(sellerId ? { vendedor: { id: sellerId } } : {}),
    ...(depositId ? { deposito: { id: depositId } } : {}),
  };
}

function buildCreateOrderBody(payload, contactId, items) {
  const brand = wholesaleBrandContext();
  const body = {
    situacao: OPEN_ORDER_STATUS,
    data: new Date().toISOString().slice(0, 10),
    numeroOrdemCompra: quotePurchaseNumber(payload.publicToken),
    valorDesconto: 0,
    valorFrete: 0,
    valorOutrasDespesas: 0,
    idContato: Number(contactId),
    observacoes:
      payload.notes ||
      "Pedido de atacado aguardando análise e aprovação manual da responsável.",
    observacoesInternas: [
      `[${brand.orderMarker}] Cotação ${payload.publicToken}.`,
      `Vendedor: ${payload.seller || "não informado"}.`,
      `Comprador: ${payload.buyer || "não informado"}.`,
      `Regra de preços: ${payload.pricingMode === "per_model" ? "faixa separada por modelo para cliente recorrente" : "faixa pelo mix total da primeira compra"}.`,
      `Desconto comercial aplicado nos itens: R$ ${(payload.discountCents / 100).toFixed(2)}.`,
      "Aguardando aprovação manual da responsável. Não cobrar, faturar ou emitir nota automaticamente antes da aprovação.",
    ].join(" "),
    itens: items,
    ...optionalOrderDefaults(),
  };

  if (!payload.useRegisteredAddress) {
    requireCompleteAddress(payload.shippingAddress, "Endereço de entrega");
    body.enderecoEntrega = {
      ...toOlistAddress(payload.shippingAddress),
      enderecoNro: payload.shippingAddress.number,
      fone: payload.phone,
      nomeDestinatario: payload.companyName,
      cpfCnpj: formatCnpj(payload.cnpj),
      ie: payload.stateRegistration || "",
    };
    delete body.enderecoEntrega.numero;
  }

  return body;
}

function quotePurchaseNumber(publicToken) {
  return `ATC-${publicToken.slice(0, 32)}`;
}

async function recoverExistingOrder(shop, payload) {
  const today = new Date().toISOString().slice(0, 10);
  const candidates = await listOlistOrders(shop, {
    cpfCnpj: formatCnpj(payload.cnpj),
    dataInicial: today,
    dataFinal: today,
    limit: 100,
    offset: 0,
  });
  const purchaseNumber = quotePurchaseNumber(payload.publicToken);

  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    const order = await getOlistOrder(shop, candidate.id);

    if (String(order?.numeroOrdemCompra || "") === purchaseNumber) {
      return {
        id: String(candidate.id),
        orderNumber: String(
          candidate.numeroPedido || order?.numeroPedido || "",
        ),
        order,
      };
    }
  }

  return null;
}

function isOpenStatus(value) {
  if (value === OPEN_ORDER_STATUS || String(value).trim() === "0") return true;
  const normalized = String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR");
  return ["aberta", "aberto", "em aberto"].includes(normalized);
}

async function getOlistOrderWithRetry(shop, orderId) {
  return retryOlistOrderRead(() => getOlistOrder(shop, orderId));
}

async function assertOrderStillOpen(shop, quote, orderDetails = null) {
  const details =
    orderDetails || (await getOlistOrderWithRetry(shop, quote.olistOrderId));

  if (details?.idNotaFiscal || details?.dataFaturamento) {
    fail(
      "O pedido já possui faturamento ou nota fiscal e não pode ser alterado pela página.",
      "ORDER_ALREADY_INVOICED",
      409,
    );
  }

  const summary = await findOlistOrderSummary(
    shop,
    quote.olistOrderNumber,
    quote.olistOrderId,
  );
  const status = summary?.situacao ?? details?.situacao;

  if (status === undefined || status === null || !isOpenStatus(status)) {
    fail(
      "O pedido não está mais em situação Aberta. Revise-o diretamente no Olist.",
      "ORDER_NOT_OPEN",
      409,
    );
  }

  return details;
}

function responseFromOrder(quote, payload, order) {
  const priceMismatch = findOlistOrderItemPriceMismatch(payload, order);
  if (priceMismatch) {
    fail(
      "O Olist devolveu um preço unitário diferente do enviado pelo app.",
      "OLIST_PRICE_MISMATCH",
      502,
      priceMismatch,
    );
  }

  const { totalConfirmedByOlistCents, values } = buildWholesaleOrderValues(
    payload,
    order,
  );

  if (!totalConfirmedByOlistCents || totalConfirmedByOlistCents <= 0) {
    fail(
      "O Olist não devolveu um total válido para o pedido.",
      "OLIST_TOTAL_MISSING",
      502,
    );
  }

  return {
    success: true,
    values_in_cents: true,
    tax_breakdown_available: false,
    tax_breakdown: null,
    tax_breakdown_message:
      "A API publica do Olist nao disponibiliza o detalhamento fiscal completo antes da NF-e.",
    app_tax_estimate_available: false,
    estimated_taxes: null,
    olist_order_id: quote.olistOrderId,
    order_number: quote.olistOrderNumber || String(order?.numeroPedido || ""),
    status: "em_aberto",
    brand: payload.brand,
    price_tier: payload.priceTier,
    automatic_price_tier: payload.automaticPriceTier,
    price_tier_selection: payload.priceTierSelection,
    manual_price_tier_applied: payload.manualPriceTierApplied,
    pricing_mode: payload.pricingMode,
    original_pricing_mode: payload.originalPricingMode,
    recurring_customer: payload.originalPricingMode === "per_model",
    payment_url: "",
    values,
  };
}

async function recordProcessingFailure(quoteId, error) {
  try {
    await db.wholesaleQuote.update({
      where: { id: quoteId },
      data: {
        status: "ERROR",
        processingStartedAt: null,
        lastErrorCode: limitedText(
          error?.code || error?.name || "UNKNOWN_ERROR",
          80,
        ),
      },
    });
  } catch (databaseError) {
    console.error("Falha ao registrar erro da cotação de atacado", {
      quoteId,
      name: databaseError?.name,
      message: databaseError?.message,
    });
  }
}

export async function calculateWholesaleOrder(shop, rawPayload) {
  const validatedPayload = validateWholesalePayload(rawPayload);
  const pricing = await assertWholesalePricing(shop, validatedPayload);
  const canonicalTotals = calculateCommercialTotals(
    pricing.products,
    validatedPayload.discountCents,
  );
  const payload = {
    ...validatedPayload,
    ...pricing,
    products: pricing.products,
    subtotalCents: canonicalTotals.commercialSubtotalCents,
    commercialTotalCents: canonicalTotals.totalSentToOlistCents,
  };
  let quote = await getOrCreateQuote(shop, payload);
  const currentPayloadHash = payloadHash(payload);
  const currentIdentityHash = identityHash(payload);

  await claimQuote(quote);

  try {
    if (quote.olistOrderId) {
      const existingOrder = await assertOrderStillOpen(shop, quote);

      if (quote.payloadHash !== currentPayloadHash) {
        const items = await resolveOrderItems(shop, payload);
        await updateOlistOrderItems(shop, quote.olistOrderId, items);
      }

      const refreshedOrder =
        quote.payloadHash === currentPayloadHash
          ? existingOrder
          : await getOlistOrderWithRetry(shop, quote.olistOrderId);

      quote = await db.wholesaleQuote.update({
        where: { id: quote.id },
        data: {
          identityHash: currentIdentityHash,
          payloadHash: currentPayloadHash,
          status: "CALCULATED",
          processingStartedAt: null,
          lastErrorCode: null,
          calculatedAt: new Date(),
        },
      });

      return responseFromOrder(quote, payload, refreshedOrder);
    }

    const recoveredOrder = await recoverExistingOrder(shop, payload);

    if (recoveredOrder) {
      quote = await db.wholesaleQuote.update({
        where: { id: quote.id },
        data: {
          olistOrderId: recoveredOrder.id,
          olistOrderNumber: recoveredOrder.orderNumber,
          identityHash: currentIdentityHash,
          status: "PROCESSING",
        },
      });

      await assertOrderStillOpen(shop, quote, recoveredOrder.order);
      const items = await resolveOrderItems(shop, payload);
      await updateOlistOrderItems(shop, quote.olistOrderId, items);
      const refreshedOrder = await getOlistOrderWithRetry(
        shop,
        quote.olistOrderId,
      );

      quote = await db.wholesaleQuote.update({
        where: { id: quote.id },
        data: {
          payloadHash: currentPayloadHash,
          status: "CALCULATED",
          processingStartedAt: null,
          lastErrorCode: null,
          calculatedAt: new Date(),
        },
      });

      return responseFromOrder(quote, payload, refreshedOrder);
    }

    const [contact, items] = await Promise.all([
      findOrCreateContact(shop, payload),
      resolveOrderItems(shop, payload),
    ]);
    const createdOrder = await createOlistOrder(
      shop,
      buildCreateOrderBody(payload, contact.id, items),
    );

    quote = await db.wholesaleQuote.update({
      where: { id: quote.id },
      data: {
        olistOrderId: String(createdOrder.id),
        olistOrderNumber: String(createdOrder.orderNumber || ""),
        identityHash: currentIdentityHash,
        status: "PROCESSING",
      },
    });

    const order = await getOlistOrderWithRetry(shop, quote.olistOrderId);

    quote = await db.wholesaleQuote.update({
      where: { id: quote.id },
      data: {
        payloadHash: currentPayloadHash,
        status: "CALCULATED",
        processingStartedAt: null,
        lastErrorCode: null,
        calculatedAt: new Date(),
      },
    });

    return responseFromOrder(quote, payload, order);
  } catch (error) {
    await recordProcessingFailure(quote.id, error);
    throw error;
  }
}

export async function confirmWholesaleOrderForReview(shop, rawPayload) {
  const publicToken = limitedText(
    rawPayload?.proposal?.quote_token || rawPayload?.quote_token,
    100,
  );
  const requestedOrderId = limitedText(rawPayload?.olist_order_id, 50);

  if (!publicToken || !requestedOrderId) {
    fail(
      "Identificação da cotação ou do pedido ausente.",
      "CONFIRMATION_IDENTIFIERS_MISSING",
      422,
    );
  }

  const quote = await db.wholesaleQuote.findUnique({
    where: { publicToken },
  });

  if (
    !quote ||
    quote.shop !== shop ||
    quote.olistOrderId !== requestedOrderId
  ) {
    fail(
      "O pedido não pertence a esta cotação.",
      "ORDER_OWNERSHIP_MISMATCH",
      409,
    );
  }

  if (quote.status === "READY_FOR_REVIEW") {
    return {
      success: true,
      olist_order_id: quote.olistOrderId,
      status: "aguardando_aprovacao",
      payment_url: "",
      message: "Pedido já estava pendente para análise no Olist.",
    };
  }

  if (quote.status !== "CALCULATED") {
    fail(
      "Calcule o pedido novamente antes de enviá-lo para análise.",
      "QUOTE_NOT_CALCULATED",
      409,
    );
  }

  await assertOrderStillOpen(shop, quote);
  await addOlistOrderMarker(
    shop,
    quote.olistOrderId,
    OLIST_REVIEW_MARKER,
  );
  await db.wholesaleQuote.update({
    where: { id: quote.id },
    data: {
      status: "READY_FOR_REVIEW",
      confirmedAt: new Date(),
      processingStartedAt: null,
      lastErrorCode: null,
    },
  });

  return {
    success: true,
    olist_order_id: quote.olistOrderId,
    status: "aguardando_aprovacao",
    payment_url: "",
    message:
      "Pedido mantido em aberto no Olist e marcado como PARA ANÁLISE.",
  };
}
