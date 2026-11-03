// RCA: identificador comercial curto e único de cada usuário do app
// (ex.: "027"). Não é role, não é tipo de representante e nunca é derivado do
// id técnico do banco.

export const RCA_MIN_LENGTH = 3;
const RCA_PATTERN = /^\d{1,6}$/;

/** Aceita "27", "027", "RCA 027", "rca-027". Retorna o RCA normalizado ou null. */
export function normalizeRca(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = input.trim().replace(/^rca[\s\-:#]*/i, "").trim();
  if (!RCA_PATTERN.test(cleaned) || Number(cleaned) === 0) return null;
  return cleaned.padStart(RCA_MIN_LENGTH, "0");
}

/** Próximo RCA sequencial a partir dos já existentes (ignora valores não numéricos). */
export function nextRca(existing: Array<string | null | undefined>): string {
  const max = existing.reduce((highest, value) => {
    const numeric = value && /^\d+$/.test(value) ? Number(value) : 0;
    return numeric > highest ? numeric : highest;
  }, 0);
  return String(max + 1).padStart(RCA_MIN_LENGTH, "0");
}

export function formatRca(rca: string | null | undefined): string {
  return rca ? `RCA ${rca}` : "";
}

/** A busca digitada parece um RCA? (ex.: "027", "rca 27") */
export function rcaFromQuery(query: string | null | undefined): string | null {
  if (!query || !/^\s*(rca[\s\-:#]*)?\d{1,6}\s*$/i.test(query)) return null;
  return normalizeRca(query);
}
