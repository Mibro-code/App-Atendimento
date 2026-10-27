import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/api-auth";
import { canAccessCustomer } from "@/lib/authz";
import { PIPELINE_STAGES, resolveReturnDate } from "@/lib/pipeline-rules";
import { moveCustomerStage, PipelineError, scheduleStageReturn } from "@/lib/pipeline";
import { loadPipelineCardById } from "@/lib/pipeline-board";
import { syncAutomaticFollowUpsForCustomerIds } from "@/lib/automatic-followups";

const stage = z.enum(PIPELINE_STAGES as [string, ...string[]]).transform((value) => value as (typeof PIPELINE_STAGES)[number]);
const returnWhen = {
  // "1" | "3" | "7" | "15" | "30" | "custom" (+ customDate AAAA-MM-DD, calendário de Brasília)
  returnOption: z.string().max(10).optional().nullable(),
  customDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
};

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("MOVE"),
    to: stage,
    reason: z.string().max(500).optional().nullable(),
    ...returnWhen,
    returnTo: z.enum(["NOVO", "FOLLOW_UP", "EM_ATENDIMENTO"]).optional().nullable(),
    followUpOption: z.string().max(10).optional().nullable(),
    followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    followUpNote: z.string().max(500).optional().nullable(),
    sale: z.object({
      saleId: z.string().optional().nullable(),
      valueCents: z.number().int().positive().optional().nullable(),
      orderReference: z.string().max(100).optional().nullable(),
    }).optional().nullable(),
  }),
  z.object({ action: z.literal("SCHEDULE_RETURN"), ...returnWhen, returnTo: z.enum(["NOVO", "FOLLOW_UP", "EM_ATENDIMENTO"]).optional().nullable() }),
  z.object({ action: z.literal("CANCEL_RETURN") }),
]);

/**
 * Mudança explícita de etapa do funil (Kanban, card ou perfil do cliente).
 * Persiste imediatamente, grava histórico e devolve o card atualizado para
 * a tela aplicar sem recarregar o funil inteiro.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const customer = await prisma.customer.findUnique({ where: { id }, select: { sellerId: true, pipelineStage: true } });
  if (!customer) return notFound("Cliente não encontrado.");
  if (!(await canAccessCustomer(user, customer.sellerId))) return forbidden();

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const data = parsed.data;

  try {
    if (data.action === "CANCEL_RETURN") {
      await scheduleStageReturn(user.id, id, null, null);
    } else if (data.action === "SCHEDULE_RETURN") {
      const returnAt = resolveReturnDate(data.returnOption ?? "", data.customDate);
      if (!returnAt) return badRequest("Escolha quando o cliente deve voltar (data futura).");
      await scheduleStageReturn(user.id, id, returnAt, data.returnTo ?? "NOVO");
    } else if (data.to === "VENDIDO") {
      return forbidden("Somente a aprovação do pedido na Olist pode marcar o cliente como vendido.");
    } else {
      const returnAt = data.returnOption ? resolveReturnDate(data.returnOption, data.customDate) : null;
      if (data.returnOption && !returnAt) return badRequest("A data de retorno deve ser futura.");
      const followUpAt = data.followUpOption ? resolveReturnDate(data.followUpOption, data.followUpDate) : null;
      if (data.followUpOption && !followUpAt) return badRequest("A data do follow-up deve ser futura.");
      await moveCustomerStage(user.id, id, data.to, {
        reason: data.reason,
        returnAt,
        returnTo: data.returnTo,
        followUpAt,
        followUpNote: data.followUpNote,
      });
      await syncAutomaticFollowUpsForCustomerIds([id]);
    }
  } catch (moveError) {
    if (moveError instanceof PipelineError) {
      return NextResponse.json({ error: moveError.message }, { status: moveError.status });
    }
    throw moveError;
  }

  return NextResponse.json({ card: await loadPipelineCardById(id) });
}
