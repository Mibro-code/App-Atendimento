// Helpers de normalização (salvos no banco) e formatação (apenas exibição).
// Regra: CNPJ/CPF/telefone são armazenados só com dígitos; dinheiro sempre em
// centavos (Int); formatação "bonita" acontece somente na camada de exibição.

export function onlyDigits(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

/**
 * Dígitos para busca em CPF/CNPJ/telefone — SOMENTE quando o termo é
 * numérico (com pontuação de documento/telefone opcional) e tem 3+ dígitos.
 * Antes, qualquer texto tinha os dígitos extraídos ("Loja 2" -> "2") e
 * casava com telefones/documentos de clientes que nada tinham a ver.
 */
export function searchDigits(query: string | null | undefined): string {
  const value = query?.trim() ?? "";
  if (!/^[\d\s.\-/()+]+$/.test(value)) return "";
  const digits = onlyDigits(value);
  return digits.length >= 3 ? digits : "";
}

export function normalizeEmail(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase();
}

export function formatCnpj(digits: string | null | undefined): string {
  const d = onlyDigits(digits);
  if (d.length !== 14) return digits ?? "";
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

export function formatCpf(digits: string | null | undefined): string {
  const d = onlyDigits(digits);
  if (d.length !== 11) return digits ?? "";
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function formatCnpjOrCpf(digits: string | null | undefined): string {
  const d = onlyDigits(digits);
  if (d.length === 14) return formatCnpj(d);
  if (d.length === 11) return formatCpf(d);
  return digits ?? "";
}

export function formatPhone(digits: string | null | undefined): string {
  const d = onlyDigits(digits);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return digits ?? "";
}

export function formatCentsToBRL(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return currencyFormatter.format(value);
}

// Fonte única de verdade para exibir datas ao usuário: o banco/JS sempre
// trabalha em UTC (Date/timestamptz), nunca alterado; só a APRESENTAÇÃO usa
// o fuso do Brasil. Antes, `toLocaleDateString("pt-BR")`/`toLocaleString("pt-BR")`
// sem `timeZone` explícito formatavam usando o fuso do PROCESSO Node — em
// produção/Docker isso é UTC (containers não têm TZ configurada por
// padrão), então toda hora exibida ficava 3h adiantada em relação a
// América/São_Paulo (e, perto da virada do dia, podia até mostrar a data
// errada). Nunca usar `new Date(...).toLocaleString()`/`toLocaleDateString()`
// direto em nenhuma tela — sempre por aqui.
export const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

// Opções fixas: reutiliza os formatadores em listas, SSR e re-renderizações.
const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRAZIL_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRAZIL_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRAZIL_TIME_ZONE, hour: "2-digit", minute: "2-digit",
});

function toValidDate(date: Date | string | null | undefined): Date | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateBR(date: Date | string | null | undefined): string {
  const d = toValidDate(date);
  if (!d) return "-";
  return dateFormatter.format(d);
}

export function formatDateTimeBR(date: Date | string | null | undefined): string {
  const d = toValidDate(date);
  if (!d) return "-";
  // Intl insere vírgula entre data e hora por padrão ("30/08/2026, 23:30:00")
  // — removida para manter o mesmo formato visual (com espaço) que as telas
  // já usavam antes desta correção, mudando só o fuso, não o layout.
  return dateTimeFormatter.format(d).replace(",", "");
}

export function formatTimeBR(date: Date | string | null | undefined): string {
  const d = toValidDate(date);
  if (!d) return "-";
  return timeFormatter.format(d);
}

// Aliases mantidos para não exigir troca de import em todas as telas —
// `formatDate`/`formatDateTime` já eram os nomes usados no projeto inteiro.
export const formatDate = formatDateBR;
export const formatDateTime = formatDateTimeBR;
export const formatTime = formatTimeBR;
