import {
  AppProxyShopError,
  authenticateAppProxyShop,
} from "../services/app-proxy-auth.server";
import {
  CrmIntegrationError,
  syncCrmQuote,
} from "../services/crm-integration.server";
import {
  validateWholesalePayload,
  WholesaleOrderError,
} from "../services/wholesale-order.server";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const CRM_EVENTS = new Set(["CALCULATED", "SENT", "READY_FOR_REVIEW"]);

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...init.headers },
  });
}

// Registra no CRM um cálculo feito inteiramente no navegador. Esta rota não
// importa nem chama qualquer serviço Olist; o contexto assinado define o
// modo e os IDs confiáveis da proposta.
export async function action({ request }) {
  if (request.method !== "POST") {
    return json(
      { success: false, code: "METHOD_NOT_ALLOWED", message: "Método não permitido." },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  try {
    const shop = await authenticateAppProxyShop(request);
    const payload = await request.json();
    const proposal = payload?.proposal || payload;
    const event = CRM_EVENTS.has(payload?.event) ? payload.event : "CALCULATED";
    validateWholesalePayload(proposal, { allowMissingCnpj: true });
    const crmSync = await syncCrmQuote({
      event,
      shop,
      proposal,
      result: null,
    });
    return json({ success: true, crm_sync: crmSync });
  } catch (error) {
    const knownError =
      error instanceof AppProxyShopError ||
      error instanceof CrmIntegrationError ||
      error instanceof WholesaleOrderError;
    console.error("Falha ao registrar cálculo da proposta no CRM", {
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
          : "Não foi possível registrar o cálculo no CRM.",
        ...(knownError && error.details ? { details: error.details } : {}),
      },
      { status: knownError ? Number(error.status) || 500 : 500 },
    );
  }
}
