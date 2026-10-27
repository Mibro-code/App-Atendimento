import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/api-auth";
import { canAccessCustomer } from "@/lib/authz";
import { isContactChannel, PipelineError, registerContactAttempt } from "@/lib/pipeline";
import { loadPipelineCardById } from "@/lib/pipeline-board";
import { syncAutomaticFollowUpsForCustomerIds } from "@/lib/automatic-followups";

const schema = z.object({
  channel: z.string().refine(isContactChannel, "Canal inválido."),
  note: z.string().max(1000).optional().nullable(),
});

// "Registrar contato": cada chamada é uma tentativa de contato comercial do
// ciclo atual (★☆☆ → ★★☆ → ★★★). Histórico em CustomerActivity.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;
  const customer = await prisma.customer.findUnique({ where: { id }, select: { sellerId: true } });
  if (!customer) return notFound("Cliente não encontrado.");
  if (!(await canAccessCustomer(user, customer.sellerId))) return forbidden();
  const attempts = await prisma.customerActivity.findMany({
    where: { customerId: id, isContactAttempt: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, type: true, description: true, createdAt: true, commercialCycle: true, pipelineStage: true,
      seller: { select: { name: true, rca: true } },
    },
  });
  return NextResponse.json({ attempts });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;
  const customer = await prisma.customer.findUnique({ where: { id }, select: { sellerId: true } });
  if (!customer) return notFound("Cliente não encontrado.");
  if (!(await canAccessCustomer(user, customer.sellerId))) return forbidden();

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());

  try {
    const result = await registerContactAttempt(user.id, id, { channel: parsed.data.channel as never, note: parsed.data.note });
    await syncAutomaticFollowUpsForCustomerIds([id]);
    return NextResponse.json({ attempts: result.attempts, stage: result.stage, card: await loadPipelineCardById(id) }, { status: 201 });
  } catch (attemptError) {
    if (attemptError instanceof PipelineError) return NextResponse.json({ error: attemptError.message }, { status: attemptError.status });
    throw attemptError;
  }
}
