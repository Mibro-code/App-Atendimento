import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { canAccessCustomer } from "@/lib/authz";
import { getSellerCatalog } from "@/lib/pricing/pricing";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";
import { PricingError } from "@/lib/pricing/pricing-rules";

const querySchema = z.object({
  brand: z.enum(["MIBRO", "SINCROFIT"]),
  customerId: z.string().min(1).optional(),
  quoteId: z.string().min(1).optional(),
});

/**
 * Catálogo ativo da marca com os preços do grupo comercial correto:
 * - com customerId: grupo do vendedor responsável pelo cliente;
 * - sem customerId: grupo do próprio usuário;
 * - com quoteId: preços da versão fixada na proposta (retomada).
 * O grupo nunca é escolhido pelo navegador.
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return badRequest("Parâmetros inválidos.");
  const { brand, customerId, quoteId } = parsed.data;

  try {
    let sellerId = user.id;
    if (customerId) {
      const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { sellerId: true } });
      if (!customer || !(await canAccessCustomer(user, customer.sellerId))) {
        throw new PricingError("Você não tem acesso a este cliente.", "FORBIDDEN");
      }
      sellerId = customer.sellerId;
    }

    let pinnedPriceTableId: string | null = null;
    if (quoteId) {
      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
        select: { customer: { select: { sellerId: true } }, items: { select: { priceTableId: true }, take: 1 } },
      });
      if (quote && (await canAccessCustomer(user, quote.customer.sellerId))) {
        pinnedPriceTableId = quote.items[0]?.priceTableId ?? null;
      }
    }

    return NextResponse.json(await getSellerCatalog(user, sellerId, brand, { pinnedPriceTableId }));
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
