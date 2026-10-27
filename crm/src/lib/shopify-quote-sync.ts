import { z } from "zod";
import type { QuoteStatus } from "@prisma/client";
import { locationInputSchema } from "./location";

// "mode" é opcional e por padrão REAL, por compatibilidade com o contrato já
// usado em produção (scripts/production-quote-sync-smoke.mjs) antes da
// introdução de SIMULATION/REAL. Quando o app Shopify for atualizado (ver
// docs/SHOPIFY-PROPOSAL-INTEGRATION.md), ele deve sempre enviar o mode
// resolvido a partir do crm_session, nunca um valor decidido só no frontend.
export const shopifyQuoteSyncSchema = z.object({
  event: z.enum(["CALCULATED", "SENT", "READY_FOR_REVIEW"]),
  mode: z.enum(["SIMULATION", "REAL"]).default("REAL"),
  shop: z.string().trim().min(1).max(255).optional(),
  customerId: z.string().trim().min(1).max(100),
  sellerId: z.string().trim().min(1).max(100),
  quoteToken: z.string().trim().min(16).max(100),
  // Preenchido quando esta cotação REAL nasce de "transformar em cotação
  // real" a partir de uma SIMULATION existente no CRM (id da Quote
  // original, não o quoteToken do Shopify).
  sourceQuoteId: z.string().trim().min(1).max(100).optional(),
  valueCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative().optional(),
  couponCode: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
  totalQuantity: z.number().int().nonnegative().default(0),
  products: z
    .array(
      z.object({
        sku: z.string().trim().max(120).default(""),
        name: z.string().trim().min(1).max(300),
        variant: z.string().trim().max(200).optional(),
        quantity: z.number().int().positive(),
        unitPriceCents: z.number().int().nonnegative(),
        subtotalCents: z.number().int().nonnegative(),
      })
    )
    .max(200),
  // Preenchido no evento "SENT" (proposta enviada por e-mail ao cliente).
  sentToEmail: z.string().trim().email().max(255).optional(),
  // Ignorado quando mode = SIMULATION: uma simulação nunca deve gerar pedido
  // Olist. O CRM não cria pedidos no Olist em nenhum caso — isto é só o
  // espelho do que o app Shopify já criou lá.
  olistOrder: z
    .object({
      id: z.string().trim().min(1).max(100),
      number: z.string().trim().max(100).optional(),
      statusRaw: z.string().trim().max(200).optional(),
    })
    .optional(),
  // Localização da proposta (item 10) — opcional, enviada preferencialmente
  // no evento "SENT" (locationSource = PROPOSAL_SENT). Nunca carrega
  // sellerId/customerId: a Quote/LocationCapture são sempre associadas ao
  // customerId/sellerId já validados nesta mesma requisição (ver
  // quotes/upsert/route.ts), nunca a um vendedor arbitrário.
  location: locationInputSchema.optional(),
});

export type ShopifyQuoteSyncInput = z.infer<typeof shopifyQuoteSyncSchema>;

export function quoteStatusForSync(
  current: QuoteStatus | null,
  event: ShopifyQuoteSyncInput["event"]
): QuoteStatus {
  // Status "finais" não retrocedem por um recálculo/reenvio tardio.
  if (current === "CONVERTIDA" || current === "CANCELADA") {
    return current;
  }
  if (current === "ENVIADA_PARA_ANALISE" && event !== "READY_FOR_REVIEW") {
    return current;
  }
  // Um recálculo pode chegar logo depois do envio do e-mail. Nesse caso,
  // preserve o marco mais avançado em vez de voltar a proposta para
  // "CALCULADA" (o sentAt já comprova que ela foi enviada).
  if (current === "ENVIADA" && event === "CALCULATED") {
    return current;
  }
  if (event === "READY_FOR_REVIEW") return "ENVIADA_PARA_ANALISE";
  if (event === "SENT") return "ENVIADA";
  return "CALCULADA";
}
