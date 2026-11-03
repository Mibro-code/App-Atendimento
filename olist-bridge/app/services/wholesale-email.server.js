import { createHash } from "node:crypto";

import {
  validateWholesalePayload,
  WholesaleOrderError,
} from "./wholesale-order.server";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_IMAGE_BASE64_LENGTH = 2_800_000;
const ALLOWED_EVENTS = new Set(["proposal", "olist_confirmed"]);
const BRAND_CONFIGURATION = {
  mibro: {
    name: "Mibro",
    tag: "mibro",
    primary: "#FF6633",
    primaryDark: "#D94D1F",
    background: "#FFF7F3",
    border: "#FFD5C7",
  },
  sincrofit: {
    name: "Sincrofit",
    tag: "sincrofit",
    primary: "#24a8b4",
    primaryDark: "#168793",
    background: "#f3f9fa",
    border: "#d7e7e9",
  },
};

export class WholesaleEmailError extends Error {
  constructor(message, { code = "WHOLESALE_EMAIL_ERROR", status = 500 } = {}) {
    super(message);
    this.name = "WholesaleEmailError";
    this.code = code;
    this.status = status;
  }
}

function fail(message, code, status = 400) {
  throw new WholesaleEmailError(message, { code, status });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

function money(cents) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((Number(cents) || 0) / 100);
}

function formatCnpj(cnpj) {
  return String(cnpj || "").replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
}

function displayCnpj(cnpj) {
  return cnpj ? formatCnpj(cnpj) : "N\u00e3o informado";
}

function formatAddress(address) {
  if (!address) return "Não informado";
  return [
    [address.street, address.number].filter(Boolean).join(", "),
    address.complement,
    address.district,
    [address.city, address.state].filter(Boolean).join("/"),
    address.zip,
    address.country,
  ].filter(Boolean).join(" — ");
}

function configuration() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.WHOLESALE_EMAIL_FROM || "").trim();
  const brandKey = String(process.env.WHOLESALE_BRAND || "mibro")
    .trim()
    .toLowerCase();
  const brand = BRAND_CONFIGURATION[brandKey] || BRAND_CONFIGURATION.mibro;
  const to = String(process.env.WHOLESALE_EMAIL_TO || "")
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

  if (!apiKey || !from || to.length === 0) {
    fail(
      "O envio por e-mail ainda não foi configurado no servidor.",
      "EMAIL_NOT_CONFIGURED",
      503,
    );
  }
  return { apiKey, from, to, brand };
}

function parseA4Image(dataUrl) {
  const value = String(dataUrl || "");
  if (!value || value.length > MAX_IMAGE_BASE64_LENGTH) {
    fail("A imagem A4 está ausente ou excede o limite permitido.", "INVALID_A4_IMAGE", 422);
  }
  const match = value.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) {
    fail("A imagem A4 possui formato inválido.", "INVALID_A4_IMAGE", 422);
  }
  return {
    extension: match[1] === "png" ? "png" : "jpg",
    content: match[2].replace(/\s/g, ""),
  };
}

