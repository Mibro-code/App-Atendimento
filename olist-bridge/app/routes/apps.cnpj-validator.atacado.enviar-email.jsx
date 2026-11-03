import {
  AppProxyShopError,
  authenticateAppProxyShop,
} from "../services/app-proxy-auth.server";
import {
  sendWholesaleProposalEmail,
  WholesaleEmailError,
  WholesaleOrderError,
} from "../services/wholesale-email.server";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...init.headers },
  });
}

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
    return json(await sendWholesaleProposalEmail(shop, payload));
  } catch (error) {
    const knownError =
      error instanceof AppProxyShopError ||
      error instanceof WholesaleEmailError ||
      error instanceof WholesaleOrderError;

    console.error("Falha ao enviar formulário de atacado por e-mail", {
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
          : "Não foi possível enviar o formulário por e-mail.",
      },
      { status: knownError ? Number(error.status) || 500 : 500 },
    );
  }
}