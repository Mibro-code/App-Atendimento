import {
  AppProxyShopError,
  authenticateAppProxyShop,
} from "../services/app-proxy-auth.server";
import {
  CrmIntegrationError,
  resolveCrmSession,
} from "../services/crm-integration.server";

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

// Rota chamada pela calculadora de atacado (tema) para trocar o
// crm_session (token opaco de uso único emitido pelo CRM interno) pelos
// dados de cliente/vendedor a serem pré-preenchidos no formulário. O CRM
// nunca recebe credenciais Olist e o app Shopify nunca recebe dados
// pessoais fora deste request pontual.
export async function loader({ request }) {
  try {
    await authenticateAppProxyShop(request);

    const token = new URL(request.url).searchParams.get("token");
    const { customer, seller, mode, resumeQuote, proposalContext } =
      await resolveCrmSession(token);

    return json({
      ok: true,
      customer,
      seller,
      mode,
      resumeQuote,
      proposalContext,
    });
  } catch (error) {
    const knownError =
      error instanceof AppProxyShopError || error instanceof CrmIntegrationError;

    console.error("Falha ao resolver sessão de cotação do CRM", {
      name: error?.name,
      code: error?.code,
      status: error?.status,
      message: error?.message,
    });

    return json(
      {
        ok: false,
        code: knownError ? error.code || error.name : "INTERNAL_ERROR",
        message: knownError
          ? error.message
          : "Não foi possível carregar os dados do CRM.",
      },
      { status: knownError ? Number(error.status) || 500 : 500 },
    );
  }
}