function productsHtml(products) {
  return products.map((product) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #d7e7e9"><strong>${escapeHtml(product.name)}</strong><br><span style="font-size:12px;color:#5f696b">SKU: ${escapeHtml(product.sku)}</span></td>
      <td style="padding:10px;border-bottom:1px solid #d7e7e9;text-align:center">${product.quantity}</td>
      <td style="padding:10px;border-bottom:1px solid #d7e7e9;text-align:right">${money(product.unitPriceCents)}</td>
      <td style="padding:10px;border-bottom:1px solid #d7e7e9;text-align:right;font-weight:700">${money(product.quantity * product.unitPriceCents)}</td>
    </tr>`).join("");
}

function buildEmailHtml({ event, proposal, imageContentId, olistOrderId, brand }) {
  const title = event === "olist_confirmed" ? "Pedido enviado ao Olist" : "Nova proposta de atacado";
  const status = event === "olist_confirmed"
    ? "Pedido enviado para análise no Olist"
    : proposal.testMode ? "Proposta gerada em modo teste" : "Proposta comercial";
  const orderRow = olistOrderId
    ? `<tr><td style="padding:8px 0;color:#5f696b">Pedido Olist</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(olistOrderId)}</td></tr>`
    : "";
  const address = proposal.useRegisteredAddress
    ? proposal.registeredAddress
    : proposal.shippingAddress;

  const scopeNotice = proposal.simulationOnly
    ? `<div style="margin:18px 0;padding:14px 16px;border:1px solid ${brand.border};border-radius:12px;background:${brand.background};font-weight:700;color:${brand.primaryDark}">Simula&ccedil;&atilde;o: o total apresentado n&atilde;o inclui impostos nem frete.</div>`
    : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:${brand.background};font-family:Arial,Helvetica,sans-serif;color:#101516">
  <div style="max-width:760px;margin:0 auto;padding:28px 16px"><div style="background:#fff;border:1px solid ${brand.border};border-radius:18px;overflow:hidden">
    <div style="background:${brand.primary};color:#fff;padding:24px 28px"><div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${brand.name} · Condição comercial</div><h1 style="margin:8px 0 0;font-size:28px">${title}</h1></div>
    <div style="padding:26px 28px"><div style="display:inline-block;padding:7px 12px;border-radius:999px;background:${brand.background};color:${brand.primaryDark};font-size:12px;font-weight:700">${status}</div>${scopeNotice}
      <h2 style="margin:24px 0 10px;font-size:20px">Dados comerciais</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#5f696b">Empresa</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(proposal.companyName)}</td></tr>
        <tr><td style="padding:8px 0;color:#5f696b">CNPJ</td><td style="padding:8px 0;text-align:right">${escapeHtml(displayCnpj(proposal.cnpj))}</td></tr>
        <tr><td style="padding:8px 0;color:#5f696b">Comprador</td><td style="padding:8px 0;text-align:right">${escapeHtml(proposal.buyer || "Não informado")}</td></tr>
        <tr><td style="padding:8px 0;color:#5f696b">Vendedor</td><td style="padding:8px 0;text-align:right">${escapeHtml(proposal.seller || "Não informado")}</td></tr>
        <tr><td style="padding:8px 0;color:#5f696b">Telefone</td><td style="padding:8px 0;text-align:right">${escapeHtml(proposal.phone || "Não informado")}</td></tr>
        <tr><td style="padding:8px 0;color:#5f696b">E-mail</td><td style="padding:8px 0;text-align:right">${escapeHtml(proposal.email)}</td></tr>${orderRow}
        <tr><td style="padding:8px 0;color:#5f696b">Inscrição estadual</td><td style="padding:8px 0;text-align:right">${escapeHtml(proposal.stateRegistration || "Não informada")}</td></tr>
      </table>
      <h2 style="margin:24px 0 10px;font-size:20px">Produtos selecionados</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #d7e7e9"><thead style="background:#f3f9fa"><tr><th style="padding:10px;text-align:left">Produto</th><th style="padding:10px">Qtd.</th><th style="padding:10px;text-align:right">Unitário</th><th style="padding:10px;text-align:right">Subtotal</th></tr></thead><tbody>${productsHtml(proposal.products)}</tbody></table>
      <table style="width:100%;margin-top:16px;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#5f696b">Quantidade total</td><td style="padding:6px 0;text-align:right">${proposal.totalQuantity}</td></tr>
        <tr><td style="padding:6px 0;color:#5f696b">Subtotal</td><td style="padding:6px 0;text-align:right">${money(proposal.subtotalCents)}</td></tr>
        <tr><td style="padding:6px 0;color:#5f696b">Desconto</td><td style="padding:6px 0;text-align:right">− ${money(proposal.discountCents)}</td></tr>
        <tr><td style="padding:12px 0;font-size:18px;font-weight:700">Total comercial</td><td style="padding:12px 0;text-align:right;font-size:20px;font-weight:700;color:${brand.primaryDark}">${money(proposal.commercialTotalCents)}</td></tr>
      </table>
      <h2 style="margin:24px 0 8px;font-size:18px">Endereço</h2><p style="margin:0;color:#5f696b;line-height:1.55">${escapeHtml(formatAddress(address))}</p>
      ${proposal.notes ? `<h2 style="margin:24px 0 8px;font-size:18px">Observações</h2><p style="margin:0;color:#5f696b;white-space:pre-wrap">${escapeHtml(proposal.notes)}</p>` : ""}
      <h2 style="margin:26px 0 12px;font-size:18px">Imagem A4 da proposta</h2><img src="cid:${imageContentId}" alt="Resumo A4 da proposta" style="display:block;width:100%;height:auto;border:1px solid #d7e7e9">
    </div></div></div></body></html>`;
}

