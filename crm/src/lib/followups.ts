import { FOLLOWUP_DEFAULT_DAYS } from "@/lib/config";

/** Data de corte: clientes sem interação desde antes disso estão "atrasados". */
export function getFollowupCutoffDate(days: number = FOLLOWUP_DEFAULT_DAYS): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
