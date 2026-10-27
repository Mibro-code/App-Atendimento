import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { canAccessCustomer } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { stageAfterStatusChange } from "@/lib/pipeline-rules";
import { moveCustomerStage } from "@/lib/pipeline";
import { syncAutomaticFollowUpsForCustomerIds } from "@/lib/automatic-followups";
import { STATUS_LABELS } from "@/lib/labels";

const schema = z.object({
  status: z
    .enum([
      "NOVO",
      "CONTATO_REALIZADO",
      "EM_NEGOCIACAO",
      "COTACAO_ENVIADA",
      "AGUARDANDO_RETORNO",
      "AGUARDANDO_PAGAMENTO",
      "CLIENTE_ATIVO",
      "SEM_INTERESSE",
      "VENDA_PERDIDA",
      "INATIVO",
    ])
    .optional(),
  temperature: z.enum(["QUENTE", "MORNO", "FRIO", "SEM_CLASSIFICACAO"]).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return notFound("Cliente não encontrado.");
  if (!(await canAccessCustomer(user, customer.sellerId))) return forbidden();

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const { status, temperature } = parsed.data;

  if (!status && !temperature) {
    return badRequest("Informe status e/ou temperature.");
  }

  const updates: Record<string, unknown> = {};
  const historyEntries: Array<{ field: "STATUS" | "TEMPERATURE"; oldValue: string | null; newValue: string }> = [];

  if (status && status !== customer.status) {
    updates.status = status;
    historyEntries.push({ field: "STATUS", oldValue: customer.status, newValue: status });
  }
  if (temperature && temperature !== customer.temperature) {
    updates.temperature = temperature;
    historyEntries.push({ field: "TEMPERATURE", oldValue: customer.temperature, newValue: temperature });
  }

  if (historyEntries.length === 0) {
    return NextResponse.json({ customer, message: "Nenhuma alteração." });
  }

  // INATIVO precisa ser real também no funil: status inativo/sem interesse
  // move para Inativos (e tira das filas ativas); reativar pelo status tira
  // de Inativos. A etapa é gravada antes do status para gerar o histórico.
  const nextStage = status && status !== customer.status ? stageAfterStatusChange(status, customer.pipelineStage) : null;
  if (nextStage) {
    await moveCustomerStage(user.id, id, nextStage, {
      reason: nextStage === "INATIVO" || nextStage === "RECICLAGEM" ? `Status alterado para ${STATUS_LABELS[status!]}` : "Reativado pelo status comercial",
      skipStatusSync: true,
    });
  }

  const [updated] = await prisma.$transaction([
    prisma.customer.update({ where: { id }, data: updates }),
    ...historyEntries.map((h) =>
      prisma.customerStatusHistory.create({
        data: {
          customerId: id,
          field: h.field,
          oldValue: h.oldValue,
          newValue: h.newValue,
          changedById: user.id,
        },
      })
    ),
  ]);

  for (const h of historyEntries) {
    await logAudit({
      actorId: user.id,
      action: h.field === "STATUS" ? "CUSTOMER_STATUS_CHANGED" : "CUSTOMER_TEMPERATURE_CHANGED",
      entityType: "Customer",
      entityId: id,
      metadata: { oldValue: h.oldValue, newValue: h.newValue },
    });
  }

  if (nextStage) await syncAutomaticFollowUpsForCustomerIds([id]);
  return NextResponse.json({ customer: updated });
}
