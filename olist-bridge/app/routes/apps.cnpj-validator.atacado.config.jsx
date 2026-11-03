import {
  AppProxyShopError,
  authenticateAppProxyShop,
} from "../services/app-proxy-auth.server";
import { getWholesaleMode } from "../services/wholesale-mode.server";

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

export async function loader({ request }) {
  let shop;

  try {
    shop = await authenticateAppProxyShop(request);
  } catch (error) {
    if (!(error instanceof AppProxyShopError)) {
      throw error;
    }

    return json(
      {
        ok: false,
        code: error.code,
        message: error.message,
      },
      { status: error.status },
    );
  }

  const mode = await getWholesaleMode(shop);

  return json({
    ok: true,
    testMode: mode.testModeEnabled,
    cnpjDataLevel: mode.cnpjDataLevel,
    orderCreationEnabled: !mode.testModeEnabled,
    proposalSendingEnabled: true,
    olistTaxPreviewAvailable: false,
    updatedAt: mode.updatedAt,
  });
}
