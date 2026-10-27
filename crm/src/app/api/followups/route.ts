import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { getCustomerScopeFilter, canAccessCustomer } from "@/lib/authz";
import { syncAutomaticFollowUpsForScope } from "@/lib/automatic-followups";

const createSchema = z.object({
  customerId: z.string(),
  dueAt: z.string().datetime(),
  note: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  await syncAutomaticFollowUpsForScope(user);

  const scope = await getCustomerScopeFilter(user);
  const customerIds = await prisma.customer.findMany({ where: scope, select: { id: true } });

  const followUps = await prisma.followUp.findMany({
    where: { customerId: { in: customerIds.map((c) => c.id) } },
    include: { customer: { select: { id: true, contactName: true, tradeName: true } } },
    orderBy: { dueAt: "asc" },
  });

  return NextResponse.json({ followUps });
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const data = parsed.data;

  const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) return notFound("Cliente não encontrado.");
  if (!(await canAccessCustomer(user, customer.sellerId))) return forbidden();

  const followUp = await prisma.followUp.create({
    data: {
      customerId: data.customerId,
      sellerId: customer.sellerId,
      dueAt: new Date(data.dueAt),
      note: data.note || null,
      source: "MANUAL",
    },
  });

  return NextResponse.json({ followUp }, { status: 201 });
}
