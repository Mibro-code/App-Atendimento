// Ativação e opções do módulo de propostas comerciais Olist. Tudo desligado
// por padrão: sem CRM_PROPOSALS_OLIST_ENABLED o CRM se comporta exatamente
// como antes (telas ocultas, APIs respondem 404).

const truthy = (v: string | undefined) => ["1", "true", "on", "yes"].includes((v ?? "").trim().toLowerCase());

export function proposalsEnabled(): boolean {
  return truthy(process.env.CRM_PROPOSALS_OLIST_ENABLED);
}

/** "api" chama POST /orcamentos/{id}/venda; "manual" exige gerar no Olist e vincular. */
export function proposalConversionMode(): "api" | "manual" {
  return (process.env.OLIST_PROPOSAL_CONVERSION_MODE ?? "").trim().toLowerCase() === "manual" ? "manual" : "api";
}

/** Atualização da situação no Olist (semântica a homologar). Desligada por padrão. */
export function proposalSituationSyncEnabled(): boolean {
  return truthy(process.env.OLIST_PROPOSAL_SITUATION_SYNC);
}

/**
 * Fluxo antigo "Gerar pedido real" a partir da simulação durante a migração:
 * all (padrão, comportamento atual), admin (somente ADMIN) ou off.
 * Pedidos reais já existentes nunca são afetados.
 */
export function legacyDirectOrderPolicy(): "all" | "admin" | "off" {
  const v = (process.env.CRM_LEGACY_DIRECT_ORDER ?? "").trim().toLowerCase();
  return v === "admin" || v === "off" ? v : "all";
}

export function legacyDirectOrderAllowed(role: string): boolean {
  const policy = legacyDirectOrderPolicy();
  return policy === "all" || (policy === "admin" && role === "ADMIN");
}

export const DEFAULT_VALIDITY_DAYS = 7;
