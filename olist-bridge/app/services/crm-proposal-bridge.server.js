// Ponte CRM -> Olist para PROPOSTAS COMERCIAIS nativas (orçamentos V3).
// Usada SOMENTE pelas rotas /internal/crm/proposals/*, /internal/crm/orders/inspect
// e /internal/crm/sellers/list (servidor a servidor, segredo da marca).
// Reaproveita a conexão Olist e as funções já exportadas de olist-api.server;
// não altera nenhum arquivo existente nem o fluxo da página de atacado.

import process from "node:process";

import {
  OlistApiError,
  createOlistContact,
  findOlistContactByTaxId,
  findOlistProductBySku,
  getOlistOrder,
  olistRequest,
} from "./olist-api.server";
import { retryOlistOrderRead } from "./olist-order-read-retry.server";
import { CrmBridgeError, formatTaxId, isCompleteAddress, taxIdPersonType } from "./crm-order-bridge-rules";
import {
  ALLOWED_MARKERS,
  PROPOSAL_SITUATIONS,
  assertBrand,
  buildOrcamentoBody,
  hasReference,
  normalizeOrcamento,
  normalizeOrder,
  normalizeSellers,
  requireOlistId,
  validateProposalPayload,
} from "./crm-proposal-bridge-rules";

function fail(message, code, status = 422, details) {
  throw new CrmBridgeError(message, { code, status, details });
}

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

function positiveIntegerEnv(name) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function findOrCreateContact(shop, p, brand) {
  try {
    return await findOlistContactByTaxId(shop, p.customer.taxId);
  } catch (error) {
    if (!(error instanceof OlistApiError) || error.status !== 404) throw error;
  }
  const a = p.customer.address;
  if (!isCompleteAddress(a)) {
    fail("Endereço do cliente incompleto (rua, número, bairro, cidade, UF e CEP). Complete o cadastro no CRM.", "INCOMPLETE_ADDRESS");
  }
  const personType = taxIdPersonType(p.customer.taxId);
  return createOlistContact(shop, {
    nome: p.customer.companyName,
    fantasia: p.customer.tradeName || p.customer.companyName,
    tipoPessoa: personType,
    cpfCnpj: formatTaxId(p.customer.taxId),
    inscricaoEstadual: "",
    telefone: p.customer.phone,
    email: p.customer.email,
    emailNfe: p.customer.email,
    endereco: { endereco: a.street, numero: a.number, complemento: a.complement || "", bairro: a.district, municipio: a.city, cep: a.zip, uf: a.state, pais: "Brasil" },
    situacao: "B",
    observacoes: `Contato criado pelo CRM (${brand.label} — proposta comercial).`,
  });
}

async function resolveProductIds(shop, items) {
  const ids = new Map();
  for (const item of items) {
    const product = await findOlistProductBySku(shop, item.sku);
    if (product.status && !["A", "ATIVO"].includes(String(product.status).toUpperCase())) {
      fail(`O produto ${item.sku} não está ativo no Olist.`, "OLIST_PRODUCT_INACTIVE");
    }
    ids.set(item.sku, product.id);
  }
  return ids;
}

async function readOrcamento(shop, id) {
  try {
    return normalizeOrcamento(await olistRequest(shop, `/orcamentos/${encodeURIComponent(id)}`, { method: "GET" }));
  } catch (error) {
    if (error instanceof OlistApiError && error.status === 404) fail("Proposta não encontrada no Olist.", "OLIST_PROPOSAL_NOT_FOUND", 404);
    throw error;
  }
}

