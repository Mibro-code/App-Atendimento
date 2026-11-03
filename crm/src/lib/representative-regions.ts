import { BRAZIL_STATES } from "./brazil-states";

export interface RegionInput {
  state: string;
  city?: string | null;
}

export interface NormalizedRegion {
  state: string;
  /** "" = o estado inteiro. */
  city: string;
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Valida UF, limpa espaços e remove duplicados (cidade sem diferenciar acento/caixa). */
export function normalizeRegions(input: RegionInput[]): { regions: NormalizedRegion[]; invalid: string[] } {
  const seen = new Set<string>();
  const regions: NormalizedRegion[] = [];
  const invalid: string[] = [];
  for (const item of input) {
    const state = item.state?.trim().toUpperCase() ?? "";
    if (!(BRAZIL_STATES as readonly string[]).includes(state)) {
      invalid.push(item.state || "(vazio)");
      continue;
    }
    const city = (item.city ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
    const key = `${state}|${fold(city)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    regions.push({ state, city });
  }
  regions.sort((a, b) => a.state.localeCompare(b.state) || a.city.localeCompare(b.city, "pt-BR"));
  return { regions, invalid };
}

/**
 * Quão bem um representante atende o local do cliente: 2 = atende a cidade,
 * 1 = atende o estado inteiro, 0 = não atende. Usado para ordenar sugestões,
 * nunca para atribuir automaticamente.
 */
export function regionMatchScore(regions: NormalizedRegion[], state?: string | null, city?: string | null): number {
  const uf = state?.trim().toUpperCase();
  if (!uf) return 0;
  const target = city ? fold(city.trim()) : "";
  let score = 0;
  for (const region of regions) {
    if (region.state !== uf) continue;
    if (region.city === "") score = Math.max(score, 1);
    else if (target && fold(region.city) === target) return 2;
  }
  return score;
}

export function formatRegions(regions: NormalizedRegion[]): string {
  const byState = new Map<string, string[]>();
  for (const region of regions) {
    const list = byState.get(region.state) ?? [];
    list.push(region.city || "todo o estado");
    byState.set(region.state, list);
  }
  return [...byState].map(([state, cities]) => `${state}: ${cities.join(", ")}`).join(" · ");
}
