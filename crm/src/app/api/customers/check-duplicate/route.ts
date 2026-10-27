import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { findPossibleDuplicates } from "@/lib/duplicates";
import { getCustomerScopeFilter } from "@/lib/authz";

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const duplicates = await findPossibleDuplicates({
    cnpjDigits: body.cnpjDigits,
    cpfDigits: body.cpfDigits,
    email: body.email,
    phoneDigits: body.phoneDigits,
    excludeCustomerId: body.excludeCustomerId,
    scope: await getCustomerScopeFilter(user),
  });

  return NextResponse.json({ possibleDuplicates: duplicates });
}
