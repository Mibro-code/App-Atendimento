function normalizeStatus(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function statusText(value) {
  if (value && typeof value === "object") {
    return (
      value.descricao ||
      value.descricaoSituacao ||
      value.nome ||
      value.value ||
      value.codigo ||
      ""
    );
  }
  return value;
}

export function extractOlistOrderStatus(...orders) {
  for (const order of orders) {
    if (!order) continue;
    for (const candidate of [
      order.situacao,
      order.descricaoSituacao,
      order.status,
      order.statusPedido,
    ]) {
      const normalized = normalizeStatus(statusText(candidate));
      if (normalized) return normalized;
    }
  }
  return "";
}

export function isApprovedOlistOrderStatus(value) {
  const normalized = normalizeStatus(statusText(value));
  return ["aprovado", "aprovada", "approved", "pedido aprovado"].includes(
    normalized,
  );
}
