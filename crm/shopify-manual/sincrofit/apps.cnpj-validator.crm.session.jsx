import { authenticateAppProxyShop } from "../services/app-proxy-auth.server";

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

// GET /apps/cnpj-validator/crm/session?token=...
export async function loader({ request }) {
  await authenticateAppProxyShop(request);

  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) {
    return json({ ok: false, code: "MISSING_TOKEN", message: "Token ausente." }, { status: 400 });
  }

  const crmApiUrl = process.env.CRM_API_URL?.replace(/\/$/, "");
  const sharedSecret = process.env.CRM_SHOPIFY_SHARED_SECRET;
  if (!crmApiUrl || !sharedSecret) {
    console.error("Integração CRM não configurada: CRM_API_URL/CRM_SHOPIFY_SHARED_SECRET ausentes.");
    return json({ ok: false, code: "CRM_NOT_CONFIGURED", message: "Integração CRM não configurada." }, { status: 503 });
  }

  try {
    const response = await fetch(`${crmApiUrl}/api/integrations/shopify/session/resolve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sharedSecret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ token }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.success !== true) {
      return json(
        {
          ok: false,
          code: body.code || "CRM_SESSION_ERROR",
          message: body.message || "Não foi possível validar a sessão do CRM.",
        },
        { status: response.status || 502 },
      );
    }

    return json({
      ok: true,
      mode: body.mode,
      brand: body.brand,
      customer: body.customer,
      seller: body.seller,
      resumeQuote: body.resumeQuote || null,
    });
  } catch (error) {
    console.error("Falha ao resolver sessão CRM", error);
    return json({ ok: false, code: "CRM_UNAVAILABLE", message: "CRM indisponível no momento." }, { status: 502 });
  }
}
