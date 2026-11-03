import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 8000;
const CRM_CONTEXT_TTL_SECONDS = 2 * 60 * 60;

export class CrmIntegrationError extends Error {
  constructor(message, { status = 502, code = "CRM_INTEGRATION_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "CrmIntegrationError";
    this.status = status;
    this.code = code;
  }
}

function configuration() {
  const url = String(process.env.CRM_API_URL || "").trim();
  const secret = String(process.env.CRM_SHOPIFY_SHARED_SECRET || "").trim();

  if (!url || !secret) {
    throw new CrmIntegrationError(
      "A integração com o CRM não está configurada.",
      { code: "CRM_CONFIGURATION_MISSING", status: 503 },
    );
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new CrmIntegrationError("A URL do CRM é inválida.", {
      code: "CRM_URL_INVALID",
      status: 503,
    });
  }

  if (parsed.protocol !== "https:" && !parsed.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
    throw new CrmIntegrationError("A URL do CRM precisa usar HTTPS.", {
      code: "CRM_URL_INVALID",
      status: 503,
    });
  }

  return { baseUrl: parsed.origin, secret };
}

function encodeContext(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signContext(encoded, secret) {
  return crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function createCrmProposalContext({ customer, seller, mode, resumeQuote }, secret) {
  const payload = {
    v: 1,
    customerId: customer.id,
    sellerId: seller.id,
    mode: mode === "simulation" ? "SIMULATION" : "REAL",
    resumeQuoteId: resumeQuote?.id || null,
    resumeQuoteMode:
      resumeQuote?.mode === "simulation"
        ? "SIMULATION"
        : resumeQuote?.mode === "real"
          ? "REAL"
          : null,
    exp: Math.floor(Date.now() / 1000) + CRM_CONTEXT_TTL_SECONDS,
  };
  const encoded = encodeContext(payload);
  return `${encoded}.${signContext(encoded, secret)}`;
}

export function verifyCrmProposalContext(value) {
  const token = String(value || "").trim();
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) {
    throw new CrmIntegrationError("Contexto da proposta do CRM inválido.", {
      code: "CRM_CONTEXT_INVALID",
      status: 400,
    });
  }

  const { secret } = configuration();
  const expected = signContext(encoded, secret);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new CrmIntegrationError("Assinatura do contexto da proposta inválida.", {
      code: "CRM_CONTEXT_INVALID",
      status: 400,
    });
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new CrmIntegrationError("Contexto da proposta do CRM inválido.", {
      code: "CRM_CONTEXT_INVALID",
      status: 400,
    });
  }

  if (
    payload?.v !== 1 ||
    !payload.customerId ||
    !payload.sellerId ||
    !["SIMULATION", "REAL"].includes(payload.mode) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new CrmIntegrationError("O contexto da proposta expirou ou é inválido.", {
      code: "CRM_CONTEXT_INVALID",
      status: 400,
    });
  }

  return payload;
}

export function proposalCrmContext(proposal) {
  const contextToken = text(proposal?.crm_context, 4096);
  if (!contextToken) {
    if (
      text(proposal?.crm_customer_id, 100) ||
      text(proposal?.crm_seller_id, 100)
    ) {
      throw new CrmIntegrationError("O contexto seguro da proposta do CRM está ausente.", {
        code: "CRM_CONTEXT_REQUIRED",
        status: 409,
      });
    }
    return null;
  }
  const context = verifyCrmProposalContext(contextToken);

  if (
    text(proposal?.crm_customer_id, 100) !== context.customerId ||
    text(proposal?.crm_seller_id, 100) !== context.sellerId
  ) {
    throw new CrmIntegrationError("A proposta não corresponde à sessão do CRM.", {
      code: "CRM_CONTEXT_MISMATCH",
      status: 409,
    });
  }
  return context;
}

export function assertProposalMayUseOlist(proposal) {
  const context = proposalCrmContext(proposal);
  if (context?.mode === "SIMULATION") {
    throw new CrmIntegrationError(
      "Simulações não podem calcular nem criar pedidos no Olist.",
      { code: "CRM_SIMULATION_OLIST_BLOCKED", status: 409 },
    );
  }
  return context;
}

// Resolve um token de sessão de cotação emitido pelo CRM (crm_session na URL
// da calculadora) em dados de cliente/vendedor para pré-preencher o
// formulário. O CRM garante uso único e curta duração desse token.
export async function resolveCrmSession(token) {
  const normalizedToken = String(token || "").trim();

  if (!normalizedToken) {
    throw new CrmIntegrationError("Token de sessão do CRM ausente.", {
      code: "CRM_TOKEN_MISSING",
      status: 400,
    });
  }

  const { baseUrl, secret } = configuration();
  let response;

  try {
    response = await fetch(
      `${baseUrl}/api/integrations/shopify/session/resolve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json",
        },
        body: JSON.stringify({ token: normalizedToken }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      },
    );
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new CrmIntegrationError("O CRM demorou demais para responder.", {
        code: "CRM_TIMEOUT",
        status: 504,
        cause: error,
      });
    }

    throw new CrmIntegrationError("Não foi possível acessar o CRM.", {
      code: "CRM_REQUEST_FAILED",
      status: 502,
      cause: error,
    });
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || body?.success !== true) {
    const code = body?.code || "CRM_SESSION_REJECTED";
    const status =
      response.status === 401 || response.status === 409
        ? response.status
        : 502;

    throw new CrmIntegrationError(
      body?.message || "O CRM não confirmou a sessão de cotação.",
      { code, status },
    );
  }

  if (!body.customer || !body.seller) {
    throw new CrmIntegrationError(
      "O CRM não devolveu os dados esperados do cliente/vendedor.",
      { code: "CRM_RESPONSE_INCOMPLETE", status: 502 },
    );
  }

  const mode = body.mode === "simulation" ? "simulation" : "real";
  const resumeQuote = body.resumeQuote || null;
  return {
    customer: body.customer,
    seller: body.seller,
    mode,
    resumeQuote,
    proposalContext: createCrmProposalContext(
      { customer: body.customer, seller: body.seller, mode, resumeQuote },
      secret,
    ),
  };
}

function text(value, maxLength = 300) {
  return String(value || "").trim().slice(0, maxLength);
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

// Envia ao CRM somente cotações que nasceram de uma sessão CRM válida. O
// vínculo é preservado pelos IDs devolvidos na resolução da sessão; acessos
// diretos à calculadora continuam funcionando, mas não tentam sincronizar.
export async function syncCrmQuote({ event, shop, proposal, result }) {
  const context = proposalCrmContext(proposal);
  const customerId = context?.customerId || text(proposal?.crm_customer_id, 100);
  const sellerId = context?.sellerId || text(proposal?.crm_seller_id, 100);

  if (!customerId || !sellerId) {
    return { configured: true, synced: false, skipped: "NO_CRM_CONTEXT" };
  }

  const quoteToken = text(proposal?.quote_token, 100);
  const products = Array.isArray(proposal?.products)
    ? proposal.products.slice(0, 200).map((product) => ({
        sku: text(product?.sku, 120),
        name: text(product?.name, 300) || "Produto",
        variant: text(product?.variant, 200) || undefined,
        quantity: integer(product?.quantity),
        unitPriceCents: integer(
          product?.unit_price_cents ?? product?.unitPriceCents,
        ),
        subtotalCents: integer(
          product?.subtotal_cents ?? product?.subtotalCents,
        ),
        priceTier:
          text(product?.price_tier ?? product?.priceTier, 20) || undefined,
        priceSource:
          text(product?.price_source ?? product?.priceSource, 80) || undefined,
      }))
    : [];

  const orderId = text(
    result?.olist_order_id || proposal?.olist_order_id,
    100,
  );
  const orderNumber = text(
    result?.order_number || result?.numero || proposal?.olist_order_number,
    100,
  );
  const valueCents = integer(
    result?.values?.total ??
      result?.total ??
      proposal?.olist_total_cents ??
      proposal?.commercial_total_cents,
  );

  const payload = {
    event,
    mode: context?.mode || "REAL",
    shop: text(shop, 255),
    customerId,
    sellerId,
    quoteToken,
    valueCents,
    totalQuantity: integer(
      proposal?.total_quantity ?? proposal?.totalQuantity,
    ),
    priceTier:
      text(proposal?.price_tier ?? proposal?.priceTier, 20) || undefined,
    automaticPriceTier:
      text(
        proposal?.automatic_price_tier ?? proposal?.automaticPriceTier,
        20,
      ) || undefined,
    priceTierSelection:
      text(
        proposal?.price_tier_selection ?? proposal?.priceTierSelection,
        20,
      ) || undefined,
    manualPriceTierApplied:
      proposal?.manual_price_tier_applied === true ||
      proposal?.manualPriceTierApplied === true,
    pricingMode:
      text(proposal?.pricing_mode ?? proposal?.pricingMode, 40) || undefined,
    originalPricingMode:
      text(
        proposal?.original_pricing_mode ?? proposal?.originalPricingMode,
        40,
      ) || undefined,
    products,
    discountCents: integer(
      proposal?.discount_cents ?? proposal?.discountCents,
    ),
    couponCode: text(proposal?.coupon_code, 80) || undefined,
    notes: text(proposal?.notes, 2000) || undefined,
    ...(event === "SENT"
      ? { sentToEmail: text(proposal?.email, 255) || undefined }
      : {}),
    ...(context?.mode === "REAL" && context.resumeQuoteMode === "SIMULATION"
      ? { sourceQuoteId: context.resumeQuoteId }
      : {}),
    ...(orderId && context?.mode !== "SIMULATION"
      ? {
          olistOrder: {
            id: orderId,
            number: orderNumber || undefined,
            statusRaw: text(result?.status, 200) || undefined,
          },
        }
      : {}),
  };

  const { baseUrl, secret } = configuration();
  let response;
  try {
    response = await fetch(`${baseUrl}/api/integrations/shopify/quotes/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new CrmIntegrationError("O CRM demorou demais para registrar a cotação.", {
        code: "CRM_QUOTE_TIMEOUT",
        status: 504,
        cause: error,
      });
    }
    throw new CrmIntegrationError("Não foi possível registrar a cotação no CRM.", {
      code: "CRM_QUOTE_REQUEST_FAILED",
      status: 502,
      cause: error,
    });
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new CrmIntegrationError(
      body?.message || "O CRM rejeitou a atualização da cotação.",
      { code: body?.code || "CRM_QUOTE_REJECTED", status: response.status || 502 },
    );
  }

  return { configured: true, synced: true, quote: body.quote, olistOrder: body.olistOrder };
}

export async function syncCrmOlistOrderStatus({ olistOrderId, status }) {
  const externalOrderId = text(olistOrderId, 100);
  const statusRaw = text(status, 200);
  if (!externalOrderId || !statusRaw) {
    throw new CrmIntegrationError("Pedido ou situação da Olist ausente.", {
      code: "CRM_ORDER_STATUS_INVALID",
      status: 400,
    });
  }

  const { baseUrl, secret } = configuration();
  let response;
  try {
    response = await fetch(`${baseUrl}/api/integrations/olist/orders/status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify({ olistOrderId: externalOrderId, status: statusRaw }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new CrmIntegrationError("O CRM demorou demais para atualizar o pedido.", {
        code: "CRM_ORDER_STATUS_TIMEOUT",
        status: 504,
        cause: error,
      });
    }
    throw new CrmIntegrationError("Não foi possível atualizar o pedido no CRM.", {
      code: "CRM_ORDER_STATUS_REQUEST_FAILED",
      status: 502,
      cause: error,
    });
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new CrmIntegrationError(
      body?.message || "O CRM rejeitou a situação do pedido Olist.",
      { code: body?.code || "CRM_ORDER_STATUS_REJECTED", status: response.status || 502 },
    );
  }

  return body;
}
