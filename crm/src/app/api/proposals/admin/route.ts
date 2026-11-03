import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fieldErrorsFromZod, forbidden, requireSession, validationFailed } from "@/lib/api-auth";
import { proposalErrorResponse } from "@/lib/proposals/proposal-api";
import { deactivateSellerLink, listOlistSellers, setCommercialFunctions, setDiscountLimit, setSellerLink } from "@/lib/proposals/proposal-admin";

const brand = z.enum(["MIBRO", "SINCROFIT"]);
const userId = z.string().regex(/^[a-z0-9]{20,40}$/i);

const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("link"), userId, brand, olistSellerId: z.string().trim().regex(/^\d{1,20}$/) }),
  z.object({ op: z.literal("unlink"), userId, brand }),
  z.object({ op: z.literal("limit"), scopeKey: z.string().trim().max(80), brandKey: z.enum(["*", "MIBRO", "SINCROFIT"]), maxDiscountBps: z.number().int().min(0).max(10_000).nullable() }),
  z.object({ op: z.literal("functions"), userId, functions: z.array(z.enum(["GERENTE_COMERCIAL", "FINANCEIRO"])).max(2) }),
]);

/** Vendedores do Olist da marca (para o vínculo). Somente ADMIN. */
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN") return forbidden();
  const parsed = brand.safeParse(req.nextUrl.searchParams.get("brand"));
  if (!parsed.success) return validationFailed({ brand: "Empresa inválida." });
  try {
    return NextResponse.json({ sellers: await listOlistSellers(user, parsed.data) });
  } catch (e) {
    return proposalErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN") return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationFailed(fieldErrorsFromZod(parsed.error));
  const input = parsed.data;
  try {
    if (input.op === "link") return NextResponse.json({ link: await setSellerLink(user, input) });
    if (input.op === "unlink") await deactivateSellerLink(user, input);
    if (input.op === "limit") await setDiscountLimit(user, input);
    if (input.op === "functions") await setCommercialFunctions(user, input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return proposalErrorResponse(e);
  }
}
