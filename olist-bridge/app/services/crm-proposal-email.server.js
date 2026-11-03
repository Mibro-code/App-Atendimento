// Envio da proposta do CRM por e-mail (mesmo provedor e configuração da
// página: RESEND_API_KEY, WHOLESALE_EMAIL_FROM, WHOLESALE_EMAIL_TO). Usado
// somente pela rota /internal/crm/proposals/email. Não usa a imagem A4 da
// página: os itens vão como tabela no corpo do e-mail.

import { createHash } from "node:crypto";
import process from "node:process";

import { CrmBridgeError } from "./crm-order-bridge-rules.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BRAND_STYLE = {
  mibro: { name: "Mibro", tag: "mibro", primary: "#FF6633", background: "#FFF7F3", border: "#FFD5C7" },
  sincrofit: { name: "Sincrofit", tag: "sincrofit", primary: "#24a8b4", background: "#f3f9fa", border: "#d7e7e9" },
};

function fail(message, code, status = 422) {
  throw new CrmBridgeError(message, { code, status });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(cents) {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function configuration(brandKey) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.WHOLESALE_EMAIL_FROM || "").trim();
  const internal = String(process.env.WHOLESALE_EMAIL_TO || "")
    .split(/[;,]/)
    .map((e) => e.trim())
    .filter((e) => EMAIL_RE.test(e));
  if (!apiKey || !from || internal.length === 0) {
    fail("O envio por e-mail ainda não foi configurado no servidor.", "EMAIL_NOT_CONFIGURED", 503);
  }
  return { apiKey, from, internal, style: BRAND_STYLE[brandKey] || BRAND_STYLE.mibro };
}

/** Valida a proposta enviada pelo CRM (somente exibição: valores já validados no CRM). */
export function validateCrmProposalEmail(raw, brand) {
  if (!raw || typeof raw !== "object") fail("Payload inválido.", "INVALID_PAYLOAD", 400);
  if (String(raw.brand || "").toLowerCase() !== brand.key) fail(`Esta integração atende somente ${brand.label}.`, "BRAND_MISMATCH", 409);
  const crmQuoteId = String(raw.crm_quote_id || "").trim();
  if (!/^[a-z0-9]{20,40}$/i.test(crmQuoteId)) fail("Identificador da cotação inválido.", "INVALID_CRM_QUOTE_ID", 400);
  const to = String(raw.to || "").trim().toLowerCase();
  if (!EMAIL_RE.test(to)) fail("E-mail do destinatário inválido.", "INVALID_EMAIL");
  const items = Array.isArray(raw.items) ? raw.items.slice(0, 100) : [];
  if (items.length === 0) fail("A proposta não tem itens.", "EMPTY_PRODUCTS");
  const lines = items.map((i) => {
    const quantity = Number(i?.quantity);
    const unit = Number(i?.unit_price_cents);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(unit) || unit <= 0) {
      fail("Item da proposta inválido.", "INVALID_ITEM");
    }
    return { name: String(i?.name || "").slice(0, 200), color: String(i?.color || "").slice(0, 80), sku: String(i?.sku || "").slice(0, 120), quantity, unit, subtotal: quantity * unit };
  });
  const subtotal = lines.reduce((t, l) => t + l.subtotal, 0);
  const discount = Number(raw.discount_cents || 0);
  if (!Number.isSafeInteger(discount) || discount < 0 || discount >= subtotal) fail("Desconto inválido.", "INVALID_DISCOUNT");
  const freight = Number(raw.freight_cents ?? 0);
  if (!Number.isSafeInteger(freight) || freight < 0 || freight > 100_000_000) fail("Frete inválido.", "INVALID_FREIGHT");
  return {
    crmQuoteId,
    to,
    customerName: String(raw.customer_name || "").slice(0, 200),
    sellerName: String(raw.seller_name || "").slice(0, 160),
    sellerEmail: EMAIL_RE.test(String(raw.seller_email || "")) ? String(raw.seller_email).trim() : null,
    notes: String(raw.notes || "").slice(0, 2000),
    lines,
    subtotal,
    discount,
    freight,
    commercialVersion: raw.commercial_version ?? null,
    paymentText: String(raw.payment_text ?? "").slice(0, 600),
    deliveryTerm: String(raw.delivery_term ?? "").slice(0, 200),
    validUntil: String(raw.valid_until ?? "").slice(0, 10),
    total: subtotal - discount + freight,
  };
}

