import { NextRequest, NextResponse } from "next/server";
import { fieldErrorsFromZod, requireSession, validationFailed } from "@/lib/api-auth";
import { proposalErrorResponse } from "@/lib/proposals/proposal-api";
import { createSchema } from "@/lib/proposals/proposal-schemas";
import { createProposalFromSimulation } from "@/lib/proposals/proposal-service";

/** Cria a proposta comercial a partir de uma simulação concluída (idempotente por simulação). */
export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationFailed(fieldErrorsFromZod(parsed.error));
  try {
    const result = await createProposalFromSimulation(user, parsed.data.simulationId, parsed.data.conditions ?? {});
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (e) {
    return proposalErrorResponse(e);
  }
}
