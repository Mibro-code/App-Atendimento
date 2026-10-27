// Constantes de configuração de regras de negócio da Fase 1.
//
// Este arquivo é importado por componentes client (via lib/time-clock.ts) —
// nunca usar API exclusiva de Node aqui (fs, path, process.cwd()). Caminho de
// armazenamento em disco (que precisa disso) fica em
// lib/attendance-storage.ts, marcado "server-only".

// Número de dias sem venda/interação para um cliente entrar como "atrasado"
// nas telas de follow-up automático (ver lib/followups.ts).
export const FOLLOWUP_DEFAULT_DAYS = 30;

// Nome do cookie de sessão fica a cargo do NextAuth (httpOnly + secure em
// produção). Não há uso de localStorage/sessionStorage para autenticação em
// nenhum ponto da aplicação.

// ---------------------------------------------------------------------------
// Fase 2 — Integração CRM → Shopify (lado CRM)
// ---------------------------------------------------------------------------

// TTL do token de sessão de cotação (CrmSessionToken / JWT enviado para o app
// Shopify via querystring). Configurável via QUOTE_SESSION_TTL_MINUTES,
// padrão 10 minutos.
const parsedTtl = Number(process.env.QUOTE_SESSION_TTL_MINUTES);
export const QUOTE_SESSION_TTL_MINUTES =
  Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 10;

// URL da calculadora/atacado no app Shopify para onde o CRM redireciona o
// usuário após gerar o token (com "?crm_session=<token>" anexado). Deve ser
// configurada por ambiente — sem valor padrão de produção aqui de propósito.
export const SHOPIFY_WHOLESALE_URL = process.env.SHOPIFY_WHOLESALE_URL || "";

export type SupportedCommercialBrand = "MIBRO" | "SINCROFIT";

/** URL da calculadora correspondente à empresa escolhida na proposta. */
export function getShopifyWholesaleUrl(brand: SupportedCommercialBrand): string {
  if (brand === "SINCROFIT") {
    return process.env.SINCROFIT_SHOPIFY_WHOLESALE_URL || "";
  }
  return process.env.MIBRO_SHOPIFY_WHOLESALE_URL || SHOPIFY_WHOLESALE_URL;
}

// ---------------------------------------------------------------------------
// Ponto — jornada, saída antecipada e documentos de ocorrência
// ---------------------------------------------------------------------------

// Horário local (America/Sao_Paulo, "HH:mm") em que o expediente normalmente
// termina. Usado só para decidir se um CLOCK_OUT é "antecipado" e por isso
// exige justificativa — é um valor único global por enquanto (não por
// usuário/loja); o horário previsto de cada batida antecipada já fica salvo
// em TimeClockEarlyDeparture.expectedAt, então uma futura granularidade por
// pessoa não exige migração de dados.
export const EXPECTED_CLOCK_OUT_TIME = process.env.EXPECTED_CLOCK_OUT_TIME || "18:00";

// Limite de tamanho e tipos aceitos para anexos de ocorrência (atestados).
export const MAX_ATTENDANCE_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_ATTENDANCE_DOCUMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;
export const ALLOWED_ATTENDANCE_DOCUMENT_EXTENSIONS = ["jpg", "jpeg", "png", "pdf"] as const;