/** Cria (POST) ou substitui (PUT) a proposta e devolve o que o Olist gravou. */
export async function upsertCrmProposal(shop, raw, brand) {
  const p = validateProposalPayload(raw, brand);
  if (p.olistProposalId) {
    const current = await readOrcamento(shop, p.olistProposalId);
    if (current.situation === "Concluído") fail("A proposta já foi concluída no Olist e não pode ser alterada.", "OLIST_PROPOSAL_CONCLUDED", 409);
  }
  const contact = await findOrCreateContact(shop, p, brand);
  const productIds = await resolveProductIds(shop, p.items);
  const body = buildOrcamentoBody(p, {
    contactId: contact.id,
    productIds,
    natureId: positiveIntegerEnv("OLIST_PROPOSAL_OPERATION_NATURE_ID") ?? positiveIntegerEnv("OLIST_DEFAULT_OPERATION_NATURE_ID"),
    today: today(),
  });

  let id = p.olistProposalId;
  let number = null;
  const created = !id;
  if (id) {
    await olistRequest(shop, `/orcamentos/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
  } else {
    const response = await olistRequest(shop, "/orcamentos", { method: "POST", body: JSON.stringify(body) });
    if (!response?.id) fail("O Olist não devolveu o ID da nova proposta.", "OLIST_PROPOSAL_ID_MISSING", 502);
    id = String(response.id);
    number = response.numeroProposta ? String(response.numeroProposta) : null;
    // Marcador informativo; falha não invalida a proposta criada.
    await olistRequest(shop, `/orcamentos/${encodeURIComponent(id)}/marcadores`, { method: "POST", body: JSON.stringify([{ descricao: "CRM" }]) }).catch(() => undefined);
  }
  let snapshot;
  try { snapshot = await readOrcamento(shop, id); }
  catch (error) {
    // Mesmo um 404 no readback pode ocorrer depois de o POST ter criado o
    // orçamento. Não devolver isso como recusa definitiva da criação.
    if (created) fail("Orçamento criado, mas a leitura de conferência falhou. Não crie novamente; consulte pela referência do CRM.", "OLIST_CREATE_UNCERTAIN", 502, { olist_proposal_id: id, proposal_number: number });
    throw error;
  }
  return { success: true, olist_proposal_id: id, proposal_number: number ?? snapshot.number, contact_id: String(contact.id), created, snapshot };
}

/**
 * Recuperação após falha ambígua na criação: procura pelo mesmo cliente e
 * vendedor desde a data informada e confere a referência exata do CRM.
 */
export async function findCrmProposal(shop, raw, brand) {
  assertBrand(raw, brand);
  const reference = `CRM-${String(raw?.crm_proposal_id ?? "").slice(-10).toUpperCase()}`;
  if (!/^CRM-[A-Z0-9]{10}$/.test(reference)) fail("Identificador da proposta do CRM inválido.", "INVALID_CRM_PROPOSAL_ID", 400);
  const sellerId = requireOlistId(raw?.seller_olist_id, "do vendedor no Olist");
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.since ?? "")) ? raw.since : today();
  let contact;
  try {
    contact = await findOlistContactByTaxId(shop, raw?.tax_id);
  } catch (error) {
    if (error instanceof OlistApiError && error.status === 404) return { success: true, found: false };
    throw error;
  }
  const matches = [];
  let complete = false;
  for (let page = 0; page < 10; page++) {
    const list = await olistRequest(shop, "/orcamentos", { method: "GET", query: { dataInicio: since, dataFim: today(), idVendedor: sellerId, limit: 100, offset: page * 100 } });
    const items = Array.isArray(list?.itens) ? list.itens : [];
    for (const candidate of items.filter((o) => String(o?.contato?.id ?? "") === String(contact.id))) {
      const detail = await olistRequest(shop, `/orcamentos/${encodeURIComponent(candidate.id)}`, { method: "GET" });
      if (hasReference(detail?.observacao, reference)) matches.push(String(candidate.id));
    }
    if (items.length < 100 || Number(list?.paginacao?.total) <= (page + 1) * 100) { complete = true; break; }
  }
  if (matches.length > 1) fail("Mais de um orçamento tem a referência do CRM. Conciliação necessária.", "OLIST_PROPOSAL_AMBIGUOUS", 409);
  if (!complete) fail("Busca incompleta: nenhum novo orçamento será criado.", "OLIST_SEARCH_INCOMPLETE", 409);
  return { success: true, found: matches.length === 1, complete, ...(matches.length ? { olist_proposal_id: matches[0] } : {}) };
}

export async function getCrmProposal(shop, raw, brand) {
  assertBrand(raw, brand);
  return { success: true, snapshot: await readOrcamento(shop, requireOlistId(raw?.olist_proposal_id, "da proposta no Olist")) };
}

export async function setCrmProposalSituation(shop, raw, brand) {
  assertBrand(raw, brand);
  const id = requireOlistId(raw?.olist_proposal_id, "da proposta no Olist");
  const situation = String(raw?.situation ?? "");
  if (!PROPOSAL_SITUATIONS.has(situation)) fail("Situação inválida.", "INVALID_SITUATION", 400);
  await olistRequest(shop, `/orcamentos/${encodeURIComponent(id)}/situacao`, { method: "PUT", body: JSON.stringify({ situacao: situation }) });
  return { success: true };
}

export async function markCrmProposal(shop, raw, brand) {
  assertBrand(raw, brand);
  const id = requireOlistId(raw?.olist_proposal_id, "da proposta no Olist");
  const marker = String(raw?.marker ?? "");
  if (!ALLOWED_MARKERS.has(marker)) fail("Marcador não permitido.", "INVALID_MARKER", 400);
  await olistRequest(shop, `/orcamentos/${encodeURIComponent(id)}/marcadores`, { method: "POST", body: JSON.stringify([{ descricao: marker }]) });
  return { success: true };
}

/**
 * Gera a venda nativa (POST /orcamentos/{id}/venda). Uma única chamada, sem
 * repetição automática: em timeout o CRM marca a conversão como incerta.
 */
export async function convertCrmProposal(shop, raw, brand) {
  assertBrand(raw, brand);
  const id = requireOlistId(raw?.olist_proposal_id, "da proposta no Olist");
  const current = await readOrcamento(shop, id);
  if (current.situation === "Concluído") fail("O Olist indica a proposta como concluída. Vincule o pedido existente no CRM.", "OLIST_PROPOSAL_CONCLUDED", 409);
  const response = await olistRequest(shop, `/orcamentos/${encodeURIComponent(id)}/venda`, { method: "POST" });
  if (!response?.id) fail("O Olist não devolveu o pedido gerado.", "OLIST_ORDER_ID_MISSING", 502);
  let order = null;
  try {
    order = normalizeOrder(await retryOlistOrderRead(() => getOlistOrder(shop, response.id)));
  } catch {
    order = null; // o pedido existe; a conferência é refeita pelo CRM depois.
  }
  return { success: true, olist_order_id: String(response.id), order_number: response.numeroPedido ? String(response.numeroPedido) : null, order };
}

async function listReceivables(shop, orderId) {
  return paginated(shop, "/contas-receber", { idVenda: orderId });
}

async function paginated(shop, path, query) {
  const rows = [];
  for (let page = 0; page < 10; page++) {
    const result = await olistRequest(shop, path, { method: "GET", query: { ...query, limit: 100, offset: page * 100 } });
    if (!Array.isArray(result?.itens)) fail("Lista inválida devolvida pelo Olist.", "OLIST_INVALID_LIST", 502);
    rows.push(...result.itens);
    if (result.itens.length < 100 || Number(result?.paginacao?.total) <= rows.length) return rows;
  }
  fail("A consulta excedeu o limite de páginas. Resultado parcial não será usado.", "OLIST_SEARCH_INCOMPLETE", 409);
}

/** Aprovação do pedido existente. Somente situação 0 -> 3; não lança contas/estoque. */
export async function approveCrmOrder(shop, raw, brand) {
  assertBrand(raw, brand);
  const id = requireOlistId(raw?.olist_order_id, "do pedido no Olist");
  const detail = await getOlistOrder(shop, id);
  const code = Number(detail.situacao);
  const snapshot = (order) => JSON.stringify({ id: order.id, taxId: order.contact_tax_id, sellerId: order.seller_id, total: order.total_cents, items: [...order.items].sort((a, b) => a.sku.localeCompare(b.sku)) });
  if (!raw.expected_order || snapshot(normalizeOrder(detail)) !== snapshot(raw.expected_order)) fail("O pedido foi alterado depois da conferência. Consulte novamente.", "ORDER_APPROVAL_CONFLICT", 409);
  if (![0, 3].includes(code) || detail.situacao == null) fail("Somente pedidos em aberto podem ser aprovados. Consulte a situação atual.", "ORDER_NOT_OPEN", 409);
  if (code === 0) await olistRequest(shop, `/pedidos/${encodeURIComponent(id)}/situacao`, { method: "PUT", body: JSON.stringify({ situacao: 3 }) });
  const order = normalizeOrder(await getOlistOrder(shop, id));
  if (order.situation_code !== 3 || snapshot(order) !== snapshot(raw.expected_order)) fail("Aprovação sem confirmação ou pedido alterado. Consulte antes de tentar novamente.", "ORDER_APPROVAL_UNCONFIRMED", 409);
  return { success: true, order, already_approved: code === 3 };
}

/** Consultas sob demanda, sem chamadas de escrita ao ERP. */
export async function consultCrmOrder(shop, raw, brand) {
  assertBrand(raw, brand);
  const kind = String(raw?.kind ?? "");
  if (kind === "stock") {
    if (!Array.isArray(raw.skus) || raw.skus.length < 1 || raw.skus.length > 100) fail("Lista de produtos inválida.", "INVALID_SKUS", 422);
    const stock = [];
    for (const sku of [...new Set(raw.skus)]) {
      if (typeof sku !== "string" || !sku.trim() || sku.length > 120) fail("SKU inválido.", "INVALID_SKUS", 422);
      const product = await findOlistProductBySku(shop, sku);
      const s = await olistRequest(shop, `/estoque/${encodeURIComponent(product.id)}`, { method: "GET" });
      stock.push({ sku, available: s.disponivel != null && Number.isFinite(Number(s.disponivel)) ? Number(s.disponivel) : null, reserved: s.reservado != null && Number.isFinite(Number(s.reservado)) ? Number(s.reservado) : null });
    }
    return { success: true, stock, checked_at: new Date().toISOString() };
  }
  const id = requireOlistId(raw?.olist_order_id, "do pedido no Olist");
  const detail = await getOlistOrder(shop, id);
  if (kind === "financial") {
    const rows = await listReceivables(shop, id);
    const installments = [];
    const centsOrUnknown = (v) => v != null && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null;
    for (const r of rows) {
      const payments = await olistRequest(shop, `/contas-receber/${encodeURIComponent(requireOlistId(r.id, "da conta"))}/recebimentos`, { method: "GET" });
      if (!Array.isArray(payments)) fail("Recebimentos inválidos devolvidos pelo Olist.", "OLIST_INVALID_RECEIPTS", 502);
      installments.push({ id: String(r.id), due_date: r.dataVencimento ?? null, situation: r.situacao ?? null, amount_cents: centsOrUnknown(r.valor), balance_cents: centsOrUnknown(r.saldo), payments: payments.map((p) => ({ date: p.data, amount_cents: centsOrUnknown(p.valorPago) })) });
    }
    return { success: true, installments, checked_at: new Date().toISOString() };
  }
  if (kind !== "documents") fail("Consulta inválida.", "INVALID_CONSULTATION", 400);
  const safeLink = (value) => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; } };
  const invoiceId = detail.idNotaFiscal || detail.notaFiscal?.id;
  let invoiceLink = null;
  if (invoiceId) {
    const result = await olistRequest(shop, `/notas/${encodeURIComponent(requireOlistId(invoiceId, "da nota"))}/link`, { method: "GET" });
    invoiceLink = safeLink(result?.link);
  }
  return { success: true, invoice_id: invoiceId ? String(invoiceId) : null, invoice_number: detail.notaFiscal?.numero ?? null, invoice_link: invoiceLink, tracking_code: detail.transportador?.codigoRastreamento ?? null, tracking_link: safeLink(detail.transportador?.urlRastreamento), checked_at: new Date().toISOString() };
}

/** Pedido por id ou número, com as contas a receber da venda (somente leitura). */
export async function inspectCrmOrder(shop, raw, brand) {
  assertBrand(raw, brand);
  let orderId = raw?.olist_order_id ? requireOlistId(raw.olist_order_id, "do pedido no Olist") : null;
  if (!orderId) {
    const number = String(raw?.order_number ?? "").trim();
    if (!/^[0-9A-Za-z-]{1,30}$/.test(number)) fail("Número do pedido inválido.", "INVALID_ORDER_NUMBER", 400);
    const list = await olistRequest(shop, "/pedidos", { method: "GET", query: { numero: number, limit: 20, offset: 0 } });
    const match = (Array.isArray(list?.itens) ? list.itens : []).filter((o) => String(o?.numeroPedido ?? "") === number);
    if (match.length === 0) fail("Pedido não encontrado no Olist.", "OLIST_ORDER_NOT_FOUND", 404);
    if (match.length > 1) fail("Mais de um pedido com esse número.", "OLIST_ORDER_AMBIGUOUS", 409);
    orderId = String(match[0].id);
  }
  let detail;
  try {
    detail = await getOlistOrder(shop, orderId);
  } catch (error) {
    if (error instanceof OlistApiError && error.status === 404) fail("Pedido não encontrado no Olist.", "OLIST_ORDER_NOT_FOUND", 404);
    throw error;
  }
  return { success: true, order: normalizeOrder(detail, raw.include_receivables === false ? [] : await listReceivables(shop, orderId)) };
}

/** Vendedores cadastrados (GET /vendedores, paginado). */
export async function listCrmSellers(shop, raw, brand) {
  assertBrand(raw, brand);
  const sellers = [];
  for (let page = 0; page < 10; page += 1) {
    const response = await olistRequest(shop, "/vendedores", { method: "GET", query: { limit: 100, offset: page * 100 } });
    const items = Array.isArray(response?.itens) ? response.itens : [];
    sellers.push(...normalizeSellers(items));
    const total = Number(response?.paginacao?.total);
    if (items.length < 100 || (Number.isFinite(total) && sellers.length >= total)) break;
  }
  return { success: true, sellers };
}
