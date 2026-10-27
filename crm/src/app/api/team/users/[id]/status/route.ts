import { NextRequest, NextResponse } from "next/server";
import { badRequest, forbidden, requireSession } from "@/lib/api-auth";
import { deactivateTeamUserWithTransfer, TeamDeactivationError } from "@/lib/team-deactivation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "SUPERVISOR") return forbidden("Apenas supervisores podem desativar integrantes da própria equipe.");

  const body = await req.json().catch(() => null);
  if (!body || body.active !== false) return badRequest("O supervisor pode somente desativar a conta.");

  if (typeof body.transferToId !== "string" || !body.transferToId.trim()) return badRequest("Escolha quem receberá os clientes antes de desativar a conta.");
  try {
    const result = await deactivateTeamUserWithTransfer(user.id, id, body.transferToId.trim());
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof TeamDeactivationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") return NextResponse.json({ error: "A carteira mudou durante a operação. Tente novamente." }, { status: 409 });
    throw error;
  }
}
