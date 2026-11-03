import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, badRequest } from "@/lib/api-auth";
import { proposalErrorResponse } from "@/lib/proposals/proposal-api";
import { consultProposal, preflightProposal } from "@/lib/proposals/proposal-operations";

const schema = z.object({ kind: z.enum(["stock", "financial", "documents", "preflight"]) });
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success) return badRequest("Consulta inválida.");
  try {
    const id = (await params).id;
    const result = input.data.kind === "preflight" ? await preflightProposal(user, id) : await consultProposal(user, id, input.data.kind);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) { return proposalErrorResponse(error); }
}
