import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, requireSession } from "@/lib/api-auth";
import { buildCustomerListWhere, CustomerFilterForbiddenError, parseCustomerListFilters } from "@/lib/customer-list";
import { isPipelineStage } from "@/lib/pipeline-rules";
import { loadPipelineCards, PIPELINE_PAGE_SIZE } from "@/lib/pipeline-board";

// Próxima página de uma coluna do funil ("Carregar mais"), com os mesmos
// filtros e o mesmo escopo RBAC da tela.
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const params = req.nextUrl.searchParams;
  const stage = params.get("column");
  if (!isPipelineStage(stage)) return badRequest("Etapa inválida.");
  const skip = Math.max(0, Number(params.get("skip")) || 0);

  let where;
  try {
    where = await buildCustomerListWhere(user, parseCustomerListFilters(Object.fromEntries(params.entries())));
  } catch (filterError) {
    if (filterError instanceof CustomerFilterForbiddenError) return forbidden(filterError.message);
    throw filterError;
  }
  const [cards, count] = await Promise.all([
    loadPipelineCards(where, stage, skip, PIPELINE_PAGE_SIZE),
    params.get("withCount") === "1" ? prisma.customer.count({ where: { AND: [where, { pipelineStage: stage }] } }) : Promise.resolve(null),
  ]);
  return NextResponse.json({ cards, count, hasMore: cards.length === PIPELINE_PAGE_SIZE });
}
