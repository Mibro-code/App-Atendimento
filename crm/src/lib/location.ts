import { z } from "zod";
import type { Prisma } from "@prisma/client";
// Sem "server-only": este módulo só define schema/transformação pura (sem
// I/O, sem segredo) e precisa ser importável tanto pelas rotas de API
// quanto por shopify-quote-sync.ts (usado também pelos testes vitest).

// Fonte única de verdade para validar/gravar localização (visita, início de
// proposta, envio de proposta) — reaproveitado por
// api/customers/[id]/activities, api/customers/[id]/quote-session e
// api/integrations/shopify/quotes/upsert. Nunca duplicar esta lógica.

export const locationStatusValues = ["GRANTED", "DENIED", "UNAVAILABLE", "TIMEOUT", "NOT_SUPPORTED"] as const;

// Corpo aceito do frontend (CRM) ou do app Shopify — nunca inclui `source`
// (isso é decidido pelo backend a partir do endpoint chamado, nunca aceito
// do cliente) nem ids (sellerId/customerId/quoteId resolvidos pela sessão
// autenticada, nunca confiados isoladamente do payload).
export const locationInputSchema = z.object({
  status: z.enum(locationStatusValues),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracyMeters: z.number().positive().optional(),
  // Quando ausente, usamos o momento em que o backend processa a requisição
  // — cobre tanto o CRM (site já valida no clique) quanto o Shopify (pode
  // mandar o instante exato da captura no navegador do vendedor).
  capturedAt: z.string().datetime().optional(),
  userAgentSummary: z.string().max(120).optional(),
  deviceType: z.enum(["mobile", "tablet", "desktop"]).optional(),
});

export type LocationInput = z.infer<typeof locationInputSchema>;

interface BuildLocationCaptureDataInput {
  location: LocationInput;
  sellerId: string;
  customerId?: string | null;
  quoteId?: string | null;
  locationSource: "CUSTOMER_CREATED" | "PROPOSAL_STARTED" | "PROPOSAL_SENT" | "CUSTOMER_VISIT";
  activityId?: string | null;
}

/**
 * Monta o `data` do Prisma para LocationCapture a partir de um LocationInput
 * já validado. Só preenche coordenadas quando status === GRANTED (para os
 * demais estados o registro existe do mesmo jeito — é dado útil: "o
 * vendedor negou" é diferente de "nunca tentamos capturar").
 */
export function buildLocationCaptureData({
  location, sellerId, customerId, quoteId, locationSource, activityId,
}: BuildLocationCaptureDataInput): Prisma.LocationCaptureUncheckedCreateInput {
  const granted = location.status === "GRANTED";
  return {
    sellerId,
    customerId: customerId ?? null,
    quoteId: quoteId ?? null,
    activityId: activityId ?? null,
    locationSource,
    locationStatus: location.status,
    latitude: granted ? location.latitude ?? null : null,
    longitude: granted ? location.longitude ?? null : null,
    accuracyMeters: granted ? location.accuracyMeters ?? null : null,
    capturedAt: granted ? (location.capturedAt ? new Date(location.capturedAt) : new Date()) : null,
    userAgentSummary: location.userAgentSummary ?? null,
    deviceType: location.deviceType ?? null,
  };
}

// Acima de 1000m de precisão o ponto já não representa bem "onde a proposta
// foi feita" — usado só para exibição (nunca descarta o dado, só sinaliza).
export const LOW_ACCURACY_THRESHOLD_METERS = 1000;

export function isLowAccuracy(accuracyMeters: number | null | undefined): boolean {
  return typeof accuracyMeters === "number" && accuracyMeters > LOW_ACCURACY_THRESHOLD_METERS;
}
