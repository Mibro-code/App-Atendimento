const DEFAULT_TIMEOUT_MS = 10_000;

export class AtendimentoLeadError extends Error {
  constructor(message, { code = "ATENDIMENTO_LEAD_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "AtendimentoLeadError";
    this.code = code;
  }
}

function configuration() {
  const url = String(process.env.ATENDIMENTO_API_URL || "").trim();
  const secret = String(process.env.ATENDIMENTO_API_SECRET || "").trim();
  if (!url && !secret) return null;
  if (!url || !secret) {
    throw new AtendimentoLeadError("A integração com o atendimento está parcialmente configurada.", {
      code: "ATENDIMENTO_CONFIGURATION_INCOMPLETE",
    });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new AtendimentoLeadError("A URL do atendimento é inválida.", {
      code: "ATENDIMENTO_URL_INVALID",
    });
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "atendimento.mibrobrasil.com.br" ||
    parsed.pathname !== "/integrations/leads/atacado"
  ) {
    throw new AtendimentoLeadError("A URL do atendimento não é permitida.", {
      code: "ATENDIMENTO_URL_INVALID",
    });
  }
  return { url: parsed.toString(), secret };
}

export async function sendLeadToAtendimento(payload) {
  const config = configuration();
  if (!config) return { configured: false, synced: false };
  let response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secret}`,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify({
        lead_id: payload.quote_token,
        name: payload.buyer_name,
        email: payload.buyer_email,
        phone: payload.buyer_phone,
        cnpj: payload.cnpj,
        campaign: payload.campaign,
        page_url: payload.page_url,
        utm_source: payload.utm_source,
        utm_medium: payload.utm_medium,
        utm_campaign: payload.utm_campaign,
        utm_content: payload.utm_content,
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AtendimentoLeadError("Não foi possível acessar o app de atendimento.", {
      code: "ATENDIMENTO_REQUEST_FAILED",
      cause: error,
    });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new AtendimentoLeadError("O app de atendimento não confirmou o lead.", {
      code: "ATENDIMENTO_WRITE_REJECTED",
    });
  }
  return {
    configured: true,
    synced: true,
    duplicate: body.duplicate === true,
    conversationId: String(body.conversationId || ""),
  };
}
