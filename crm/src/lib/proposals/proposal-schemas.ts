import { z } from "zod";

// Validação de entrada das rotas de propostas. Valores monetários sempre em
// centavos inteiros; preços NUNCA são aceitos do navegador (só SKU e quantidade).

const text = (max: number) => z.string().trim().max(max).nullable().optional();

export const conditionsSchema = z.object({
  validityDays: z.number().int().min(1).max(365).nullable().optional(),
  paymentType: z.enum(["Nenhuma", "Parcelas", "Texto livre"]).nullable().optional(),
  paymentCondition: z.string().trim().max(60).regex(/^[0-9x+ ,]*$/i, "Use o formato 30 60 90, 3x ou 30+2x.").nullable().optional(),
  paymentText: text(500),
  freightCents: z.number().int().min(0).max(100_000_000).optional(),
  freightResponsibility: z.enum(["R", "D", "T", "3", "4", "S"]).nullable().optional(),
  deliveryTerm: text(200),
  customerNotes: text(2000),
  internalNotes: text(2000),
});

export const createSchema = z.object({
  simulationId: z.string().regex(/^[a-z0-9]{20,40}$/i),
  conditions: conditionsSchema.optional(),
});

export const editSchema = conditionsSchema.extend({
  expectedVersion: z.number().int().min(1),
  items: z
    .array(z.object({ sku: z.string().trim().min(1).max(120), quantity: z.number().int().min(1).max(100_000) }))
    .min(1, "Inclua ao menos um produto.")
    .max(100),
  requestedTier: z.enum(["AUTO", "TIER1", "TIER2", "TIER3"]),
  discountCents: z.number().int().min(0).max(100_000_000),
  discountJustification: text(1000),
  reason: text(500),
});

const reason = z.string().trim().max(1000);

export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("resolve_conflict") }),
  z.object({ action: z.literal("refresh") }),
  z.object({ action: z.literal("submit"), justification: reason.nullable().optional() }),
  z.object({ action: z.literal("approve"), reason: reason.nullable().optional() }),
  z.object({ action: z.literal("reject"), reason }),
  z.object({ action: z.literal("request_changes"), reason }),
  z.object({ action: z.literal("send_email"), to: z.string().trim().max(200).nullable().optional() }),
  z.object({ action: z.literal("register_dispatch"), description: z.string().trim().max(500), recipient: z.string().trim().max(200).nullable().optional() }),
  z.object({
    action: z.literal("register_response"),
    decision: z.enum(["ACEITA", "RECUSADA", "ALTERACAO_SOLICITADA"]),
    channel: z.enum(["EMAIL", "WHATSAPP", "TELEFONE", "PRESENCIAL", "OUTRO"]),
    evidence: z.string().trim().max(2000),
    contactName: z.string().trim().max(200).nullable().optional(),
    occurredAt: z.string().datetime({ offset: true }),
  }),
  z.object({ action: z.literal("reopen"), reason }),
  z.object({ action: z.literal("request_conversion") }),
  z.object({ action: z.literal("deny_conversion"), reason }),
  z.object({ action: z.literal("convert") }),
  z.object({ action: z.literal("reconcile_order"), orderNumber: z.string().trim().max(30), justification: reason }),
  z.object({ action: z.literal("refresh_order") }),
  z.object({ action: z.literal("approve_order") }),
  z.object({ action: z.literal("transfer"), sellerId: z.string().regex(/^[a-z0-9]{20,40}$/i), reason }),
  z.object({ action: z.literal("cancel"), reason }),
  z.object({ action: z.literal("duplicate") }),
  z.object({ action: z.literal("finance_review"), note: z.string().trim().max(2000) }),
]);

export type ProposalActionInput = z.infer<typeof actionSchema>;
