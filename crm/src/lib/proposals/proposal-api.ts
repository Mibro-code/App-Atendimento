import "server-only";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { PricingError } from "@/lib/pricing/pricing-rules";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";
import { ProposalError } from "@/lib/proposals/proposal-rules";

/** Resposta padronizada; nunca expõe detalhes internos de erros inesperados. */
export function proposalErrorResponse(error: unknown): NextResponse {
  if (error instanceof ProposalError) {
    const fieldErrors = (error.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors;
    return NextResponse.json(
      { error: error.message, code: error.code, ...(fieldErrors ? { fieldErrors } : error.details ? { details: error.details } : {}) },
      { status: error.status }
    );
  }
  if (error instanceof PricingError) return pricingErrorResponse(error);
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002")) {
    return NextResponse.json({ error: "A proposta foi alterada simultaneamente. Recarregue a página.", code: "CONFLICT" }, { status: 409 });
  }
  console.error("PROPOSAL_API_FAILED", { name: (error as Error)?.name, message: (error as Error)?.message });
  return NextResponse.json({ error: "Falha inesperada. Tente novamente.", code: "INTERNAL_ERROR" }, { status: 500 });
}
