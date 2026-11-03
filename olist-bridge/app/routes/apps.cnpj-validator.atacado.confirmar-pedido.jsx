import {
  AppProxyShopError,
  authenticateAppProxyShop,
} from "../services/app-proxy-auth.server";
import { OlistApiError } from "../services/olist-api.server";
import {
  confirmWholesaleOrderForReview,
  WholesaleOrderError,
} from "../services/wholesale-order.server";
import {
  appendWholesaleLeadToSheet,
  WholesaleLeadSheetError,
} from "../services/wholesale-leads-sheet.server";
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
    const result = await confirmWholesaleOrderForReview(shop, payload);

    let sheetSync = { configured: false, synced: false };
    try {
      sheetSync = await appendWholesaleLeadToSheet(
        shop,
        payload?.proposal || payload,
        result,
      );
    } catch (sheetError) {
      console.error("Pedido confirmado, mas a planilha de leads nao foi atualizada", {
        name: sheetError?.name,
        code: sheetError?.code,
        message: sheetError?.message,
        olistOrderId: result?.olist_order_id,
      });

      sheetSync = {
        configured: true,
        synced: false,
        code:
          sheetError instanceof WholesaleLeadSheetError
            ? sheetError.code
            : "LEAD_SHEET_ERROR",
      };
    }

    return json({
      ...result,
      sheet_sync: sheetSync,
    });
  } catch (error) {
    const knownError =
      error instanceof AppProxyShopError ||
      error instanceof WholesaleTestModeError ||
      error instanceof WholesaleOrderError ||
      error instanceof OlistApiError;

    console.error("Falha ao enviar pedido de atacado para análise", {
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
          : "Não foi possível enviar o pedido para análise.",
      },
      { status: knownError ? Number(error.status) || 500 : 500 },
    );
  }
}
