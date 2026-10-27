/**
 * @deprecated Classificação antiga do funil, calculada na tela. Tratava
 * qualquer status diferente de NOVO (inclusive INATIVO) como "Em atendimento"
 * — origem do bug "inativo continua ativo". A etapa agora é persistida em
 * Customer.pipelineStage (ver lib/pipeline.ts e lib/pipeline-rules.ts).
 * Mantido apenas como referência; não usar em telas novas.
 */
export type PipelineStage = "NEW" | "IN_PROGRESS" | "SOLD";

export function hasCompleteCustomerProfile(input: {
  contactName: string;
  legalName?: string | null;
  tradeName?: string | null;
  email?: string | null;
  phoneDigits?: string | null;
  state?: string | null;
  businessType?: string | null;
  industrySegment?: string | null;
  interests?: readonly string[];
  interestedBrand?: string | null;
}): boolean {
  return Boolean(
    input.contactName.trim()
    && (input.legalName?.trim() || input.tradeName?.trim())
    && (input.email?.trim() || input.phoneDigits?.trim())
    && input.state?.trim()
    && input.businessType
    && input.industrySegment?.trim()
    && input.interests?.length
    && input.interestedBrand
  );
}

export function classifyCustomerPipeline(input: {
  status: string;
  activities: number;
  quotes: number;
  profileComplete?: boolean;
  lastConfirmedSaleAt: Date | null;
  followUpAfterDays: number;
  now?: Date;
}): { stage: PipelineStage; returningForRepurchase: boolean; returnAt: Date | null } {
  const now = input.now ?? new Date();
  if (input.lastConfirmedSaleAt) {
    const returnAt = new Date(input.lastConfirmedSaleAt.getTime() + Math.max(1, input.followUpAfterDays || 30) * 86_400_000);
    return now >= returnAt
      ? { stage: "IN_PROGRESS", returningForRepurchase: true, returnAt }
      : { stage: "SOLD", returningForRepurchase: false, returnAt };
  }
  const worked = input.status !== "NOVO" || input.activities > 0 || input.quotes > 0 || input.profileComplete === true;
  return { stage: worked ? "IN_PROGRESS" : "NEW", returningForRepurchase: false, returnAt: null };
}