function buildText({ event, proposal, olistOrderId }) {
  const items = proposal.products.map((product) =>
    `${product.quantity}x ${product.name} | SKU ${product.sku} | ${money(product.unitPriceCents)} | ${money(product.quantity * product.unitPriceCents)}`,
  );
  const address = proposal.useRegisteredAddress
    ? proposal.registeredAddress
    : proposal.shippingAddress;
  return [
    event === "olist_confirmed" ? "PEDIDO ENVIADO AO OLIST" : "NOVA PROPOSTA DE ATACADO",
    olistOrderId ? `Pedido Olist: ${olistOrderId}` : null,
    proposal.simulationOnly
      ? "IMPORTANTE: o frete não está incluído e será calculado após a compra, conforme a forma de entrega ou retirada escolhida pelo cliente."
      : null,
    `Empresa: ${proposal.companyName}`,
    `CNPJ: ${displayCnpj(proposal.cnpj)}`,
    `Comprador: ${proposal.buyer || "Não informado"}`,
    `Vendedor: ${proposal.seller || "Não informado"}`,
    `Telefone: ${proposal.phone || "Não informado"}`,
    `E-mail: ${proposal.email}`,
    `Inscrição estadual: ${proposal.stateRegistration || "Não informada"}`,
    "PRODUTOS",
    ...items,
    `Quantidade total: ${proposal.totalQuantity}`,
    `Subtotal: ${money(proposal.subtotalCents)}`,
    `Desconto: ${money(proposal.discountCents)}`,
    `Total comercial: ${money(proposal.commercialTotalCents)}`,
    `Endereço: ${formatAddress(address)}`,
    `Observações: ${proposal.notes || "Nenhuma"}`,
  ].filter(Boolean).join("\n");
}

export async function sendWholesaleProposalEmail(shop, rawBody) {
  const event = String(rawBody?.event || "");
  if (!ALLOWED_EVENTS.has(event)) {
    fail("Tipo de envio de e-mail inválido.", "INVALID_EMAIL_EVENT");
  }

  const simulationOnly = rawBody?.proposal?.simulation_only === true;
  const proposal = validateWholesalePayload(rawBody?.proposal, {
    allowMissingCnpj: simulationOnly,
  });
  proposal.testMode = rawBody?.proposal?.test_mode === true;
  proposal.simulationOnly = simulationOnly;
  proposal.freightIncluded = rawBody?.proposal?.freight_included === true;
  const image = parseA4Image(rawBody?.a4_image);
  const olistOrderId = String(rawBody?.olist_order_id || rawBody?.proposal?.olist_order_id || "").trim().slice(0, 80);
  const config = configuration();
  const sendToCustomer = rawBody?.send_to_customer === true && proposal.simulationOnly;
  const recipients = sendToCustomer ? [proposal.email] : config.to;
  const blindCopy = sendToCustomer
    ? config.to.filter((email) => email.toLowerCase() !== proposal.email.toLowerCase()) : [];
  const imageContentId = `${config.brand.tag}-wholesale-a4`;
  const subject = `[${config.brand.name} Atacado] ${event === "olist_confirmed" ? "Pedido Olist" : "Proposta"} — ${proposal.companyName}`;
  const safeToken = proposal.publicToken.replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `${config.brand.tag}-${event}-${safeToken.slice(0, 32)}.${image.extension}`;
  const idempotencyHash = createHash("sha256")
    .update(JSON.stringify({ shop, event, proposal, olistOrderId, image: image.content }))
    .digest("hex").slice(0, 48);

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `wholesale-${event}-${idempotencyHash}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: recipients,
      ...(blindCopy.length ? { bcc: blindCopy } : {}),
      reply_to: sendToCustomer ? config.to[0] : proposal.email,
      subject,
      html: buildEmailHtml({
        event,
        proposal,
        imageContentId,
        olistOrderId,
        brand: config.brand,
      }),
      text: buildText({ event, proposal, olistOrderId }),
      attachments: [{ content: image.content, filename, content_id: imageContentId }],
      tags: [{ name: "brand", value: config.brand.tag }, { name: "event", value: event }],
    }),
  });

  const responseText = await response.text();
  let result = {};
  try { result = responseText ? JSON.parse(responseText) : {}; } catch { result = {}; }
  if (!response.ok || !result.id) {
    console.error("Falha no envio de e-mail de atacado", {
      shop,
      event,
      status: response.status,
      message: result?.message || responseText.slice(0, 500),
    });
    fail("Não foi possível enviar o e-mail da proposta.", "EMAIL_DELIVERY_FAILED", 502);
  }

  return {
    success: true,
    email_id: String(result.id),
    event,
    message: event === "olist_confirmed"
      ? "Pedido enviado ao Olist e por e-mail."
      : "Proposta enviada por e-mail.",
  };
}

export { WholesaleOrderError };