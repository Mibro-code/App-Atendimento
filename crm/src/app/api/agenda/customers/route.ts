import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { buildCustomerListWhere, parseCustomerListFilters } from "@/lib/customer-list";
import { formatCnpjOrCpf, formatPhone } from "@/lib/format";

/**
 * Autocomplete de cliente no formulário da Agenda. Reaproveita a busca e o
 * escopo de RBAC da listagem de clientes (nome, empresa, CPF, CNPJ, telefone)
 * e devolve só o mínimo para exibir a opção.
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < 2) return NextResponse.json({ customers: [] });

  const where = await buildCustomerListWhere(user, parseCustomerListFilters({ q }));
  const rows = await prisma.customer.findMany({
    where,
    select: {
      id: true, contactName: true, tradeName: true, legalName: true,
      cnpjDigits: true, cpfDigits: true, phoneDigits: true, city: true, state: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  return NextResponse.json({
    customers: rows.map((row) => ({
      id: row.id,
      name: row.tradeName || row.contactName,
      detail: [
        row.tradeName && row.contactName !== row.tradeName ? row.contactName : null,
        row.legalName,
        formatCnpjOrCpf(row.cnpjDigits || row.cpfDigits) || null,
        row.phoneDigits ? formatPhone(row.phoneDigits) : null,
        [row.city, row.state].filter(Boolean).join("/") || null,
      ].filter(Boolean).join(" · "),
    })),
  });
}
