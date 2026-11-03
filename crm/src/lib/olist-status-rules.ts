const APPROVED_STATUS_KEYS = new Set([
  "aprovado",
  "aprovada",
  "approved",
  "pedido aprovado",
  "venda aprovada",
]);

function normalizeStatus(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isApprovedOlistStatus(statusRaw: string): boolean {
  return APPROVED_STATUS_KEYS.has(normalizeStatus(statusRaw));
}
