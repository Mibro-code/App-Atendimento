import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, badRequest, forbidden } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { buildCustomerListWhere, CustomerFilterForbiddenError, parseCustomerListFilters } from "@/lib/customer-list";
import { transferCustomersBulk } from "@/lib/customer-transfer";

const filterSchema = z.object({
  q: z.string().optional(), sellerId: z.string().optional(), status: z.string().optional(),
  temperature: z.string().optional(), state: z.string().optional(), spRegion: z.string().optional(), city: z.string().optional(),
  leadOrigin: z.string().optional(), createdFrom: z.string().optional(), createdTo: z.string().optional(),
  businessType: z.string().optional(), industrySegment: z.string().optional(),
  worksWithSmartwatch: z.string().optional(), interest: z.string().optional(), interestedBrand: z.string().optional(),
}).partial();

const schema = z.object({
  mode: z.enum(["selected", "filtered"]),
  customerIds: z.array(z.string().min(1)).max(200).default([]),
  filters: filterSchema.default({}),
  targetSellerId: z.string().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados do repasse em massa inválidos.", parsed.error.flatten());

  let customerIds = [...new Set(parsed.data.customerIds)];
  if (parsed.data.mode === "selected" && customerIds.length === 0) {
    return badRequest("Selecione ao menos um cliente.");
  }
  if (parsed.data.mode === "filtered") {
    try {
      const filters = parseCustomerListFilters(parsed.data.filters);
      const where = await buildCustomerListWhere(user, filters);
      const matches = await prisma.customer.findMany({ where, select: { id: true }, take: 5001 });
      if (matches.length > 5000) return badRequest("O filtro possui mais de 5.000 clientes. Refine os filtros antes do repasse.");
      customerIds = matches.map((customer) => customer.id);
    } catch (filterError) {
      if (filterError instanceof CustomerFilterForbiddenError) return forbidden("Filtro fora do seu escopo.");
      throw filterError;
    }
  }

  const result = await transferCustomersBulk({
    actor: user,
    customerIds,
    targetSellerId: parsed.data.targetSellerId,
    reason: parsed.data.reason,
  });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json(result);
}
