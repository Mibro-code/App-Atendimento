import { getOlistAccessToken } from "./olist-auth.server";

const DEFAULT_API_BASE_URL = "https://api.tiny.com.br/public-api/v3";
const DEFAULT_TIMEOUT_MS = 15000;
const RATE_LIMIT_RETRIES = 2;
const PRODUCT_CACHE_TTL_MS = 10 * 60 * 1000;
const ORDER_HISTORY_CACHE_TTL_MS = 60 * 1000;
const productSkuCache = new Map();
const approvedOrderHistoryCache = new Map();
const APPROVED_OR_LATER_ORDER_STATUSES = new Set([
  "1",
  "3",
  "4",
  "5",
  "6",
  "7",
  "9",
]);

export class OlistApiError extends Error {
  constructor(
    message,
    { status = 502, code = "OLIST_API_ERROR", details, cause } = {},
  ) {
    super(message, { cause });
    this.name = "OlistApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getApiConfiguration() {
  const baseUrl = (
    process.env.OLIST_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL
  ).replace(/\/+$/, "");
  const timeoutMs = Number(
    process.env.OLIST_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
  );

  let parsedBaseUrl;

  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new OlistApiError("A URL da API Olist não é válida.", {
      status: 500,
    });
  }

  if (parsedBaseUrl.protocol !== "https:") {
    throw new OlistApiError("A URL da API Olist precisa usar HTTPS.", {
      status: 500,
    });
  }

  return {
    baseUrl,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_TIMEOUT_MS,
  };
}

function createApiUrl(path, query) {
  const { baseUrl } = getApiConfiguration();
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const url = new URL(`${baseUrl}/${normalizedPath}`);

  for (const [name, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, String(value));
    }
  }

  return url;
}

async function parseResponse(response) {
  const responseText = await response.text();

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new OlistApiError("A Olist devolveu uma resposta inválida.", {
      status: 502,
    });
  }
}

async function performRequest(shop, url, options, forceRefresh) {
  const { timeoutMs } = getApiConfiguration();
  const accessToken = await getOlistAccessToken(shop, { forceRefresh });
  const hasBody = options.body !== undefined && options.body !== null;

  return fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(seconds * 1000, 500), 10_000);
  }

  const retryDate = Date.parse(retryAfter || "");
  if (Number.isFinite(retryDate)) {
    return Math.min(Math.max(retryDate - Date.now(), 500), 10_000);
  }

  return 1000 * 2 ** attempt;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function olistRequest(shop, path, { query, ...options } = {}) {
  const url = createApiUrl(path, query);
  let response;

  try {
    for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
      response = await performRequest(shop, url, options, false);

      if (response.status === 401) {
        response = await performRequest(shop, url, options, true);
      }

      if (response.status !== 429 || attempt === RATE_LIMIT_RETRIES) {
        break;
      }

      const delay = retryDelayMs(response, attempt);
      await response.body?.cancel();
      await wait(delay);
    }
  } catch (error) {
    if (error instanceof OlistApiError) {
      throw error;
    }

    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new OlistApiError(
        "A Olist demorou demais para responder. Tente novamente.",
        { status: 504, cause: error },
      );
    }

    throw new OlistApiError("Não foi possível acessar a API da Olist.", {
      status: 502,
      cause: error,
    });
  }

  const responseData = await parseResponse(response);

  if (!response.ok) {
    const validationDetails = Array.isArray(responseData?.detalhes)
      ? responseData.detalhes
          .map((detail) => detail?.mensagem)
          .filter(Boolean)
          .slice(0, 5)
      : [];
    const responseMessage =
      responseData?.mensagem || responseData?.message || responseData?.error;
    const messageParts = [
      responseMessage,
      validationDetails.length > 0 ? validationDetails.join(" ") : null,
    ].filter(Boolean);

    throw new OlistApiError(
      messageParts.length > 0
        ? `A Olist recusou a solicitação: ${messageParts.join(" ")}`
        : `A Olist recusou a solicitação com HTTP ${response.status}.`,
      {
        status: response.status,
        code: "OLIST_REQUEST_REJECTED",
        details: validationDetails,
      },
    );
  }

  return responseData;
}

export async function getOlistAccountInfo(shop) {
  return olistRequest(shop, "/info", {
    method: "GET",
  });
}

