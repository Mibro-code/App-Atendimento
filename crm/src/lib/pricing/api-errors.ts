import "server-only";
import { NextResponse } from "next/server";
import { PricingError } from "@/lib/pricing/pricing-rules";

const STATUS_BY_CODE: Record<string, number> = {
  FORBIDDEN: 403,
  SELLER_FORBIDDEN: 403,
  NOT_FOUND: 404,
  SELLER_NOT_FOUND: 404,
  DRAFT_CONFLICT: 409,
  EFFECTIVE_CONFLICT: 409,
  CONFLICT: 409,
  NOT_DRAFT: 409,
  NOT_ARCHIVABLE: 409,
  NOT_EDITABLE: 409,
  OLIST_SYNC_IN_PROGRESS: 409,
  ALREADY_SENT: 409,
  ALREADY_REAL: 409,
  ORDER_ID_CHANGED: 409,
  BRIDGE_NOT_CONFIGURED: 503,
  BRIDGE_TIMEOUT: 504,
  BRIDGE_UNREACHABLE: 502,
  OLIST_VERIFICATION_FAILED: 502,
};

/** Converte PricingError/PriceAdminError em resposta JSON padronizada (com fieldErrors quando houver). */
export function pricingErrorResponse(error: unknown): NextResponse {
  if (error instanceof PricingError) {
    const fieldErrors = (error.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors;
    return NextResponse.json(
      { error: error.message, code: error.code, ...(fieldErrors ? { fieldErrors } : { details: error.details }) },
      { status: STATUS_BY_CODE[error.code] ?? 422 }
    );
  }
  throw error;
}
