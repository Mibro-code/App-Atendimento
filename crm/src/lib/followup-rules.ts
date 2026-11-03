import { FOLLOWUP_DEFAULT_DAYS } from "./config";

export interface FollowUpReferenceDates {
  customerId: string;
  createdAt: Date;
  lastInteractionAt: Date | null;
  lastSaleAt: Date | null;
}

export function normalizeFollowUpDays(days: number | null | undefined): number {
  return Number.isInteger(days) && days! >= 1 && days! <= 365 ? days! : FOLLOWUP_DEFAULT_DAYS;
}

export function getAutomaticFollowUpSchedule(
  customer: FollowUpReferenceDates,
  configuredDays: number | null | undefined,
  now: Date = new Date()
) {
  const days = normalizeFollowUpDays(configuredDays);
  const relevantAt = [customer.createdAt, customer.lastInteractionAt, customer.lastSaleAt]
    .filter((value): value is Date => value instanceof Date)
    .reduce((latest, value) => (value > latest ? value : latest), customer.createdAt);
  const dueAt = new Date(relevantAt);
  dueAt.setDate(dueAt.getDate() + days);

  return {
    days,
    relevantAt,
    dueAt,
    isDue: dueAt <= now,
    dedupeKey: `auto-inactivity:${customer.customerId}:${relevantAt.getTime()}:${days}`,
  };
}

/** Materializa o aviso assim que já houve contato/venda, ainda que futuro. */
export function shouldMaterializeAutomaticFollowUp(
  customer: Pick<FollowUpReferenceDates, "lastInteractionAt" | "lastSaleAt">,
  isDue: boolean
): boolean {
  return isDue || !!customer.lastInteractionAt || !!customer.lastSaleAt;
}