export async function findOlistProductBySku(shop, sku) {
  const normalizedSku = String(sku || "").trim();

  if (!normalizedSku) {
    throw new OlistApiError("Informe um SKU para consultar.", {
      status: 400,
    });
  }

  if (normalizedSku.length > 120) {
    throw new OlistApiError("O SKU informado é muito longo.", {
      status: 400,
    });
  }

  const cacheKey = `${shop}:${normalizedSku.toLocaleUpperCase("pt-BR")}`;
  const cached = productSkuCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.product;
  }
  productSkuCache.delete(cacheKey);

  const response = await olistRequest(shop, "/produtos", {
    method: "GET",
    query: {
      codigo: normalizedSku,
      situacao: "A",
      limit: 20,
      offset: 0,
    },
  });
  const products = Array.isArray(response?.itens) ? response.itens : [];
  const exactMatches = products.filter(
    (product) =>
      String(product?.sku || "")
        .trim()
        .toLocaleUpperCase("pt-BR") ===
      normalizedSku.toLocaleUpperCase("pt-BR"),
  );
  const uniqueMatches = [
    ...new Map(
      exactMatches
        .filter((product) => product?.id)
        .map((product) => [String(product.id), product]),
    ).values(),
  ];

  if (uniqueMatches.length === 0) {
    throw new OlistApiError(
      `Nenhum produto da Olist foi encontrado com o SKU ${normalizedSku}.`,
      { status: 404 },
    );
  }

  let product;

  if (uniqueMatches.length === 1) {
    product = uniqueMatches[0];
  } else {
    const detailedMatches = [];
    for (const match of uniqueMatches) {
      detailedMatches.push(
        await olistRequest(shop, `/produtos/${encodeURIComponent(match.id)}`, {
          method: "GET",
        }),
      );
    }
    const activeMatches = detailedMatches.filter(
      (match) =>
        String(match?.sku || "")
          .trim()
          .toLocaleUpperCase("pt-BR") ===
          normalizedSku.toLocaleUpperCase("pt-BR") &&
        String(match?.situacao || "").toUpperCase() === "A",
    );
    const activeVariations = activeMatches.filter(
      (match) =>
        String(match?.tipoVariacao || "").toUpperCase() === "V" ||
        Boolean(match?.produtoPai?.id),
    );
    const candidates =
      activeVariations.length > 0 ? activeVariations : activeMatches;

    if (candidates.length !== 1) {
      throw new OlistApiError(
        candidates.length === 0
          ? `Nenhum produto ativo da Olist foi encontrado com o SKU ${normalizedSku}.`
          : `A Olist devolveu mais de uma variação ativa com o SKU ${normalizedSku}.`,
        { status: candidates.length === 0 ? 404 : 409 },
      );
    }

    product = candidates[0];
  }

  const normalizedProduct = {
    id: product.id,
    sku: product.sku,
    description: product.descricao || "",
    status: product.situacao || "A",
    type: product.tipo || null,
    variationType: product.tipoVariacao || null,
    unit: product.unidade || null,
  };

  productSkuCache.set(cacheKey, {
    product: normalizedProduct,
    expiresAt: Date.now() + PRODUCT_CACHE_TTL_MS,
  });

  if (productSkuCache.size > 500) {
    const oldestKey = productSkuCache.keys().next().value;
    productSkuCache.delete(oldestKey);
  }

  return normalizedProduct;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatBrazilianTaxId(value) {
  if (value.length === 11) {
    return value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }

  return value.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
}

export async function findOlistContactByTaxId(shop, taxId) {
  const normalizedTaxId = onlyDigits(taxId);

  if (![11, 14].includes(normalizedTaxId.length)) {
    throw new OlistApiError("Informe um CPF ou CNPJ válido para consultar.", {
      status: 400,
    });
  }

  const queryValues = [
    ...new Set([formatBrazilianTaxId(normalizedTaxId), normalizedTaxId]),
  ];
  let exactMatches = [];

  for (const queryTaxId of queryValues) {
    const response = await olistRequest(shop, "/contatos", {
      method: "GET",
      query: {
        cpfCnpj: queryTaxId,
        limit: 20,
        offset: 0,
      },
    });
    const contacts = Array.isArray(response?.itens) ? response.itens : [];

    exactMatches = contacts.filter(
      (contact) => onlyDigits(contact?.cpfCnpj) === normalizedTaxId,
    );

    if (exactMatches.length > 0) {
      break;
    }
  }

  if (exactMatches.length === 0) {
    throw new OlistApiError(
      "Nenhum contato da Olist foi encontrado com esse CPF ou CNPJ.",
      { status: 404 },
    );
  }

  if (exactMatches.length > 1) {
    throw new OlistApiError(
      "A Olist devolveu mais de um contato com esse CPF ou CNPJ.",
      { status: 409 },
    );
  }

  const contact = exactMatches[0];

  return {
    id: contact.id,
    name: contact.nome || "",
    tradeName: contact.fantasia || "",
    taxId: contact.cpfCnpj || normalizedTaxId,
    personType: contact.tipoPessoa || null,
    status: contact.situacao || null,
    crmStatus: contact.statusCrm || null,
  };
}

