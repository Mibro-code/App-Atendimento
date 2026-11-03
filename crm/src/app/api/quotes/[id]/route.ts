import { NextRequest, NextResponse } from "next/server";
import { requireSession, badRequest } from "@/lib/api-auth";
import { changeSimulationDeletion, QuoteTrashError } from "@/lib/quote-trash";
import { Prisma } from "@prisma/client";

async function run(req: NextRequest, params: Promise<{ id: string }>, action: "DELETE" | "RESTORE") {
  const { user, error } = await requireSession();
  if (error) return error;
  if (action === "RESTORE") {
    const body = await req.json().catch(() => null);
    if (body?.action !== "RESTORE") return badRequest("Ação inválida.");
  }
  try {
    const { id } = await params;
    return NextResponse.json(await changeSimulationDeletion(user.id, id, action));
  } catch (error) {
    if (error instanceof QuoteTrashError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "A proposta foi alterada simultaneamente. Tente novamente." }, { status: 409 });
    }
    throw error;
  }
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return run(req, params, "DELETE"); }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return run(req, params, "RESTORE"); }