export function buildCrmProposalHtml(p, style) {
  const rows = p.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid ${style.border}">${escapeHtml(l.name)}${l.color ? ` — ${escapeHtml(l.color)}` : ""}<br><small style="color:#777">${escapeHtml(l.sku)}</small></td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid ${style.border};text-align:right">${l.quantity}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid ${style.border};text-align:right">${money(l.unit)}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid ${style.border};text-align:right">${money(l.subtotal)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;background:${style.background};font-family:Arial,sans-serif;color:#222">
<div style="max-width:640px;margin:0 auto;padding:24px">
<h1 style="color:${style.primary};font-size:20px;margin:0 0 4px">Proposta ${escapeHtml(style.name)} Atacado</h1>
<p style="margin:0 0 16px;color:#555">${escapeHtml(p.customerName)}</p>
<table style="width:100%;border-collapse:collapse;background:#fff;font-size:14px">
<thead><tr style="background:${style.primary};color:#fff"><th style="padding:8px;text-align:left">Produto</th><th style="padding:8px;text-align:right">Qtd.</th><th style="padding:8px;text-align:right">Unitário</th><th style="padding:8px;text-align:right">Subtotal</th></tr></thead>
<tbody>${rows}</tbody></table>
<table style="width:100%;margin-top:12px;font-size:14px">
<tr><td>Subtotal</td><td style="text-align:right">${money(p.subtotal)}</td></tr>
${p.discount > 0 ? `<tr><td>Desconto</td><td style="text-align:right">− ${money(p.discount)}</td></tr>` : ""}
${p.commercialVersion ? `<tr><td>Frete</td><td style="text-align:right">${money(p.freight)}</td></tr>` : ""}
<tr><td style="font-weight:bold">Total</td><td style="text-align:right;font-weight:bold">${money(p.total)}</td></tr></table>
<p style="font-size:12px;color:#777">${p.commercialVersion ? `Versão ${escapeHtml(p.commercialVersion)}. Frete incluído no total informado. Impostos sujeitos à conferência no ERP.` : "Valores sem impostos e frete, que são calculados na emissão do pedido."} Proposta sujeita à disponibilidade de estoque.</p>
${[p.paymentText && `Pagamento: ${p.paymentText}`, p.deliveryTerm && `Prazo: ${p.deliveryTerm}`, p.validUntil && `Validade: ${p.validUntil}`].filter(Boolean).map((s) => `<p>${escapeHtml(s)}</p>`).join("")}
${p.notes ? `<p style="font-size:13px">${escapeHtml(p.notes)}</p>` : ""}
${p.sellerName ? `<p style="font-size:13px">Atendimento: ${escapeHtml(p.sellerName)}${p.sellerEmail ? ` — ${escapeHtml(p.sellerEmail)}` : ""}</p>` : ""}
</div></body></html>`;
}

export async function sendCrmProposalEmail(raw, brand) {
  const p = validateCrmProposalEmail(raw, brand);
  const config = configuration(brand.key);
  const idempotency = createHash("sha256")
    .update(JSON.stringify({ q: p.crmQuoteId, to: p.to, lines: p.lines, discount: p.discount, freight: p.freight, version: p.commercialVersion, payment: p.paymentText, delivery: p.deliveryTerm, validity: p.validUntil, notes: p.notes }))
    .digest("hex")
    .slice(0, 48);

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `crm-proposal-${idempotency}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: [p.to],
      bcc: config.internal.filter((e) => e.toLowerCase() !== p.to),
      reply_to: p.sellerEmail || config.internal[0],
      subject: `[${config.style.name} Atacado] Proposta — ${p.customerName || p.to}`,
      html: buildCrmProposalHtml(p, config.style),
      tags: [{ name: "brand", value: config.style.tag }, { name: "event", value: "crm_proposal" }],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.id) {
    console.error("CRM_PROPOSAL_EMAIL_FAILED", { status: response.status, message: body?.message });
    fail("Não foi possível enviar o e-mail da proposta.", "EMAIL_DELIVERY_FAILED", 502);
  }
  return { success: true, email_id: String(body.id), sent_to: p.to };
}
