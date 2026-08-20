const prisma = require("../database/prisma");
const { updateConversationAfterSending } = require("./message-service");

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PLACEHOLDER = /{{\s*([^{}]+?)\s*}}/g;

function customerServiceWindowFrom(lastCustomerMessageAt, now = new Date()) {
  const last = lastCustomerMessageAt ? new Date(lastCustomerMessageAt) : null;
  const expiresAt = last ? new Date(last.getTime() + CUSTOMER_SERVICE_WINDOW_MS) : null;
  const open = Boolean(expiresAt && expiresAt.getTime() > now.getTime());
  return {
    open,
    requiresTemplate: !open,
    lastCustomerMessageAt: last?.toISOString() || null,
    expiresAt: expiresAt?.toISOString() || null,
    remainingSeconds: open ? Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)) : 0,
  };
}

async function getCustomerServiceWindow(conversationId, now = new Date()) {
  const latest = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "RECEBIDA",
      type: { not: "reaction" },
      externalId: { startsWith: "wamid." },
    },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  return customerServiceWindowFrom(latest?.occurredAt, now);
}

async function assertFreeFormAllowed(conversationId) {
  const window = await getCustomerServiceWindow(conversationId);
  if (!window.open) {
    throw Object.assign(new Error("A janela de 24 horas da Meta está encerrada. Envie um template aprovado para retomar o contato."), {
      statusCode: 409,
      code: "TEMPLATE_REQUIRED",
      details: { customerServiceWindow: window },
    });
  }
  return window;
}

function placeholders(text) {
  const found = [];
  for (const match of String(text || "").matchAll(PLACEHOLDER)) if (!found.includes(match[1])) found.push(match[1]);
  return found;
}

function componentExample(component, placeholder, index) {
  if (component.type === "BODY") {
    if (component.example?.body_text_named_params) {
      return component.example.body_text_named_params.find((item) => item.param_name === placeholder)?.example || "";
    }
    return component.example?.body_text?.[0]?.[index] || "";
  }
  if (component.type === "HEADER") return component.example?.header_text?.[index] || "";
  if (component.type === "BUTTONS") return component.example?.[index] || "";
  return "";
}

function templateVariables(template) {
  const variables = [];
  for (const component of template.components || []) {
    if (["BODY", "HEADER"].includes(component.type) && component.format !== "IMAGE" && component.format !== "VIDEO" && component.format !== "DOCUMENT") {
      placeholders(component.text).forEach((placeholder, index) => variables.push({
        key: `${component.type}:${placeholder}`,
        component: component.type,
        placeholder,
        label: `${component.type === "HEADER" ? "Cabeçalho" : "Mensagem"} — {{${placeholder}}}`,
        example: componentExample(component, placeholder, index),
      }));
    }
    if (component.type === "BUTTONS") {
      (component.buttons || []).forEach((button, index) => {
        if (button.type === "URL" && placeholders(button.url).length) variables.push({
          key: `BUTTON:${index}`,
          component: "BUTTON",
          placeholder: String(index),
          label: `Link do botão “${button.text || index + 1}”`,
          example: button.example?.[0] || "",
        });
      });
    }
  }
  return variables;
}

function renderText(text, variables, values) {
  let rendered = String(text || "");
  for (const variable of variables) {
    if (!["BODY", "HEADER"].includes(variable.component)) continue;
    const replacement = String(values[variable.key] || variable.example || `{{${variable.placeholder}}}`);
    rendered = rendered.replaceAll(`{{${variable.placeholder}}}`, replacement);
  }
  return rendered;
}

function normalizeTemplate(template) {
  const variables = templateVariables(template);
  const defaults = Object.fromEntries(variables.map((variable) => [variable.key, variable.example]));
  const header = (template.components || []).find((component) => component.type === "HEADER");
  const body = (template.components || []).find((component) => component.type === "BODY");
  const footer = (template.components || []).find((component) => component.type === "FOOTER");
  const unsupportedHeader = header && ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(header.format);
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    supported: !unsupportedHeader,
    unsupportedReason: unsupportedHeader ? `O template usa cabeçalho ${String(header.format).toLowerCase()}, ainda não disponível neste envio.` : null,
    preview: [renderText(header?.text, variables, defaults), renderText(body?.text, variables, defaults), footer?.text]
      .filter(Boolean).join("\n\n"),
    previewTemplate: [header?.text, body?.text, footer?.text].filter(Boolean).join("\n\n"),
    variables,
  };
}

async function listApprovedTemplates(channel) {
  return (await channel.listMessageTemplates())
    .map(normalizeTemplate)
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

function templateComponents(template, values) {
  const variables = templateVariables(template);
  const components = [];
  for (const type of ["HEADER", "BODY"]) {
    const selected = variables.filter((variable) => variable.component === type);
    if (!selected.length) continue;
    components.push({
      type: type.toLowerCase(),
      parameters: selected.map((variable) => ({
        type: "text",
        text: String(values[variable.key] || "").trim(),
        ...(!/^\d+$/.test(variable.placeholder) ? { parameter_name: variable.placeholder } : {}),
      })),
    });
  }
  for (const variable of variables.filter((item) => item.component === "BUTTON")) {
    components.push({
      type: "button", sub_type: "url", index: variable.placeholder,
      parameters: [{ type: "text", text: String(values[variable.key] || "").trim() }],
    });
  }
  return components;
}

async function sendApprovedTemplate({ conversationId, name, language, values = {}, sentByUserId, channel }) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } });
  if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  const templates = await channel.listMessageTemplates();
  const template = templates.find((item) => item.name === name && item.language === language && item.status === "APPROVED");
  if (!template) throw Object.assign(new Error("Template aprovado não encontrado na Meta."), { statusCode: 404 });
  const normalized = normalizeTemplate(template);
  if (!normalized.supported) throw Object.assign(new Error(normalized.unsupportedReason), { statusCode: 400 });
  for (const variable of normalized.variables) {
    if (!String(values[variable.key] || "").trim()) {
      throw Object.assign(new Error(`Preencha a variável ${variable.label}.`), { statusCode: 400 });
    }
  }
  const components = templateComponents(template, values);
  const result = await channel.sendTemplate(conversation.contact.phone, { name, language, components });
  const occurredAt = new Date();
  const preview = [
    ...(template.components || []).filter((item) => ["HEADER", "BODY"].includes(item.type)).map((item) => renderText(item.text, normalized.variables, values)),
    (template.components || []).find((item) => item.type === "FOOTER")?.text,
  ].filter(Boolean).join("\n\n");
  const message = await prisma.message.create({ data: {
    conversationId, externalId: result.externalId, channel: conversation.channel,
    direction: "ENVIADA", status: "ENVIADA", type: "template", text: preview,
    occurredAt, sentByUserId: sentByUserId || null,
    rawPayload: { message: result.data, template: { name, language, category: template.category, values } },
  } });
  await updateConversationAfterSending({ conversationId, sentByUserId, occurredAt });
  return { message, providerData: result.data };
}

module.exports = {
  CUSTOMER_SERVICE_WINDOW_MS,
  assertFreeFormAllowed,
  customerServiceWindowFrom,
  getCustomerServiceWindow,
  listApprovedTemplates,
  normalizeTemplate,
  sendApprovedTemplate,
  templateComponents,
};
