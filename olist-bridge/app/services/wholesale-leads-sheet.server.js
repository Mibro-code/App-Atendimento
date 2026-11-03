const DEFAULT_TIMEOUT_MS = 10_000;

export class WholesaleLeadSheetError extends Error {
  constructor(message, { code = "LEAD_SHEET_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "WholesaleLeadSheetError";
    this.code = code;
  }
}

function configuredBrand() {
  return String(process.env.WHOLESALE_BRAND || "").trim().toLowerCase() ===
    "sincrofit"
    ? "Sincrofit"
    : "Mibro";
}

function configuration() {
  const url = String(process.env.GOOGLE_SCRIPT_WEBHOOK_URL || "").trim();
  const secret = String(process.env.GOOGLE_SCRIPT_WEBHOOK_SECRET || "").trim();

  if (!url && !secret) return null;
  if (!url || !secret) {
    throw new WholesaleLeadSheetError(
      "A integração com a planilha está parcialmente configurada.",
      { code: "LEAD_SHEET_CONFIGURATION_INCOMPLETE" },
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new WholesaleLeadSheetError(
      "A URL do webhook da planilha é inválida.",
      { code: "LEAD_SHEET_URL_INVALID" },
    );
  }

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "script.google.com" ||
    !parsedUrl.pathname.endsWith("/exec")
  ) {
    throw new WholesaleLeadSheetError(
      "Use a URL HTTPS publicada pelo Google Apps Script e terminada em /exec.",
      { code: "LEAD_SHEET_URL_INVALID" },
    );
  }

  return { url: parsedUrl.toString(), secret };
}

export async function appendWholesaleLeadToSheet(shop, rawPayload, result) {
  const config = configuration();
  if (!config) return { configured: false, synced: false };

  const payload = {
    ...rawPayload,
    lead_id: rawPayload?.quote_token,
    brand: configuredBrand(),
    store: shop,
    buyer: rawPayload?.buyer_name || rawPayload?.buyer || "",
    phone: rawPayload?.buyer_phone || rawPayload?.phone || "",
    comprador: rawPayload?.buyer_name || rawPayload?.comprador || "",
    email: rawPayload?.buyer_email || rawPayload?.email || "",
    telefone: rawPayload?.buyer_phone || rawPayload?.telefone || "",
    olist_order_id: result?.olist_order_id || rawPayload?.olist_order_id || "",
    lead_status: result?.status || "aguardando_aprovacao",
    webhook_secret: config.secret,
  };

  let response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WholesaleLeadSheetError(
      "Não foi possível acessar o webhook da planilha.",
      { code: "LEAD_SHEET_REQUEST_FAILED", cause: error },
    );
  }

  const responseText = await response.text();
  let responseBody = null;
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    // A resposta é validada abaixo sem registrar HTML ou dados sensíveis.
  }

  if (!response.ok || responseBody?.success !== true) {
    throw new WholesaleLeadSheetError(
      "O Google Apps Script não confirmou a gravação do lead.",
      { code: "LEAD_SHEET_WRITE_REJECTED" },
    );
  }

  return {
    configured: true,
    synced: true,
    duplicate: responseBody?.duplicate === true,
    leadId: String(responseBody?.lead_id || payload.lead_id || ""),
  };
}
