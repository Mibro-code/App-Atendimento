import process from "node:process";

import { OlistApiError } from "./olist-api.server";
import { WholesaleTestModeError } from "./wholesale-mode.server";
import { CrmBridgeError, deploymentBrand, isAuthorizedCrmRequest } from "./crm-order-bridge-rules";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

/**
 * Envelope comum das rotas /internal/crm/*: só POST, Bearer igual a
 * CRM_SHOPIFY_SHARED_SECRET (segredo desta marca) e erros padronizados.
 */
export async function handleCrmBridge(request, handler) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, code: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...HEADERS, Allow: "POST" },
    });
  }
  if (!isAuthorizedCrmRequest(request.headers.get("authorization"), process.env.CRM_SHOPIFY_SHARED_SECRET)) {
    return json({ success: false, code: "UNAUTHORIZED", message: "Não autorizado." }, 401);
  }
  const body = await request.json().catch(() => null);
  try {
    return json(await handler({ body, brand: deploymentBrand() }));
  } catch (error) {
    const known = error instanceof CrmBridgeError || error instanceof OlistApiError || error instanceof WholesaleTestModeError;
    console.error("CRM_BRIDGE_REQUEST_FAILED", { name: error?.name, code: error?.code, status: error?.status, message: error?.message });
    return json(
      {
        success: false,
        code: known ? error.code || error.name : "INTERNAL_ERROR",
        message: known ? error.message : "Falha interna na integração com o Olist.",
        ...(known && error.details ? { details: error.details } : {}),
      },
      known ? Number(error.status) || 500 : 500,
    );
  }
}
