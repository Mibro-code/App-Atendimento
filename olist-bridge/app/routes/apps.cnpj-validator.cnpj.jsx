import {
  isValidCnpj,
  lookupCnpj,
  onlyCnpjDigits,
} from "../services/cnpj.server";
import { authenticateAppProxyShop } from "../services/app-proxy-auth.server";
import { getOlistCustomerPricingProfile } from "../services/olist-api.server";
import {
  publicCnpjRateLimiter,
  requestClientIp,
} from "../services/public-cnpj-policy.server";

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
  const shop = await authenticateAppProxyShop(request);

  const cnpj = onlyCnpjDigits(new URL(request.url).searchParams.get("cnpj"));
  const rateLimit = publicCnpjRateLimiter.consume({
    shop,
    clientIp: requestClientIp(request),
    cnpj,
  });
  const rateLimitHeaders = {
    "X-RateLimit-Limit": String(rateLimit.limit),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
  };

  if (!rateLimit.allowed) {
    return json(
      {
        ok: false,
        code: "RATE_LIMITED",
        message: "Muitas consultas de CNPJ. Aguarde e tente novamente.",
      },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  if (!isValidCnpj(cnpj)) {
    return json(
      {
        ok: false,
        code: "INVALID_CNPJ",
        message: "Informe um CNPJ válido com 14 dígitos.",
      },
      { status: 422, headers: rateLimitHeaders },
    );
  }

  try {
    const company = await lookupCnpj(cnpj);
    let pricing = {
      mode: "mixed",
      recurring_customer: false,
      criterion: "olist_not_verified",
      verified: false,
    };

    try {
      const pricingProfile = await getOlistCustomerPricingProfile(shop, cnpj);
      pricing = {
        mode: pricingProfile.pricingMode,
        recurring_customer: pricingProfile.recurringCustomer,
        criterion: "approved_or_later_olist_order",
        verified: true,
      };
    } catch (olistError) {
      console.warn("Histórico Olist indisponível durante a consulta CNPJ", {
        shop,
        cnpj,
        code: olistError.code,
        status: olistError.status,
        message: olistError.message,
      });
    }

    return json(
      {
        ok: true,
        company,
        pricing,
      },
      { headers: rateLimitHeaders },
    );
  } catch (error) {
    if (error.code === "CNPJ_NOT_FOUND") {
      return json(
        {
          ok: false,
          code: error.code,
          message: "CNPJ não encontrado na base cadastral.",
        },
        { status: 404, headers: rateLimitHeaders },
      );
    }

    console.error("Falha ao consultar CNPJ", {
      cnpj,
      code: error.code,
      status: error.status,
      message: error.message,
    });

    return json(
      {
        ok: false,
        code: "LOOKUP_UNAVAILABLE",
        message: "Não foi possível verificar o CNPJ agora. Tente novamente.",
      },
      { status: 503, headers: rateLimitHeaders },
    );
  }
}
