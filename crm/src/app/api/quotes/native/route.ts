import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, validationFailed, fieldErrorsFromZod } from "@/lib/api-auth";
import { saveNativeQuote } from "@/lib/quotes/native-quote";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";

const tier = z.enum(["AUTO", "TIER1", "TIER2", "TIER3"]);

// Somente SKU + quantidade + faixa desejada: preço nunca é aceito do navegador.
const schema = z.object({
  quoteId: z.string().min(1).nullable().optional(),
  customerId: z.string().min(1, "Escolha o cliente."),
  brand: z.enum(["MIBRO", "SINCROFIT"], { message: "Escolha a marca." }),
  draft: z.object({
    step: z.number().int().min(0).max(10),
    quantities: z
      .record(z.string().max(80), z.number().int("Use números inteiros.").min(0).max(100_000))
      .refine((q) => Object.keys(q).length <= 200, "Itens demais."),
    requestedTier: tier,
    search: z.string().max(100).optional(),
  }),
  discountCents: z.number().int("Desconto inválido.").min(0, "O desconto não pode ser negativo.").max(1_000_000_000),
  couponCode: z.string().trim().max(40, "Cupom muito longo.").nullable().optional(),
  notes: z.string().max(2000, "Observação muito longa.").nullable().optional(),
  finalize: z.boolean().optional(),
  useCurrentTable: z.boolean().optional(),
});

/** Cria ou atualiza (autosave) a cotação nativa; o servidor reprecifica tudo. */
export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationFailed(fieldErrorsFromZod(parsed.error));
  try {
    return NextResponse.json(await saveNativeQuote(user, parsed.data));
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
