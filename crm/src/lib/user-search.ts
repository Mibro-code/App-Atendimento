// Busca local de responsável (nome, e-mail, RCA, papel, tipo e região).
// Pura: usada pelo seletor com busca e pelos testes.

export interface UserOption {
  id: string;
  name: string;
  rca?: string | null;
  role?: string | null;
  email?: string | null;
  representativeType?: string | null;
  regions?: Array<{ state: string; city: string }>;
  regionScore?: number;
}

export const ROLE_LABELS: Record<string, string> = { ADMIN: "Admin", SUPERVISOR: "Supervisor", VENDEDOR: "Vendedor", REPRESENTANTE: "Representante" };
export const TYPE_LABELS: Record<string, string> = { ATACADO: "Atacado", VAREJO: "Varejo", OUTRO: "Outro" };
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function userOptionMatches(option: UserOption, query: string): boolean {
  const q = fold(query.trim()).replace(/^rca[\s\-:#]*/, "");
  if (!q) return true;
  if (option.rca && (option.rca === q.padStart(3, "0") || option.rca.includes(q))) return true;
  const haystack = [
    option.name, option.email ?? "", option.role ? ROLE_LABELS[option.role] ?? option.role : "",
    option.representativeType ? TYPE_LABELS[option.representativeType] ?? "" : "",
    ...(option.regions ?? []).flatMap((region) => [region.state, region.city]),
  ].map(fold).join(" ");
  return haystack.includes(q);
}