export async function createOlistContact(shop, contact) {
  const response = await olistRequest(shop, "/contatos", {
    method: "POST",
    body: JSON.stringify(contact),
  });

  if (!response?.id) {
    throw new OlistApiError("A Olist não devolveu o ID do novo contato.", {
      code: "OLIST_CONTACT_ID_MISSING",
    });
  }

  return {
    id: response.id,
  };
}

export async function createOlistOrder(shop, order) {
  const response = await olistRequest(shop, "/pedidos", {
    method: "POST",
    body: JSON.stringify(order),
  });

  if (!response?.id) {
    throw new OlistApiError("A Olist não devolveu o ID do novo pedido.", {
      code: "OLIST_ORDER_ID_MISSING",
    });
  }

  return {
    id: response.id,
    orderNumber: response.numeroPedido || "",
  };
}

export async function updateOlistOrderItems(shop, orderId, items) {
  await olistRequest(shop, `/pedidos/${encodeURIComponent(orderId)}/itens`, {
    method: "PUT",
    body: JSON.stringify({ itens: items }),
  });
}

export async function getOlistOrder(shop, orderId) {
  return olistRequest(shop, `/pedidos/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });
}

export async function findOlistOrderSummary(shop, orderNumber, orderId) {
  const orders = await listOlistOrders(shop, {
    numero: orderNumber || undefined,
    limit: 20,
    offset: 0,
  });

  return (
    orders.find((order) => String(order?.id) === String(orderId)) ||
    orders.find(
      (order) => String(order?.numeroPedido) === String(orderNumber || ""),
    ) ||
    null
  );
}

export async function listOlistOrders(shop, query = {}) {
  const response = await olistRequest(shop, "/pedidos", {
    method: "GET",
    query,
  });

  return Array.isArray(response?.itens) ? response.itens : [];
}

export async function getOlistCustomerPricingProfile(shop, taxId) {
  const normalizedTaxId = onlyDigits(taxId);

  if (normalizedTaxId.length !== 14) {
    throw new OlistApiError(
      "Informe um CNPJ válido para consultar o histórico.",
      {
        status: 400,
      },
    );
  }

  const cacheKey = `${shop}:${normalizedTaxId}`;
  const cached = approvedOrderHistoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile;
  }
  approvedOrderHistoryCache.delete(cacheKey);

  const orders = await listOlistOrders(shop, {
    cpfCnpj: formatBrazilianTaxId(normalizedTaxId),
    orderBy: "desc",
    limit: 100,
    offset: 0,
  });
  const qualifyingOrder = orders.find((order) =>
    APPROVED_OR_LATER_ORDER_STATUSES.has(String(order?.situacao ?? "").trim()),
  );
  const profile = {
    recurringCustomer: Boolean(qualifyingOrder),
    pricingMode: qualifyingOrder ? "per_model" : "mixed",
    qualifyingOrderId: qualifyingOrder?.id ? String(qualifyingOrder.id) : null,
  };

  approvedOrderHistoryCache.set(cacheKey, {
    profile,
    expiresAt: Date.now() + ORDER_HISTORY_CACHE_TTL_MS,
  });

  if (approvedOrderHistoryCache.size > 500) {
    const oldestKey = approvedOrderHistoryCache.keys().next().value;
    approvedOrderHistoryCache.delete(oldestKey);
  }

  return profile;
}

export async function addOlistOrderMarker(shop, orderId, description) {
  await olistRequest(
    shop,
    `/pedidos/${encodeURIComponent(orderId)}/marcadores`,
    {
      method: "POST",
      body: JSON.stringify([{ descricao: description }]),
    },
  );
}
