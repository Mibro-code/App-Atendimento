import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { getCustomerScopeFilter } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const scope = await getCustomerScopeFilter(user);
  const customerIds = await prisma.customer.findMany({ where: scope, select: { id: true } });

  const sales = await prisma.sale.findMany({
    where: { customerId: { in: customerIds.map((c) => c.id) } },
    include: { customer: { select: { id: true, contactName: true, tradeName: true } }, seller: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ sales });
}
