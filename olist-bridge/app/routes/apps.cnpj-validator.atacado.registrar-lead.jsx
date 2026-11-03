import {
  AppProxyShopError,
  authenticateAppProxyShop,
} from "../services/app-proxy-auth.server";
import {
  appendWholesaleLeadToSheet,
  WholesaleLeadSheetError,
} from "../services/wholesale-leads-sheet.server";

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

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

const COMPANY_FIELDS = [
  "razao_social",
  "nome_fantasia",
  "situacao_cadastral",
  "inscricao_estadual",
  "situacao_ie",
  "contribuinte_icms",
  "endereco",
  "uf",
  "cidade",
  "cep",
  "telefone",
  "email",
];

function normalizeLead(rawPayload) {
  const companyData = Object.fromEntries(
    COMPANY_FIELDS.map((key) => [key, clean(rawPayload?.company_data?.[key], 500)])
      .filter(([, value]) => value),
  );
  const lead = {
    quote_token: clean(rawPayload?.quote_token, 100),
    source: "lp_atacado_publica",
    buyer_name: clean(rawPayload?.buyer_name, 160),
    buyer_email: clean(rawPayload?.buyer_email, 254).toLowerCase(),
    buyer_phone: clean(rawPayload?.buyer_phone, 40),
    cnpj: clean(rawPayload?.cnpj, 24),
    campaign: clean(rawPayload?.campaign, 120),
    template: clean(rawPayload?.template, 80),
    page_path: clean(rawPayload?.page_path, 500),
    page_url: clean(rawPayload?.page_url, 2_000),
    utm_source: clean(rawPayload?.utm_source, 200),
    utm_medium: clean(rawPayload?.utm_medium, 200),
    utm_campaign: clean(rawPayload?.utm_campaign, 200),
    utm_content: clean(rawPayload?.utm_content, 200),
    referrer: clean(rawPayload?.referrer, 2_000),
    company_data: companyData,
    ...Object.fromEntries(
      Object.entries(companyData).map(([key, value]) => [`cnpj_${key}`, value]),
    ),
  };

  if (
    !lead.quote_token ||
    !lead.buyer_name ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.buyer_email) ||
    lead.buyer_phone.replace(/\D/g, "").length < 10 ||
    lead.cnpj.replace(/\D/g, "").length !== 14
  ) {
    throw new WholesaleLeadSheetError("Cadastro inválido.", {
      code: "LEAD_VALIDATION_FAILED",
    });
  }

  return lead;
}

export async function action({ request }) {
  if (request.method !== "POST") {
    return json(
      { success: false, code: "METHOD_NOT_ALLOWED" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  try {
    const shop = await authenticateAppProxyShop(request);
    const lead = normalizeLead(await request.json());
    const syncResult = async (operation, errorType, fallbackCode) => {
      try {
        return await operation();
      } catch (syncError) {
        console.error("Destino do lead não confirmou o registro", {
          name: syncError?.name,
          code: syncError?.code,
          message: syncError?.message,
        });
        return {
          configured: true,
          synced: false,
          code: syncError instanceof errorType ? syncError.code : fallbackCode,
        };
      }
    };
    const sheetSync = await syncResult(
      () => appendWholesaleLeadToSheet(shop, lead, { status: "cadastro_lp_atacado" }),
      WholesaleLeadSheetError,
      "LEAD_SHEET_ERROR",
    );

    return json({
      success: sheetSync.synced === true,
      sheet_sync: sheetSync,
    });
  } catch (error) {
    const knownError =
      error instanceof AppProxyShopError ||
      error instanceof WholesaleLeadSheetError;

    console.error("Falha ao registrar lead público de atacado na planilha", {
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });

    return json(
      {
        success: false,
        code: knownError ? error.code || error.name : "INTERNAL_ERROR",
        message: knownError
          ? error.message
          : "Não foi possível registrar o cadastro na planilha.",
      },
      { status: error instanceof AppProxyShopError ? 401 : 500 },
    );
  }
}
