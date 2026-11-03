import { NextRequest, NextResponse } from "next/server";
import { fieldErrorsFromZod, requireSession, validationFailed } from "@/lib/api-auth";
import { proposalErrorResponse } from "@/lib/proposals/proposal-api";
import { editSchema } from "@/lib/proposals/proposal-schemas";
import { updateProposal } from "@/lib/proposals/proposal-service";

/** Edita a proposta: cria nova versão; preços recalculados no servidor. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  const parsed = editSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationFailed(fieldErrorsFromZod(parsed.error));
  try {
    return NextResponse.json(await updateProposal(user, (await params).id, parsed.data));
  } catch (e) {
    return proposalErrorResponse(e);
  }
}
