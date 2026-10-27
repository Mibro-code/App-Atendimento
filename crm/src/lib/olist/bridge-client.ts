import "server-only";
import type { CommercialBrand } from "@prisma/client";

// Cliente da ponte CRM -> Olist (rotas /internal/crm/* do app Shopify da
// marca). Cada marca tem a própria instalação, a própria conta Olist e o
// próprio segredo — nunca se cruzam. O segredo é o mesmo par já usado pelo
// app Shopify para falar com o CRM (CRM_SHOPIFY_<MARCA>_SHARED_SECRET).

export class OlistBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "OlistBridgeError";
  }
}

const TIMEOUT_MS = 60_000; // criação de pedido no Olist pode levar alguns segundos

function bridgeConfig(brand: CommercialBrand) {
  const url = (brand === "SINCROFIT" ? process.env.SINCROFIT_SHOPIFY_INTERNAL_URL : process.env.MIBRO_SHOPIFY_INTERNAL_URL)?.trim();
  const secret = (
    brand === "SINCROFIT"
      ? process.env.CRM_SHOPIFY_SINCROFIT_SHARED_SECRET
      : process.env.CRM_SHOPIFY_MIBRO_SHARED_SECRET || process.env.CRM_SHOPIFY_SHARED_SECRET
  )?.trim();
  if (!url || !secret) {
    throw new OlistBridgeError(
      `Integração Olist da ${brand === "SINCROFIT" ? "Sincrofit" : "Mibro"} não configurada no CRM.`,
      "BRIDGE_NOT_CONFIGURED",
      503
    );
  }
  return { url: url.replace(/\/+$/, ""), secret };
}

export type BridgePath = "/internal/crm/pricing-profile" | "/internal/crm/orders/calculate" | "/internal/crm/orders/confirm" | "/internal/crm/proposals/email";

export async function callOlistBridge<T = Record<string, unknown>>(brand: CommercialBrand, path: BridgePath, body: unknown): Promise<T> {
  const { url, secret } = bridgeConfig(brand);
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    throw new OlistBridgeError(
      timeout ? "O Olist demorou para responder. Tente novamente; o pedido não será duplicado." : "Não foi possível falar com a integração Olist.",
      timeout ? "BRIDGE_TIMEOUT" : "BRIDGE_UNREACHABLE",
      504
    );
  }
  const data = (await response.json().catch(() => null)) as (T & { success?: boolean; code?: string; message?: string; details?: unknown }) | null;
  if (!response.ok || !data || data.success === false) {
    throw new OlistBridgeError(
      data?.message || `Integração Olist respondeu ${response.status}.`,
      data?.code || `BRIDGE_HTTP_${response.status}`,
      response.status,
      data?.details
    );
  }
  return data;
}
