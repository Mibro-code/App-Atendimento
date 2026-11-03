import {
  AppProxyShopError,
  authenticateAppProxyShop,
} from "../services/app-proxy-auth.server";
import { OlistApiError } from "../services/olist-api.server";
import {
  calculateWholesaleOrder,
  WholesaleOrderError,
} from "../services/wholesale-order.server";
import {
  assertWholesaleOrderCreationAllowed,
  WholesaleTestModeError,
} from "../services/wholesale-mode.server";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...init.headers,
    },
  });
}

export async function action({ request }) {
  if (request.method !== "POST") {
    return json(
      {
        success: false,
        code: "METHOD_NOT_ALLOWED",
        message: "Método não permitido.",
      },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  try {
    const shop = await authenticateAppProxyShop(request);
    await assertWholesaleOrderCreationAllowed(shop);
    const payload = await request.json();
    const result = await calculateWholesaleOrder(shop, payload);

    return json(result);
  } catch (error) {
    const knownError =
      error instanceof AppProxyShopError ||
      error instanceof WholesaleTestModeError ||
      error instanceof WholesaleOrderError ||
      error instanceof OlistApiError;

    console.error("Falha ao calcular pedido de atacado no Olist", {
      name: error?.name,
      code: error?.code,
      status: error?.status,
      message: error?.message,
    });

    return json(
      {
        success: false,
        code: knownError ? error.code || error.name : "INTERNAL_ERROR",
        message: knownError
          ? error.message
          : "Não foi possível calcular o pedido no Olist.",
        ...(knownError && error.details ? { details: error.details } : {}),
      },
      { status: knownError ? Number(error.status) || 500 : 500 },
    );
  }
}
